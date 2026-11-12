/**
 * Leitor da API interna e catálogo de hotéis (T027, T032) contra respostas simuladas em HTTP.
 * A resposta de `GetCurrentUser` ainda é sintética (fixture `current-user.json`, T020/T021).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request, type APIRequestContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HunitUnavailableError,
  ScreenNotRecognizedError,
  SessionExpiredError,
} from '../../src/hunit/errors.js';
import {
  HUNIT_API_ROUTES,
  HunitApiClient,
  type HunitApiRoute,
} from '../../src/hunit/network/api-client.js';
import { readCatalog } from '../../src/hunit/network/catalog.js';
import { ReadOnlyGuardError } from '../../src/hunit/read-only-guard.js';
import { readJsonFixture } from '../helpers/fake-hunit-server.js';

/** Próxima resposta do servidor simulado. */
let next: { status: number; body: string; headers?: Record<string, string> };
let received: Array<{ path: string; companyId: string | undefined }> = [];
let server: Server;
let requestContext: APIRequestContext;
let api: HunitApiClient;

function respondWith(status: number, body: unknown, headers: Record<string, string> = {}) {
  next = { status, body: typeof body === 'string' ? body : JSON.stringify(body), headers };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({
      path: req.url ?? '',
      companyId: req.headers['x-company-id'] as string | undefined,
    });
    res.writeHead(next.status, { 'content-type': 'application/json', ...next.headers });
    res.end(next.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  requestContext = await request.newContext();
  api = new HunitApiClient(requestContext, {
    apiUrl,
    webUrl: 'https://hunit.test',
    timeoutMs: 5_000,
    // As novas tentativas têm teste próprio (api-client-retry.test.ts).
    retryDelaysMs: [],
  });
});

afterAll(async () => {
  await requestContext.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('HunitApiClient', () => {
  it('faz GET na rota permitida, com parâmetros e o hotel em X-Company-Id', async () => {
    received = [];
    respondWith(200, { ok: true });

    const body = await api.get(HUNIT_API_ROUTES.bookings, {
      query: { Page: 2, StartDate: '2026-11-01' },
      companyId: '101',
    });

    expect(body).toEqual({ ok: true });
    expect(received).toEqual([
      { path: '/api/Entity/GetBookings?Page=2&StartDate=2026-11-01', companyId: '101' },
    ]);
  });

  it.each([401, 403, 302])('status %i → SessionExpiredError', async (status) => {
    respondWith(status, '', status === 302 ? { location: 'https://login.test/' } : {});
    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it.each([500, 503, 429])('status %i → HunitUnavailableError', async (status) => {
    respondWith(status, '');
    await expect(api.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(
      HunitUnavailableError,
    );
  });

  it('resposta que não é JSON → ScreenNotRecognizedError com a resposta como evidência', async () => {
    respondWith(200, '<html>manutenção</html>');

    const error = await api.get(HUNIT_API_ROUTES.currentUser).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ScreenNotRecognizedError);
    expect((error as ScreenNotRecognizedError).evidence?.response).toBe('<html>manutenção</html>');
  });

  it('recusa, antes de enviar, rotas fora da lista de permissão', async () => {
    received = [];

    await expect(api.get('/api/Payment/ChargePrePayment' as HunitApiRoute)).rejects.toBeInstanceOf(
      ReadOnlyGuardError,
    );
    expect(received).toEqual([]);
  });

  it('API fora do ar → HunitUnavailableError', async () => {
    const offline = new HunitApiClient(requestContext, {
      apiUrl: 'http://127.0.0.1:1',
      webUrl: 'https://hunit.test',
      timeoutMs: 2_000,
      retryDelaysMs: [],
    });
    await expect(offline.get(HUNIT_API_ROUTES.currentUser)).rejects.toBeInstanceOf(
      HunitUnavailableError,
    );
  });
});

describe('readCatalog (GetCurrentUser → hotéis)', () => {
  it('devolve os hotéis ativos, com o id como código', async () => {
    respondWith(200, readJsonFixture('current-user.json'));

    expect(await readCatalog(api)).toEqual([
      { code: '101', name: 'Hotel Exemplo Centro' },
      { code: '102', name: 'Hotel Exemplo Praia' },
    ]);
  });

  it.each([
    ['sem a lista de hotéis', { user: {} }],
    ['hotel sem nome', { companies: [{ id: 1, isActive: true }] }],
    ['isActive com tipo errado', { companies: [{ id: 1, name: 'X', isActive: 'sim' }] }],
  ])('formato inesperado (%s) → ScreenNotRecognizedError com a resposta', async (_, body) => {
    respondWith(200, body);

    const error = await readCatalog(api).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ScreenNotRecognizedError);
    expect((error as ScreenNotRecognizedError).evidence?.response).toBe(JSON.stringify(body));
  });
});
