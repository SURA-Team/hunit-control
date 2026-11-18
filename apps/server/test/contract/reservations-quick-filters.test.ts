/**
 * Testes de contrato da 1.8.0 (specs/006, T028; contracts/api-changes.md): `quickFilter` e `order` na
 * lista e na seleção, e a rota `/reservations/quick-filter-counts`, para os dois perfis. A paridade
 * entre as contagens, a lista e o domínio fica em `test/integration/reservations-quick-filters.test.ts`.
 * Todos os dados são fictícios.
 */
import type { components } from '@hunit/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';

type Counts = components['schemas']['ReservationQuickFilterCounts'];

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const key = (number: number) => ({
  hotelCode: 'hml_um',
  reservationNumber: String(900_000 + number),
});

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;
  await seedTestHotels(db);

  // 1: falta cobrar. 2: "Validar comprovante" (falta cobrar e a verificar). 3: erro na cobrança.
  // 4: faturada. 5: "A revisar (sistema anterior)", noutro hotel e com check-in anterior.
  await insertCommercialReservation(db, 1, { checkIn: '2026-11-10' });
  await insertCommercialReservation(db, 2, { checkIn: '2026-11-05' });
  await insertLine(db, key(2));
  await insertReturn(db, key(2));
  await insertCommercialReservation(db, 3, {
    classification: 'virtual_card_charge_error',
    checkIn: '2026-11-08',
  });
  await insertCommercialReservation(db, 4, { classification: 'invoiced', checkIn: '2026-11-01' });
  await insertCommercialReservation(db, 5, {
    hotelCode: 'hml_dois',
    classification: 'not_virtual_card',
    checkIn: '2026-10-30',
  });
});

afterAll(async () => {
  await test.close();
});

function get(path: string, client: TestClient | null = reader): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'GET',
    url: `/v1${path}`,
    headers: client ? client.headers : {},
  });
}

function problemCode(response: LightMyRequestResponse): unknown {
  return response.json<{ code?: unknown }>().code;
}

describe('GET /v1/reservations/quick-filter-counts (FR-017)', () => {
  it.each([
    ['consulta', () => reader],
    ['operador', () => operator],
  ])('sem filtros, para o perfil %s', async (_, client) => {
    const response = await get('/reservations/quick-filter-counts', client());
    expect(response.statusCode).toBe(200);
    expectMatchesContract('countReservationQuickFilters', response);
    expect(response.json<Counts>()).toEqual({
      all: 5,
      pendingCharge: 3,
      toReview: 2,
      withError: 1,
      done: 1,
    });
  });

  it('com filtros: as contagens acompanham a busca e os demais filtros', async () => {
    const response = await get(
      '/reservations/quick-filter-counts?hotelCode=hml_um&checkInFrom=2026-11-05&classification=virtual_card_pending_charge',
    );
    expect(response.statusCode).toBe(200);
    expectMatchesContract('countReservationQuickFilters', response);
    expect(response.json<Counts>()).toEqual({
      all: 2,
      pendingCharge: 2,
      toReview: 1,
      withError: 0,
      done: 0,
    });
  });

  it('filtro fora do contrato: 400 validation_error', async () => {
    const response = await get('/reservations/quick-filter-counts?reservationStatus=talvez');
    expect(response.statusCode).toBe(400);
    expectMatchesContract('countReservationQuickFilters', response);
    expect(problemCode(response)).toBe('validation_error');
  });

  it('período invertido: 400 validation_error, como na lista', async () => {
    const response = await get(
      '/reservations/quick-filter-counts?checkInFrom=2026-11-10&checkInTo=2026-11-01',
    );
    expect(response.statusCode).toBe(400);
    expect(problemCode(response)).toBe('validation_error');
  });

  it('sem chave: 401', async () => {
    const response = await get('/reservations/quick-filter-counts', null);
    expect(response.statusCode).toBe(401);
    expectMatchesContract('countReservationQuickFilters', response);
  });
});

describe.each([
  ['GET /v1/reservations', '/reservations', 'listReservations'],
  ['GET /v1/reservations/selection', '/reservations/selection', 'selectReservations'],
])('%s — quickFilter e order (FR-016, R-18)', (_, path, operationId) => {
  const numbersOf = (response: LightMyRequestResponse) =>
    response
      .json<{ items: Array<{ reservationNumber: string }> }>()
      .items.map((item) => item.reservationNumber);

  it('quickFilter: só as reservas do grupo', async () => {
    const response = await get(`${path}?quickFilter=to_review&order=hotel_number`);
    expect(response.statusCode).toBe(200);
    expectMatchesContract(operationId, response);
    expect(numbersOf(response)).toEqual(['900005', '900002']);
  });

  it('order=hotel_check_in: hotel, check-in e número', async () => {
    const response = await get(`${path}?order=hotel_check_in`, operator);
    expect(response.statusCode).toBe(200);
    expectMatchesContract(operationId, response);
    expect(numbersOf(response)).toEqual(['900005', '900004', '900002', '900003', '900001']);
  });

  it('sem order: a ordem da 1.7.0 (hotel e número)', async () => {
    const response = await get(path);
    expect(numbersOf(response)).toEqual(['900005', '900001', '900002', '900003', '900004']);
  });

  it.each(['quickFilter=todas', 'order=checkin'])('%s fora do enum: 400', async (query) => {
    const response = await get(`${path}?${query}`);
    expect(response.statusCode).toBe(400);
    expectMatchesContract(operationId, response);
    expect(problemCode(response)).toBe('validation_error');
  });
});
