import { setTimeout as sleep } from 'node:timers/promises';
import type { APIRequestContext, APIResponse } from 'playwright';
import { HunitUnavailableError, ScreenNotRecognizedError, SessionExpiredError } from '../errors.js';
import type { HunitRetryListener } from '../gateway.js';
import { assertApiClientRequest } from '../read-only-guard.js';

/** Espera antes de cada nova tentativa de uma leitura com erro passageiro (research R-23). */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

/** Maior espera aceita de um `Retry-After` do Hunit (research R-23). */
export const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;

/** Rotas da API interna do Hunit lidas pelo sistema (todas na lista de permissão da proteção). */
export const HUNIT_API_ROUTES = {
  currentUser: '/api/Account/GetCurrentUser',
  bookings: '/api/Entity/GetBookings',
  bookingDetail: '/api/Company/BookingDetail',
} as const;

export type HunitApiRoute = (typeof HUNIT_API_ROUTES)[keyof typeof HUNIT_API_ROUTES];

export interface HunitApiClientOptions {
  /** Endereço da API interna (HUNIT_API_URL). */
  apiUrl: string;
  /** Endereço da tela do Hunit (HUNIT_WEB_URL); enviado como origem, como faz a própria tela. */
  webUrl: string;
  /** Tempo máximo de cada requisição, em milissegundos. */
  timeoutMs: number;
  /**
   * Chamado com cada resposta JSON recebida, antes de ser conferida. Usado só pela verificação
   * manual (`hunit-reservations-check`) para guardar as respostas reais como material de
   * fixtures (T020).
   */
  onResponse?: (route: HunitApiRoute, body: unknown) => void | Promise<void>;
  /**
   * Espera antes de cada nova tentativa quando a leitura falha por indisponibilidade passageira
   * (sem resposta, 429, 5xx); o tamanho da lista é o número de novas tentativas. Padrão:
   * `DEFAULT_RETRY_DELAYS_MS`. Lista vazia: sem novas tentativas.
   */
  retryDelaysMs?: readonly number[];
  /** Maior espera aceita de um `Retry-After`. Padrão: `DEFAULT_MAX_RETRY_AFTER_MS`. */
  maxRetryAfterMs?: number;
  /** Chamado antes de cada nova tentativa (aviso ao operador, FR-011a). */
  onRetry?: HunitRetryListener;
  /**
   * Abortado quando a sessão é fechada (ex.: cancelamento): a espera termina na hora e nenhuma
   * tentativa nova começa (SC-008).
   */
  signal?: AbortSignal;
}

/** Resultado de uma tentativa que não lançou erro. */
type Attempt =
  | { ok: true; body: unknown }
  /** Falha passageira: pode ser repetida, na espera pedida pelo Hunit, se houver. */
  | { ok: false; error: HunitUnavailableError; retryAfterMs: number | null };

/**
 * Lê o cabeçalho `Retry-After`, em segundos ou como data HTTP.
 *
 * @returns a espera em milissegundos, ou `null` se o cabeçalho não veio ou é inválido.
 */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1_000;
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export interface HunitGetOptions {
  query?: Record<string, string | number>;
  /** Hotel da consulta (cabeçalho `X-Company-Id`, research R-13a). */
  companyId?: string;
}

/**
 * Leitor da API interna do Hunit (constitution, princípio II): só GET, só nas rotas da lista de
 * permissão (`read-only-guard.ts`), com a sessão do navegador que fez o login — os cookies ficam
 * no contexto do Playwright e nunca passam por este código.
 *
 * Traduz as falhas para os erros da camada do Hunit:
 * - 401, 403 ou redirecionamento (para o login) → `SessionExpiredError`;
 * - sem resposta, 429 ou 5xx → `HunitUnavailableError`, depois das novas tentativas;
 * - outro status, ou corpo que não é JSON → `ScreenNotRecognizedError`, com a resposta como
 *   evidência.
 *
 * Só a indisponibilidade passageira é repetida (FR-011a, research R-23): até
 * `retryDelaysMs.length` novas tentativas, com a espera da lista ou a do `Retry-After` (até
 * `maxRetryAfterMs`), avisando `onRetry` antes de cada uma.
 */
export class HunitApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly options: HunitApiClientOptions,
  ) {}

  async get(route: HunitApiRoute, options: HunitGetOptions = {}): Promise<unknown> {
    const url = new URL(route, this.options.apiUrl);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, String(value));
    }
    // Última barreira: nada fora da lista de permissão sai daqui (FR-012). Todas as tentativas
    // usam esta mesma URL.
    assertApiClientRequest('GET', url.toString(), this.options.apiUrl);

    const delays = this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    for (let retry = 1; ; retry += 1) {
      const attempt = await this.attempt(url, route, options);
      if (attempt.ok) return attempt.body;

      const plannedMs = delays[retry - 1];
      // Sem tentativas sobrando, ou a sessão já foi fechada: a falha sobe como está.
      if (plannedMs === undefined || this.options.signal?.aborted) throw attempt.error;

      const delayMs =
        attempt.retryAfterMs === null
          ? plannedMs
          : Math.min(
              attempt.retryAfterMs,
              this.options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS,
            );
      await this.options.onRetry?.({
        attempt: retry,
        maxAttempts: delays.length,
        delayMs,
        hotelCode: options.companyId ?? null,
        reason: attempt.error.message,
      });
      await this.wait(delayMs, attempt.error);
    }
  }

  /** Espera antes de uma nova tentativa; o fechamento da sessão interrompe com a falha original. */
  private async wait(delayMs: number, failure: HunitUnavailableError): Promise<void> {
    const { signal } = this.options;
    try {
      await sleep(delayMs, undefined, signal ? { signal } : {});
    } catch {
      throw failure;
    }
  }

  /** Uma requisição. Lança as falhas que não são repetidas; devolve as passageiras. */
  private async attempt(
    url: URL,
    route: HunitApiRoute,
    options: HunitGetOptions,
  ): Promise<Attempt> {
    const origin = new URL(this.options.webUrl).origin;
    let response: APIResponse;
    try {
      response = await this.request.get(url.toString(), {
        headers: {
          accept: 'application/json',
          origin,
          referer: `${origin}/`,
          ...(options.companyId !== undefined && { 'x-company-id': options.companyId }),
        },
        maxRedirects: 0,
        failOnStatusCode: false,
        timeout: this.options.timeoutMs,
      });
    } catch (error) {
      return {
        ok: false,
        error: new HunitUnavailableError(`a API não respondeu a ${route}`, { cause: error }),
        retryAfterMs: null,
      };
    }

    const status = response.status();
    const body = await response.text().catch(() => '');

    if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
      throw new SessionExpiredError();
    }
    if (status === 429 || status >= 500) {
      return {
        ok: false,
        error: new HunitUnavailableError(`a API respondeu ${status} a ${route}`),
        retryAfterMs: parseRetryAfter(response.headers()['retry-after']),
      };
    }
    if (status !== 200) {
      throw new ScreenNotRecognizedError(`a API respondeu ${status} a ${route}`, {
        evidence: { response: body },
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch (error) {
      throw new ScreenNotRecognizedError(`a resposta de ${route} não é JSON`, {
        evidence: { response: body },
        cause: error,
      });
    }
    await this.options.onResponse?.(route, parsed);
    return { ok: true, body: parsed };
  }
}
