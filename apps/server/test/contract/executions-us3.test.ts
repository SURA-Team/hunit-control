/**
 * Testes de contrato da US3 (T053): cancelar, retomar, listar execuções e acompanhar o andamento
 * (`current`, duração por hotel e `timing`). O Hunit é simulado.
 */
import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestApp,
  startExecutionBody,
  type TestApp,
  type TestClient,
} from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const VALID_TOKEN = '246810';
const HOTEL_1 = '31';
const HOTEL_2 = '32';

/** Pausa a leitura de uma reserva até o teste liberar. */
interface Pause {
  bookingId: string;
  reached: () => void;
  release: Promise<void>;
}
let pause: Pause | null = null;

function pauseAt(reservationNumber: string) {
  let reached: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  pause = { bookingId: `booking-${reservationNumber}`, reached, release: releasePromise };
  return {
    reached: reachedPromise,
    release: () => {
      pause = null;
      release();
    },
  };
}

beforeAll(async () => {
  test = await createTestApp({
    scenario: {
      validToken: VALID_TOKEN,
      hotels: [HOTEL_1, HOTEL_2].map((code) => ({
        code,
        name: `Hotel ${code}`,
        reservations: [
          { reservationNumber: `${code}01`, listing: { checkIn: '2026-11-03' } },
          { reservationNumber: `${code}02`, listing: { checkIn: '2026-11-04' } },
        ],
      })),
    },
  });
  test.harness.hunit.before('readReservation', async (call) => {
    const current = pause;
    if (!current || call.bookingId !== current.bookingId) return;
    current.reached();
    await current.release;
  });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
});

afterAll(async () => {
  pause = null;
  await test.close();
});

interface HotelBody {
  hotelCode: string;
  status: string;
  reservationsSeen: number;
  pagesDone: number | null;
  pagesTotal: number | null;
  durationSeconds: number | null;
  failureReason: string | null;
}

interface ExecutionBody {
  id: string;
  parentExecutionId: string | null;
  status: string;
  endReason: string | null;
  current: {
    hotelCode: string;
    page: number;
    pagesTotal: number | null;
    reservationNumber: string | null;
  } | null;
  hotels: HotelBody[];
  timing: {
    avgSecondsPerReservation: number | null;
    avgSecondsPerHotel: number | null;
    estimatedRemainingSeconds: number | null;
  };
  recentEvents: Array<{ type: string; status?: string }>;
}

function bodyOf(response: LightMyRequestResponse): ExecutionBody {
  return response.json<ExecutionBody>();
}

function newCredentials() {
  return { username: `op-${randomUUID().slice(0, 8)}@hotel.test`, password: 'SENHA-US3-456' };
}

async function start(credentials = newCredentials()) {
  const response = await test.app.inject({
    method: 'POST',
    url: '/v1/executions',
    headers: operator.headers,
    payload: startExecutionBody({ credentials }),
  });
  expect(response.statusCode).toBe(202);
  return bodyOf(response);
}

async function get(executionId: string, client: TestClient = operator) {
  return test.app.inject({
    method: 'GET',
    url: `/v1/executions/${executionId}`,
    headers: client.headers,
  });
}

async function sendToken(executionId: string) {
  await vi.waitFor(
    async () => {
      const response = await test.app.inject({
        method: 'POST',
        url: `/v1/executions/${executionId}/two-factor`,
        headers: operator.headers,
        payload: { token: VALID_TOKEN },
      });
      expect(response.statusCode).toBe(202);
    },
    { timeout: 5_000, interval: 20 },
  );
}

async function cancel(executionId: string, client: TestClient = operator) {
  return test.app.inject({
    method: 'POST',
    url: `/v1/executions/${executionId}/cancel`,
    headers: client.headers,
  });
}

async function resume(
  executionId: string,
  client: TestClient = operator,
  payload: Record<string, unknown> = { credentials: newCredentials() },
) {
  return test.app.inject({
    method: 'POST',
    url: `/v1/executions/${executionId}/resume`,
    headers: client.headers,
    payload,
  });
}

async function finished(executionId: string): Promise<ExecutionBody> {
  await test.harness.runner.whenFinished(executionId);
  return bodyOf(await get(executionId));
}

/** Execução parada na 2ª reserva do 2º hotel (o 1º hotel já concluído). */
async function startPausedInSecondHotel() {
  const paused = pauseAt(`${HOTEL_2}02`);
  const execution = await start();
  await sendToken(execution.id);
  await paused.reached;
  return { execution, release: paused.release };
}

describe('POST /v1/executions/{executionId}/cancel (cancelExecution)', () => {
  it('202 com a execução; termina cancelled/cancelled_by_client sem gravar o hotel em andamento', async () => {
    const { execution, release } = await startPausedInSecondHotel();

    const response = await cancel(execution.id);
    release();

    expect(response.statusCode).toBe(202);
    expectMatchesContract('cancelExecution', response);
    expect(bodyOf(response).id).toBe(execution.id);

    const done = await finished(execution.id);
    expect(done).toMatchObject({ status: 'cancelled', endReason: 'cancelled_by_client' });
    expect(done.hotels.map((hotel) => [hotel.hotelCode, hotel.status])).toEqual([
      [HOTEL_1, 'completed'],
      [HOTEL_2, 'cancelled'],
    ]);
    expect(done.recentEvents.at(-1)).toMatchObject({ type: 'status_changed', status: 'cancelled' });
  });

  it('409 execution_already_finished para execução encerrada', async () => {
    const execution = await start();
    await sendToken(execution.id);
    expect((await finished(execution.id)).status).toBe('completed');

    const response = await cancel(execution.id);

    expect(response.statusCode).toBe(409);
    expectMatchesContract('cancelExecution', response);
    expect(response.json()).toMatchObject({ code: 'execution_already_finished' });
  });

  it('404 para execução inexistente, 403 para reader, 400 para id inválido', async () => {
    const missing = await cancel(randomUUID());
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('cancelExecution', missing);

    const execution = await start();
    const forbidden = await cancel(execution.id, reader);
    expect(forbidden.statusCode).toBe(403);
    expectMatchesContract('cancelExecution', forbidden);

    const invalid = await test.app.inject({
      method: 'POST',
      url: '/v1/executions/nao-e-uuid/cancel',
      headers: operator.headers,
    });
    expect(invalid.statusCode).toBe(400);
    expectMatchesContract('cancelExecution', invalid);

    // Limpeza: a execução iniciada aqui não fica esperando o token.
    await cancel(execution.id);
    await test.harness.runner.whenFinished(execution.id);
  });
});

describe('POST /v1/executions/{executionId}/resume (resumeExecution)', () => {
  it('202 com a nova execução, que só consulta os hotéis não concluídos (SC-007)', async () => {
    const { execution, release } = await startPausedInSecondHotel();
    await cancel(execution.id);
    release();
    await test.harness.runner.whenFinished(execution.id);
    const credentials = newCredentials();

    const response = await resume(execution.id, operator, { credentials });

    expect(response.statusCode).toBe(202);
    expectMatchesContract('resumeExecution', response);
    expect(response.body).not.toContain(credentials.password);
    expect(response.body).not.toContain(credentials.username);
    const resumed = bodyOf(response);
    expect(resumed.parentExecutionId).toBe(execution.id);
    expect(resumed.id).not.toBe(execution.id);

    await sendToken(resumed.id);
    const done = await finished(resumed.id);
    expect(done.status).toBe('completed');
    expect(done.hotels.map((hotel) => [hotel.hotelCode, hotel.status])).toEqual([
      [HOTEL_2, 'completed'],
    ]);
  });

  it('409 execution_already_resumed quando a execução já foi retomada, citando a retomada', async () => {
    const { execution, release } = await startPausedInSecondHotel();
    await cancel(execution.id);
    release();
    await test.harness.runner.whenFinished(execution.id);
    const first = bodyOf(await resume(execution.id));

    const response = await resume(execution.id);

    expect(response.statusCode).toBe(409);
    expectMatchesContract('resumeExecution', response);
    expect(response.json()).toMatchObject({ code: 'execution_already_resumed' });
    expect(response.json<{ detail: string }>().detail).toContain(first.id);

    await cancel(first.id);
    await test.harness.runner.whenFinished(first.id);
  });

  it('409 nothing_to_resume quando todos os hotéis foram concluídos', async () => {
    const execution = await start();
    await sendToken(execution.id);
    await finished(execution.id);

    const response = await resume(execution.id);

    expect(response.statusCode).toBe(409);
    expectMatchesContract('resumeExecution', response);
    expect(response.json()).toMatchObject({ code: 'nothing_to_resume' });
  });

  it('409 execution_already_active quando a execução ainda está em andamento', async () => {
    const execution = await start();

    const response = await resume(execution.id);

    expect(response.statusCode).toBe(409);
    expectMatchesContract('resumeExecution', response);
    expect(response.json()).toMatchObject({ code: 'execution_already_active' });

    await cancel(execution.id);
    await test.harness.runner.whenFinished(execution.id);
  });

  it('409 execution_already_active quando a conta já tem outra execução ativa (FR-006)', async () => {
    const { execution, release } = await startPausedInSecondHotel();
    await cancel(execution.id);
    release();
    await test.harness.runner.whenFinished(execution.id);
    const credentials = newCredentials();
    const busy = await start(credentials);

    const response = await resume(execution.id, operator, { credentials });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'execution_already_active' });

    await cancel(busy.id);
    await test.harness.runner.whenFinished(busy.id);
  });

  it('404 para execução inexistente, 403 para reader, 400 sem credenciais', async () => {
    const missing = await resume(randomUUID());
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('resumeExecution', missing);

    const forbidden = await resume(randomUUID(), reader);
    expect(forbidden.statusCode).toBe(403);
    expectMatchesContract('resumeExecution', forbidden);

    const invalid = await resume(randomUUID(), operator, {});
    expect(invalid.statusCode).toBe(400);
    expectMatchesContract('resumeExecution', invalid);
  });
});

describe('GET /v1/executions/{executionId}: andamento (FR-021, FR-021a)', () => {
  it('durante a execução: hotel, página e reserva atuais, duração dos hotéis e estimativa', async () => {
    const { execution, release } = await startPausedInSecondHotel();

    let response = await get(execution.id, reader);
    // O andamento é gravado logo depois de cada reserva: espera a 1ª reserva do 2º hotel.
    await vi.waitFor(async () => {
      response = await get(execution.id, reader);
      expect(bodyOf(response).current?.reservationNumber).toBe(`${HOTEL_2}01`);
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('getExecution', response);
    const body = bodyOf(response);
    expect(body.status).toBe('running');
    expect(body.current).toEqual({
      hotelCode: HOTEL_2,
      page: 1,
      pagesTotal: 1,
      reservationNumber: `${HOTEL_2}01`,
    });
    const [first, second] = body.hotels;
    expect(first).toMatchObject({ hotelCode: HOTEL_1, status: 'completed', reservationsSeen: 2 });
    expect(Number.isInteger(first?.durationSeconds)).toBe(true);
    expect(second).toMatchObject({
      hotelCode: HOTEL_2,
      status: 'running',
      reservationsSeen: 1,
      pagesTotal: 1,
      durationSeconds: null,
    });
    // Já há medição do 1º hotel: médias e estimativa preenchidas.
    expect(body.timing.avgSecondsPerReservation).toEqual(expect.any(Number));
    expect(body.timing.avgSecondsPerHotel).toEqual(expect.any(Number));
    expect(body.timing.estimatedRemainingSeconds).toEqual(expect.any(Number));

    release();
    const done = await finished(execution.id);
    expect(done.current).toBeNull();
    expect(done.timing.estimatedRemainingSeconds).toBeNull();
    expect(done.timing.avgSecondsPerHotel).toEqual(expect.any(Number));
    for (const hotel of done.hotels) {
      expect(Number.isInteger(hotel.durationSeconds)).toBe(true);
    }
  });

  it('esperando o token: sem hotel atual e sem estimativa', async () => {
    const execution = await start();
    await vi.waitFor(async () =>
      expect(bodyOf(await get(execution.id)).status).toBe('awaiting_2fa'),
    );

    const response = await get(execution.id);

    expectMatchesContract('getExecution', response);
    expect(bodyOf(response)).toMatchObject({
      current: null,
      hotels: [],
      timing: { estimatedRemainingSeconds: null },
    });

    await cancel(execution.id);
    await test.harness.runner.whenFinished(execution.id);
  });
});

describe('GET /v1/executions (listExecutions)', () => {
  it('filtra por status e percorre todas as páginas pelo cursor, sem repetir', async () => {
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const response: LightMyRequestResponse = await test.app.inject({
        method: 'GET',
        url: `/v1/executions?status=cancelled&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        headers: reader.headers,
      });
      expect(response.statusCode).toBe(200);
      expectMatchesContract('listExecutions', response);
      const page: { items: Array<{ id: string; status: string }>; nextCursor: string | null } =
        response.json();
      expect(page.items.every((item) => item.status === 'cancelled')).toBe(true);
      all.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    // Os testes anteriores cancelaram várias execuções.
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(new Set(all).size).toBe(all.length);
  });
});
