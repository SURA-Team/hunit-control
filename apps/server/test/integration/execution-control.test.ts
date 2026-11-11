/**
 * Cancelamento e retomada de execuções (T051, US3): Hunit simulado + banco real.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ExecutionNotFoundError,
  ExecutionStillActiveError,
  NothingToResumeError,
  resumeExecution,
} from '../../src/executions/resume.js';
import {
  ExecutionAlreadyActiveError,
  findExecution,
  listExecutionHotels,
} from '../../src/persistence/executions-repo.js';
import { HunitUnavailableError } from '../../src/hunit/errors.js';
import { executionEvents, executionHotels, reservations } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient, insertExecution, insertHotel } from '../helpers/factories.js';
import type { FakeHotel } from '../helpers/fake-hunit-gateway.js';
import {
  createRunnerHarness,
  startInput,
  TEST_PASSWORD,
  type RunnerHarness,
  type RunnerHarnessOptions,
} from '../helpers/runner.js';

let database: TestDatabase;
let clientId: string;
const harnesses: RunnerHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  clientId = (await insertClient(database.db, { name: 'desktop-us3' })).id;
});

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function harness(options: RunnerHarnessOptions = {}): Promise<RunnerHarness> {
  const created = await createRunnerHarness(database, options);
  harnesses.push(created);
  return created;
}

/** Promessa que o teste abre quando quiser. */
function gate() {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Códigos de hotel exclusivos do teste (o banco é compartilhado pelo arquivo). */
function codes(...names: string[]): string[] {
  const prefix = randomUUID().slice(0, 6);
  return names.map((name) => `${prefix}-${name}`);
}

/** Hotel com duas reservas de check-in dentro da semana usada nos testes. */
function hotelWithReservations(code: string, overrides: Partial<FakeHotel> = {}): FakeHotel {
  return {
    code,
    reservations: [
      { reservationNumber: `${code}-1`, listing: { checkIn: '2026-11-03' } },
      { reservationNumber: `${code}-2`, listing: { checkIn: '2026-11-04' } },
    ],
    ...overrides,
  };
}

function credentials() {
  return { username: `operador-${randomUUID().slice(0, 8)}@hotel.test`, password: TEST_PASSWORD };
}

/** Entrega o token assim que a execução o pedir. */
async function sendTokenWhenAsked(h: RunnerHarness, executionId: string): Promise<void> {
  await vi.waitFor(() => expect(h.runner.submitToken(executionId, '123456')).toBe(true), {
    timeout: 5_000,
    interval: 10,
  });
}

async function executionRow(executionId: string) {
  const found = await findExecution(database.db, executionId);
  if (!found) throw new Error('execução sumiu');
  return found.execution;
}

async function hotelStatuses(executionId: string): Promise<Record<string, string>> {
  const rows = await listExecutionHotels(database.db, executionId);
  return Object.fromEntries(rows.map((row) => [row.hotelCode, row.status]));
}

async function reservationNumbers(hotelCode: string): Promise<string[]> {
  const rows = await database.db
    .select({ number: reservations.reservationNumber })
    .from(reservations)
    .where(eq(reservations.hotelCode, hotelCode));
  return rows.map((row) => row.number).sort();
}

/**
 * Prepara uma execução com os hotéis A, B e C e a deixa parada na primeira reserva de B (o 2º
 * hotel). `release` deixa a leitura seguir.
 */
async function startAndPauseAtSecondHotel(options: RunnerHarnessOptions = {}) {
  const [a, b, c] = codes('A', 'B', 'C') as [string, string, string];
  const h = await harness({
    ...options,
    scenario: {
      hotels: [hotelWithReservations(a), hotelWithReservations(b), hotelWithReservations(c)],
    },
  });
  const reached = gate();
  const release = gate();
  h.hunit.before('readReservation', async (call) => {
    if (call.hotelCode !== b) return;
    reached.open();
    await release.promise;
  });

  const input = startInput(clientId, { hotelCodes: [a, b, c] });
  const execution = await h.runner.start(input);
  await sendTokenWhenAsked(h, execution.id);
  await reached.promise;
  return { h, execution, input, hotels: { a, b, c }, release };
}

describe('cancelamento (FR-022, SC-008)', () => {
  it('para no meio do 2º hotel: 1º gravado, 2º sem dados, 3º pendente', async () => {
    const { h, execution, hotels, release } = await startAndPauseAtSecondHotel();
    const cancelledBy = (await insertClient(database.db)).id;

    const startedAt = Date.now();
    expect(await h.runner.cancel(execution.id, cancelledBy)).toBe('requested');
    release.open();
    await h.runner.whenFinished(execution.id);

    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(await executionRow(execution.id)).toMatchObject({
      status: 'cancelled',
      endReason: 'cancelled_by_client',
      cancelledByClientId: cancelledBy,
    });
    expect(await hotelStatuses(execution.id)).toEqual({
      [hotels.a]: 'completed',
      [hotels.b]: 'cancelled',
      [hotels.c]: 'pending',
    });
    expect(await reservationNumbers(hotels.a)).toEqual([`${hotels.a}-1`, `${hotels.a}-2`]);
    expect(await reservationNumbers(hotels.b)).toEqual([]);
    // O andamento do hotel cancelado fica registrado, inclusive o total informado pelo Hunit.
    const runs = await listExecutionHotels(database.db, execution.id);
    expect(runs.find((run) => run.hotelCode === hotels.a)).toMatchObject({
      reservationsTotal: 2,
      reservationsSeen: 2,
      reservationsOpened: 2,
    });
    expect(runs.find((run) => run.hotelCode === hotels.b)).toMatchObject({
      reservationsTotal: 2,
      pagesTotal: 1,
      failureReason: 'A execução foi cancelada no meio do hotel; nada foi gravado.',
    });
    // O 3º hotel nem foi consultado.
    expect(h.hunit.callsTo('searchReservations').map((call) => call.hotelCode)).not.toContain(
      hotels.c,
    );
    // O navegador foi fechado.
    expect(h.hunit.sessions[0]?.closed).toBe(true);

    const finalEvent = await h.events.lastStatusChange(execution.id);
    expect(finalEvent).toMatchObject({ status: 'cancelled' });
  });

  it('fecha o navegador à força quando a leitura em andamento não termina (prazo de 10 s)', async () => {
    const { h, execution, hotels } = await startAndPauseAtSecondHotel({ cancelGraceMs: 50 });

    const startedAt = Date.now();
    // A leitura da reserva do 2º hotel nunca termina sozinha: só o fechamento a interrompe.
    expect(await h.runner.cancel(execution.id, clientId)).toBe('requested');
    await h.runner.whenFinished(execution.id);

    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(h.hunit.sessions[0]?.closed).toBe(true);
    expect(await executionRow(execution.id)).toMatchObject({
      status: 'cancelled',
      endReason: 'cancelled_by_client',
    });
    expect((await hotelStatuses(execution.id))[hotels.b]).toBe('cancelled');
    expect(await reservationNumbers(hotels.b)).toEqual([]);
  });

  it('o prazo padrão de fechamento forçado é de 10 s', async () => {
    const { h, execution, release } = await startAndPauseAtSecondHotel();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      await h.runner.cancel(execution.id, clientId);

      expect(setTimeoutSpy.mock.calls.map(([, delay]) => delay)).toContain(10_000);
      // Antes do prazo, o navegador continua aberto: a parada é cooperativa.
      expect(h.hunit.sessions[0]?.closed).toBe(false);
    } finally {
      setTimeoutSpy.mockRestore();
      release.open();
    }
    await h.runner.whenFinished(execution.id);
    expect((await executionRow(execution.id)).status).toBe('cancelled');
  });

  it('com hotéis em paralelo, marca como cancelados todos os que estavam em andamento', async () => {
    const [a, b, c] = codes('A', 'B', 'C') as [string, string, string];
    const h = await harness({
      hotelConcurrency: 2,
      scenario: {
        hotels: [hotelWithReservations(a), hotelWithReservations(b), hotelWithReservations(c)],
      },
    });
    const reachedA = gate();
    const reachedB = gate();
    const release = gate();
    h.hunit.before('readReservation', async (call) => {
      if (call.hotelCode === a) reachedA.open();
      else if (call.hotelCode === b) reachedB.open();
      else return;
      await release.promise;
    });

    const execution = await h.runner.start(startInput(clientId, { hotelCodes: [a, b, c] }));
    await sendTokenWhenAsked(h, execution.id);
    await Promise.all([reachedA.promise, reachedB.promise]);

    await h.runner.cancel(execution.id, clientId);
    release.open();
    await h.runner.whenFinished(execution.id);

    expect((await executionRow(execution.id)).status).toBe('cancelled');
    expect(await hotelStatuses(execution.id)).toEqual({
      [a]: 'cancelled',
      [b]: 'cancelled',
      [c]: 'pending',
    });
    expect(await reservationNumbers(a)).toEqual([]);
    expect(await reservationNumbers(b)).toEqual([]);
  });

  it('cancela enquanto espera o token: o token deixa de ser aceito', async () => {
    const h = await harness({ scenario: { hotels: [] } });
    const execution = await h.runner.start(startInput(clientId));
    await vi.waitFor(async () =>
      expect((await executionRow(execution.id)).status).toBe('awaiting_2fa'),
    );

    expect(await h.runner.cancel(execution.id, clientId)).toBe('requested');
    await h.runner.whenFinished(execution.id);

    expect(await executionRow(execution.id)).toMatchObject({
      status: 'cancelled',
      endReason: 'cancelled_by_client',
      twoFactorDeadline: null,
    });
    expect(h.runner.submitToken(execution.id, '123456')).toBe(false);
    expect(h.hunit.callsTo('submitToken')).toEqual([]);
  });

  it('execução já encerrada: nada muda', async () => {
    const h = await harness({ scenario: { hotels: [] } });
    const execution = await h.runner.start(startInput(clientId));
    await sendTokenWhenAsked(h, execution.id);
    await h.runner.whenFinished(execution.id);

    expect(await h.runner.cancel(execution.id, clientId)).toBe('already_finished');
    expect(await executionRow(execution.id)).toMatchObject({
      status: 'completed',
      cancelledByClientId: null,
    });
  });

  it('execução ativa no banco que não está neste processo: cancelada direto no banco', async () => {
    const h = await harness();
    const hotel = await insertHotel(database.db);
    const orphan = await insertExecution(database.db, { status: 'running', clientId });
    await database.db
      .insert(executionHotels)
      .values({ executionId: orphan.id, hotelCode: hotel.code, status: 'running' });

    expect(await h.runner.cancel(orphan.id, clientId)).toBe('requested');

    expect(await executionRow(orphan.id)).toMatchObject({
      status: 'cancelled',
      endReason: 'cancelled_by_client',
      cancelledByClientId: clientId,
    });
    expect(await hotelStatuses(orphan.id)).toEqual({ [hotel.code]: 'cancelled' });
    const statusEvents = await database.db
      .select()
      .from(executionEvents)
      .where(
        and(eq(executionEvents.executionId, orphan.id), eq(executionEvents.type, 'status_changed')),
      );
    expect(statusEvents.map((event) => event.status)).toEqual(['cancelled']);
  });

  it('execução inexistente: nada a cancelar', async () => {
    const h = await harness();

    expect(await h.runner.cancel(randomUUID(), clientId)).toBe('already_finished');
  });
});

describe('retomada (FR-023, SC-007)', () => {
  it('retoma do 1º hotel não concluído, com novo acesso e token, sem reprocessar o 1º', async () => {
    const { h, execution, input, hotels, release } = await startAndPauseAtSecondHotel();
    await h.runner.cancel(execution.id, clientId);
    release.open();
    await h.runner.whenFinished(execution.id);

    const resumed = await resumeExecution(
      { db: database.db, runner: h.runner },
      { executionId: execution.id, clientId, credentials: credentials() },
    );

    expect(resumed).toMatchObject({
      parentExecutionId: execution.id,
      requestedHotelCodes: [hotels.b, hotels.c],
      periodFrom: input.period.from,
      periodTo: input.period.to,
      clientId,
    });
    expect(resumed.id).not.toBe(execution.id);

    // Novo acesso: nova sessão, novo login e novo token.
    await sendTokenWhenAsked(h, resumed.id);
    await h.runner.whenFinished(resumed.id);

    expect((await executionRow(resumed.id)).status).toBe('completed');
    const secondSession = h.hunit.calls.filter((call) => call.session === 2);
    expect(secondSession.map((call) => call.method)).toContain('login');
    expect(secondSession.map((call) => call.method)).toContain('submitToken');
    const searched = h.hunit
      .callsTo('searchReservations')
      .filter((call) => call.session === 2)
      .map((call) => call.hotelCode);
    expect(new Set(searched)).toEqual(new Set([hotels.b, hotels.c]));
    expect(await hotelStatuses(resumed.id)).toEqual({
      [hotels.b]: 'completed',
      [hotels.c]: 'completed',
    });
    expect(await reservationNumbers(hotels.b)).toEqual([`${hotels.b}-1`, `${hotels.b}-2`]);
  });

  it('inclui hotéis com falha de uma execução concluída', async () => {
    const [a, b] = codes('A', 'B') as [string, string];
    const h = await harness({
      scenario: {
        hotels: [
          hotelWithReservations(a),
          hotelWithReservations(b, { searchError: new HunitUnavailableError() }),
        ],
      },
    });
    const execution = await h.runner.start(startInput(clientId, { hotelCodes: [a, b] }));
    await sendTokenWhenAsked(h, execution.id);
    await h.runner.whenFinished(execution.id);
    expect((await executionRow(execution.id)).status).toBe('completed');

    const resumed = await resumeExecution(
      { db: database.db, runner: h.runner },
      { executionId: execution.id, clientId, credentials: credentials() },
    );

    expect(resumed.requestedHotelCodes).toEqual([b]);
  });

  it('execução que falhou antes de consultar hotéis: retoma o pedido original', async () => {
    const [a, b] = codes('A', 'B') as [string, string];
    const h = await harness({ scenario: { hotels: [{ code: a }, { code: b }] } });
    const execution = await h.runner.start(startInput(clientId, { hotelCodes: [a, b] }));
    await vi.waitFor(() => expect(h.runner.submitToken(execution.id, '000000')).toBe(true));
    await h.runner.whenFinished(execution.id);
    expect(await executionRow(execution.id)).toMatchObject({
      status: 'failed',
      endReason: 'invalid_token',
    });

    const resumed = await resumeExecution(
      { db: database.db, runner: h.runner },
      { executionId: execution.id, clientId, credentials: credentials() },
    );

    expect(resumed.requestedHotelCodes).toEqual([a, b]);
  });

  it('todos os hotéis já foram consultados: nada a retomar', async () => {
    const [a] = codes('A') as [string];
    const h = await harness({ scenario: { hotels: [hotelWithReservations(a)] } });
    const execution = await h.runner.start(startInput(clientId, { hotelCodes: [a] }));
    await sendTokenWhenAsked(h, execution.id);
    await h.runner.whenFinished(execution.id);

    await expect(
      resumeExecution(
        { db: database.db, runner: h.runner },
        { executionId: execution.id, clientId, credentials: credentials() },
      ),
    ).rejects.toBeInstanceOf(NothingToResumeError);
    expect(h.hunit.sessions).toHaveLength(1);
  });

  it('execução ainda ativa não pode ser retomada', async () => {
    const h = await harness({ scenario: { hotels: [] } });
    const execution = await h.runner.start(startInput(clientId));

    await expect(
      resumeExecution(
        { db: database.db, runner: h.runner },
        { executionId: execution.id, clientId, credentials: credentials() },
      ),
    ).rejects.toBeInstanceOf(ExecutionStillActiveError);
  });

  it('conta que já tem uma execução ativa: recusada (FR-006)', async () => {
    const [a] = codes('A') as [string];
    const h = await harness({
      scenario: {
        hotels: [hotelWithReservations(a, { searchError: new HunitUnavailableError() })],
      },
    });
    const finished = await h.runner.start(startInput(clientId, { hotelCodes: [a] }));
    await sendTokenWhenAsked(h, finished.id);
    await h.runner.whenFinished(finished.id);
    const busy = startInput(clientId);
    await h.runner.start(busy);

    await expect(
      resumeExecution(
        { db: database.db, runner: h.runner },
        { executionId: finished.id, clientId, credentials: busy.credentials },
      ),
    ).rejects.toBeInstanceOf(ExecutionAlreadyActiveError);
  });

  it('execução inexistente', async () => {
    const h = await harness();

    await expect(
      resumeExecution(
        { db: database.db, runner: h.runner },
        { executionId: randomUUID(), clientId, credentials: credentials() },
      ),
    ).rejects.toBeInstanceOf(ExecutionNotFoundError);
  });
});
