/**
 * Envio ao Comercial de ponta a ponta pela API, com o Hunit simulado e a planilha em memória
 * (specs/005, US1; FR-001 a FR-008; quickstart §2, cenários 1 a 5) — tasks.md, T030.
 * Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HunitUnavailableError, SessionExpiredError } from '../../src/hunit/errors.js';
import { findLine, getCommercialDetail } from '../../src/persistence/commercial-repo.js';
import { findReservation } from '../../src/persistence/reservations-repo.js';
import { commercialDispatchEvents } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  GUEST_MARKER,
  insertCommercialReservation,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution } from '../helpers/factories.js';
import {
  reservationDetails,
  type FakeDetail,
  type FakeHotel,
} from '../helpers/fake-hunit-gateway.js';
import { TEST_PASSWORD } from '../helpers/runner.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const HOTEL = 'Hotel Homologação Um';
const CHECK_IN = '2026-11-03';
const number = (n: number) => String(900_000 + n);
const key = (n: number, hotelCode = 'hml_um') => ({ hotelCode, reservationNumber: number(n) });

interface DispatchBody {
  id: string;
  status: string;
  endReason: string | null;
  counts: Record<string, number>;
  items: Array<{ reservationNumber: string; outcome: string; reason: string | null }>;
}

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true, twoFactorTimeoutMs: 2_000 });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  await seedTestHotels(test.database.db);
});

afterAll(async () => {
  await test.close();
});

/** O Hunit simulado com as reservas de cada hotel (o detalhe padrão é "pendente de cobrança"). */
function hunitWith(
  entries: Array<{ n: number; hotelCode?: string; detail?: FakeDetail | Error }>,
  extra: Partial<Record<string, Partial<FakeHotel>>> = {},
) {
  const codes = ['hml_um', 'hml_dois', 'hml_tres'];
  test.harness.hunit.scenario = {
    hotels: codes.map((code) => ({
      code,
      reservations: entries
        .filter((entry) => (entry.hotelCode ?? 'hml_um') === code)
        .map((entry) => ({
          reservationNumber: number(entry.n),
          listing: { checkIn: CHECK_IN },
          ...(entry.detail ? { detail: entry.detail } : {}),
        })),
      ...extra[code],
    })),
  };
}

const credentials = () => ({
  username: `operador-${randomUUID().slice(0, 8)}@hotel.test`,
  password: TEST_PASSWORD,
});

function start(
  reservations: Array<{ hotelCode: string; reservationNumber: string }>,
  client = operator,
  creds = credentials(),
): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'POST',
    url: '/v1/commercial-dispatches',
    headers: client.headers,
    payload: { credentials: creds, reservations },
  });
}

async function get(id: string): Promise<DispatchBody> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/commercial-dispatches/${id}`,
    headers: reader.headers,
  });
  expectMatchesContract('getCommercialDispatch', response);
  return response.json<DispatchBody>();
}

const wait = { timeout: 10_000, interval: 20 };

async function untilStatus(id: string, status: string): Promise<DispatchBody> {
  let body: DispatchBody | null = null;
  await vi.waitFor(async () => {
    body = await get(id);
    expect(body.status).toBe(status);
  }, wait);
  return body as unknown as DispatchBody;
}

async function sendToken(id: string): Promise<void> {
  const response = await test.app.inject({
    method: 'POST',
    url: `/v1/commercial-dispatches/${id}/two-factor`,
    headers: operator.headers,
    payload: { token: '123456' },
  });
  expect(response.statusCode).toBe(202);
}

/** Envia, informa o token e espera terminar. */
async function dispatchAndFinish(
  reservations: Array<{ hotelCode: string; reservationNumber: string }>,
  finalStatus = 'completed',
): Promise<DispatchBody> {
  const created = await start(reservations);
  expect(created.statusCode).toBe(202);
  expectMatchesContract('createCommercialDispatch', created);
  const { id } = created.json<DispatchBody>();
  await untilStatus(id, 'awaiting_2fa');
  await sendToken(id);
  return untilStatus(id, finalStatus);
}

const outcomes = (body: DispatchBody) =>
  Object.fromEntries(body.items.map((item) => [item.reservationNumber, item.outcome]));

describe('envio com verificação no Hunit (US1, cenários 1 e 2)', () => {
  it('envia as que exigem cobrança, retira as cobradas e relata as não encontradas', async () => {
    const { db } = test.database;
    for (let n = 1; n <= 10; n += 1)
      await insertCommercialReservation(db, n, { guestName: GUEST_MARKER });
    hunitWith([
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ n })),
      { n: 8, detail: reservationDetails.alreadyCharged() },
      { n: 9, detail: reservationDetails.alreadyCharged() },
      // 10 não está no Hunit nesse check-in.
    ]);

    const body = await dispatchAndFinish(Array.from({ length: 10 }, (_unused, i) => key(i + 1)));
    expect(body.counts).toMatchObject({
      total: 10,
      sent: 7,
      withdrawn: 2,
      notVerified: 1,
      pending: 0,
    });
    expect(outcomes(body)[number(8)]).toBe('withdrawn');
    expect(body.items.find((item) => item.reservationNumber === number(8))?.reason).toBe(
      'Já cobrada',
    );
    expect(body.items.find((item) => item.reservationNumber === number(10))?.reason).toBe(
      'não encontrada no Hunit no check-in registrado (03/11/2026)',
    );

    // A verificação atualiza a reserva (FR-004) e a retirada fica "Já cobrada".
    expect((await findReservation(db, 'hml_um', number(8)))?.classification).toBe(
      'virtual_card_already_charged',
    );
    expect((await findReservation(db, 'hml_um', number(1)))?.lastDispatchId).toBe(body.id);
    expect(await findLine(db, key(8))).toBeNull();
    expect((await findLine(db, key(1)))?.state).toBe('open');

    // A planilha recebe as 7, sem o nome do hóspede.
    expect((await test.sync?.runRound())?.ok).toBe(true);
    const rows = test.sheet?.rows('toCharge') ?? [];
    expect(rows.map((row) => row[1]).sort()).toEqual([1, 2, 3, 4, 5, 6, 7].map(number));
    expect(JSON.stringify(rows)).not.toContain(GUEST_MARKER);

    // Tratativa enviada, com o envio no histórico.
    const detail = await getCommercialDetail(db, key(1));
    expect(detail.events.map((event) => [event.type, event.dispatchId])).toEqual([
      ['dispatched', body.id],
    ]);
  });

  it('reenviar atualiza a linha sem duplicar e mantém o retorno já preenchido', async () => {
    test.sheet?.fillReturn(HOTEL, number(1), [
      'AUT1',
      'Maquininha Fictícia',
      10,
      'Comercial Fictício 1',
    ]);
    hunitWith([1, 2, 3].map((n) => ({ n })));
    const body = await dispatchAndFinish([key(1), key(2), key(3)]);
    expect(body.counts).toMatchObject({ sent: 3 });

    await test.sync?.runRound();
    const rows = test.sheet?.rows('toCharge') ?? [];
    expect(rows).toHaveLength(7);
    expect(rows.find((row) => row[1] === number(1))?.slice(10)).toEqual([
      'AUT1',
      'Maquininha Fictícia',
      10,
      'Comercial Fictício 1',
    ]);
    expect(
      (await getCommercialDetail(test.database.db, key(1))).events.filter(
        (event) => event.type === 'dispatched',
      ),
    ).toHaveLength(2);
  });
});

describe('elegibilidade e conta (FR-001, FR-003, R-01)', () => {
  it('a conferência diz quem aceita, quem fica de fora e o total', async () => {
    await insertCommercialReservation(test.database.db, 11, { classification: 'invoiced' });
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/commercial-dispatches/check',
      headers: operator.headers,
      payload: { reservations: [key(1), key(2), key(11), key(999)] },
    });
    expect(response.statusCode).toBe(200);
    expectMatchesContract('checkCommercialDispatch', response);
    expect(response.json()).toEqual({
      // O total é o que o Hunit informou na verificação do envio anterior (FR-004).
      eligible: [
        { hotelCode: 'hml_um', reservationNumber: number(2), totalAmount: '500.00', resend: true },
      ],
      ignored: [
        // A 1 tem o retorno do Comercial lido na rodada anterior, aguardando validação.
        { hotelCode: 'hml_um', reservationNumber: number(1), reason: 'return_awaiting_validation' },
        { hotelCode: 'hml_um', reservationNumber: number(11), reason: 'not_accepting' },
        { hotelCode: 'hml_um', reservationNumber: number(999), reason: 'not_found' },
      ],
      totalAmount: '500.00',
    });
  });

  it('nenhuma elegível: 422; perfil consulta: 403', async () => {
    const none = await start([key(11)]);
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ code: 'no_eligible_reservations' });
    expect((await start([key(1)], reader)).statusCode).toBe(403);
  });

  it('execução ativa na mesma conta: account_busy', async () => {
    const creds = credentials();
    const execution = await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: operator.headers,
      payload: { credentials: creds, period: { from: '2026-11-01', to: '2026-11-07' } },
    });
    expect(execution.statusCode).toBe(202);
    const busy = await start([key(2)], operator, creds);
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ code: 'account_busy' });
    await test.app.inject({
      method: 'POST',
      url: `/v1/executions/${execution.json<{ id: string }>().id}/cancel`,
      headers: operator.headers,
    });
  });
});

describe('token, cancelamento e retomada (US1, cenários 2, 7 e 8)', () => {
  it('sem token no prazo: falha e nenhuma reserva é enviada', async () => {
    await insertCommercialReservation(test.database.db, 21);
    hunitWith([{ n: 21 }]);
    const created = await start([key(21)]);
    const { id } = created.json<DispatchBody>();
    const body = await untilStatus(id, 'failed');
    expect(body.endReason).toBe('two_factor_timeout');
    expect(outcomes(body)[number(21)]).toBe('not_verified');
    expect(await findLine(test.database.db, key(21))).toBeNull();
  });

  it('cancelar no meio: processadas ficam; retomar processa só as não verificadas', async () => {
    const { db } = test.database;
    for (const n of [31, 32, 33, 34]) await insertCommercialReservation(db, n);
    hunitWith([31, 32, 33, 34].map((n) => ({ n })));
    let release: () => void = () => undefined;
    const paused = new Promise<void>((resolve) => (release = resolve));
    let searches = 0;
    test.harness.hunit.before('searchReservations', async () => {
      searches += 1;
      if (searches === 2) await paused;
    });

    const created = await start([key(31), key(32), key(33), key(34)]);
    const { id } = created.json<DispatchBody>();
    await untilStatus(id, 'awaiting_2fa');
    await sendToken(id);
    await vi.waitFor(() => expect(searches).toBe(2), wait);
    const cancel = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-dispatches/${id}/cancel`,
      headers: operator.headers,
    });
    expect(cancel.statusCode).toBe(202);
    release();

    const cancelled = await untilStatus(id, 'cancelled');
    expect(outcomes(cancelled)).toMatchObject({
      [number(31)]: 'sent',
      [number(33)]: 'not_verified',
      [number(34)]: 'not_verified',
    });
    expect(cancelled.items.find((item) => item.reservationNumber === number(34))?.reason).toBe(
      'envio cancelado antes da verificação',
    );

    const resumed = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-dispatches/${id}/resume`,
      headers: operator.headers,
      payload: { credentials: credentials() },
    });
    expect(resumed.statusCode).toBe(202);
    const child = resumed.json<DispatchBody & { parentDispatchId: string }>();
    expect(child.parentDispatchId).toBe(id);
    expect(child.items.map((item) => item.reservationNumber).sort()).toEqual(
      cancelled.items
        .filter((item) => item.outcome === 'not_verified')
        .map((item) => item.reservationNumber)
        .sort(),
    );
    await untilStatus(child.id, 'awaiting_2fa');
    await sendToken(child.id);
    const finished = await untilStatus(child.id, 'completed');
    expect(finished.counts.notVerified).toBe(0);
  });
});

describe('falhas do Hunit (edge cases)', () => {
  it('indisponível em uma reserva: não verificada e o envio segue; sessão expirada: falha', async () => {
    const { db } = test.database;
    await insertCommercialReservation(db, 41);
    await insertCommercialReservation(db, 42, { hotelCode: 'hml_dois' });
    await insertCommercialReservation(db, 43);
    hunitWith([{ n: 41 }, { n: 42, hotelCode: 'hml_dois' }, { n: 43 }], {
      hml_dois: { searchError: new HunitUnavailableError('teste') },
    });
    const body = await dispatchAndFinish([key(41), key(42, 'hml_dois'), key(43)]);
    expect(outcomes(body)).toEqual({
      [number(41)]: 'sent',
      [number(42)]: 'not_verified',
      [number(43)]: 'sent',
    });

    await insertCommercialReservation(db, 44, { hotelCode: 'hml_tres' });
    await insertCommercialReservation(db, 45);
    hunitWith([{ n: 44, hotelCode: 'hml_tres' }, { n: 45 }], {
      hml_tres: { searchError: new SessionExpiredError() },
    });
    const expired = await dispatchAndFinish([key(44, 'hml_tres'), key(45)], 'failed');
    expect(expired.endReason).toBe('session_expired');
    expect(outcomes(expired)).toEqual({
      [number(44)]: 'not_verified',
      [number(45)]: 'not_verified',
    });
  });

  it('"A revisar (sistema anterior)" é reclassificada pela verificação e enviada', async () => {
    await insertCommercialReservation(test.database.db, 51, {
      classification: 'not_virtual_card',
      lastExecutionId: null,
    });
    hunitWith([{ n: 51 }]);
    const body = await dispatchAndFinish([key(51)]);
    expect(outcomes(body)[number(51)]).toBe('sent');
    expect((await findReservation(test.database.db, 'hml_um', number(51)))?.classification).toBe(
      'virtual_card_pending_charge',
    );
  });
});

describe('segredos (FR-002, SC-009)', () => {
  it('a senha nunca vai para logs, eventos nem banco', async () => {
    expect(test.logs.text()).not.toContain(TEST_PASSWORD);
    const messages = await test.database.db
      .select({ message: commercialDispatchEvents.message })
      .from(commercialDispatchEvents);
    expect(JSON.stringify(messages)).not.toContain(TEST_PASSWORD);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('sem planilha configurada, o envio é recusado (409)', async () => {
    const without = await createTestApp();
    try {
      const client = await without.createClient('operator');
      const response = await without.app.inject({
        method: 'POST',
        url: '/v1/commercial-dispatches',
        headers: client.headers,
        payload: { credentials: credentials(), reservations: [key(1)] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'commercial_sheet_not_configured' });
    } finally {
      await without.close();
    }
  });
});

it('o perfil consulta acompanha, mas não cancela', async () => {
  const [row] = await test.database.db
    .select({ id: commercialDispatchEvents.dispatchId })
    .from(commercialDispatchEvents)
    .where(eq(commercialDispatchEvents.type, 'status_changed'))
    .limit(1);
  const id = row?.id ?? '';
  expect((await get(id)).id).toBe(id);
  const cancel = await test.app.inject({
    method: 'POST',
    url: `/v1/commercial-dispatches/${id}/cancel`,
    headers: reader.headers,
  });
  expect(cancel.statusCode).toBe(403);
  // Nada de execução sobrou ativa (o teste de conta cancelou a sua).
  expect(insertExecution).toBeDefined();
});
