/**
 * Testes de contrato da busca de reservas da feature 002 (T061, FR-020 a FR-020b): busca livre
 * (`q`), canal e valor, combináveis com os filtros antigos, e a lista de canais. Os exemplos são os
 * de specs/002-app-desktop/contracts/api-changes.md §3. Todos os nomes e códigos são fictícios.
 *
 * Desde a 008 (T037, US7, FR-029, SC-011): a busca acha também pelo código de autorização do
 * retorno do Comercial confirmado pelo Financeiro — na lista, nas contagens dos filtros rápidos e
 * em "selecionar todas do filtro" —, e não pelo de retornos não confirmados.
 */
import type { LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commercialReturns } from '../../src/persistence/schema.js';
import { insertReturn } from '../helpers/commercial-fixtures.js';
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

  // Retornos do Comercial (specs/008, US7), num hotel à parte para não mudar as buscas acima.
  await insertHotel(db, { code: 'H3', name: 'Hotel Três' });
  for (const [reservationNumber, authorizationCode, state] of [
    ['C-CONF', 'MAQ-5521', 'confirmed'],
    ['C-AGUARD', 'MAQ-AGUARD', 'awaiting_validation'],
    ['C-RECUS', 'MAQ-RECUS', 'rejected'],
    ['C-SUBST', 'MAQ-SUBST', 'superseded'],
    ['C-DESF', 'MAQ-DESF', 'confirmed'],
  ] as const) {
    const key = { hotelCode: 'H3', reservationNumber };
    await insertReservation(db, { ...base, ...key, guestName: 'Carlos Teixeira' });
    const row = await insertReturn(db, key, { authorizationCode, state });
    // Confirmação desfeita: o retorno volta a aguardar validação (como `undoReturnConfirmation`).
    if (reservationNumber === 'C-DESF') {
      await db
        .update(commercialReturns)
        .set({ state: 'awaiting_validation', decidedAt: null, decidedByClientId: null })
        .where(eq(commercialReturns.id, row.id));
    }
  }
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

describe('busca pelo código de autorização do Comercial (specs/008, US7, FR-029)', () => {
  async function inject(url: string, query: Record<string, string>) {
    const response = await test.app.inject({ method: 'GET', url, query, headers: reader.headers });
    expect(response.statusCode).toBe(200);
    return response;
  }

  it('acha pelo código do retorno confirmado, sem diferenciar maiúsculas (cenário 1)', async () => {
    expect(await found({ q: 'MAQ-5521' })).toEqual(['H3/C-CONF']);
    expect(await found({ q: 'maq-5521' })).toEqual(['H3/C-CONF']);
    expect(await found({ q: '  Maq-5521 ' })).toEqual(['H3/C-CONF']);
  });

  it('é o código inteiro, não um pedaço', async () => {
    expect(await found({ q: 'MAQ-552' })).toEqual([]);
  });

  it('lista, contagens e seleção dizem o mesmo (cenário 2)', async () => {
    const counts = await inject('/v1/reservations/quick-filter-counts', { q: 'maq-5521' });
    expectMatchesContract('countReservationQuickFilters', counts);
    expect(counts.json<{ all: number }>().all).toBe(1);

    const selection = await inject('/v1/reservations/selection', { q: 'maq-5521' });
    expectMatchesContract('selectReservations', selection);
    const body = selection.json<{
      total: number;
      items: Array<{ hotelCode: string; reservationNumber: string }>;
    }>();
    expect(body.total).toBe(1);
    expect(body.items.map((item) => `${item.hotelCode}/${item.reservationNumber}`)).toEqual([
      'H3/C-CONF',
    ]);

    // Combinada com filtros: o código acha só se a reserva também passa neles.
    expect(await found({ q: 'MAQ-5521', hotelCode: 'H3' })).toEqual(['H3/C-CONF']);
    expect(await found({ q: 'MAQ-5521', hotelCode: 'H1' })).toEqual([]);
  });

  it.each([
    ['aguardando validação', 'MAQ-AGUARD'],
    ['recusado', 'MAQ-RECUS'],
    ['substituído', 'MAQ-SUBST'],
    ['com a confirmação desfeita (cenário 4)', 'MAQ-DESF'],
  ])('não acha pelo código de retorno %s (cenário 3)', async (_caso, code) => {
    expect(await found({ q: code })).toEqual([]);
    const counts = await inject('/v1/reservations/quick-filter-counts', { q: code });
    expect(counts.json<{ all: number }>().all).toBe(0);
  });

  it('as buscas de antes continuam iguais (cenário 5)', async () => {
    expect(await found({ q: 'aut-0042' })).toEqual(['H1/258-1234']);
    expect(await found({ q: '7001' })).toEqual(['H2/7001']);
    expect(await found({ q: 'teixeira' })).toEqual([
      'H3/C-AGUARD',
      'H3/C-CONF',
      'H3/C-DESF',
      'H3/C-RECUS',
      'H3/C-SUBST',
    ]);
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
