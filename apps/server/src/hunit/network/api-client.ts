import type { APIRequestContext, APIResponse } from 'playwright';
import { HunitUnavailableError, ScreenNotRecognizedError, SessionExpiredError } from '../errors.js';
import { assertApiClientRequest } from '../read-only-guard.js';

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
 * - sem resposta, 429 ou 5xx → `HunitUnavailableError`;
 * - outro status, ou corpo que não é JSON → `ScreenNotRecognizedError`, com a resposta como
 *   evidência.
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
    // Última barreira: nada fora da lista de permissão sai daqui (FR-012).
    assertApiClientRequest('GET', url.toString(), this.options.apiUrl);

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
      throw new HunitUnavailableError(`a API não respondeu a ${route}`, { cause: error });
    }

    const status = response.status();
    const body = await response.text().catch(() => '');

    if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
      throw new SessionExpiredError();
    }
    if (status === 429 || status >= 500) {
      throw new HunitUnavailableError(`a API respondeu ${status} a ${route}`);
    }
    if (status !== 200) {
      throw new ScreenNotRecognizedError(`a API respondeu ${status} a ${route}`, {
        evidence: { response: body },
      });
    }

    try {
      return JSON.parse(body) as unknown;
    } catch (error) {
      throw new ScreenNotRecognizedError(`a resposta de ${route} não é JSON`, {
        evidence: { response: body },
        cause: error,
      });
    }
  }
}
