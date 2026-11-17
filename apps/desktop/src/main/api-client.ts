/**
 * Cliente da API do HUNIT Control no processo principal (specs/002, research R-03 e R-07).
 *
 * - Só confia no certificado raiz guardada na configuração (a autoridade interna do Caddy do
 *   servidor): o `Agent` do undici recebe só essa raiz em `ca`, e a verificação de nome é a padrão
 *   do Node. Certificado de outra autoridade, de outro nome ou vencido → `untrusted_server`, sem a
 *   requisição sair da máquina.
 * - O `fetch` e o `Agent` vêm do mesmo pacote `undici`: o `fetch` global do Node não aceita o
 *   `Agent` de outra versão.
 * - As chamadas são tipadas pelo contrato (`@hunit/contracts`) com `openapi-fetch`.
 * - Toda resposta vira `Result`; nenhuma mensagem de erro leva a chave nem a senha (FR-007).
 * - O cabeçalho `Date` das respostas mede a diferença entre o relógio do servidor e o da máquina,
 *   que corrige a contagem regressiva do token.
 */
import type { components, paths } from '@hunit/contracts';
import createClient, { type Client } from 'openapi-fetch';
import {
  Agent,
  fetch as undiciFetch,
  Request as UndiciRequest,
  type Response as UndiciResponse,
} from 'undici';
import type {
  AppError,
  ClientIdentity,
  CommercialDetail,
  CommercialDispatch,
  CommercialDispatchCheck,
  CommercialDispatchListInput,
  CommercialDispatchSummary,
  CommercialLine,
  CommercialSheetStatus,
  ConfirmationBatchResult,
  EvidenceFile,
  EvidenceSummary,
  Execution,
  ExecutionListInput,
  ExecutionSummary,
  Hotel,
  Page,
  Reservation,
  ReservationFilters,
  ReservationKey,
  ReservationListInput,
  ReservationOutcome,
  ReservationSelection,
  ReservationTreatment,
  Result,
  SheetReadResult,
  TreatmentCheck,
  TreatmentDetail,
  TreatmentDocumentKind,
} from '../shared/ipc-types.js';

type Schemas = components['schemas'];

/** Códigos de erro do Node e do OpenSSL que indicam certificado não confiável. */
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_CHAIN_TOO_LONG',
  'INVALID_CA',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
]);

const UNTRUSTED_DETAIL =
  'Não foi possível confirmar a identidade do servidor: o certificado apresentado não é o do servidor configurado.';
const OFFLINE_DETAIL = 'O servidor não respondeu.';

/** Tempo máximo do envio de um documento (até 25 MB pela rede local). */
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Tempo máximo das operações longas do Comercial: "Ler retornos agora" responde em até 50 s
 * (depois disso, 202 e a rodada continua no servidor) e os lotes de até 2 000 reservas.
 */
const LONG_TIMEOUT_MS = 150_000;

export interface ApiClientOptions {
  /** Origem do servidor, sem barra no fim (ex.: "https://192.168.0.50"). */
  serverUrl: string;
  /** Certificado raiz (PEM) da autoridade do servidor. */
  caCertificatePem: string;
  apiKey: string;
  /** Tempo máximo de cada requisição comum. Padrão: 15 s. */
  timeoutMs?: number | undefined;
}

export interface CredentialsBody {
  username: string;
  password: string;
}

function isUntrustedCertificate(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (
      typeof code === 'string' &&
      (TLS_ERROR_CODES.has(code) || code.startsWith('ERR_TLS_CERT'))
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Falha sem resposta HTTP: certificado recusado ou servidor fora do alcance. */
export function networkError(error: unknown): AppError {
  return isUntrustedCertificate(error)
    ? { code: 'untrusted_server', detail: UNTRUSTED_DETAIL }
    : { code: 'offline', detail: OFFLINE_DETAIL };
}

const API_ERROR_CODES = new Set<string>([
  'validation_error',
  'unauthorized',
  'forbidden_for_role',
  'not_found',
  'execution_already_active',
  'not_awaiting_two_factor',
  'execution_already_finished',
  'nothing_to_resume',
  'execution_already_resumed',
  'evidence_expired',
  'empty_file',
  'file_too_large',
  'unsupported_file_type',
  'file_not_found',
  'not_eligible_for_treatment',
  'document_not_current',
  'document_not_revertible',
  'proof_required',
  'document_purged',
  'account_busy',
  'commercial_sheet_not_configured',
  'commercial_sheet_unavailable',
  'no_eligible_reservations',
  'dispatch_already_finished',
  'dispatch_already_resumed',
  'return_awaiting_validation',
  'return_not_awaiting_validation',
  'return_not_confirmed',
  'not_in_commercial_sheet',
  'restore_expired',
  'internal_error',
] satisfies Schemas['Problem']['code'][]);

/**
 * Nome do arquivo num `content-disposition`: prefere `filename*` (UTF-8, RFC 6266), depois
 * `filename`; sem nenhum dos dois, um nome genérico.
 */
export function fileNameFromDisposition(header: string | null): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Cai no nome simples.
    }
  }
  return /filename="([^"]*)"/i.exec(header ?? '')?.[1] ?? 'documento';
}

/** Erro de uma resposta HTTP que não deu certo, a partir do corpo `problem+json` (se houver). */
export function httpError(status: number, body: unknown): AppError {
  const problem = body as { code?: unknown; detail?: unknown } | null;
  const code =
    typeof problem?.code === 'string' && API_ERROR_CODES.has(problem.code)
      ? (problem.code as AppError['code'])
      : status === 401
        ? 'unauthorized'
        : 'internal_error';
  const detail = typeof problem?.detail === 'string' ? problem.detail : undefined;
  return { code, status, ...(detail !== undefined && { detail }) };
}

export class ApiClient {
  private readonly agent: Agent;
  private readonly http: Client<paths>;
  /** Mesmo cliente, com o tempo das operações longas do Comercial. */
  private readonly slowHttp: Client<paths>;
  private readonly timeoutMs: number;
  private offsetMs = 0;

  constructor(private readonly options: ApiClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.agent = new Agent({
      connect: { ca: options.caCertificatePem, rejectUnauthorized: true },
    });
    this.http = createClient<paths>({
      baseUrl: `${options.serverUrl}/v1`,
      headers: { authorization: `Bearer ${options.apiKey}` },
      Request: UndiciRequest as unknown as typeof Request,
      fetch: (request) => this.send(request as unknown as UndiciRequest, this.timeoutMs),
    });
    this.slowHttp = createClient<paths>({
      baseUrl: `${options.serverUrl}/v1`,
      headers: { authorization: `Bearer ${options.apiKey}` },
      Request: UndiciRequest as unknown as typeof Request,
      fetch: (request) =>
        this.send(request as unknown as UndiciRequest, Math.max(this.timeoutMs, LONG_TIMEOUT_MS)),
    });
  }

  /** Relógio do servidor menos o relógio local, medido na última resposta (R-07). */
  clockOffsetMs(): number {
    return this.offsetMs;
  }

  async close(): Promise<void> {
    await this.agent.close();
  }

  // -------------------------------------------------------------------------
  // Operações do contrato
  // -------------------------------------------------------------------------

  getHealth(): Promise<Result<{ status: 'ok' }>> {
    return this.call(() => this.http.GET('/health'));
  }

  getMe(): Promise<Result<ClientIdentity>> {
    return this.call(() => this.http.GET('/me'));
  }

  async listHotels(): Promise<Result<Hotel[]>> {
    return items(await this.call(() => this.http.GET('/hotels')));
  }

  async listExecutions(input: ExecutionListInput): Promise<Result<Page<ExecutionSummary>>> {
    const result = await this.call(() =>
      this.http.GET('/executions', { params: { query: input } }),
    );
    return result.ok ? { ok: true, data: page(result.data) } : result;
  }

  getExecution(executionId: string): Promise<Result<Execution>> {
    return this.call(() =>
      this.http.GET('/executions/{executionId}', { params: { path: { executionId } } }),
    );
  }

  startExecution(body: Schemas['StartExecutionRequest']): Promise<Result<Execution>> {
    return this.call(() => this.http.POST('/executions', { body }));
  }

  resumeExecution(executionId: string, credentials: CredentialsBody): Promise<Result<Execution>> {
    return this.call(() =>
      this.http.POST('/executions/{executionId}/resume', {
        params: { path: { executionId } },
        body: { credentials },
      }),
    );
  }

  cancelExecution(executionId: string): Promise<Result<Execution>> {
    return this.call(() =>
      this.http.POST('/executions/{executionId}/cancel', { params: { path: { executionId } } }),
    );
  }

  async sendToken(executionId: string, token: string): Promise<Result<void>> {
    const result = await this.call(() =>
      this.http.POST('/executions/{executionId}/two-factor', {
        params: { path: { executionId } },
        body: { token },
      }),
    );
    return result.ok ? { ok: true, data: undefined } : result;
  }

  async listReservations(input: ReservationListInput): Promise<Result<Page<Reservation>>> {
    const result = await this.call(() =>
      this.http.GET('/reservations', { params: { query: input } }),
    );
    return result.ok ? { ok: true, data: page(result.data) } : result;
  }

  getReservation(key: ReservationKey): Promise<Result<Reservation>> {
    return this.call(() =>
      this.http.GET('/reservations/{hotelCode}/{reservationNumber}', { params: { path: key } }),
    );
  }

  async listChannels(): Promise<Result<string[]>> {
    return items(await this.call(() => this.http.GET('/channels')));
  }

  async listEvidence(executionId: string): Promise<Result<EvidenceSummary[]>> {
    return items(
      await this.call(() =>
        this.http.GET('/executions/{executionId}/evidence', { params: { path: { executionId } } }),
      ),
    );
  }

  /** Baixa um arquivo de evidência; o conteúdo nunca vai para a interface (FR-024). */
  async downloadEvidence(
    evidenceId: string,
    file: EvidenceFile,
  ): Promise<Result<{ content: Buffer; contentType: string }>> {
    const path = `/evidence/${encodeURIComponent(evidenceId)}/${file}`;
    const opened = await this.raw(path, {}, this.timeoutMs);
    if (!opened.ok) return opened;
    const response = opened.data;
    try {
      const content = Buffer.from(await response.arrayBuffer());
      return {
        ok: true,
        data: { content, contentType: response.headers.get('content-type') ?? '' },
      };
    } catch (error) {
      return { ok: false, error: networkError(error) };
    }
  }

  // -------------------------------------------------------------------------
  // Tratativas manuais (specs/003, contracts/api-changes.md)
  // -------------------------------------------------------------------------

  /**
   * Envia o arquivo de uma tratativa ou de um comprovante. Os bytes saem da memória do processo
   * principal; o nome vai na query (o servidor não o registra em log).
   */
  async uploadTreatmentFile(
    name: string,
    content: Uint8Array,
  ): Promise<Result<Schemas['TreatmentFile']>> {
    const opened = await this.raw(
      `/treatment-files?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: content,
      },
      UPLOAD_TIMEOUT_MS,
    );
    if (!opened.ok) return opened;
    try {
      return { ok: true, data: (await opened.data.json()) as Schemas['TreatmentFile'] };
    } catch (error) {
      return { ok: false, error: networkError(error) };
    }
  }

  checkTreatmentDocuments(body: {
    kind: TreatmentDocumentKind;
    reservations: ReservationKey[];
  }): Promise<Result<TreatmentCheck>> {
    return this.call(() => this.http.POST('/treatment-documents/check', { body }));
  }

  registerTreatmentDocuments(body: {
    kind: TreatmentDocumentKind;
    fileId: string;
    fileName: string;
    reservations: ReservationKey[];
  }): Promise<Result<{ batchId: string; items: ReservationOutcome[] }>> {
    return this.call(() => this.http.POST('/treatment-documents', { body }));
  }

  async removeTreatmentDocument(documentId: string): Promise<Result<void>> {
    const result = await this.call(() =>
      this.http.DELETE('/treatment-documents/{documentId}', { params: { path: { documentId } } }),
    );
    return result.ok ? { ok: true, data: undefined } : result;
  }

  revertTreatmentDocument(documentId: string): Promise<Result<ReservationTreatment>> {
    return this.call(() =>
      this.http.POST('/treatment-documents/{documentId}/revert', {
        params: { path: { documentId } },
      }),
    );
  }

  getReservationTreatment(key: ReservationKey): Promise<Result<TreatmentDetail>> {
    return this.call(() =>
      this.http.GET('/reservations/{hotelCode}/{reservationNumber}/treatment', {
        params: { path: key },
      }),
    );
  }

  setManualChargedAmount(
    key: ReservationKey,
    amount: string,
  ): Promise<Result<ReservationTreatment>> {
    return this.call(() =>
      this.http.PUT('/reservations/{hotelCode}/{reservationNumber}/manual-amount', {
        params: { path: key },
        body: { amount },
      }),
    );
  }

  clearManualChargedAmount(key: ReservationKey): Promise<Result<ReservationTreatment>> {
    return this.call(() =>
      this.http.DELETE('/reservations/{hotelCode}/{reservationNumber}/manual-amount', {
        params: { path: key },
      }),
    );
  }

  /** Confirma o alerta "Verificar" de uma reserva (specs/003, FR-002a). */
  confirmTreatmentReview(key: ReservationKey): Promise<Result<ReservationTreatment>> {
    return this.call(() =>
      this.http.POST('/reservations/{hotelCode}/{reservationNumber}/treatment/review', {
        params: { path: key },
      }),
    );
  }

  /** Baixa o arquivo de um documento, com o nome original; o conteúdo não vai para a interface. */
  async downloadTreatmentDocument(
    documentId: string,
  ): Promise<Result<{ content: Buffer; fileName: string }>> {
    const opened = await this.raw(
      `/treatment-documents/${encodeURIComponent(documentId)}/file`,
      {},
      UPLOAD_TIMEOUT_MS,
    );
    if (!opened.ok) return opened;
    const response = opened.data;
    try {
      return {
        ok: true,
        data: {
          content: Buffer.from(await response.arrayBuffer()),
          fileName: fileNameFromDisposition(response.headers.get('content-disposition')),
        },
      };
    } catch (error) {
      return { ok: false, error: networkError(error) };
    }
  }

  // -------------------------------------------------------------------------
  // Envio ao Comercial pela planilha (specs/005, contracts/api-changes.md)
  // -------------------------------------------------------------------------

  /** "Selecionar todas do filtro": até 2 000 reservas, na ordem da lista (FR-030). */
  selectReservations(filters: ReservationFilters): Promise<Result<ReservationSelection>> {
    return this.call(() =>
      this.slowHttp.GET('/reservations/selection', { params: { query: filters } }),
    );
  }

  /** "Verificar" em lote (FR-029). */
  confirmTreatmentReviews(
    reservations: ReservationKey[],
  ): Promise<Result<ConfirmationBatchResult>> {
    return this.call(() => this.slowHttp.POST('/treatment-reviews', { body: { reservations } }));
  }

  checkCommercialDispatch(
    reservations: ReservationKey[],
  ): Promise<Result<CommercialDispatchCheck>> {
    return this.call(() =>
      this.slowHttp.POST('/commercial-dispatches/check', { body: { reservations } }),
    );
  }

  startCommercialDispatch(body: {
    credentials: CredentialsBody;
    reservations: ReservationKey[];
  }): Promise<Result<CommercialDispatch>> {
    return this.call(() => this.slowHttp.POST('/commercial-dispatches', { body }));
  }

  async listCommercialDispatches(
    input: CommercialDispatchListInput,
  ): Promise<Result<Page<CommercialDispatchSummary>>> {
    const result = await this.call(() =>
      this.http.GET('/commercial-dispatches', { params: { query: input } }),
    );
    return result.ok ? { ok: true, data: page(result.data) } : result;
  }

  getCommercialDispatch(dispatchId: string): Promise<Result<CommercialDispatch>> {
    return this.call(() =>
      this.http.GET('/commercial-dispatches/{dispatchId}', { params: { path: { dispatchId } } }),
    );
  }

  resumeCommercialDispatch(
    dispatchId: string,
    credentials: CredentialsBody,
  ): Promise<Result<CommercialDispatch>> {
    return this.call(() =>
      this.http.POST('/commercial-dispatches/{dispatchId}/resume', {
        params: { path: { dispatchId } },
        body: { credentials },
      }),
    );
  }

  cancelCommercialDispatch(dispatchId: string): Promise<Result<CommercialDispatch>> {
    return this.call(() =>
      this.http.POST('/commercial-dispatches/{dispatchId}/cancel', {
        params: { path: { dispatchId } },
      }),
    );
  }

  async sendDispatchToken(dispatchId: string, token: string): Promise<Result<void>> {
    const result = await this.call(() =>
      this.http.POST('/commercial-dispatches/{dispatchId}/two-factor', {
        params: { path: { dispatchId } },
        body: { token },
      }),
    );
    return result.ok ? { ok: true, data: undefined } : result;
  }

  getReservationCommercial(key: ReservationKey): Promise<Result<CommercialDetail>> {
    return this.call(() =>
      this.http.GET('/reservations/{hotelCode}/{reservationNumber}/commercial', {
        params: { path: key },
      }),
    );
  }

  /** Desfaz o envio: a linha vai para "Concluídas" como "Pedido cancelado pelo Financeiro". */
  cancelCommercialLine(key: ReservationKey): Promise<Result<CommercialLine>> {
    return this.call(() =>
      this.http.POST('/reservations/{hotelCode}/{reservationNumber}/commercial/cancel', {
        params: { path: key },
      }),
    );
  }

  restoreCommercialLine(key: ReservationKey): Promise<Result<CommercialLine>> {
    return this.call(() =>
      this.http.POST('/reservations/{hotelCode}/{reservationNumber}/commercial/restore', {
        params: { path: key },
      }),
    );
  }

  confirmCommercialReturn(returnId: string): Promise<Result<ReservationTreatment>> {
    return this.call(() =>
      this.http.POST('/commercial-returns/{returnId}/confirm', {
        params: { path: { returnId } },
      }),
    );
  }

  rejectCommercialReturn(returnId: string, reason: string): Promise<Result<ReservationTreatment>> {
    return this.call(() =>
      this.http.POST('/commercial-returns/{returnId}/reject', {
        params: { path: { returnId } },
        body: { reason },
      }),
    );
  }

  undoCommercialReturnConfirmation(returnId: string): Promise<Result<ReservationTreatment>> {
    return this.call(() =>
      this.http.POST('/commercial-returns/{returnId}/undo-confirmation', {
        params: { path: { returnId } },
      }),
    );
  }

  confirmCommercialReturns(
    reservations: ReservationKey[],
  ): Promise<Result<ConfirmationBatchResult>> {
    return this.call(() =>
      this.slowHttp.POST('/commercial-returns/confirm', { body: { reservations } }),
    );
  }

  getCommercialSheetStatus(): Promise<Result<CommercialSheetStatus>> {
    return this.call(() => this.http.GET('/commercial-sheet'));
  }

  /**
   * "Ler retornos agora": rodada completa. Passou de 50 s, o servidor responde 202 com o estado e
   * a rodada continua lá (`round` nulo).
   */
  async readCommercialSheet(): Promise<Result<SheetReadResult>> {
    const result = await this.call(() => this.slowHttp.POST('/commercial-sheet/read'));
    if (!result.ok) return result;
    const body = result.data as SheetReadResult | CommercialSheetStatus;
    return {
      ok: true,
      data: 'round' in body ? body : { sheet: body, round: null },
    };
  }

  /** Fluxo de eventos (SSE) de um envio ao Comercial; mesmas regras do fluxo das execuções. */
  openDispatchEventStream(
    dispatchId: string,
    options: { lastEventId?: string | undefined; signal?: AbortSignal | undefined },
  ): Promise<Result<UndiciResponse>> {
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (options.lastEventId !== undefined) headers['last-event-id'] = options.lastEventId;
    return this.raw(
      `/commercial-dispatches/${encodeURIComponent(dispatchId)}/events`,
      { headers, signal: options.signal },
      null,
    );
  }

  /**
   * Abre o fluxo de eventos (SSE) de uma execução. Sem tempo limite de requisição: o servidor
   * manda um batimento a cada 15 s, e quem lê o fluxo decide quando ele parou.
   */
  openEventStream(
    executionId: string,
    options: { lastEventId?: string | undefined; signal?: AbortSignal | undefined },
  ): Promise<Result<UndiciResponse>> {
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (options.lastEventId !== undefined) headers['last-event-id'] = options.lastEventId;
    return this.raw(
      `/executions/${encodeURIComponent(executionId)}/events`,
      { headers, signal: options.signal },
      null,
    );
  }

  // -------------------------------------------------------------------------
  // Transporte
  // -------------------------------------------------------------------------

  private async send(request: UndiciRequest, timeoutMs: number | null): Promise<Response> {
    const signals = [request.signal];
    if (timeoutMs !== null) signals.push(AbortSignal.timeout(timeoutMs));
    const response = await undiciFetch(request, {
      dispatcher: this.agent,
      signal: AbortSignal.any(signals),
    });
    this.measureClock(response);
    return response as unknown as Response;
  }

  private measureClock(response: UndiciResponse): void {
    const date = response.headers.get('date');
    const serverTime = date ? Date.parse(date) : Number.NaN;
    if (!Number.isNaN(serverTime)) this.offsetMs = serverTime - Date.now();
  }

  /** Requisição fora do cliente tipado (arquivos e fluxo de eventos). */
  private async raw(
    path: string,
    init: {
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: Uint8Array;
      signal?: AbortSignal | undefined;
    },
    timeoutMs: number | null,
  ): Promise<Result<UndiciResponse>> {
    try {
      const request = new UndiciRequest(`${this.options.serverUrl}/v1${path}`, {
        method: init.method ?? 'GET',
        headers: { ...init.headers, authorization: `Bearer ${this.options.apiKey}` },
        ...(init.body && { body: init.body }),
        ...(init.signal && { signal: init.signal }),
      });
      const response = (await this.send(request, timeoutMs)) as unknown as UndiciResponse;
      if (response.ok) return { ok: true, data: response };
      const body: unknown = await response.json().catch(() => null);
      return { ok: false, error: httpError(response.status, body) };
    } catch (error) {
      return { ok: false, error: networkError(error) };
    }
  }

  private async call<T>(
    operation: () => Promise<{ data?: T; error?: unknown; response: Response }>,
  ): Promise<Result<T>> {
    try {
      const { data, error, response } = await operation();
      if (response.ok) return { ok: true, data: data as T };
      return { ok: false, error: httpError(response.status, error) };
    } catch (error) {
      return { ok: false, error: networkError(error) };
    }
  }
}

function items<T>(result: Result<{ items: T[] }>): Result<T[]> {
  return result.ok ? { ok: true, data: result.data.items } : result;
}

function page<T>(data: { items: T[]; nextCursor?: string | null }): Page<T> {
  return { items: data.items, nextCursor: data.nextCursor ?? null };
}
