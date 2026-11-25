/**
 * Ordem `amount_desc` da lista e da seleção (specs/007, T014; contracts/api-changes.md, research
 * R-07): valor do maior para o menor, sem valor no fim, empate por hotel e número; o cursor percorre
 * todas as páginas sem repetir nem pular e não vale com outra ordem. Todos os dados são fictícios.
 */
import type { components } from '@hunit/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { insertCommercialReservation, seedTestHotels } from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';

type Reservation = components['schemas']['Reservation'];
type Selection = components['schemas']['ReservationSelection'];

let test: TestApp;
let reader: TestClient;

/** Valor de cada reserva; repetidos e nulos de propósito. */
const AMOUNTS: (string | null)[] = [
  '300.00',
  '1200.50',
  null,
  '300.00',
  '99.90',
  '1200.50',
  null,
  '5000.00',
  '0.00',
  '300.00',
];

beforeAll(async () => {
  test = await createTestApp();
  reader = await test.createClient('reader');
  const { db } = test.database;
  await seedTestHotels(db);
  for (const [index, totalAmount] of AMOUNTS.entries()) {
    await insertCommercialReservation(db, index + 1, {
      hotelCode: index % 2 === 0 ? 'hml_dois' : 'hml_um',
      totalAmount,
    });
  }
});

afterAll(async () => {
  await test?.close();
});

function get(path: string): Promise<LightMyRequestResponse> {
  return test.app.inject({ method: 'GET', url: `/v1${path}`, headers: reader.headers });
}

async function pages(query: string, limit: number): Promise<Reservation[]> {
  const items: Reservation[] = [];
  let cursor: string | null = null;
  do {
    const after: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await get(`/reservations?${query}&limit=${limit}${after}`);
    expect(response.statusCode, response.body).toBe(200);
    expectMatchesContract('listReservations', response);
    const page = response.json<{ items: Reservation[]; nextCursor: string | null }>();
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const keyOf = (item: { hotelCode: string; reservationNumber: string }) =>
  `${item.hotelCode}/${item.reservationNumber}`;

/** A ordem esperada, calculada à parte. */
function expectedOrder(items: Reservation[]): string[] {
  const value = (item: Reservation) => (item.totalAmount === null ? -1 : Number(item.totalAmount));
  return [...items]
    .sort(
      (a, b) =>
        value(b) - value(a) ||
        a.hotelCode.localeCompare(b.hotelCode) ||
        a.reservationNumber.localeCompare(b.reservationNumber),
    )
    .map(keyOf);
}

describe('order=amount_desc (specs/007)', () => {
  it.each([1, 3, 100])(
    'percorre as páginas de %i sem repetir nem pular, na ordem certa',
    async (limit) => {
      const ordered = await pages('order=amount_desc', limit);
      expect(ordered).toHaveLength(AMOUNTS.length);
      expect(ordered.map(keyOf)).toEqual(expectedOrder(ordered));
      expect(ordered.at(-1)?.totalAmount).toBeNull();
      expect(ordered[0]?.totalAmount).toBe('5000.00');
    },
  );

  it('a seleção segue a mesma ordem', async () => {
    const response = await get('/reservations/selection?order=amount_desc');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<Selection>();
    const listed = await pages('order=amount_desc', 100);
    expect(body.items.map(keyOf)).toEqual(listed.map(keyOf));
  });

  it('cursor de outra ordem: 400', async () => {
    const first = (await get('/reservations?order=amount_desc&limit=2')).json<{
      nextCursor: string;
    }>();
    const response = await get(`/reservations?order=hotel_check_in&cursor=${first.nextCursor}`);
    expect(response.statusCode).toBe(400);
    const back = (await get('/reservations?order=hotel_check_in&limit=2')).json<{
      nextCursor: string;
    }>();
    const reverse = await get(`/reservations?order=amount_desc&cursor=${back.nextCursor}`);
    expect(reverse.statusCode).toBe(400);
  });
});
