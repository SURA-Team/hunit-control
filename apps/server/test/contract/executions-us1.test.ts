/**
 * Testes de contrato da US1 (T025): iniciar execução, acompanhar, enviar o token, catálogo de
 * hotéis e stream de eventos. O Hunit é simulado.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvalidCredentialsError } from '../../src/hunit/errors.js';
import {
  createTestApp,
  startExecutionBody,
  type TestApp,
  type TestClient,
} from '../helpers/app.js';
import { expectMatchesContract, expectMatchesSchema } from '../helpers/contract.js';
import { readSse } from '../helpers/sse.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;
let baseUrl: string;

const VALID_TOKEN = '135790';

beforeAll(async () => {
  test = await createTestApp({
    scenario: {
      validToken: VALID_TOKEN,
      hotels: [
        { code: '10', name: 'Hotel Alfa' },
        { code: '20', name: 'Hotel Beta' },
      ],
    },
  });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  await test.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = test.app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await test.close();
});

/** Corpo de início com um usuário exclusivo (cada conta só pode ter uma execução ativa). */
function newBody(overrides: Record<string, unknown> = {}) {
  const body = startExecutionBody(overrides);
  return {
    ...body,
    credentials: { ...body.credentials, username: `op-${randomUUID().slice(0, 8)}@hotel.test` },
  };
}

interface ExecutionBody {
  id: string;
  status: string;
  endReason: string | null;
  twoFactorDeadline: string | null;
  requestedClient: string;
  recentEvents: Array<{ type: string; status?: string; message: string }>;
}

function bodyOf(response: LightMyRequestResponse): ExecutionBody {
  return response.json<ExecutionBody>();
}

async function start(body: Record<string, unknown> = newBody(), client = operator) {
  return test.app.inject({
    method: 'POST',
    url: '/v1/executions',
    headers: client.headers,
    payload: body,
  });
}

async function get(executionId: string, client: TestClient = operator) {
  return test.app.inject({
    method: 'GET',
    url: `/v1/executions/${executionId}`,
    headers: client.headers,
  });
}

async function sendToken(executionId: string, token: string, client = operator) {
  return test.app.inject({
    method: 'POST',
    url: `/v1/executions/${executionId}/two-factor`,
    headers: client.headers,
    payload: { token },
  });
}

async function waitForStatus(executionId: string, status: string): Promise<ExecutionBody> {
  let last: ExecutionBody | undefined;
  await vi.waitFor(
    async () => {
      last = bodyOf(await get(executionId));
      expect(last.status).toBe(status);
    },
    { timeout: 5_000, interval: 20 },
  );
  if (!last) throw new Error('inalcançável');
  return last;
}

describe('POST /v1/executions (createExecution)', () => {
  it('202 com a execução criada, conforme o contrato', async () => {
    const response = await start();

    expect(response.statusCode).toBe(202);
    expectMatchesContract('createExecution', response);
    const body = bodyOf(response);
    expect(body).toMatchObject({ requestedClient: operator.name, endReason: null });
    expect(['queued', 'running', 'awaiting_2fa']).toContain(body.status);

    await waitForStatus(body.id, 'awaiting_2fa');
  });

  it('a resposta nunca devolve as credenciais', async () => {
    const body = newBody();
    const response = await start(body);

    expect(response.body).not.toContain(body.credentials.password);
    expect(response.body).not.toContain(body.credentials.username);
  });

  it('409 execution_already_active para a mesma conta (FR-006)', async () => {
    const body = newBody();
    expect((await start(body)).statusCode).toBe(202);

    const again = await start(body);

    expect(again.statusCode).toBe(409);
    expectMatchesContract('createExecution', again);
    expect(again.json()).toMatchObject({ code: 'execution_already_active' });
  });

  it('400 validation_error quando o período começa depois de terminar', async () => {
    const response = await start(newBody({ period: { from: '2026-11-10', to: '2026-11-01' } }));

    expect(response.statusCode).toBe(400);
    expectMatchesContract('createExecution', response);
    expect(response.json()).toMatchObject({ code: 'validation_error' });
  });

  it('400 validation_error para data inexistente', async () => {
    const response = await start(newBody({ period: { from: '2026-02-30', to: '2026-03-01' } }));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });
  });

  it('403 forbidden_for_role para o nível reader', async () => {
    const response = await start(newBody(), reader);

    expect(response.statusCode).toBe(403);
    expectMatchesContract('createExecution', response);
  });
});

describe('GET /v1/executions/{executionId} (getExecution)', () => {
  it('200 com estado, prazo do token e eventos recentes; reader também pode consultar', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');
    // O evento é gravado logo depois da mudança de estado: espera ele também.
    let response = await get(id, reader);
    await vi.waitFor(async () => {
      response = await get(id, reader);
      expect(bodyOf(response).recentEvents.at(-1)?.status).toBe('awaiting_2fa');
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('getExecution', response);
    const body = bodyOf(response);
    expect(body.twoFactorDeadline).not.toBeNull();
    expect(body.recentEvents.map((event) => event.status)).toEqual([
      'queued',
      'running',
      'awaiting_2fa',
    ]);
  });

  it('404 not_found para execução inexistente', async () => {
    const response = await get(randomUUID());

    expect(response.statusCode).toBe(404);
    expectMatchesContract('getExecution', response);
  });

  it('400 validation_error para id que não é UUID', async () => {
    const response = await get('nao-e-uuid');

    expect(response.statusCode).toBe(400);
    expectMatchesContract('getExecution', response);
  });
});

describe('GET /v1/executions (listExecutions)', () => {
  it('200 com as execuções mais recentes primeiro', async () => {
    const { id } = bodyOf(await start());

    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/executions?limit=1',
      headers: reader.headers,
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('listExecutions', response);
    const body = response.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(body.items.map((item) => item.id)).toEqual([id]);
    expect(body.nextCursor).not.toBeNull();
  });

  it('400 validation_error para cursor inválido', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/executions?cursor=lixo',
      headers: reader.headers,
    });

    expect(response.statusCode).toBe(400);
    expectMatchesContract('listExecutions', response);
  });
});

describe('POST /v1/executions/{executionId}/two-factor (sendTwoFactor)', () => {
  it('202 sem corpo; o acesso é concluído e o catálogo atualizado', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');

    const response = await sendToken(id, VALID_TOKEN);

    expect(response.statusCode).toBe(202);
    expectMatchesContract('sendTwoFactor', response);
    const done = await waitForStatus(id, 'completed');
    expect(done.twoFactorDeadline).toBeNull();
    expect(done.recentEvents.map((event) => event.type)).toContain('catalog_updated');
  });

  it('token errado: a execução termina como failed/invalid_token', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');

    expect((await sendToken(id, '000000')).statusCode).toBe(202);

    expect((await waitForStatus(id, 'failed')).endReason).toBe('invalid_token');
  });

  it('409 not_awaiting_two_factor quando a execução não espera token', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');
    await sendToken(id, VALID_TOKEN);
    await waitForStatus(id, 'completed');

    const response = await sendToken(id, VALID_TOKEN);

    expect(response.statusCode).toBe(409);
    expectMatchesContract('sendTwoFactor', response);
    expect(response.json()).toMatchObject({ code: 'not_awaiting_two_factor' });
  });

  it('404 para execução inexistente e 403 para reader', async () => {
    const missing = await sendToken(randomUUID(), VALID_TOKEN);
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('sendTwoFactor', missing);

    const { id } = bodyOf(await start());
    const forbidden = await sendToken(id, VALID_TOKEN, reader);
    expect(forbidden.statusCode).toBe(403);
    expectMatchesContract('sendTwoFactor', forbidden);
  });

  it('400 validation_error para token fora do formato, sem repetir o valor', async () => {
    const { id } = bodyOf(await start());

    const response = await sendToken(id, 'abc-SEGREDO');

    expect(response.statusCode).toBe(400);
    expectMatchesContract('sendTwoFactor', response);
    expect(response.body).not.toContain('abc-SEGREDO');
  });

  it('o token não aparece nos logs', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');
    await sendToken(id, VALID_TOKEN);
    await waitForStatus(id, 'completed');

    expect(test.logs.text()).not.toContain(VALID_TOKEN);
  });
});

describe('falha no login pela API', () => {
  it('credenciais inválidas: failed/invalid_credentials sem pedir token', async () => {
    const own = await createTestApp({ scenario: { login: new InvalidCredentialsError() } });
    try {
      const client = await own.createClient('operator');
      const created = await own.app.inject({
        method: 'POST',
        url: '/v1/executions',
        headers: client.headers,
        payload: newBody(),
      });
      const { id } = bodyOf(created);
      await own.harness.runner.whenFinished(id);

      const response = await own.app.inject({
        method: 'GET',
        url: `/v1/executions/${id}`,
        headers: client.headers,
      });
      const body = bodyOf(response);
      expect(body).toMatchObject({ status: 'failed', endReason: 'invalid_credentials' });
      expect(body.recentEvents.map((event) => event.status)).not.toContain('awaiting_2fa');
    } finally {
      await own.close();
    }
  });
});

describe('GET /v1/hotels (listHotels)', () => {
  it('200 com o catálogo lido na última execução concluída', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');
    await sendToken(id, VALID_TOKEN);
    await waitForStatus(id, 'completed');

    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/hotels',
      headers: reader.headers,
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('listHotels', response);
    expect(response.json()).toMatchObject({
      items: [
        { code: '10', name: 'Hotel Alfa', available: true },
        { code: '20', name: 'Hotel Beta', available: true },
      ],
    });
  });

  it('401 sem chave', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/v1/hotels' });

    expect(response.statusCode).toBe(401);
    expectMatchesContract('listHotels', response);
  });
});

describe('GET /v1/executions/{executionId}/events (streamExecutionEvents, T034)', () => {
  function openStream(executionId: string, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/v1/executions/${executionId}/events`, {
      headers: { ...operator.headers, ...headers },
    });
  }

  it('entrega os eventos em tempo real, no formato do contrato, e termina no estado final', async () => {
    const { id } = bodyOf(await start());
    const response = await openStream(id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reading = readSse(response, { timeoutMs: 5_000 });
    await waitForStatus(id, 'awaiting_2fa');
    await sendToken(id, VALID_TOKEN);
    const { messages, endedByServer } = await reading;

    expect(endedByServer).toBe(true);
    for (const message of messages) {
      const data = JSON.parse(message.data) as { id: string; type: string };
      expectMatchesSchema('ExecutionEvent', data);
      expect(message.id).toBe(data.id);
      expect(message.event).toBe(data.type);
    }
    const statuses = messages.map(
      (message) => (JSON.parse(message.data) as { status?: string }).status,
    );
    expect(statuses.filter(Boolean)).toEqual([
      'queued',
      'running',
      'awaiting_2fa',
      'running',
      'completed',
    ]);
  });

  it('com Last-Event-ID, reenvia só os eventos posteriores', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');

    const first = await readSse(await openStream(id), {
      stopWhen: (message) => message.data.includes('"awaiting_2fa"'),
    });
    const lastId = first.messages.at(-1)?.id ?? '';

    await sendToken(id, VALID_TOKEN);
    await waitForStatus(id, 'completed');

    const resumed = await readSse(await openStream(id, { 'last-event-id': lastId }));
    const ids = resumed.messages.map((message) => Number(message.id));
    expect(Math.min(...ids)).toBeGreaterThan(Number(lastId));
    expect(resumed.messages.at(-1)?.data).toContain('"completed"');
    expect(resumed.endedByServer).toBe(true);
  });

  it('para execução já encerrada cujo fim o cliente já recebeu, termina sem mensagens', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');
    await sendToken(id, VALID_TOKEN);
    await waitForStatus(id, 'completed');
    const all = await readSse(await openStream(id));
    const lastId = all.messages.at(-1)?.id ?? '';

    const again = await readSse(await openStream(id, { 'last-event-id': lastId }));

    expect(again).toEqual({ messages: [], endedByServer: true });
  });

  it('400 para Last-Event-ID inválido, 404 para execução inexistente, 401 sem chave', async () => {
    const { id } = bodyOf(await start());

    const invalid = await test.app.inject({
      method: 'GET',
      url: `/v1/executions/${id}/events`,
      headers: { ...operator.headers, 'last-event-id': 'abc' },
    });
    expect(invalid.statusCode).toBe(400);
    expectMatchesContract('streamExecutionEvents', invalid);

    const missing = await test.app.inject({
      method: 'GET',
      url: `/v1/executions/${randomUUID()}/events`,
      headers: operator.headers,
    });
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('streamExecutionEvents', missing);

    const anonymous = await test.app.inject({
      method: 'GET',
      url: `/v1/executions/${id}/events`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('o assinante sai quando o cliente desconecta', async () => {
    const { id } = bodyOf(await start());
    await waitForStatus(id, 'awaiting_2fa');

    await readSse(await openStream(id), {
      stopWhen: (message) => message.data.includes('"awaiting_2fa"'),
    });

    await vi.waitFor(() => expect(test.harness.events.subscriberCount(id)).toBe(0), {
      timeout: 2_000,
    });
  });
});
