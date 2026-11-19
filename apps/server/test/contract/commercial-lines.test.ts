/**
 * Linha da reserva na planilha do Comercial pela API (specs/005; research R-11; clarify Q2):
 * detalhe do Comercial, desfazer e reverter o envio (T034) e a linha que muda de aba quando uma
 * execução mostra a reserva cobrada — "A verificar" (FR-009, T035). Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findLine } from '../../src/persistence/commercial-repo.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { reservationDetails } from '../helpers/fake-hunit-gateway.js';
import { TEST_PASSWORD } from '../helpers/runner.js';

const DAY = 24 * 60 * 60 * 1000;
let clock = new Date('2026-11-17T12:00:00Z');
let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const number = (n: number) => String(900_000 + n);
const key = (n: number) => ({ hotelCode: 'hml_um', reservationNumber: number(n) });
const path = (n: number, action = '') => `/v1/reservations/hml_um/${number(n)}/commercial${action}`;

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true, now: () => clock });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  await seedTestHotels(test.database.db);
});

afterAll(async () => {
  await test.close();
});

function call(
  method: 'GET' | 'POST',
  url: string,
  client: TestClient = operator,
): Promise<LightMyRequestResponse> {
  return test.app.inject({ method, url, headers: client.headers });
}

describe('GET .../commercial', () => {
  it('reserva nunca enviada: sem linha, sem retornos e sem histórico', async () => {
    await insertCommercialReservation(test.database.db, 1);
    const response = await call('GET', path(1), reader);
    expect(response.statusCode).toBe(200);
    expectMatchesContract('getReservationCommercial', response);
    expect(response.json()).toEqual({ line: null, returns: [], events: [] });
  });

  it('linha, retorno com a diferença para o valor a cobrar e reserva inexistente (404)', async () => {
    await insertCommercialReservation(test.database.db, 2, { totalAmount: '100.00' });
    await insertLine(test.database.db, key(2), { at: clock });
    await insertReturn(test.database.db, key(2), { chargedAmount: '90.50' });
    const response = await call('GET', path(2), reader);
    expectMatchesContract('getReservationCommercial', response);
    expect(response.json()).toMatchObject({
      line: { state: 'open', tab: 'to_charge', inSheet: true, restorableUntil: null },
      returns: [
        {
          state: 'awaiting_validation',
          chargedAmount: '90.50',
          expectedAmount: '100.00',
          difference: '-9.50',
          chargeHotel: 'Estabelecimento Fictício',
        },
      ],
    });
    expect((await call('GET', '/v1/reservations/hml_um/000000/commercial')).statusCode).toBe(404);
  });
});

describe('desfazer e reverter o envio (R-11)', () => {
  it('recusa com retorno aguardando validação', async () => {
    const response = await call('POST', path(2, '/cancel'));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'return_awaiting_validation' });
  });

  it('desfaz: a linha vai para "Concluídas" como "Pedido cancelado pelo Financeiro"', async () => {
    await insertCommercialReservation(test.database.db, 3);
    await insertLine(test.database.db, key(3), { at: clock });
    await test.sync?.runRound();

    const response = await call('POST', path(3, '/cancel'));
    expect(response.statusCode).toBe(200);
    expectMatchesContract('cancelCommercialLine', response);
    expect(response.json()).toMatchObject({
      state: 'cancelled',
      tab: 'done',
      restorableUntil: new Date(clock.getTime() + 30 * DAY).toISOString(),
    });

    await test.sync?.runRound();
    expect(test.sheet?.rows('toCharge').some((row) => row[1] === number(3))).toBe(false);
    expect(test.sheet?.rows('done').find((row) => row[1] === number(3))?.[7]).toBe(
      'Pedido cancelado pelo Financeiro',
    );
    // Sem linha aberta, a reserva deixa de contar como tratativa.
    const reservation = await call('GET', `/v1/reservations/hml_um/${number(3)}`, reader);
    expect(reservation.json()).toMatchObject({
      treatment: { status: 'none' },
      commercial: { lineState: 'cancelled' },
    });

    expect((await call('POST', path(3, '/cancel'))).json()).toMatchObject({
      code: 'not_in_commercial_sheet',
    });
  });

  it('reverte no prazo: volta para "A cobrar"; depois de 30 dias, recusa', async () => {
    const response = await call('POST', path(3, '/restore'));
    expect(response.statusCode).toBe(200);
    expectMatchesContract('restoreCommercialLine', response);
    expect(response.json()).toMatchObject({ state: 'open', tab: 'to_charge' });
    const detail = (await call('GET', path(3), reader)).json<{ events: Array<{ type: string }> }>();
    expect(detail.events.map((event) => event.type)).toEqual(['line_restored', 'line_cancelled']);

    await call('POST', path(3, '/cancel'));
    clock = new Date(clock.getTime() + 31 * DAY);
    const expired = await call('POST', path(3, '/restore'));
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({ code: 'restore_expired' });
  });

  it('o perfil consulta não desfaz nem reverte', async () => {
    expect((await call('POST', path(3, '/cancel'), reader)).statusCode).toBe(403);
    expect((await call('POST', path(3, '/restore'), reader)).statusCode).toBe(403);
  });
});

describe('a execução mostra a reserva cobrada (FR-009, "A verificar", T035)', () => {
  it('a linha vai para "Concluídas", o retorno aguardando é encerrado e a reserva fica "Verificar"', async () => {
    const { db } = test.database;
    await insertCommercialReservation(db, 10, { checkIn: '2026-11-03' });
    await insertLine(db, key(10), { at: clock });
    await insertReturn(db, key(10));
    test.harness.hunit.scenario = {
      hotels: [
        {
          code: 'hml_um',
          reservations: [
            {
              reservationNumber: number(10),
              listing: { checkIn: '2026-11-03' },
              detail: reservationDetails.alreadyCharged(),
            },
          ],
        },
      ],
    };

    const created = await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: operator.headers,
      payload: {
        credentials: {
          username: `operador-${randomUUID().slice(0, 8)}@hotel.test`,
          password: TEST_PASSWORD,
        },
        period: { from: '2026-11-03', to: '2026-11-03' },
        hotelCodes: ['hml_um'],
      },
    });
    const { id } = created.json<{ id: string }>();
    const status = async () =>
      (await call('GET', `/v1/executions/${id}`, reader)).json<{ status: string }>().status;
    await vi.waitFor(async () => expect(await status()).toBe('awaiting_2fa'), {
      timeout: 10_000,
      interval: 20,
    });
    await test.app.inject({
      method: 'POST',
      url: `/v1/executions/${id}/two-factor`,
      headers: operator.headers,
      payload: { token: '123456' },
    });
    await vi.waitFor(async () => expect(await status()).toBe('completed'), {
      timeout: 10_000,
      interval: 20,
    });

    expect((await findLine(db, key(10)))?.state).toBe('concluded');
    const reservation = (
      await call('GET', `/v1/reservations/hml_um/${number(10)}`, reader)
    ).json<unknown>();
    expect(reservation).toMatchObject({
      treatment: { situation: 'virtual_card_already_charged', needsReview: true },
      commercial: { lineState: 'concluded', returnState: 'closed' },
    });
    const detail = (await call('GET', path(10), reader)).json<{
      returns: Array<{ state: string }>;
      events: Array<{ type: string; actor: { kind: string } }>;
    }>();
    expect(detail.returns[0]?.state).toBe('closed');
    expect(detail.events.map((event) => [event.type, event.actor.kind])).toEqual([
      ['return_closed', 'system'],
      ['line_concluded', 'system'],
    ]);
  });
});
