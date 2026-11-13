/**
 * Acompanhamento das execuções no processo principal (specs/002, T040, FR-011 a FR-014, research
 * R-06): fluxo de eventos (SSE) como sinal, estado sempre pelo GET, pedido de token só para as
 * execuções desta máquina e notificação de fim. Servidor HTTPS local com respostas programadas.
 */
import type { ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/main/api-client.js';
import { ExecutionWatcher, type FinishedSummary } from '../../src/main/execution-watcher.js';
import type {
  Execution,
  ExecutionStatus,
  TwoFactorClosed,
  TwoFactorRequest,
} from '../../src/shared/ipc-types.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import {
  openSse,
  sendJson,
  startHttpsServer,
  type SseStream,
  type TestHttpsServer,
} from '../helpers/https-server.js';

const ID = '11111111-1111-4111-8111-111111111111';
const DEADLINE = '2026-11-12T12:05:00.000Z';

let certificates: TestCertificates;
let server: TestHttpsServer;
let api: ApiClient;
let watcher: ExecutionWatcher;

let execution: Execution;
let streams: SseStream[];
let lastEventIds: Array<string | undefined>;
let nextEventId: number;

let changed: string[];
let requests: TwoFactorRequest[];
let closed: TwoFactorClosed[];
let finished: FinishedSummary[];

function makeExecution(status: ExecutionStatus, overrides: Partial<Execution> = {}): Execution {
  return {
    id: ID,
    status,
    period: { from: '2026-11-01', to: '2026-11-07' },
    createdAt: '2026-11-12T12:00:00.000Z',
    requestedClient: 'desktop-financeiro',
    endReason: null,
    twoFactorDeadline: status === 'awaiting_2fa' ? DEADLINE : null,
    hotels: [],
    counts: {},
    recentEvents: [
      { id: '3', at: '2026-11-12T12:00:00.000Z', type: 'status_changed', status, message: '' },
    ],
    warnings: [],
    ...overrides,
  };
}

/** Muda o estado devolvido pelo GET e manda o evento correspondente pelo fluxo aberto. */
function emitStatus(status: ExecutionStatus, overrides: Partial<Execution> = {}) {
  execution = makeExecution(status, overrides);
  currentStream().send({
    id: nextEventId++,
    event: 'status_changed',
    data: { id: String(nextEventId), type: 'status_changed', status, message: '' },
  });
}

function emitEvent(type: string) {
  currentStream().send({ id: nextEventId++, event: type, data: { type, message: '' } });
}

function currentStream(): SseStream {
  const stream = streams.at(-1);
  if (!stream) throw new Error('nenhum fluxo aberto');
  return stream;
}

async function waitForStreams(count: number) {
  await vi.waitFor(() => expect(streams.length).toBeGreaterThanOrEqual(count), { timeout: 5_000 });
}

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startHttpsServer(certificates.server);
});

beforeEach(() => {
  execution = makeExecution('running');
  streams = [];
  lastEventIds = [];
  nextEventId = 4;
  changed = [];
  requests = [];
  closed = [];
  finished = [];
  server.on('GET', `/v1/executions/${ID}`, (_request, response) =>
    sendJson(response, 200, execution),
  );
  server.on('GET', `/v1/executions/${ID}/events`, (request, response: ServerResponse) => {
    lastEventIds.push(request.headers['last-event-id'] as string | undefined);
    streams.push(openSse(response));
  });
  api = new ApiClient({
    serverUrl: server.url,
    caCertificatePem: certificates.authority.certificatePem,
    apiKey: 'hunit_chave-watcher',
  });
  watcher = new ExecutionWatcher({
    getApi: () => api,
    onChanged: (executionId) => changed.push(executionId),
    onTwoFactorRequested: (request) => requests.push(request),
    onTwoFactorClosed: (event) => closed.push(event),
    onFinished: (summary) => finished.push(summary),
    reportFailure: () => undefined,
    reconnectDelayMs: 50,
  });
});

afterEach(async () => {
  watcher.stopAll();
  for (const stream of streams) stream.close();
  await api.close();
  server.reset();
});

afterAll(async () => {
  await server.close();
});

describe('fluxo de eventos (R-06)', () => {
  it('abre o fluxo a partir do evento mais recente do estado e avisa a cada evento', async () => {
    watcher.track(ID, { own: true });
    await waitForStreams(1);

    expect(lastEventIds[0]).toBe('3');
    emitEvent('hotel_started');
    emitEvent('page_done');

    await vi.waitFor(() => expect(changed.length).toBeGreaterThanOrEqual(2));
    expect(new Set(changed)).toEqual(new Set([ID]));
  });

  it('depois de uma queda, reconecta com o Last-Event-ID do último evento recebido', async () => {
    watcher.track(ID, { own: true });
    await waitForStreams(1);
    emitEvent('hotel_started');
    await vi.waitFor(() => expect(changed.length).toBeGreaterThanOrEqual(1));

    currentStream().close();
    await waitForStreams(2);

    expect(lastEventIds[1]).toBe('4');
  });

  it('para no status_changed final, sem reconectar', async () => {
    watcher.track(ID, { own: true });
    await waitForStreams(1);

    emitStatus('completed');
    currentStream().close();
    await vi.waitFor(() => expect(finished).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(streams).toHaveLength(1);
  });
});

describe('pedido de token (FR-011, FR-012)', () => {
  it('execução desta máquina que entra em awaiting_2fa dispara o pedido uma única vez', async () => {
    watcher.track(ID, { own: true });
    await waitForStreams(1);

    emitStatus('awaiting_2fa');
    emitEvent('warning');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(requests).toEqual([
      { executionId: ID, deadline: DEADLINE, clockOffsetMs: expect.any(Number) as number },
    ]);
  });

  it('execução encontrada aguardando token ao começar o acompanhamento abre o pedido (FR-019)', async () => {
    execution = makeExecution('awaiting_2fa');

    watcher.track(ID, { own: true });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });

  it('execução de outra máquina recebe os eventos, mas nunca dispara o pedido', async () => {
    watcher.watch(ID);
    await waitForStreams(1);

    emitStatus('awaiting_2fa');
    await vi.waitFor(() => expect(changed.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(requests).toEqual([]);
  });

  it.each([
    ['running depois do token enviado daqui', 'running', {}, true, 'accepted'],
    ['failed por token recusado', 'failed', { endReason: 'invalid_token' }, true, 'rejected'],
    ['failed por prazo', 'failed', { endReason: 'two_factor_timeout' }, false, 'expired'],
    ['cancelada', 'cancelled', { endReason: 'cancelled_by_client' }, false, 'finished'],
    ['running sem token enviado daqui', 'running', {}, false, 'answered_elsewhere'],
  ] as const)('%s → %s', async (_caso, status, overrides, tokenSentHere, reason) => {
    watcher.track(ID, { own: true });
    await waitForStreams(1);
    emitStatus('awaiting_2fa');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    if (tokenSentHere) watcher.noteTokenSent(ID);
    emitStatus(status, overrides);

    await vi.waitFor(() => expect(closed).toEqual([{ executionId: ID, reason }]));
  });
});

describe('fim da execução desta máquina (FR-014)', () => {
  it('pede a notificação de fim com o resultado resumido', async () => {
    watcher.track(ID, { own: true });
    await waitForStreams(1);

    emitStatus('completed', {
      counts: { virtual_card_pending_charge: 3, virtual_card_already_charged: 9 },
    });

    await vi.waitFor(() => expect(finished).toHaveLength(1));
    expect(finished[0]).toMatchObject({ title: 'Execução concluída' });
    expect(finished[0]?.body).toContain('12 reservas');
    expect(finished[0]?.body).toContain('3 pendentes de cobrança');
  });

  it('execução de outra máquina não gera notificação de fim', async () => {
    watcher.watch(ID);
    await waitForStreams(1);

    emitStatus('failed', { endReason: 'invalid_credentials' });
    await vi.waitFor(() => expect(changed.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(finished).toEqual([]);
  });
});
