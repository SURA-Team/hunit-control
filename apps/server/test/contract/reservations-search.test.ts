/**
 * Testes de contrato da busca de reservas da feature 002 (T061, FR-020 a FR-020b): busca livre
 * (`q`), canal e valor, combináveis com os filtros antigos, e a lista de canais. Os exemplos são os
 * de specs/002-app-desktop/contracts/api-changes.md §3. Todos os nomes e códigos são fictícios.
 */
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

interface ReservationBody {
  hotelCode: string;
  reservationNumber: string;
  guestName: string | null;
}

interface ListBody {
  items: ReservationBody[];
  nextCursor: string | null;
}

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;

  await insertHotel(db, { code: 'H1', name: 'Hotel Um' });
  await insertHotel(db, { code: 'H2', name: 'Hotel Dois' });
  const { id: lastExecutionId } = await insertExecution(db);
  const base = { lastExecutionId };

  await insertReservation(db, {
    ...base,
    hotelCode: 'H1',
    reservationNumber: '258-1234',
    guestName: 'João Silva',
    channel: 'Booking.com',
    authorizationCode: 'AUT-0042',
    transactionId: 'TX-9001',
    processorReference: 'REF-777',
    totalAmount: '1234.50',
  });
  await insertReservation(db, {
    ...base,
    hotelCode: 'H2',
    reservationNumber: '258-1234',
    guestName: 'Maria Souza',
    channel: 'Expedia',
    totalAmount: '500.00',
    chargedAmount: '1234.50',
  });
  await insertReservation(db, {
    ...base,
    hotelCode: 'H2',
    reservationNumber: '7001',
    guestName: 'JOÃO PEREIRA',
    channel: 'Expedia',
    totalAmount: '300.00',
  });
  await insertReservation(db, {
    ...base,
    hotelCode: 'H1',
    reservationNumber: '7002',
    guestName: null,
    anonymizedAt: new Date(),
    channel: 'Booking.com',
    totalAmount: '80.00',
  });
  await insertReservation(db, {
    ...base,
    hotelCode: 'H1',
    reservationNumber: '7003',
    guestName: 'Ana Lima',
    channel: 'Booking.com',
    classification: 'invoiced',
    reservationStatus: 'cancelled',
    totalAmount: '99.90',
  });
});

afterAll(async () => {
  await test.close();
});

function keys(body: ListBody): string[] {
  return body.items.map((item) => `${item.hotelCode}/${item.reservationNumber}`);
}

async function search(query: Record<string, string>, client: TestClient = operator) {
  const response = await test.app.inject({
    method: 'GET',
    url: '/v1/reservations',
    query,
    headers: client.headers,
  });
  expectMatchesContract('listReservations', response);
  return response;
}

async function found(query: Record<string, string>): Promise<string[]> {
  const response = await search(query);
  expect(response.statusCode).toBe(200);
  return keys(response.json<ListBody>());
}

function problemCode(response: LightMyRequestResponse): unknown {
  return response.json<{ code?: unknown }>().code;
}

describe('GET /v1/reservations — busca livre q (FR-020a)', () => {
  it('acha pelo código de autorização em qualquer hotel, sem diferenciar maiúsculas', async () => {
    expect(await found({ q: 'aut-0042' })).toEqual(['H1/258-1234']);
  });

  it('acha pela transação e pela referência da operadora', async () => {
    expect(await found({ q: 'tx-9001' })).toEqual(['H1/258-1234']);
    expect(await found({ q: 'REF-777' })).toEqual(['H1/258-1234']);
  });

  it('acha pelo número da reserva sem informar o hotel', async () => {
    expect(await found({ q: '258-1234' })).toEqual(['H1/258-1234', 'H2/258-1234']);
  });

  it('número com hotel devolve só a reserva daquele hotel', async () => {
    expect(await found({ q: '258-1234', hotelCode: 'H1' })).toEqual(['H1/258-1234']);
  });

  it('acha por parte do nome do hóspede, sem diferenciar maiúsculas e acentos', async () => {
    expect(await found({ q: 'joao' })).toEqual(['H1/258-1234', 'H2/7001']);
    expect(await found({ q: 'SOUZ' })).toEqual(['H2/258-1234']);
  });

  it('não acha reserva anonimizada pelo nome', async () => {
    const result = await found({ q: 'joao' });

    expect(result).not.toContain('H1/7002');
  });

  it('ignora espaços nas pontas', async () => {
    expect(await found({ q: '  aut-0042  ' })).toEqual(['H1/258-1234']);
  });

  it('trata % e _ como texto, não como curinga', async () => {
    expect(await found({ q: '%_' })).toEqual([]);
  });

  it('combina com os filtros antigos', async () => {
    expect(
      await found({ q: 'ana', classification: 'invoiced', reservationStatus: 'cancelled' }),
    ).toEqual(['H1/7003']);
    expect(await found({ q: 'ana', classification: 'virtual_card_pending_charge' })).toEqual([]);
  });

  it('pagina por cursor mantendo a busca', async () => {
    const first = (await search({ q: '258-1234', limit: '1' })).json<ListBody>();
    expect(keys(first)).toEqual(['H1/258-1234']);
    expect(first.nextCursor).not.toBeNull();

    const second = await found({ q: '258-1234', limit: '1', cursor: first.nextCursor ?? '' });
    expect(second).toEqual(['H2/258-1234']);
  });

  it.each([
    ['um caractere', 'a'],
    ['só espaços e um caractere', '  a '],
  ])('recusa busca com %s', async (_caso, q) => {
    const response = await search({ q });

    expect(response.statusCode).toBe(400);
    expect(problemCode(response)).toBe('validation_error');
  });
});

describe('GET /v1/reservations — valor e canal (FR-020, FR-020b)', () => {
  it('amount acha pelo valor total ou pelo valor cobrado', async () => {
    expect(await found({ amount: '1234.50' })).toEqual(['H1/258-1234', 'H2/258-1234']);
  });

  it('amount combina com a busca livre', async () => {
    expect(await found({ amount: '1234.50', q: 'maria' })).toEqual(['H2/258-1234']);
  });

  it('recusa valor fora do formato da API', async () => {
    const response = await search({ amount: '1.234,50' });

    expect(response.statusCode).toBe(400);
    expect(problemCode(response)).toBe('validation_error');
  });

  it('channel é igualdade exata', async () => {
    expect(await found({ channel: 'Expedia' })).toEqual(['H2/258-1234', 'H2/7001']);
    expect(await found({ channel: 'expedia' })).toEqual([]);
    expect(await found({ channel: 'Expedia', q: 'joao' })).toEqual(['H2/7001']);
  });
});

describe('GET /v1/channels (feature 002)', () => {
  it.each([
    ['operador', () => operator],
    ['consulta', () => reader],
  ])('devolve os canais distintos em ordem alfabética para %s', async (_perfil, clientOf) => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/channels',
      headers: clientOf().headers,
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('listChannels', response);
    expect(response.json()).toEqual({ items: ['Booking.com', 'Expedia'] });
  });
});
