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
  EvidenceFile,
  EvidenceSummary,
  Execution,
  ExecutionListInput,
  ExecutionSummary,
  Hotel,
  Page,
  Reservation,
  ReservationKey,
  ReservationListInput,
  Result,
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
  'internal_error',
] satisfies Schemas['Problem']['code'][]);

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
    init: { headers?: Record<string, string>; signal?: AbortSignal | undefined },
    timeoutMs: number | null,
  ): Promise<Result<UndiciResponse>> {
    try {
      const request = new UndiciRequest(`${this.options.serverUrl}/v1${path}`, {
        headers: { ...init.headers, authorization: `Bearer ${this.options.apiKey}` },
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
