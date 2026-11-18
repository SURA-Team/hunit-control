/**
 * Acompanhar envios, retornos e a planilha (specs/005, US3; FR-013, FR-014, FR-021, FR-029,
 * FR-030; SC-012, SC-014, SC-015) — tasks.md, T046 a T048. Dados fictícios.
 */
import type { components } from '@hunit/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commercialLines, reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertDispatch,
  insertLine,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';

type SheetStatus = components['schemas']['CommercialSheetStatus'];
type Selection = components['schemas']['ReservationSelection'];
type BatchResult = components['schemas']['ConfirmationBatchResult'];

const HOTEL = 'Hotel Homologação Um';
let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const number = (n: number) => String(900_000 + n);
const key = (n: number) => ({ hotelCode: 'hml_um', reservationNumber: number(n) });

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  await seedTestHotels(test.database.db);
});

afterAll(async () => {
  await test.close();
});

const status = async (client = reader) => {
  const response = await test.app.inject({
    method: 'GET',
    url: '/v1/commercial-sheet',
    headers: client.headers,
  });
  expect(response.statusCode).toBe(200);
  expectMatchesContract('getCommercialSheetStatus', response);
  return response.json<SheetStatus>();
};

const readNow = (client = operator) =>
  test.app.inject({ method: 'POST', url: '/v1/commercial-sheet/read', headers: client.headers });

describe('estado da planilha e "Ler retornos agora" (T046)', () => {
  it('sem planilha configurada: not_configured; ler agora, 409', async () => {
    const without = await createTestApp();
    try {
      const client = await without.createClient('operator');
      const response = await without.app.inject({
        method: 'GET',
        url: '/v1/commercial-sheet',
        headers: client.headers,
      });
      expect(response.json()).toMatchObject({ configured: false, status: 'not_configured' });
      const read = await without.app.inject({
        method: 'POST',
        url: '/v1/commercial-sheet/read',
        headers: client.headers,
      });
      expect(read.statusCode).toBe(409);
      expect(read.json()).toMatchObject({ code: 'commercial_sheet_not_configured' });
    } finally {
      await without.close();
    }
  });

  it('ler agora: rodada completa, pendências zeradas e problemas do retorno listados', async () => {
    await insertCommercialReservation(test.database.db, 1);
    await insertLine(test.database.db, key(1));
    expect((await status()).pending.count).toBe(1);

    const first = await readNow();
    expect(first.statusCode).toBe(200);
    expectMatchesContract('readCommercialSheet', first);
    expect(first.json()).toMatchObject({
      sheet: { status: 'ok', pending: { count: 0 } },
      round: { linesWritten: 1 },
    });

    test.sheet?.fillReturn(HOTEL, number(1), ['AUT1', '', '', '']);
    await readNow();
    const current = await status();
    expect(current.problems).toEqual([
      expect.objectContaining({
        hotelCode: 'hml_um',
        reservationNumber: number(1),
        kind: 'incomplete',
        message:
          'Retorno incompleto: faltam o hotel da cobrança, o valor cobrado e o responsável pela cobrança',
      }),
    ]);
  });

  it('planilha fora do ar: 503 genérico, nada perdido; quando volta, as pendências são aplicadas', async () => {
    await insertCommercialReservation(test.database.db, 2);
    await insertLine(test.database.db, key(2));
    test.sheet?.setFailing('sheet_unavailable');

    const failed = await readNow();
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({ code: 'commercial_sheet_unavailable' });
    const failing = await status();
    expect(failing).toMatchObject({
      status: 'failing',
      lastError: { code: 'sheet_unavailable' },
      pending: { count: 1 },
    });
    expect(failing.lastError?.message).toContain('indisponível');
    expect(failing.nextAttemptAt).not.toBeNull();

    test.sheet?.setFailing(null);
    expect((await readNow()).statusCode).toBe(200);
    expect(await status()).toMatchObject({ status: 'ok', lastError: null, pending: { count: 0 } });
  });

  it('o perfil consulta vê o estado, mas não pede leitura', async () => {
    await status(reader);
    expect((await readNow(reader)).statusCode).toBe(403);
  });
});

describe('lista de envios (FR-020)', () => {
  it('dos mais recentes para os mais antigos, com as contagens', async () => {
    const dispatch = await insertDispatch(test.database.db);
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/commercial-dispatches?limit=10',
      headers: reader.headers,
    });
    expect(response.statusCode).toBe(200);
    expectMatchesContract('listCommercialDispatches', response);
    const items = response.json<{ items: Array<{ id: string; counts: { total: number } }> }>()
      .items;
    expect(items.map((item) => item.id)).toContain(dispatch.id);
  });
});

describe('"Verificar" em lote e "selecionar todas do filtro" (T047, T048)', () => {
  const COUNT = 2_500;
  const FIRST = 10_000;

  beforeAll(async () => {
    // 2 500 reservas enviadas que o Hunit passou a mostrar como cobradas: alerta "Verificar".
    const { db } = test.database;
    const dispatch = await insertDispatch(db);
    const now = new Date();
    const changedAt = new Date(now.getTime() - 60_000);
    const rows = Array.from({ length: COUNT }, (_unused, index) => ({
      hotelCode: 'hml_um',
      reservationNumber: number(FIRST + index),
      guestName: `Hóspede Fictício ${index}`,
      channel: 'Booking.com',
      checkIn: '2026-11-03',
      checkOut: '2026-11-05',
      stayPeriod: '03/11/2026 - 05/11/2026',
      totalAmount: '100.00',
      reservationStatus: 'active' as const,
      classification: 'virtual_card_already_charged' as const,
      reason: 'cobrada',
      prePaymentFound: true,
      chargeActionVisible: false,
      firstVerifiedAt: now,
      lastVerifiedAt: now,
      statusChangedAt: changedAt,
    }));
    for (let start = 0; start < rows.length; start += 500) {
      const batch = rows.slice(start, start + 500);
      await db.insert(reservations).values(batch);
      await db.insert(commercialLines).values(
        batch.map((row) => ({
          hotelCode: row.hotelCode,
          reservationNumber: row.reservationNumber,
          state: 'concluded' as const,
          firstSentAt: changedAt,
          lastSentAt: changedAt,
          concludedAt: changedAt,
          lastDispatchId: dispatch.id,
          lastSentByClientId: dispatch.clientId,
          changedAt,
        })),
      );
    }
  });

  const select = async (query: string) => {
    const started = Date.now();
    const response = await test.app.inject({
      method: 'GET',
      url: `/v1/reservations/selection?${query}`,
      headers: reader.headers,
    });
    const elapsed = Date.now() - started;
    expect(response.statusCode).toBe(200);
    expectMatchesContract('selectReservations', response);
    return { body: response.json<Selection>(), elapsed };
  };

  it('selecionar todas do filtro: as 2 000 primeiras, na ordem da lista, em até 5 s (SC-015)', async () => {
    const { body, elapsed } = await select('needsReview=true&hotelCode=hml_um');
    expect(body.total).toBe(COUNT);
    expect(body.truncated).toBe(true);
    expect(body.items).toHaveLength(2_000);
    expect(body.items[0]).toMatchObject({
      reservationNumber: number(FIRST),
      hotelName: HOTEL,
      situation: 'virtual_card_already_charged',
      needsReview: true,
    });
    expect(elapsed).toBeLessThan(5_000);
  });

  it('confirmar o "Verificar" de 2 000 em lote em até 2 min (SC-014); a próxima seleção traz as seguintes', async () => {
    const { body } = await select('needsReview=true&hotelCode=hml_um');
    const keys = body.items.map((item) => ({
      hotelCode: item.hotelCode,
      reservationNumber: item.reservationNumber,
    }));
    const started = Date.now();
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/treatment-reviews',
      headers: operator.headers,
      payload: { reservations: keys },
    });
    expect(Date.now() - started).toBeLessThan(120_000);
    expect(response.statusCode).toBe(200);
    expectMatchesContract('confirmTreatmentReviews', response);
    const result = response.json<BatchResult>();
    expect(result.items.filter((item) => item.outcome === 'confirmed')).toHaveLength(2_000);
    expect(result.countsByClassification).toEqual({ virtual_card_already_charged: 2_000 });

    const next = (await select('needsReview=true&hotelCode=hml_um')).body;
    expect(next).toMatchObject({ total: COUNT - 2_000, truncated: false });
    expect(next.items[0]?.reservationNumber).toBe(number(FIRST + 2_000));

    // Reserva sem o alerta fica de fora, com o motivo.
    const without = await test.app.inject({
      method: 'POST',
      url: '/v1/treatment-reviews',
      headers: operator.headers,
      payload: { reservations: [key(1), keys[0]] },
    });
    expect(without.json<BatchResult>().items.map((item) => [item.outcome, item.reason])).toEqual([
      ['ignored', 'no_review_alert'],
      ['ignored', 'no_review_alert'],
    ]);
  }, 180_000);

  it('o perfil consulta não confirma o "Verificar" em lote', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/treatment-reviews',
      headers: reader.headers,
      payload: { reservations: [key(FIRST + 2_100)] },
    });
    expect(response.statusCode).toBe(403);
  });
});
