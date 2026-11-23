/**
 * Acompanhamento dos envios ao Comercial no processo principal (specs/005, T036; research R-14):
 * o mesmo das execuções — o envio desta máquina pede o token com o prazo do servidor, o fluxo de
 * eventos abre depois do evento mais recente (o histórico não é reprocessado) e o fim vira uma
 * notificação. Servidor HTTPS local com respostas programadas; dados fictícios.
 */
import type { ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/main/api-client.js';
import { ExecutionWatcher, type FinishedSummary } from '../../src/main/execution-watcher.js';
import type {
  CommercialDispatch,
  ExecutionStatus,
  JobRef,
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
import { dispatchFixture } from '../helpers/commercial-fixtures.js';

const ID = '44444444-4444-4444-8444-444444444444';
const JOB: JobRef = { kind: 'dispatch', id: ID };
const ME = 'desktop-financeiro';

let certificates: TestCertificates;
let server: TestHttpsServer;
let api: ApiClient;
let watcher: ExecutionWatcher;
let dispatch: CommercialDispatch;
let streams: SseStream[];
let lastEventIds: Array<string | undefined>;
let changed: JobRef[];
let requests: TwoFactorRequest[];
let closed: TwoFactorClosed[];
let finished: FinishedSummary[];
let listQueries: string[] = [];
let nextEventId: number;
let deadline: string;

function makeDispatch(status: ExecutionStatus, overrides: Partial<CommercialDispatch> = {}) {
  return dispatchFixture({
    id: ID,
    status,
    twoFactorDeadline: status === 'awaiting_2fa' ? deadline : null,
    lastEventId: '9',
    ...overrides,
  });
}

function emitStatus(status: ExecutionStatus, overrides: Partial<CommercialDispatch> = {}) {
  dispatch = makeDispatch(status, overrides);
  const stream = streams.at(-1);
  if (!stream) throw new Error('nenhum fluxo aberto');
  stream.send({
    id: nextEventId++,
    event: 'status_changed',
    data: { type: 'status_changed', status, message: '' },
  });
}

function emitItem() {
  const stream = streams.at(-1);
  if (!stream) throw new Error('nenhum fluxo aberto');
  stream.send({ id: nextEventId++, event: 'item_processed', data: { type: 'item_processed' } });
}

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startHttpsServer(certificates.server);
});

beforeEach(() => {
  deadline = new Date(Date.now() + 90_000).toISOString();
  dispatch = makeDispatch('awaiting_2fa');
  streams = [];
  lastEventIds = [];
  changed = [];
  requests = [];
  closed = [];
  finished = [];
  nextEventId = 10;
  listQueries = [];
  server.on('GET', `/v1/commercial-dispatches/${ID}`, (_request, response) =>
    sendJson(response, 200, dispatch),
  );
  server.on(
    'GET',
    `/v1/commercial-dispatches/${ID}/events`,
    (request, response: ServerResponse) => {
      lastEventIds.push(request.headers['last-event-id'] as string | undefined);
      streams.push(openSse(response));
    },
  );
  server.on('GET', '/v1/executions', (_request, response) =>
    sendJson(response, 200, { items: [], nextCursor: null }),
  );
  server.on('GET', '/v1/commercial-dispatches', (request, response) => {
    listQueries.push(request.query.toString());
    sendJson(response, 200, {
      items: [
        { ...dispatch, requestedClient: ME },
        {
          ...makeDispatch('awaiting_2fa'),
          id: '66666666-6666-4666-8666-666666666666',
          requestedClient: 'outra-maquina',
        },
      ],
      nextCursor: null,
    });
  });
  api = new ApiClient({
    serverUrl: server.url,
    caCertificatePem: certificates.authority.certificatePem,
    apiKey: 'hunit_chave-envio',
  });
  watcher = new ExecutionWatcher({
    getApi: () => api,
    onChanged: (job) => changed.push(job),
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

describe('envio desta máquina (specs/005, research R-14)', () => {
  it('pede o token com o prazo do servidor e abre o fluxo depois do evento mais recente', async () => {
    watcher.track(JOB, { own: true });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ job: JOB, deadline });
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    expect(lastEventIds[0]).toBe('9');
    expect(watcher.ownActive()).toEqual([JOB]);
  });

  it('token desta máquina aceito: fecha o pedido como aceito no primeiro andamento', async () => {
    watcher.track(JOB, { own: true });
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    watcher.noteTokenSent(JOB);
    emitStatus('running');
    emitItem();

    await vi.waitFor(() => expect(closed).toEqual([{ job: JOB, reason: 'accepted' }]));
    expect(changed.every((job) => job.kind === 'dispatch' && job.id === ID)).toBe(true);
  });

  it('ao terminar, a notificação traz as contagens do envio', async () => {
    dispatch = makeDispatch('running');
    watcher.track(JOB, { own: true });
    await vi.waitFor(() => expect(streams).toHaveLength(1));

    emitStatus('completed', {
      counts: {
        total: 3,
        pending: 0,
        sent: 2,
        withdrawn: 1,
        notVerified: 0,
        ignored: 0,
        checked: 0,
      },
    });

    await vi.waitFor(() => expect(finished).toHaveLength(1));
    expect(finished[0]).toEqual({
      job: JOB,
      title: 'Envio ao Comercial concluído',
      body: '2 enviada(s); 1 retirada(s).',
    });
  });

  it('ao conectar, retoma só os envios ativos deste cliente', async () => {
    await watcher.resumeOwn(ME);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests.map((request) => request.job)).toEqual([JOB]);
    // Envios e verificações da fila "Cobradas no Hunit": as duas pedem o token (specs/008).
    expect(listQueries.at(-1)).toContain('purpose=all');
  });
});
