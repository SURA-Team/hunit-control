/**
 * Ao conectar ou reconectar, o app volta a acompanhar as execuções ativas desta máquina
 * (specs/002, T053, FR-019, research R-06): `active=true` e `requestedClient` igual ao nome do
 * `/me`; um pedido de token ainda no prazo reaparece com o tempo restante certo.
 */
import type { ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/main/api-client.js';
import { ExecutionWatcher } from '../../src/main/execution-watcher.js';
import type { Execution, ExecutionStatus, TwoFactorRequest } from '../../src/shared/ipc-types.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import {
  openSse,
  sendJson,
  startHttpsServer,
  type SseStream,
  type TestHttpsServer,
} from '../helpers/https-server.js';

const MINE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ME = 'desktop-financeiro';

let certificates: TestCertificates;
let server: TestHttpsServer;
let api: ApiClient;
let watcher: ExecutionWatcher;
let requests: TwoFactorRequest[];
let streams: Map<string, SseStream[]>;
let deadline: string;

function execution(id: string, client: string, status: ExecutionStatus): Execution {
  return {
    id,
    status,
    period: { from: '2026-11-01', to: '2026-11-07' },
    createdAt: '2026-11-12T12:00:00.000Z',
    requestedClient: client,
    endReason: null,
    twoFactorDeadline: status === 'awaiting_2fa' ? deadline : null,
    hotels: [],
    counts: {},
    recentEvents: [
      { id: '7', at: '2026-11-12T12:00:00.000Z', type: 'status_changed', status, message: '' },
    ],
    warnings: [],
  };
}

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startHttpsServer(certificates.server);
});

beforeEach(() => {
  requests = [];
  streams = new Map();
  deadline = new Date(Date.now() + 90_000).toISOString();
  const executions = {
    [MINE]: execution(MINE, ME, 'awaiting_2fa'),
    [OTHER]: execution(OTHER, 'desktop-controladoria', 'awaiting_2fa'),
  };
  server.on('GET', '/v1/executions', (request, response) => {
    expect(request.query.get('active')).toBe('true');
    sendJson(response, 200, { items: Object.values(executions), nextCursor: null });
  });
  for (const [id, body] of Object.entries(executions)) {
    server.on('GET', `/v1/executions/${id}`, (_request, response) => sendJson(response, 200, body));
    server.on('GET', `/v1/executions/${id}/events`, (_request, response: ServerResponse) => {
      streams.set(id, [...(streams.get(id) ?? []), openSse(response)]);
    });
  }
  api = new ApiClient({
    serverUrl: server.url,
    caCertificatePem: certificates.authority.certificatePem,
    apiKey: 'hunit_chave-resume',
  });
  watcher = new ExecutionWatcher({
    getApi: () => api,
    onChanged: () => undefined,
    onTwoFactorRequested: (request) => requests.push(request),
    onTwoFactorClosed: () => undefined,
    onFinished: () => undefined,
    reportFailure: () => undefined,
    reconnectDelayMs: 50,
  });
});

afterEach(async () => {
  watcher.stopAll();
  for (const list of streams.values()) for (const stream of list) stream.close();
  await api.close();
  server.reset();
});

afterAll(async () => {
  await server.close();
});

describe('ExecutionWatcher.resumeOwn (FR-019)', () => {
  it('acompanha só as execuções ativas iniciadas por este cliente', async () => {
    await watcher.resumeOwn(ME);

    await vi.waitFor(() => expect(streams.get(MINE)).toHaveLength(1));
    expect(streams.has(OTHER)).toBe(false);
    expect(watcher.ownActive()).toEqual([MINE]);
  });

  it('reabre o pedido de token de uma execução desta máquina com o prazo do servidor', async () => {
    await watcher.resumeOwn(ME);

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ executionId: MINE, deadline });
    const remaining = Date.parse(deadline) - (Date.now() + (requests[0]?.clockOffsetMs ?? 0));
    expect(remaining).toBeGreaterThan(80_000);
    expect(remaining).toBeLessThanOrEqual(91_000);
  });

  it('nova reconexão não duplica o acompanhamento nem o pedido de token', async () => {
    await watcher.resumeOwn(ME);
    await vi.waitFor(() => expect(streams.get(MINE)).toHaveLength(1));
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    await watcher.resumeOwn(ME);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(streams.get(MINE)).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('ignora execuções de outros clientes mesmo aguardando token (FR-012)', async () => {
    await watcher.resumeOwn(ME);
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests.map((request) => request.executionId)).toEqual([MINE]);
  });
});
