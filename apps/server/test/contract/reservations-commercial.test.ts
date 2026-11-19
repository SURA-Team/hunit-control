/**
 * Situação detalhada ("Validar comprovante"), valor cobrado com a origem e o resumo do Comercial
 * nas consultas de reservas (specs/005, FR-015, FR-023, FR-024; research R-09, R-10) — tasks.md,
 * T024. Todos os dados são fictícios.
 */
import type { components } from '@hunit/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { contractDocument, expectMatchesContract } from '../helpers/contract.js';

type ReservationView = components['schemas']['Reservation'];
type ReservationPage = { items: ReservationView[] };

let test: TestApp;
let reader: TestClient;

const key = (number: number) => ({
  hotelCode: 'hml_um',
  reservationNumber: String(900_000 + number),
});

beforeAll(async () => {
  test = await createTestApp();
  reader = await test.createClient('reader');
  const { db } = test.database;
  await seedTestHotels(db);

  // 1: enviada e com retorno aguardando validação → "Validar comprovante".
  await insertCommercialReservation(db, 1);
  await insertLine(db, key(1));
  await insertReturn(db, key(1));
  // 2: enviada, sem retorno → "Tratativa enviada".
  await insertCommercialReservation(db, 2);
  await insertLine(db, key(2));
  // 3: retorno confirmado → "Comprovante enviado", valor do Comercial.
  await insertCommercialReservation(db, 3);
  await insertLine(db, key(3), { state: 'concluded' });
  await insertReturn(db, key(3), { state: 'confirmed', chargedAmount: '80.00' });
  // 4: o Hunit passou a mostrar "já cobrada" depois do envio → alerta "Verificar".
  await insertCommercialReservation(db, 4, {
    classification: 'virtual_card_already_charged',
    statusChangedAt: new Date('2026-11-17T10:00:00Z'),
  });
  await insertLine(db, key(4), { state: 'concluded' });
  // 5: envio desfeito → não conta como tratativa.
  await insertCommercialReservation(db, 5);
  await insertLine(db, key(5), { state: 'cancelled' });
  // 6: nunca enviada.
  await insertCommercialReservation(db, 6);
});

afterAll(async () => {
  await test.close();
});

async function get(number: number): Promise<ReservationView> {
  const { hotelCode, reservationNumber } = key(number);
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/reservations/${hotelCode}/${reservationNumber}`,
    headers: reader.headers,
  });
  expect(response.statusCode).toBe(200);
  expectMatchesContract('getReservation', response);
  return response.json<ReservationView>();
}

async function numbers(query: string): Promise<string[]> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/reservations?hotelCode=hml_um&limit=500&${query}`,
    headers: reader.headers,
  });
  expect(response.statusCode).toBe(200);
  expectMatchesContract('listReservations', response);
  return response.json<ReservationPage>().items.map((item) => item.reservationNumber);
}

const n = (...values: number[]) => values.map((value) => String(900_000 + value));

describe('situação detalhada (R-09)', () => {
  it('retorno aguardando: situation continua "treatment_sent"; detailedSituation = "return_pending"', async () => {
    const reservation = await get(1);
    expect(reservation.treatment).toMatchObject({
      status: 'sent',
      situation: 'treatment_sent',
      detailedSituation: 'return_pending',
    });
    expect(reservation.commercial).toMatchObject({
      lineState: 'open',
      inSheet: true,
      returnState: 'awaiting_validation',
      syncPending: true,
    });
  });

  it('sem retorno, as duas são "treatment_sent"; envio desfeito não conta como tratativa', async () => {
    expect((await get(2)).treatment).toMatchObject({
      situation: 'treatment_sent',
      detailedSituation: 'treatment_sent',
    });
    const cancelled = await get(5);
    expect(cancelled.treatment).toMatchObject({
      status: 'none',
      situation: 'virtual_card_pending_charge',
    });
    expect(cancelled.commercial?.lineState).toBe('cancelled');
    expect((await get(6)).commercial).toBeNull();
  });

  it('retorno confirmado vale como comprovante, com o valor e a origem "commercial"', async () => {
    expect((await get(3)).treatment).toMatchObject({
      status: 'charged',
      situation: 'proof_sent',
      detailedSituation: 'proof_sent',
      commercialChargedAmount: '80.00',
      effectiveChargedAmount: '80.00',
      chargedAmountOrigin: 'commercial',
    });
  });

  it('linha concluída porque o Hunit mostrou "já cobrada" → alerta "Verificar"', async () => {
    expect((await get(4)).treatment).toMatchObject({
      status: 'sent',
      situation: 'virtual_card_already_charged',
      needsReview: true,
    });
  });
});

describe('filtros (FR-015, FR-023, FR-024)', () => {
  it('detailedSituation separa "Validar comprovante" de "Tratativa enviada"', async () => {
    expect(await numbers('detailedSituation=return_pending')).toEqual(n(1));
    expect(await numbers('detailedSituation=treatment_sent')).toEqual(n(2));
    expect(
      await numbers('detailedSituation=return_pending&detailedSituation=treatment_sent'),
    ).toEqual(n(1, 2));
  });

  it('situation=treatment_sent continua trazendo as duas (clientes até a 1.6.0)', async () => {
    expect(await numbers('situation=treatment_sent')).toEqual(n(1, 2));
  });

  it('"Falta cobrar" inclui "Validar comprovante" e não o comprovante por retorno', async () => {
    expect(await numbers('pendingCharge=true')).toEqual(n(1, 2, 5, 6));
  });

  it('o filtro de valor encontra o valor do Comercial confirmado', async () => {
    expect(await numbers('amount=80.00')).toEqual(n(3));
  });

  it('"A verificar" encontra a linha concluída pelo Hunit', async () => {
    expect(await numbers('needsReview=true')).toEqual(n(4));
  });
});

describe('compatibilidade com o app atual (R-09)', () => {
  it('nenhuma resposta traz em `situation` um valor que a 1.6.0 não tinha', async () => {
    const schemas = contractDocument.components?.['schemas'] as Record<string, { enum?: string[] }>;
    const known = new Set(schemas['ReservationSituation']?.enum);
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/reservations?hotelCode=hml_um&limit=500',
      headers: reader.headers,
    });
    for (const item of response.json<ReservationPage>().items) {
      expect(known.has(item.treatment.situation)).toBe(true);
    }
    expect(known.has('return_pending')).toBe(false);
  });
});
