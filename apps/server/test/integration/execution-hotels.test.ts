/**
 * Consulta e gravação dos hotéis pelo executor (T039, US2): Hunit simulado + banco real.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  HunitUnavailableError,
  ScreenNotRecognizedError,
  SessionExpiredError,
} from '../../src/hunit/errors.js';
import { findExecution, listExecutionHotels } from '../../src/persistence/executions-repo.js';
import {
  evidence,
  executionHotels,
  reservationObservations,
  reservations,
} from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient } from '../helpers/factories.js';
import {
  reservationDetails,
  type FakeHotel,
  type FakeReservation,
} from '../helpers/fake-hunit-gateway.js';
import {
  createRunnerHarness,
  startInput,
  type RunnerHarness,
  type RunnerHarnessOptions,
} from '../helpers/runner.js';

let database: TestDatabase;
let clientId: string;
const harnesses: RunnerHarness[] = [];
const week = { from: '2026-11-01', to: '2026-11-07' };

beforeAll(async () => {
  database = await createTestDatabase();
  clientId = (await insertClient(database.db, { name: 'desktop' })).id;
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

/** Inicia a execução, entrega o token quando pedido e espera o fim. */
async function run(h: RunnerHarness, hotelCodes: string[] | null = null, period = week) {
  const execution = await h.runner.start(startInput(clientId, { hotelCodes, period }));
  await vi.waitFor(() => expect(h.runner.submitToken(execution.id, '123456')).toBe(true), {
    timeout: 5_000,
    interval: 10,
  });
  await h.runner.whenFinished(execution.id);
  const found = await findExecution(database.db, execution.id);
  if (!found) throw new Error('execução sumiu');
  return found.execution;
}

async function reservationsOf(hotelCode: string) {
  return database.db
    .select()
    .from(reservations)
    .where(eq(reservations.hotelCode, hotelCode))
    .orderBy(reservations.reservationNumber);
}

async function hotelRun(executionId: string, hotelCode: string) {
  const [row] = await database.db
    .select()
    .from(executionHotels)
    .where(
      and(eq(executionHotels.executionId, executionId), eq(executionHotels.hotelCode, hotelCode)),
    );
  return row;
}

function reservation(number: string, overrides: Partial<FakeReservation> = {}): FakeReservation {
  return { reservationNumber: number, listing: { checkIn: '2026-11-03' }, ...overrides };
}

describe('hotel concluído (FR-011 a FR-019)', () => {
  it('percorre todas as páginas, classifica e grava cada reserva com o histórico', async () => {
    const hotel: FakeHotel = {
      code: 'A1',
      pageSize: 2,
      reservations: [
        reservation('1001'),
        reservation('1002', { detail: reservationDetails.alreadyCharged() }),
        reservation('1003', { detail: reservationDetails.validatedOnly() }),
        reservation('1004', { detail: reservationDetails.chargeError() }),
        reservation('1005', { detail: reservationDetails.notVirtualCard() }),
        reservation('1006', {
          reservationStatus: 'cancelled',
          detail: reservationDetails.alreadyCharged(),
        }),
        reservation('258-7', { reservationStatus: 'cancelled' }),
        reservation('1008', { detail: reservationDetails.unrecognized() }),
      ],
    };
    const h = await harness({ scenario: { hotels: [hotel] } });

    const execution = await run(h);

    expect(execution).toMatchObject({ status: 'completed', endReason: null });
    // Todas as 4 páginas (8 reservas, 2 por página) foram lidas.
    expect(h.hunit.callsTo('searchReservations').map((call) => call.page)).toEqual([1, 2, 3, 4]);
    // A "258-" não é aberta.
    expect(h.hunit.callsTo('readReservation').map((call) => call.bookingId)).not.toContain(
      'booking-258-7',
    );

    const rows = await reservationsOf('A1');
    expect(
      rows.map((row) => [row.reservationNumber, row.classification, row.reservationStatus]),
    ).toEqual([
      ['1001', 'virtual_card_pending_charge', 'active'],
      ['1002', 'virtual_card_already_charged', 'active'],
      ['1003', 'virtual_card_validated_only', 'active'],
      ['1004', 'virtual_card_charge_error', 'active'],
      ['1005', 'not_virtual_card', 'active'],
      ['1006', 'virtual_card_already_charged', 'cancelled'],
      ['1008', 'analysis_error', 'active'], // detalhe sem situação: vale a da listagem
      ['258-7', 'ignored_hotelbeds_258', 'cancelled'],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        verificationCount: 1,
        lastExecutionId: execution.id,
        notFoundSince: null,
        statusChanged: false,
      });
      expect(row.reason).not.toBe('');
      expect(row.firstVerifiedAt).toEqual(row.lastVerifiedAt);
    }
    expect(rows.find((row) => row.reservationNumber === '1002')).toMatchObject({
      guestName: 'Hóspede de Teste',
      channel: 'Booking.com',
      checkIn: '2026-11-03',
      totalAmount: '500.00',
      prePaymentFound: true,
      chargedAt: new Date('2026-11-02T14:30:00.000Z'),
      chargedBy: 'Operador de Teste',
      chargedAmount: '500.00',
      authorizationCode: 'A-0001',
      installmentAmount: '500.00',
      chargeActionVisible: false,
    });

    const observations = await database.db
      .select()
      .from(reservationObservations)
      .where(eq(reservationObservations.executionId, execution.id));
    expect(observations).toHaveLength(8);

    expect(await hotelRun(execution.id, 'A1')).toMatchObject({
      status: 'completed',
      pagesTotal: 4,
      pagesDone: 4,
      reservationsSeen: 8,
      reservationsOpened: 7,
      failureReason: null,
      counts: {
        virtual_card_pending_charge: 1,
        virtual_card_already_charged: 2,
        virtual_card_validated_only: 1,
        virtual_card_charge_error: 1,
        not_virtual_card: 1,
        analysis_error: 1,
        ignored_hotelbeds_258: 1,
      },
    });

    // Erro de análise e situação não identificada têm evidência ligada à reserva.
    const proofs = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.executionId, execution.id));
    expect(proofs).toEqual([
      expect.objectContaining({
        hotelCode: 'A1',
        reservationNumber: '1008',
        kind: 'classification_failure',
      }),
    ]);

    const events = await h.events.listRecent(execution.id, 100);
    const types = events.map((event) => event.type);
    expect(types).toContain('hotel_started');
    expect(types.filter((type) => type === 'page_done')).toHaveLength(4);
    expect(types.filter((type) => type === 'reservation_classified')).toHaveLength(8);
    expect(types).toContain('hotel_completed');
    // Nome do hóspede nunca vai para os eventos.
    expect(events.some((event) => event.message.includes('Hóspede de Teste'))).toBe(false);
  });

  it('situação não identificada: classifica a cobrança e registra evidência (FR-014a)', async () => {
    const h = await harness({
      scenario: {
        hotels: [
          { code: 'A2', reservations: [reservation('1101', { reservationStatus: 'unknown' })] },
        ],
      },
    });

    const execution = await run(h);

    expect(await reservationsOf('A2')).toEqual([
      expect.objectContaining({
        classification: 'virtual_card_pending_charge',
        reservationStatus: 'unknown',
      }),
    ]);
    const proofs = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.executionId, execution.id));
    expect(proofs).toEqual([
      expect.objectContaining({ reservationNumber: '1101', kind: 'reservation_status_unknown' }),
    ]);
  });

  it('hotel sem reservas no período é concluído com zero reservas', async () => {
    const h = await harness({ scenario: { hotels: [{ code: 'B1', reservations: [] }] } });

    const execution = await run(h);

    expect(execution.status).toBe('completed');
    expect(await hotelRun(execution.id, 'B1')).toMatchObject({
      status: 'completed',
      pagesTotal: 0,
      pagesDone: 0,
      reservationsSeen: 0,
    });
  });

  it('reserva repetida entre páginas é gravada uma única vez', async () => {
    const h = await harness({
      scenario: {
        hotels: [
          {
            code: 'C1',
            pages: [
              [reservation('2001'), reservation('2002')],
              [reservation('2002'), reservation('2003')],
            ],
          },
        ],
      },
    });

    const execution = await run(h);

    expect((await reservationsOf('C1')).map((row) => row.reservationNumber)).toEqual([
      '2001',
      '2002',
      '2003',
    ]);
    expect(h.hunit.callsTo('readReservation')).toHaveLength(3);
    expect(await hotelRun(execution.id, 'C1')).toMatchObject({ reservationsSeen: 3 });
  });

  it('falha ao abrir uma reserva → erro de análise com evidência, e o hotel segue', async () => {
    const h = await harness({
      scenario: {
        hotels: [
          {
            code: 'D1',
            reservations: [
              reservation('3001', {
                detail: new ScreenNotRecognizedError('detalhe sem o campo de pré-pagamento', {
                  evidence: { response: '{"inesperado":true}' },
                }),
              }),
              reservation('3002'),
            ],
          },
        ],
      },
    });

    const execution = await run(h);

    expect(
      (await reservationsOf('D1')).map((row) => [row.reservationNumber, row.classification]),
    ).toEqual([
      ['3001', 'analysis_error'],
      ['3002', 'virtual_card_pending_charge'],
    ]);
    const [proof] = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.executionId, execution.id));
    expect(proof).toMatchObject({
      hotelCode: 'D1',
      reservationNumber: '3001',
      kind: 'classification_failure',
    });
    expect(proof?.reason).toContain('detalhe sem o campo de pré-pagamento');
  });

  it('divide o período em blocos de MAX_PERIOD_DAYS e une as reservas', async () => {
    const h = await harness({
      maxPeriodDays: 3,
      scenario: {
        hotels: [
          {
            code: 'E1',
            reservations: [
              reservation('4001', { listing: { checkIn: '2026-11-01' } }),
              reservation('4002', { listing: { checkIn: '2026-11-05' } }),
              reservation('4003', { listing: { checkIn: '2026-11-07' } }),
            ],
          },
        ],
      },
    });

    const execution = await run(h);

    expect(h.hunit.callsTo('searchReservations').map((call) => call.period)).toEqual([
      { from: '2026-11-01', to: '2026-11-03' },
      { from: '2026-11-04', to: '2026-11-06' },
      { from: '2026-11-07', to: '2026-11-07' },
    ]);
    expect(await reservationsOf('E1')).toHaveLength(3);
    expect(await hotelRun(execution.id, 'E1')).toMatchObject({ pagesTotal: 3, pagesDone: 3 });
  });
});

describe('falhas de hotel (FR-019, edge cases)', () => {
  it('hotel com falha não grava nada e a execução segue para o próximo', async () => {
    const h = await harness({
      scenario: {
        hotels: [
          {
            code: 'F1',
            reservations: [reservation('5001')],
            searchError: new ScreenNotRecognizedError('a reserva 9 não é Canal Collect', {
              evidence: { response: '{"items":[]}' },
            }),
          },
          { code: 'F2', reservations: [reservation('5002')] },
        ],
      },
    });

    const execution = await run(h);

    expect(execution).toMatchObject({ status: 'completed', endReason: null });
    expect(await reservationsOf('F1')).toEqual([]);
    expect(await reservationsOf('F2')).toHaveLength(1);
    expect(await hotelRun(execution.id, 'F1')).toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('não é Canal Collect') as unknown,
    });
    const proofs = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.executionId, execution.id));
    expect(proofs).toEqual([
      expect.objectContaining({
        hotelCode: 'F1',
        reservationNumber: null,
        kind: 'screen_not_recognized',
      }),
    ]);
    const events = await h.events.listRecent(execution.id, 100);
    expect(events.find((event) => event.type === 'hotel_failed')?.hotelCode).toBe('F1');
    expect(events.at(-1)?.message).toContain('1 com falha');
  });

  it('falha no meio do hotel (depois de algumas reservas) também não grava nada', async () => {
    const h = await harness({
      scenario: {
        hotels: [
          {
            code: 'G1',
            reservations: [
              reservation('6001'),
              reservation('6002', { detail: new HunitUnavailableError('a API respondeu 503') }),
            ],
          },
        ],
      },
    });

    const execution = await run(h);

    expect(execution.status).toBe('completed');
    expect(await reservationsOf('G1')).toEqual([]);
    expect(
      await database.db
        .select()
        .from(reservationObservations)
        .where(eq(reservationObservations.executionId, execution.id)),
    ).toEqual([]);
    expect(await hotelRun(execution.id, 'G1')).toMatchObject({ status: 'failed' });
  });

  it('sessão expirada no meio de um hotel encerra a execução; os seguintes ficam pendentes', async () => {
    const h = await harness({
      scenario: {
        hotels: [
          { code: 'H1', reservations: [reservation('7001')] },
          { code: 'H2', reservations: [reservation('7002'), reservation('7003')] },
          { code: 'H3', reservations: [reservation('7004')] },
        ],
      },
    });
    h.hunit.before('readReservation', (call) => {
      if (call.bookingId === 'booking-7003') throw new SessionExpiredError();
    });

    const execution = await run(h);

    expect(execution).toMatchObject({ status: 'failed', endReason: 'session_expired' });
    expect(await reservationsOf('H1')).toHaveLength(1);
    expect(await reservationsOf('H2')).toEqual([]);
    expect(await reservationsOf('H3')).toEqual([]);
    const runs = await listExecutionHotels(database.db, execution.id);
    expect(runs.map((row) => [row.hotelCode, row.status])).toEqual([
      ['H1', 'completed'],
      ['H2', 'failed'],
      ['H3', 'pending'],
    ]);
  });

  it('hotel pedido que não está no catálogo é apontado como falha; os outros seguem', async () => {
    const h = await harness({
      scenario: { hotels: [{ code: 'I1', reservations: [reservation('8001')] }] },
    });

    const execution = await run(h, ['I1', 'I9']);

    expect(execution.status).toBe('completed');
    expect(await reservationsOf('I1')).toHaveLength(1);
    const events = await h.events.listRecent(execution.id, 100);
    expect(events.find((event) => event.type === 'hotel_failed')).toMatchObject({
      hotelCode: 'I9',
    });
  });

  it('servidor desligando no meio de um hotel: nada gravado e hotel marcado como falho', async () => {
    const h = await harness({
      scenario: {
        hotels: [{ code: 'J1', reservations: [reservation('9001'), reservation('9002')] }],
      },
    });
    let reached: () => void = () => undefined;
    const atSecondReservation = new Promise<void>((resolve) => {
      reached = resolve;
    });
    h.hunit.before('readReservation', async (call) => {
      if (call.bookingId !== 'booking-9002') return;
      reached();
      await new Promise(() => undefined); // nunca responde
    });

    const execution = await h.runner.start(startInput(clientId));
    await vi.waitFor(() => expect(h.runner.submitToken(execution.id, '123456')).toBe(true));
    await atSecondReservation;
    await h.runner.shutdown();

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'server_restarted',
    });
    expect(await reservationsOf('J1')).toEqual([]);
    expect(await hotelRun(execution.id, 'J1')).toMatchObject({ status: 'failed' });
  });
});

describe('verificações seguintes (FR-018, FR-018a)', () => {
  it('atualiza o histórico, registra mudanças de status e marca as não encontradas', async () => {
    const hotel: FakeHotel = {
      code: 'K1',
      reservations: [
        reservation('1'), // pendente → cobrada
        reservation('2'), // ativa → cancelada
        reservation('3'), // some do resultado (check-in no período)
        reservation('4', { listing: { checkIn: '2026-11-10' } }), // fora do período da 2ª
        reservation('5'), // continua igual
      ],
    };
    const h = await harness({ scenario: { hotels: [hotel] } });
    const first = await run(h, null, { from: '2026-11-01', to: '2026-11-15' });

    hotel.reservations = [
      reservation('1', { detail: reservationDetails.alreadyCharged() }),
      reservation('2', { reservationStatus: 'cancelled' }),
      reservation('5'),
      reservation('6'),
    ];
    const second = await run(h);

    const rows = new Map((await reservationsOf('K1')).map((row) => [row.reservationNumber, row]));
    expect(rows.get('1')).toMatchObject({
      classification: 'virtual_card_already_charged',
      verificationCount: 2,
      statusChanged: true,
      previousClassification: 'virtual_card_pending_charge',
      previousReservationStatus: 'active',
      lastExecutionId: second.id,
    });
    expect(rows.get('1')?.changedFields).toEqual(
      expect.arrayContaining(['classification', 'chargedAt']),
    );
    expect(rows.get('1')?.statusChangedAt).toEqual(rows.get('1')?.lastVerifiedAt);
    expect(rows.get('1')?.firstVerifiedAt.getTime()).toBeLessThan(
      rows.get('1')?.lastVerifiedAt.getTime() ?? 0,
    );

    expect(rows.get('2')).toMatchObject({
      reservationStatus: 'cancelled',
      statusChanged: true,
      previousReservationStatus: 'active',
      changedFields: ['reservationStatus'],
    });

    // Some do resultado com check-in no período: marcada, sem mudar o resto.
    expect(rows.get('3')).toMatchObject({
      verificationCount: 1,
      classification: 'virtual_card_pending_charge',
      lastExecutionId: first.id,
    });
    expect(rows.get('3')?.notFoundSince).toBeInstanceOf(Date);
    // Check-in fora do período consultado: não é marcada.
    expect(rows.get('4')?.notFoundSince).toBeNull();
    expect(rows.get('5')).toMatchObject({
      verificationCount: 2,
      statusChanged: false,
      changedFields: [],
      notFoundSince: null,
    });
    expect(rows.get('6')).toMatchObject({ verificationCount: 1 });

    // Reaparece: a marcação é removida.
    hotel.reservations = [reservation('3')];
    await run(h);
    const [third] = (await reservationsOf('K1')).filter((row) => row.reservationNumber === '3');
    expect(third).toMatchObject({ notFoundSince: null, verificationCount: 2 });
  });

  it('hotel que falha não marca reservas como não encontradas', async () => {
    const hotel: FakeHotel = { code: 'L1', reservations: [reservation('1')] };
    const h = await harness({ scenario: { hotels: [hotel] } });
    await run(h);

    hotel.reservations = [];
    hotel.searchError = new HunitUnavailableError('a API respondeu 503');
    await run(h);

    expect((await reservationsOf('L1'))[0]?.notFoundSince).toBeNull();
  });
});

describe('somente leitura (FR-012)', () => {
  it('o executor só chama operações de leitura do gateway', async () => {
    const h = await harness({
      scenario: {
        hotels: [{ code: 'M1', reservations: [reservation('1'), reservation('258-2')] }],
      },
    });

    await run(h);

    const methods = new Set(h.hunit.calls.map((call) => call.method));
    expect([...methods].sort()).toEqual(
      [
        'close',
        'listHotels',
        'login',
        'readReservation',
        'searchReservations',
        'submitToken',
      ].sort(),
    );
  });
});

describe('hotéis em paralelo (T063, research R-08)', () => {
  it.each([
    [1, 1],
    [2, 2],
    [5, 4], // nunca mais hotéis ao mesmo tempo do que hotéis na execução
  ])('HOTEL_CONCURRENCY=%i → no máximo %i hotéis ao mesmo tempo', async (concurrency, expected) => {
    const codes = ['a', 'b', 'c', 'd'].map((suffix) => `N${concurrency}${suffix}`);
    const h = await harness({
      hotelConcurrency: concurrency,
      scenario: {
        hotels: codes.map((code) => ({
          code,
          reservations: [reservation(`${code}-1`), reservation(`${code}-2`)],
        })),
      },
    });
    const inFlight = new Set<string>();
    let maxInFlight = 0;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    h.hunit.before('readReservation', async (call) => {
      inFlight.add(call.hotelCode);
      // Barreira: espera os outros hotéis permitidos chegarem (com prazo, para os últimos da
      // fila, que ficam sozinhos). Se o limite fosse desrespeitado, mais hotéis chegariam aqui.
      const deadline = Date.now() + 1_000;
      while (inFlight.size < expected && Date.now() < deadline) await sleep(5);
      maxInFlight = Math.max(maxInFlight, inFlight.size);
      await sleep(10);
      inFlight.delete(call.hotelCode);
    });

    const execution = await run(h);

    expect(execution.status).toBe('completed');
    expect(maxInFlight).toBe(expected);
    for (const code of codes) {
      expect(await reservationsOf(code)).toHaveLength(2);
      expect(await hotelRun(execution.id, code)).toMatchObject({ status: 'completed' });
    }
  });

  it('sessão expirada num hotel interrompe o outro em andamento; o não iniciado fica pendente', async () => {
    const h = await harness({
      hotelConcurrency: 2,
      scenario: {
        hotels: [
          { code: 'S1', reservations: [reservation('S1-a')] },
          { code: 'S2', reservations: [reservation('S2-a'), reservation('S2-b')] },
          { code: 'S3', reservations: [reservation('S3-a')] },
        ],
      },
    });
    let s2Started: () => void = () => undefined;
    const s2Reading = new Promise<void>((resolve) => {
      s2Started = resolve;
    });
    h.hunit.before('readReservation', async (call) => {
      if (call.bookingId === 'booking-S1-a') {
        await s2Reading; // garante que os dois hotéis estão em andamento
        throw new SessionExpiredError();
      }
      if (call.bookingId === 'booking-S2-a') {
        s2Started();
        // Só responde depois que o S1 foi encerrado pela sessão expirada.
        await vi.waitFor(
          async () => {
            const [row] = await database.db
              .select({ status: executionHotels.status })
              .from(executionHotels)
              .where(eq(executionHotels.hotelCode, 'S1'));
            expect(row?.status).toBe('failed');
          },
          { timeout: 5_000, interval: 10 },
        );
      }
    });

    const execution = await run(h);

    expect(execution).toMatchObject({ status: 'failed', endReason: 'session_expired' });
    // O S2 parou antes da próxima reserva e não gravou nada.
    expect(h.hunit.callsTo('readReservation').map((call) => call.bookingId)).not.toContain(
      'booking-S2-b',
    );
    for (const code of ['S1', 'S2', 'S3']) expect(await reservationsOf(code)).toEqual([]);
    const runs = await listExecutionHotels(database.db, execution.id);
    expect(runs.map((row) => [row.hotelCode, row.status])).toEqual([
      ['S1', 'failed'],
      ['S2', 'failed'],
      ['S3', 'pending'],
    ]);
  });
});
