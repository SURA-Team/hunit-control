/**
 * Acompanhamento das execuções e dos envios ao Comercial no processo principal (specs/002, FR-011
 * a FR-016, FR-019, research R-06 e R-07; specs/005, research R-14).
 *
 * Execuções e envios (`JobRef`) seguem as mesmas regras: os dois pedem o token do Hunit e
 * terminam com uma notificação.
 *
 * - Ao começar a acompanhar, busca o estado atual (GET) e abre o fluxo de eventos (SSE) a partir
 *   do evento mais recente: o histórico não é reprocessado — um pedido de token já passado não
 *   reabre o diálogo —, e uma execução encontrada aguardando token abre o pedido (FR-019).
 * - Os eventos são só sinais: a cada um, a interface é avisada e busca o estado de novo pelo GET.
 *   O app não soma eventos nem recalcula nada (princípio III).
 * - Pedido de token só para as execuções desta máquina (FR-012); as das outras máquinas são
 *   acompanhadas só para exibição.
 * - Queda do fluxo: reconecta com `Last-Event-ID`. O servidor manda um batimento a cada 15 s;
 *   sem nada por 45 s, o fluxo é dado como parado e reaberto.
 */
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type {
  AppError,
  ClassificationCounts,
  CommercialDispatch,
  CommercialDispatchListInput,
  CommercialDispatchSummary,
  Execution,
  ExecutionEndReason,
  ExecutionListInput,
  ExecutionStatus,
  ExecutionSummary,
  JobRef,
  Page,
  Result,
  TwoFactorCloseReason,
  TwoFactorClosed,
  TwoFactorRequest,
} from '../shared/ipc-types.js';

/** O que o acompanhamento usa do cliente da API. */
export interface WatcherApi {
  getExecution(executionId: string): Promise<Result<Execution>>;
  listExecutions(input: ExecutionListInput): Promise<Result<Page<ExecutionSummary>>>;
  openEventStream(executionId: string, options: StreamOptions): Promise<Result<EventStream>>;
  getCommercialDispatch(dispatchId: string): Promise<Result<CommercialDispatch>>;
  listCommercialDispatches(
    input: CommercialDispatchListInput,
  ): Promise<Result<Page<CommercialDispatchSummary>>>;
  openDispatchEventStream(dispatchId: string, options: StreamOptions): Promise<Result<EventStream>>;
  clockOffsetMs(): number;
}

interface StreamOptions {
  lastEventId?: string | undefined;
  signal?: AbortSignal | undefined;
}

interface EventStream {
  body: ReadableStream<Uint8Array> | null;
}

export interface FinishedSummary {
  job: JobRef;
  title: string;
  body: string;
}

export interface ExecutionWatcherOptions {
  getApi(): WatcherApi | null;
  /** Chegou evento de uma execução ou envio acompanhado: a interface busca o estado de novo. */
  onChanged(job: JobRef): void;
  onTwoFactorRequested(request: TwoFactorRequest): void;
  onTwoFactorClosed(event: TwoFactorClosed): void;
  /** Uma execução ou envio desta máquina terminou (FR-014). */
  onFinished(summary: FinishedSummary): void;
  /** Erro de rede, certificado ou chave: o estado da conexão reflete. */
  reportFailure(error: AppError): void;
  /** Espera antes de reabrir um fluxo que caiu. Padrão: 2 s. */
  reconnectDelayMs?: number;
  /** Sem nenhum dado (nem batimento) por este tempo, o fluxo é reaberto. Padrão: 45 s. */
  idleTimeoutMs?: number;
}

const FINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(['completed', 'failed', 'cancelled']);

/** O que o acompanhamento usa do estado de uma execução ou de um envio. */
interface JobSnapshot {
  status: ExecutionStatus;
  /** Só em envios (specs/008). */
  purpose?: CommercialDispatch['purpose'];
  endReason: ExecutionEndReason | null;
  twoFactorDeadline: string | null;
  /** Evento mais recente: o fluxo é aberto depois dele (o histórico não é reprocessado). */
  lastEventId: string | undefined;
  summary: () => FinishedSummary;
}

interface Tracked {
  job: JobRef;
  /** Iniciada ou retomada nesta máquina: recebe o pedido de token e a notificação de fim. */
  own: boolean;
  /** Telas que mostram a execução agora. */
  viewers: number;
  lastEventId: string | undefined;
  /** O pedido de token está aberto na interface. */
  awaiting: boolean;
  /** O token deste pedido foi enviado por esta máquina. */
  tokenSent: boolean;
  /**
   * A execução saiu da espera do token e o Hunit está conferindo o token: o servidor volta a
   * `running` antes da resposta do Hunit. O pedido fecha como aceito no primeiro evento de
   * andamento (acesso concluído) ou como recusado se a execução falhar.
   */
  verifying: boolean;
  finished: boolean;
  running: boolean;
  controller: AbortController | null;
  /** Os eventos de estado são tratados um por vez, na ordem em que chegaram. */
  queue: Promise<void>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jobKey = (job: JobRef) => `${job.kind}:${job.id}`;

/** Um texto sozinho é o id de uma execução (a forma usada desde a 002). */
const toJob = (target: string | JobRef): JobRef =>
  typeof target === 'string' ? { kind: 'execution', id: target } : target;

export class ExecutionWatcher {
  private readonly tracked = new Map<string, Tracked>();
  private readonly reconnectDelayMs: number;
  private readonly idleTimeoutMs: number;
  private stopped = false;

  constructor(private readonly options: ExecutionWatcherOptions) {
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
  }

  /** Execução ou envio desta máquina (iniciado, retomado ou encontrado ativo ao conectar). */
  track(target: string | JobRef, { own }: { own: boolean }): void {
    const entry = this.entry(toJob(target));
    if (own) entry.own = true;
    this.ensureRunning(entry);
  }

  /** Uma tela passou a mostrar a execução ou o envio (de qualquer máquina). */
  watch(target: string | JobRef): void {
    const entry = this.entry(toJob(target));
    entry.viewers += 1;
    this.ensureRunning(entry);
  }

  unwatch(target: string | JobRef): void {
    const entry = this.tracked.get(jobKey(toJob(target)));
    if (!entry) return;
    entry.viewers = Math.max(0, entry.viewers - 1);
    if (!entry.own && entry.viewers === 0) this.forget(entry);
  }

  /** O token foi enviado por esta máquina: a saída da espera conta como "aceito". */
  noteTokenSent(target: string | JobRef): void {
    const entry = this.tracked.get(jobKey(toJob(target)));
    if (entry) entry.tokenSent = true;
  }

  /** Execuções e envios desta máquina ainda ativos (aviso ao fechar a janela, FR-026). */
  ownActive(): JobRef[] {
    return [...this.tracked.values()]
      .filter((entry) => entry.own && !entry.finished)
      .map((entry) => entry.job);
  }

  /**
   * Ao conectar ou reconectar: acompanha as execuções e os envios ativos iniciados por este
   * cliente (`requestedClient` igual ao nome do `/me`), inclusive retomando um pedido de token
   * (FR-019).
   */
  async resumeOwn(clientName: string): Promise<void> {
    const api = this.options.getApi();
    if (!api) return;
    const [executions, dispatches] = await Promise.all([
      api.listExecutions({ active: true, limit: 50 }),
      // Envios e verificações da fila "Cobradas no Hunit": as duas pedem o token (specs/008).
      api.listCommercialDispatches({ active: true, limit: 50, purpose: 'all' }),
    ]);
    if (!executions.ok) {
      this.options.reportFailure(executions.error);
    } else {
      for (const execution of executions.data.items) {
        if (execution.requestedClient === clientName) this.track(execution.id, { own: true });
      }
    }
    // Servidor anterior à 1.7.0 não tem envios (404): nada a acompanhar.
    if (!dispatches.ok) {
      if (dispatches.error.code !== 'not_found') this.options.reportFailure(dispatches.error);
      return;
    }
    for (const dispatch of dispatches.data.items) {
      if (dispatch.requestedClient === clientName) {
        this.track({ kind: 'dispatch', id: dispatch.id }, { own: true });
      }
    }
  }

  stopAll(): void {
    this.stopped = true;
    for (const entry of this.tracked.values()) this.forget(entry);
  }

  private entry(job: JobRef): Tracked {
    this.stopped = false;
    let entry = this.tracked.get(jobKey(job));
    if (!entry || entry.finished) {
      entry = {
        job,
        own: false,
        viewers: 0,
        lastEventId: undefined,
        awaiting: false,
        tokenSent: false,
        verifying: false,
        finished: false,
        running: false,
        controller: null,
        queue: Promise.resolve(),
      };
      this.tracked.set(jobKey(job), entry);
    }
    return entry;
  }

  private forget(entry: Tracked): void {
    entry.finished = true;
    entry.controller?.abort();
    if (this.tracked.get(jobKey(entry.job)) === entry) this.tracked.delete(jobKey(entry.job));
  }

  private isActive(entry: Tracked): boolean {
    return (
      !this.stopped &&
      !entry.finished &&
      this.tracked.get(jobKey(entry.job)) === entry &&
      (entry.own || entry.viewers > 0)
    );
  }

  private ensureRunning(entry: Tracked): void {
    if (entry.running || entry.finished) return;
    entry.running = true;
    void this.run(entry).finally(() => {
      entry.running = false;
    });
  }

  private async run(entry: Tracked): Promise<void> {
    let synced = false;
    while (this.isActive(entry)) {
      const api = this.options.getApi();
      if (!api) return;

      if (!synced) {
        const state = await fetchJob(api, entry.job);
        if (!state.ok) {
          this.options.reportFailure(state.error);
          if (state.error.code === 'not_found') return this.forget(entry);
          await delay(this.reconnectDelayMs);
          continue;
        }
        entry.lastEventId = state.data.lastEventId ?? entry.lastEventId;
        await this.applyState(entry, state.data, { initial: true });
        synced = true;
        if (!this.isActive(entry)) return;
      }

      const controller = new AbortController();
      entry.controller = controller;
      const options = { lastEventId: entry.lastEventId, signal: controller.signal };
      const opened =
        entry.job.kind === 'execution'
          ? await api.openEventStream(entry.job.id, options)
          : await api.openDispatchEventStream(entry.job.id, options);
      if (!opened.ok) {
        this.options.reportFailure(opened.error);
        if (opened.error.code === 'not_found') return this.forget(entry);
      } else if (opened.data.body) {
        await this.consume(entry, opened.data.body, controller);
        await entry.queue;
      }
      if (this.isActive(entry)) await delay(this.reconnectDelayMs);
    }
  }

  /** Lê o fluxo até ele terminar, cair ou ficar parado. */
  private async consume(
    entry: Tracked,
    body: ReadableStream<Uint8Array>,
    controller: AbortController,
  ): Promise<void> {
    const parser = createParser({ onEvent: (event) => this.onEvent(entry, event) });
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let idleTimer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Fluxo interrompido (rede, parada ou fim do acompanhamento): o laço decide se reabre.
    } finally {
      clearTimeout(idleTimer);
      reader.releaseLock();
    }
  }

  private onEvent(entry: Tracked, event: EventSourceMessage): void {
    if (event.id) entry.lastEventId = event.id;
    this.options.onChanged(entry.job);

    let status: ExecutionStatus | undefined;
    if (event.event === 'status_changed') {
      try {
        status = (JSON.parse(event.data) as { status?: ExecutionStatus }).status;
      } catch {
        return;
      }
      if (!status) return;
    }
    const next = status;
    // Todos os eventos passam pela mesma fila: o andamento que confirma o token é tratado depois
    // da mudança de estado que o antecedeu.
    entry.queue = entry.queue
      .then(() => (next ? this.onStatus(entry, next) : this.onProgress(entry)))
      .catch(() => undefined);
  }

  /** Um evento de andamento depois de `running`: o Hunit aceitou o token (acesso concluído). */
  private onProgress(entry: Tracked): Promise<void> {
    if (entry.verifying)
      this.closeRequest(entry, entry.tokenSent ? 'accepted' : 'answered_elsewhere');
    return Promise.resolve();
  }

  private closeRequest(entry: Tracked, reason: TwoFactorCloseReason): void {
    this.options.onTwoFactorClosed({ job: entry.job, reason });
    entry.awaiting = false;
    entry.verifying = false;
    entry.tokenSent = false;
  }

  private async onStatus(entry: Tracked, status: ExecutionStatus): Promise<void> {
    const pending = entry.awaiting || entry.verifying;
    const needsState = status === 'awaiting_2fa' || pending || FINAL_STATUSES.has(status);
    if (!needsState || !(entry.own || pending)) {
      if (FINAL_STATUSES.has(status)) this.finish(entry, null);
      return;
    }
    const api = this.options.getApi();
    if (!api) return;
    const state = await fetchJob(api, entry.job);
    if (!state.ok) {
      this.options.reportFailure(state.error);
      if (FINAL_STATUSES.has(status)) this.finish(entry, null);
      return;
    }
    await this.applyState(entry, { ...state.data, status }, { initial: false });
  }

  private applyState(
    entry: Tracked,
    execution: JobSnapshot,
    { initial }: { initial: boolean },
  ): Promise<void> {
    const api = this.options.getApi();

    if (execution.status === 'awaiting_2fa') {
      if (entry.own && !entry.awaiting && execution.twoFactorDeadline && api) {
        entry.awaiting = true;
        entry.tokenSent = false;
        this.options.onTwoFactorRequested({
          job: entry.job,
          ...(execution.purpose && { purpose: execution.purpose }),
          deadline: execution.twoFactorDeadline,
          clockOffsetMs: api.clockOffsetMs(),
        });
      }
      return Promise.resolve();
    }

    if (entry.awaiting && (execution.status === 'running' || execution.status === 'queued')) {
      // Saiu da espera: o Hunit ainda confere o token.
      entry.awaiting = false;
      entry.verifying = true;
    } else if (entry.awaiting || entry.verifying) {
      this.closeRequest(entry, closeReason(execution.status, execution.endReason));
    }

    if (FINAL_STATUSES.has(execution.status)) {
      // Encontrada já encerrada ao começar a acompanhar: não é "terminou agora".
      this.finish(entry, initial ? null : execution);
    }
    return Promise.resolve();
  }

  private finish(entry: Tracked, job: JobSnapshot | null): void {
    if (entry.finished) return;
    if (job && entry.own) this.options.onFinished(job.summary());
    this.forget(entry);
  }
}

/** Estado atual de uma execução ou de um envio, pelo GET. */
async function fetchJob(api: WatcherApi, job: JobRef): Promise<Result<JobSnapshot>> {
  if (job.kind === 'execution') {
    const state = await api.getExecution(job.id);
    if (!state.ok) return state;
    const execution = state.data;
    return {
      ok: true,
      data: {
        status: execution.status,
        endReason: execution.endReason ?? null,
        twoFactorDeadline: execution.twoFactorDeadline ?? null,
        lastEventId: latestEventId(execution),
        summary: () => summarize(execution),
      },
    };
  }
  const state = await api.getCommercialDispatch(job.id);
  if (!state.ok) return state;
  const dispatch = state.data;
  return {
    ok: true,
    data: {
      status: dispatch.status,
      purpose: dispatch.purpose,
      endReason: dispatch.endReason ?? null,
      twoFactorDeadline: dispatch.twoFactorDeadline,
      lastEventId: dispatch.lastEventId ?? undefined,
      summary: () => summarizeDispatch(dispatch),
    },
  };
}

function latestEventId(execution: Execution): string | undefined {
  let latest: number | undefined;
  for (const event of execution.recentEvents) {
    const id = Number(event.id);
    if (Number.isFinite(id) && (latest === undefined || id > latest)) latest = id;
  }
  return latest === undefined ? undefined : String(latest);
}

/** Desfecho do pedido quando a execução termina antes de o acesso ao Hunit ser concluído. */
function closeReason(
  status: ExecutionStatus,
  endReason: ExecutionEndReason | null,
): TwoFactorCloseReason {
  if (status === 'failed' && endReason === 'invalid_token') return 'rejected';
  if (status === 'failed' && endReason === 'two_factor_timeout') return 'expired';
  return 'finished';
}

/** Mensagens curtas do motivo de término, para a notificação de fim (data-model §6.4). */
const END_REASONS: Record<ExecutionEndReason, string> = {
  invalid_credentials: 'Usuário ou senha do Hunit incorretos.',
  invalid_token: 'O Hunit recusou o token.',
  two_factor_timeout: 'O prazo para informar o token terminou.',
  hunit_unavailable: 'O Hunit não respondeu.',
  hunit_screen_not_recognized: 'Uma tela ou resposta do Hunit não foi reconhecida.',
  session_expired: 'A sessão no Hunit expirou durante a execução.',
  server_restarted: 'O servidor reiniciou durante a execução. É possível retomar.',
  cancelled_by_client: 'Cancelada por um operador.',
  internal_error: 'Erro interno do servidor.',
};

function total(counts: ClassificationCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
}

/** Resultado resumido da notificação de fim (FR-014). */
export function summarize(execution: Execution): FinishedSummary {
  const reservations = total(execution.counts);
  const pending = execution.counts.virtual_card_pending_charge ?? 0;
  const failedHotels = execution.hotels.filter((hotel) => hotel.status === 'failed').length;
  const parts = [`${reservations} reservas`];
  if (pending > 0) parts[0] += `: ${pending} pendentes de cobrança`;
  if (failedHotels > 0) parts.push(`${failedHotels} hotel(is) com falha`);

  switch (execution.status) {
    case 'completed':
      return {
        job: { kind: 'execution', id: execution.id },
        title: 'Execução concluída',
        body: `${parts.join('; ')}.`,
      };
    case 'cancelled':
      return {
        job: { kind: 'execution', id: execution.id },
        title: 'Execução cancelada',
        body: `${parts.join('; ')}.`,
      };
    default:
      return {
        job: { kind: 'execution', id: execution.id },
        title: 'Execução falhou',
        body: execution.endReason ? END_REASONS[execution.endReason] : `${parts.join('; ')}.`,
      };
  }
}

/** Resultado resumido de um envio ao Comercial, para a notificação de fim (specs/005). */
export function summarizeDispatch(dispatch: CommercialDispatch): FinishedSummary {
  const job: JobRef = { kind: 'dispatch', id: dispatch.id };
  if (dispatch.purpose === 'hunit_check') return summarizeHunitCheck(dispatch, job);
  const { sent, withdrawn, notVerified, ignored } = dispatch.counts;
  const parts = [`${sent} enviada(s)`];
  if (withdrawn > 0) parts.push(`${withdrawn} retirada(s)`);
  if (notVerified > 0) parts.push(`${notVerified} não verificada(s)`);
  if (ignored > 0) parts.push(`${ignored} fora do envio`);
  const body = `${parts.join('; ')}.`;

  switch (dispatch.status) {
    case 'completed':
      return { job, title: 'Envio ao Comercial concluído', body };
    case 'cancelled':
      return { job, title: 'Envio ao Comercial cancelado', body };
    default:
      return {
        job,
        title: 'Envio ao Comercial falhou',
        body: dispatch.endReason ? END_REASONS[dispatch.endReason] : body,
      };
  }
}

/** Fim de uma verificação da fila "Cobradas no Hunit" (specs/008). */
function summarizeHunitCheck(dispatch: CommercialDispatch, job: JobRef): FinishedSummary {
  const confirmed = dispatch.items.filter((item) => item.checkResult === 'confirmed').length;
  const notFound = dispatch.items.filter((item) => item.checkResult === 'not_found').length;
  const parts = [`${confirmed} com a cobrança no Hunit`, `${notFound} sem a cobrança`];
  if (dispatch.counts.notVerified > 0)
    parts.push(`${dispatch.counts.notVerified} não verificada(s)`);
  const body = `${parts.join('; ')}.`;
  switch (dispatch.status) {
    case 'completed':
      return { job, title: 'Verificação no Hunit concluída', body };
    case 'cancelled':
      return { job, title: 'Verificação no Hunit cancelada', body };
    default:
      return {
        job,
        title: 'Verificação no Hunit falhou',
        body: dispatch.endReason ? END_REASONS[dispatch.endReason] : body,
      };
  }
}
