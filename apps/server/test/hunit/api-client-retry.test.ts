/**
 * Novas tentativas do leitor da API interna em erros passageiros do Hunit — tasks.md, T087
 * (FR-011a, research R-23). Servidor HTTP simulado com respostas em fila e esperas curtas.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request, type APIRequestContext } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HunitUnavailableError,
  ScreenNotRecognizedError,
  SessionExpiredError,
} from '../../src/hunit/errors.js';
import type { HunitRetryNotice } from '../../src/hunit/gateway.js';
import {
  DEFAULT_RETRY_DELAYS_MS,
  HUNIT_API_ROUTES,
  HunitApiClient,
  type HunitApiClientOptions,
  type HunitApiRoute,
} from '../../src/hunit/network/api-client.js';
import { ReadOnlyGuardError } from '../../src/hunit/read-only-guard.js';

interface ScriptedResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/** Respostas na ordem; a última se repete quando a fila acaba. */
let script: ScriptedResponse[] = [];
let requests = 0;
let server: Server;
let apiUrl: string;
let requestContext: APIRequestContext;

function respond(...responses: ScriptedResponse[]) {
  script = responses;
}

const ok = (body: unknown = { ok: true }): ScriptedResponse => ({
  status: 200,
  body: JSON.stringify(body),
});

function client(options: Partial<HunitApiClientOptions> = {}) {
  const notices: HunitRetryNotice[] = [];
  const api = new HunitApiClient(requestContext, {
    apiUrl,
    webUrl: 'https://hunit.test',
    timeoutMs: 2_000,
    retryDelaysMs: [10, 20, 30],
    onRetry: (notice) => {
      notices.push(notice);
    },
    ...options,
  });
  return { api, notices };
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    requests += 1;
    const next = (script.length > 1 ? script.shift() : script[0]) ?? { status: 500 };
    res.writeHead(next.status, { 'content-type': 'application/json', ...next.headers });
    res.end(next.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  requestContext = await request.newContext();
});

afterAll(async () => {
  await requestContext.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests = 0;
  script = [];
});

describe('novas tentativas em erros passageiros (FR-011a)', () => {
  it('as esperas padrão são 2, 5, 10, 20 e 30 s (5 novas tentativas)', () => {
    expect(DEFAULT_RETRY_DELAYS_MS).toEqual([2_000, 5_000, 10_000, 20_000, 30_000]);
  });

  it('503 seguido de 200: devolve o corpo e avisa a nova tentativa, com o hotel', async () => {
    respond({ status: 503 }, ok({ id: 1 }));
    const { api, notices } = client();

    const body = await api.get(HUNIT_API_ROUTES.bookingDetail, { companyId: '4543' });

    expect(body).toEqual({ id: 1 });
    expect(requests).toBe(2);
    expect(notices).toEqual([
      {
        attempt: 1,
        maxAttempts: 3,
        delayMs: 10,
        hotelCode: '4543',
        reason: 'O Hunit está indisponível: a API respondeu 503 a /api/Company/BookingDetail',
      },
    ]);
  });

  it.each([429, 500, 502, 504])('status %i também é repetido', async (status) => {
    respond({ status }, ok());
    const { api, notices } = client();

    await expect(api.get(HUNIT_API_ROUTES.currentUser)).resolves.toEqual({ ok: true });
    expect(requests).toBe(2);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.hotelCode).toBeNull();
  });

  it('esperas crescentes entre as tentativas', async () => {
    respond({ status: 503 }, { status: 503 }, { status: 503 }, ok());
    const { api, notices } = client();

    await api.get(HUNIT_API_ROUTES.currentUser);

    expect(notices.map((notice) => [notice.attempt, notice.delayMs])).toEqual([
      [1, 10],
      [2, 20],
      [3, 30],
    ]);
  });

  it('erro em todas as tentativas: HunitUnavailableError depois de 1 + 3 requisições', async () => {
    respond({ status: 503 });
    const { api, notices } = client();

    const error = await api.get(HUNIT_API_ROUTES.currentUser).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HunitUnavailableError);
    expect((error as Error).message).toBe(
      'O Hunit está indisponível: a API respondeu 503 a /api/Account/GetCurrentUser',
    );
    expect(requests).toBe(4);
    expect(notices).toHaveLength(3);
  });

  it('sem novas tentativas configuradas, falha na primeira', async () => {
    respond({ status: 503 });
    const { api, notices } = client({ retryDelaysMs: [] });

    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(
      HunitUnavailableError,
    );
    expect(requests).toBe(1);
    expect(notices).toEqual([]);
  });

  it('sem resposta (API fora do ar) também é repetido', async () => {
    const { api, notices } = client({ apiUrl: 'http://127.0.0.1:1', retryDelaysMs: [10, 10] });

    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(
      HunitUnavailableError,
    );
    expect(notices.map((notice) => notice.attempt)).toEqual([1, 2]);
    expect(notices[0]?.reason).toBe(
      'O Hunit está indisponível: a API não respondeu a /api/Account/GetCurrentUser',
    );
  });
});

describe('Retry-After', () => {
  it('em segundos: a espera segue o cabeçalho', async () => {
    respond({ status: 429, headers: { 'retry-after': '1' } }, ok());
    const { api, notices } = client();

    await api.get(HUNIT_API_ROUTES.currentUser);

    expect(notices[0]?.delayMs).toBe(1_000);
  });

  it('acima do limite: a espera é cortada no limite', async () => {
    respond({ status: 503, headers: { 'retry-after': '120' } }, ok());
    const { api, notices } = client({ maxRetryAfterMs: 50 });

    await api.get(HUNIT_API_ROUTES.currentUser);

    expect(notices[0]?.delayMs).toBe(50);
  });

  it('como data HTTP: a espera vai até a data, dentro do limite', async () => {
    const inOneHour = new Date(Date.now() + 3_600_000).toUTCString();
    respond({ status: 503, headers: { 'retry-after': inOneHour } }, ok());
    const { api, notices } = client({ maxRetryAfterMs: 40 });

    await api.get(HUNIT_API_ROUTES.currentUser);

    expect(notices[0]?.delayMs).toBe(40);
  });

  it('inválido: usa a espera padrão', async () => {
    respond({ status: 503, headers: { 'retry-after': 'amanhã' } }, ok());
    const { api, notices } = client();

    await api.get(HUNIT_API_ROUTES.currentUser);

    expect(notices[0]?.delayMs).toBe(10);
  });
});

describe('o que não é repetido', () => {
  it.each([401, 403])('status %i (sessão expirada)', async (status) => {
    respond({ status });
    const { api, notices } = client();

    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(requests).toBe(1);
    expect(notices).toEqual([]);
  });

  it('status inesperado (404) e resposta que não é JSON', async () => {
    const { api, notices } = client();

    respond({ status: 404 });
    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(
      ScreenNotRecognizedError,
    );
    respond({ status: 200, body: '<html>manutenção</html>' });
    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(
      ScreenNotRecognizedError,
    );

    expect(requests).toBe(2);
    expect(notices).toEqual([]);
  });

  it('rota fora da lista de permissão: recusada antes de qualquer requisição', async () => {
    const { api, notices } = client();

    await expect(api.get('/api/Payment/ChargePrePayment' as HunitApiRoute)).rejects.toBeInstanceOf(
      ReadOnlyGuardError,
    );
    expect(requests).toBe(0);
    expect(notices).toEqual([]);
  });
});

describe('sessão fechada (cancelamento, SC-008)', () => {
  it('fechar durante a espera interrompe na hora, sem nova requisição', async () => {
    respond({ status: 503 });
    const controller = new AbortController();
    const { api } = client({
      retryDelaysMs: [60_000],
      signal: controller.signal,
      onRetry: () => controller.abort(),
    });

    const started = Date.now();
    const error = await api.get(HUNIT_API_ROUTES.currentUser).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HunitUnavailableError);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(requests).toBe(1);
  });

  it('depois de fechada, uma falha não é repetida', async () => {
    respond({ status: 503 });
    const controller = new AbortController();
    controller.abort();
    const { api, notices } = client({ signal: controller.signal });

    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(
      HunitUnavailableError,
    );
    expect(requests).toBe(1);
    expect(notices).toEqual([]);
  });
});
