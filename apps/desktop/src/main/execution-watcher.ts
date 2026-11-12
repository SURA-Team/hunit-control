/**
 * Acompanhamento das execuções no processo principal (specs/002, FR-011 a FR-016, FR-019,
 * research R-06 e R-07).
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
  Execution,
  ExecutionEndReason,
  ExecutionListInput,
  ExecutionStatus,
  ExecutionSummary,
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
  openEventStream(
    executionId: string,
    options: { lastEventId?: string | undefined; signal?: AbortSignal | undefined },
  ): Promise<Result<{ body: ReadableStream<Uint8Array> | null }>>;
  clockOffsetMs(): number;
}

export interface FinishedSummary {
  executionId: string;
  title: string;
  body: string;
}

export interface ExecutionWatcherOptions {
  getApi(): WatcherApi | null;
  /** Chegou evento de uma execução acompanhada: a interface busca o estado de novo. */
  onChanged(executionId: string): void;
  onTwoFactorRequested(request: TwoFactorRequest): void;
  onTwoFactorClosed(event: TwoFactorClosed): void;
  /** Uma execução desta máquina terminou (FR-014). */
  onFinished(summary: FinishedSummary): void;
  /** Erro de rede, certificado ou chave: o estado da conexão reflete. */
  reportFailure(error: AppError): void;
  /** Espera antes de reabrir um fluxo que caiu. Padrão: 2 s. */
  reconnectDelayMs?: number;
  /** Sem nenhum dado (nem batimento) por este tempo, o fluxo é reaberto. Padrão: 45 s. */
  idleTimeoutMs?: number;
}

const FINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(['completed', 'failed', 'cancelled']);

interface Tracked {
  executionId: string;
  /** Iniciada ou retomada nesta máquina: recebe o pedido de token e a notificação de fim. */
  own: boolean;
  /** Telas que mostram a execução agora. */
  viewers: number;
  lastEventId: string | undefined;
  /** O pedido de token está aberto na interface. */
  awaiting: boolean;
  /** O token deste pedido foi enviado por esta máquina. */
  tokenSent: boolean;
  finished: boolean;
  running: boolean;
  controller: AbortController | null;
  /** Os eventos de estado são tratados um por vez, na ordem em que chegaram. */
  queue: Promise<void>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ExecutionWatcher {
  private readonly tracked = new Map<string, Tracked>();
  private readonly reconnectDelayMs: number;
  private readonly idleTimeoutMs: number;
  private stopped = false;

  constructor(private readonly options: ExecutionWatcherOptions) {
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
  }

  /** Execução desta máquina (iniciada, retomada ou encontrada ativa ao conectar). */
  track(executionId: string, { own }: { own: boolean }): void {
    const entry = this.entry(executionId);
    if (own) entry.own = true;
    this.ensureRunning(entry);
  }

  /** Uma tela passou a mostrar a execução (de qualquer máquina). */
  watch(executionId: string): void {
    const entry = this.entry(executionId);
    entry.viewers += 1;
    this.ensureRunning(entry);
  }

  unwatch(executionId: string): void {
    const entry = this.tracked.get(executionId);
    if (!entry) return;
    entry.viewers = Math.max(0, entry.viewers - 1);
    if (!entry.own && entry.viewers === 0) this.forget(entry);
  }

  /** O token foi enviado por esta máquina: a saída da espera conta como "aceito". */
  noteTokenSent(executionId: string): void {
    const entry = this.tracked.get(executionId);
    if (entry) entry.tokenSent = true;
  }

  /** Execuções desta máquina ainda ativas (aviso ao fechar a janela, FR-026). */
  ownActive(): string[] {
    return [...this.tracked.values()]
      .filter((entry) => entry.own && !entry.finished)
      .map((entry) => entry.executionId);
  }

  /**
   * Ao conectar ou reconectar: acompanha as execuções ativas iniciadas por este cliente
   * (`requestedClient` igual ao nome do `/me`), inclusive retomando um pedido de token (FR-019).
   */
  async resumeOwn(clientName: string): Promise<void> {
    const api = this.options.getApi();
    if (!api) return;
    const active = await api.listExecutions({ active: true, limit: 50 });
    if (!active.ok) {
      this.options.reportFailure(active.error);
      return;
    }
    for (const execution of active.data.items) {
      if (execution.requestedClient === clientName) this.track(execution.id, { own: true });
    }
  }

  stopAll(): void {
    this.stopped = true;
    for (const entry of this.tracked.values()) this.forget(entry);
  }

  private entry(executionId: string): Tracked {
    this.stopped = false;
    let entry = this.tracked.get(executionId);
    if (!entry || entry.finished) {
      entry = {
        executionId,
        own: false,
        viewers: 0,
        lastEventId: undefined,
        awaiting: false,
        tokenSent: false,
        finished: false,
        running: false,
        controller: null,
        queue: Promise.resolve(),
      };
      this.tracked.set(executionId, entry);
    }
    return entry;
  }

  private forget(entry: Tracked): void {
    entry.finished = true;
    entry.controller?.abort();
    if (this.tracked.get(entry.executionId) === entry) this.tracked.delete(entry.executionId);
  }

  private isActive(entry: Tracked): boolean {
    return (
      !this.stopped &&
      !entry.finished &&
      this.tracked.get(entry.executionId) === entry &&
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
        const state = await api.getExecution(entry.executionId);
        if (!state.ok) {
          this.options.reportFailure(state.error);
          if (state.error.code === 'not_found') return this.forget(entry);
          await delay(this.reconnectDelayMs);
          continue;
        }
        entry.lastEventId = latestEventId(state.data) ?? entry.lastEventId;
        await this.applyState(entry, state.data, { initial: true });
        synced = true;
        if (!this.isActive(entry)) return;
      }

      const controller = new AbortController();
      entry.controller = controller;
      const opened = await api.openEventStream(entry.executionId, {
        lastEventId: entry.lastEventId,
        signal: controller.signal,
      });
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
    this.options.onChanged(entry.executionId);
    if (event.event !== 'status_changed') return;

    let status: ExecutionStatus | undefined;
    try {
      status = (JSON.parse(event.data) as { status?: ExecutionStatus }).status;
    } catch {
      return;
    }
    if (!status) return;
    const next = status;
    entry.queue = entry.queue.then(() => this.onStatus(entry, next)).catch(() => undefined);
  }

  private async onStatus(entry: Tracked, status: ExecutionStatus): Promise<void> {
    const needsState = status === 'awaiting_2fa' || entry.awaiting || FINAL_STATUSES.has(status);
    if (!needsState || !(entry.own || entry.awaiting)) {
      if (FINAL_STATUSES.has(status)) this.finish(entry, null);
      return;
    }
    const api = this.options.getApi();
    if (!api) return;
    const state = await api.getExecution(entry.executionId);
    if (!state.ok) {
      this.options.reportFailure(state.error);
      if (FINAL_STATUSES.has(status)) this.finish(entry, null);
      return;
    }
    await this.applyState(entry, { ...state.data, status }, { initial: false });
  }

  private applyState(
    entry: Tracked,
    execution: Execution,
    { initial }: { initial: boolean },
  ): Promise<void> {
    const api = this.options.getApi();

    if (execution.status === 'awaiting_2fa') {
      if (entry.own && !entry.awaiting && execution.twoFactorDeadline && api) {
        entry.awaiting = true;
        entry.tokenSent = false;
        this.options.onTwoFactorRequested({
          executionId: entry.executionId,
          deadline: execution.twoFactorDeadline,
          clockOffsetMs: api.clockOffsetMs(),
        });
      }
      return Promise.resolve();
    }

    if (entry.awaiting) {
      this.options.onTwoFactorClosed({
        executionId: entry.executionId,
        reason: closeReason(execution.status, execution.endReason ?? null, entry.tokenSent),
      });
      entry.awaiting = false;
      entry.tokenSent = false;
    }

    if (FINAL_STATUSES.has(execution.status)) {
      // Encontrada já encerrada ao começar a acompanhar: não é "terminou agora".
      this.finish(entry, initial ? null : execution);
    }
    return Promise.resolve();
  }

  private finish(entry: Tracked, execution: Execution | null): void {
    if (entry.finished) return;
    if (execution && entry.own) this.options.onFinished(summarize(execution));
    this.forget(entry);
  }
}

function latestEventId(execution: Execution): string | undefined {
  let latest: number | undefined;
  for (const event of execution.recentEvents) {
    const id = Number(event.id);
    if (Number.isFinite(id) && (latest === undefined || id > latest)) latest = id;
  }
  return latest === undefined ? undefined : String(latest);
}

function closeReason(
  status: ExecutionStatus,
  endReason: ExecutionEndReason | null,
  tokenSentHere: boolean,
): TwoFactorCloseReason {
  if (status === 'running' || status === 'queued') {
    return tokenSentHere ? 'accepted' : 'answered_elsewhere';
  }
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
        executionId: execution.id,
        title: 'Execução concluída',
        body: `${parts.join('; ')}.`,
      };
    case 'cancelled':
      return {
        executionId: execution.id,
        title: 'Execução cancelada',
        body: `${parts.join('; ')}.`,
      };
    default:
      return {
        executionId: execution.id,
        title: 'Execução falhou',
        body: execution.endReason ? END_REASONS[execution.endReason] : `${parts.join('; ')}.`,
      };
  }
}
