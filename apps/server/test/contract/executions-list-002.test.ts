/**
 * Testes de contrato da lista de execuções com os acréscimos da feature 002 (T052): quem iniciou
 * cada execução (`requestedClient`, FR-015) e o filtro de ativas (`active`, FR-019), que o app
 * desktop usa para achar as execuções da própria máquina ao abrir ou reconectar.
 */
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionStatus } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution } from '../helpers/factories.js';

let test: TestApp;
let starter: TestClient;
let resumer: TestClient;
let reader: TestClient;

const ACTIVE: ExecutionStatus[] = ['queued', 'running', 'awaiting_2fa'];
const FINISHED: ExecutionStatus[] = ['completed', 'failed', 'cancelled'];

/** id da execução → status, para conferir as respostas. */
const statusById = new Map<string, ExecutionStatus>();
let parentId = '';
let resumedId = '';

interface SummaryBody {
  id: string;
  status: ExecutionStatus;
  requestedClient: string;
  parentExecutionId?: string | null;
}

function itemsOf(response: LightMyRequestResponse): SummaryBody[] {
  return response.json<{ items: SummaryBody[] }>().items;
}

async function list(query: string, client: TestClient = starter) {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/executions${query}`,
    headers: client.headers,
  });
  expect(response.statusCode).toBe(200);
  expectMatchesContract('listExecutions', response);
  return itemsOf(response);
}

beforeAll(async () => {
  test = await createTestApp();
  starter = await test.createClient('operator');
  resumer = await test.createClient('operator');
  reader = await test.createClient('reader');

  const endReasons: Partial<Record<ExecutionStatus, 'internal_error' | 'cancelled_by_client'>> = {
    failed: 'internal_error',
    cancelled: 'cancelled_by_client',
  };
  for (const status of [...ACTIVE, ...FINISHED]) {
    const row = await insertExecution(test.database.db, {
      clientId: starter.id,
      status,
      endReason: endReasons[status] ?? null,
      ...(FINISHED.includes(status) && { finishedAt: new Date() }),
    });
    statusById.set(row.id, status);
  }

  // Execução interrompida e retomada por outro cliente (outra máquina).
  const parent = await insertExecution(test.database.db, {
    clientId: starter.id,
    status: 'failed',
    endReason: 'server_restarted',
    finishedAt: new Date(),
  });
  const resumed = await insertExecution(test.database.db, {
    clientId: resumer.id,
    status: 'completed',
    parentExecutionId: parent.id,
    finishedAt: new Date(),
  });
  parentId = parent.id;
  resumedId = resumed.id;
  statusById.set(parent.id, 'failed');
  statusById.set(resumed.id, 'completed');
});

afterAll(async () => {
  await test.close();
});

describe('GET /v1/executions — quem iniciou (FR-015)', () => {
  it('todo item traz o nome do cliente que iniciou', async () => {
    const items = await list('');

    expect(items).toHaveLength(statusById.size);
    for (const item of items) {
      const expected = item.id === resumedId ? resumer.name : starter.name;
      expect(item.requestedClient, item.id).toBe(expected);
    }
  });

  it('a retomada traz o cliente que retomou, e a original o que iniciou', async () => {
    const items = await list('');

    expect(items.find((item) => item.id === resumedId)).toMatchObject({
      requestedClient: resumer.name,
      parentExecutionId: parentId,
    });
    expect(items.find((item) => item.id === parentId)?.requestedClient).toBe(starter.name);
  });

  it('o perfil consulta também vê quem iniciou', async () => {
    const items = await list('', reader);

    expect(items.every((item) => item.requestedClient.length > 0)).toBe(true);
  });
});

describe('GET /v1/executions — filtro de ativas (FR-019)', () => {
  it('active=true só devolve execuções na fila, em andamento ou aguardando token', async () => {
    const items = await list('?active=true');

    expect(items.map((item) => item.status).sort()).toEqual([...ACTIVE].sort());
  });

  it('active=false só devolve execuções encerradas', async () => {
    const items = await list('?active=false');

    expect(items.length).toBe(statusById.size - ACTIVE.length);
    expect(items.every((item) => FINISHED.includes(item.status))).toBe(true);
  });

  it('active combina com status', async () => {
    expect((await list('?active=true&status=running')).map((item) => item.status)).toEqual([
      'running',
    ]);
    expect(await list('?active=true&status=completed')).toEqual([]);
    expect((await list('?active=false&status=failed')).map((item) => item.status)).toEqual([
      'failed',
      'failed',
    ]);
  });

  it('valor que não é booleano é recusado', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/executions?active=talvez',
      headers: starter.headers,
    });

    expect(response.statusCode).toBe(400);
    expectMatchesContract('listExecutions', response);
  });
});
