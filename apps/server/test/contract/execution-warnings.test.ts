/**
 * Teste de contrato dos avisos no estado da execução (specs/002, T083, FR-016a): o servidor repete
 * as leituras do Hunit que falham por erro passageiro e publica um evento `warning` a cada nova
 * tentativa. Com vários hotéis ao mesmo tempo, os eventos de reserva tiram o aviso de
 * `recentEvents` em segundos; por isso o estado da execução traz a lista própria dos avisos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution } from '../helpers/factories.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

interface EventBody {
  id: string;
  type: string;
  hotelCode: string | null;
  message: string;
}

interface ExecutionBody {
  recentEvents: EventBody[];
  warnings: EventBody[];
}

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
});

afterAll(async () => {
  await test.close();
});

async function newExecution() {
  return insertExecution(test.database.db, { clientId: operator.id, status: 'running' });
}

async function warn(executionId: string, index: number) {
  return test.harness.events.publish({
    executionId,
    type: 'warning',
    hotelCode: '31',
    message: `Hotel 31: o Hunit não respondeu. Nova tentativa ${index} de 5 em 2 s.`,
  });
}

async function getExecution(executionId: string, client: TestClient = operator) {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/executions/${executionId}`,
    headers: client.headers,
  });
  expect(response.statusCode).toBe(200);
  expectMatchesContract('getExecution', response);
  return response.json<ExecutionBody>();
}

describe('GET /v1/executions/{id} — avisos (FR-016a)', () => {
  it('sem avisos, a lista vem vazia', async () => {
    const execution = await newExecution();
    await test.harness.events.publish({
      executionId: execution.id,
      type: 'hotel_started',
      hotelCode: '31',
      message: 'Hotel 31 iniciado.',
    });

    expect((await getExecution(execution.id)).warnings).toEqual([]);
  });

  it('traz só os eventos warning, os mais recentes primeiro, no máximo 20', async () => {
    const execution = await newExecution();
    const published = [];
    for (let index = 1; index <= 25; index += 1) {
      published.push(await warn(execution.id, index));
      await test.harness.events.publish({
        executionId: execution.id,
        type: 'page_done',
        hotelCode: '31',
        message: `Página ${index} lida.`,
      });
    }

    const { warnings } = await getExecution(execution.id);

    expect(warnings).toHaveLength(20);
    expect(warnings.every((event) => event.type === 'warning')).toBe(true);
    expect(warnings.map((event) => event.id)).toEqual(
      published
        .slice(-20)
        .reverse()
        .map((event) => String(event.id)),
    );
  });

  it('o aviso continua em warnings depois de sair de recentEvents', async () => {
    const execution = await newExecution();
    const warning = await warn(execution.id, 1);
    for (let index = 1; index <= 60; index += 1) {
      await test.harness.events.publish({
        executionId: execution.id,
        type: 'reservation_classified',
        hotelCode: '32',
        reservationNumber: `32${String(index).padStart(3, '0')}`,
        message: 'Reserva classificada.',
      });
    }

    const body = await getExecution(execution.id);

    expect(body.recentEvents.some((event) => event.id === String(warning.id))).toBe(false);
    expect(body.warnings).toEqual([
      expect.objectContaining({
        id: String(warning.id),
        hotelCode: '31',
        message: warning.message,
      }),
    ]);
  });

  it('não mistura avisos de outras execuções', async () => {
    const mine = await newExecution();
    const other = await newExecution();
    const own = await warn(mine.id, 1);
    await warn(other.id, 1);

    expect((await getExecution(mine.id)).warnings.map((event) => event.id)).toEqual([
      String(own.id),
    ]);
  });

  it('o perfil consulta também recebe os avisos', async () => {
    const execution = await newExecution();
    await warn(execution.id, 1);

    expect((await getExecution(execution.id, reader)).warnings).toHaveLength(1);
  });
});
