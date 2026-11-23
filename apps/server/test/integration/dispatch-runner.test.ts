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
import { commercialDispatchEvents, commercialReports } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  GUEST_MARKER,
  insertCommercialReservation,
  insertLine,
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

async function untilStatus(
  id: string,
  status: string,
  timeout = wait.timeout,
): Promise<DispatchBody> {
  let body: DispatchBody | null = null;
  await vi.waitFor(
    async () => {
      body = await get(id);
      expect(body.status).toBe(status);
    },
    { ...wait, timeout },
  );
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
      'Cobrada na maquininha',
      46345,
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
      'Cobrada na maquininha',
      46345,
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

describe('"Verificar agora" da fila "Cobradas no Hunit" (specs/008, US3; research R-07)', () => {
  type HunitQueue = {
    items: Array<{ reservationNumber: string; status: string; requiresCharge: boolean }>;
    counts: Record<string, number>;
  };
  type CheckBody = Omit<DispatchBody, 'items'> & {
    purpose: string;
    parentDispatchId: string | null;
    items: Array<DispatchBody['items'][number] & { checkResult: string | null }>;
  };

  /** Reserva enviada ao Comercial, lida no Hunit antes do relato "Cobrada no Hunit". */
  async function reported(n: number, hotelCode = 'hml_um'): Promise<void> {
    const { db } = test.database;
    await insertCommercialReservation(db, n, {
      hotelCode,
      lastVerifiedAt: new Date('2026-11-17T10:00:00Z'),
    });
    await insertLine(db, key(n, hotelCode));
    await db.insert(commercialReports).values({
      ...key(n, hotelCode),
      kind: 'charged_in_hunit',
      situationText: 'Cobrada no Hunit',
      chargedBy: 'Comercial Fictício 1',
      readAt: new Date('2026-11-18T10:00:00Z'),
    });
  }

  function check(client = operator): Promise<LightMyRequestResponse> {
    return test.app.inject({
      method: 'POST',
      url: '/v1/commercial-hunit-charges/check',
      headers: client.headers,
      payload: { credentials: credentials() },
    });
  }

  /** `timeout`: espera pelo fim da verificação (a de 50 reservas leva mais com a máquina ocupada). */
  async function checkAndFinish(
    finalStatus = 'completed',
    timeout = wait.timeout,
  ): Promise<CheckBody> {
    const created = await check();
    expect(created.statusCode).toBe(202);
    expectMatchesContract('checkCommercialHunitCharges', created);
    const { id } = created.json<CheckBody>();
    await untilStatus(id, 'awaiting_2fa');
    await sendToken(id);
    await untilStatus(id, finalStatus, timeout);
    const response = await test.app.inject({
      method: 'GET',
      url: `/v1/commercial-dispatches/${id}`,
      headers: reader.headers,
    });
    return response.json<CheckBody>();
  }

  async function queue(): Promise<HunitQueue> {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/commercial-hunit-charges',
      headers: reader.headers,
    });
    expect(response.statusCode).toBe(200);
    expectMatchesContract('listCommercialHunitCharges', response);
    return response.json<HunitQueue>();
  }

  const statusOf = async (n: number) =>
    (await queue()).items.find((item) => item.reservationNumber === number(n));

  it('confere cada relato: confirmada só com a cobrança no Hunit; sem abrir linha nem registrar envio', async () => {
    const { db } = test.database;
    await db.delete(commercialReports);
    for (const n of [61, 62, 63]) await reported(n);
    expect((await queue()).counts).toEqual({ awaiting: 3, notFound: 0, confirmed: 0 });
    hunitWith([
      { n: 61, detail: reservationDetails.alreadyCharged() },
      { n: 62 },
      { n: 63, detail: reservationDetails.invoiced() },
    ]);

    const body = await checkAndFinish();
    expect(body.purpose).toBe('hunit_check');
    expect(body.counts).toMatchObject({ total: 3, checked: 3, sent: 0, notVerified: 0 });
    expect(
      Object.fromEntries(body.items.map((item) => [item.reservationNumber, item.checkResult])),
    ).toEqual({ [number(61)]: 'confirmed', [number(62)]: 'not_found', [number(63)]: 'not_found' });

    // A leitura grava a classificação do Hunit; nada de envio novo no histórico.
    expect((await findReservation(db, 'hml_um', number(61)))?.classification).toBe(
      'virtual_card_already_charged',
    );
    const history = await getCommercialDetail(db, key(61));
    expect(history.events.map((event) => event.type)).toContain('hunit_checked');
    expect(history.events.map((event) => event.type)).not.toContain('dispatched');
    expect(history.events.find((event) => event.type === 'hunit_checked')?.reason).toBe(
      'cobrança encontrada',
    );

    // A fila: confirmada vai para "Concluídas"; a pendente continua não encontrada.
    expect(await statusOf(61)).toMatchObject({ status: 'confirmed', requiresCharge: false });
    expect(await statusOf(62)).toMatchObject({ status: 'not_found', requiresCharge: true });
    expect(await statusOf(63)).toMatchObject({ status: 'not_found', requiresCharge: false });
    expect((await findLine(db, key(61)))?.state).toBe('concluded');
    expect((await findLine(db, key(62)))?.state).toBe('open');

    // A coluna J acompanha a situação derivada.
    expect((await test.sync?.runRound())?.ok).toBe(true);
    const columnJ = (tab: 'toCharge' | 'done', n: number) =>
      test.sheet?.rows(tab).find((row) => row[1] === number(n))?.[9];
    expect(columnJ('done', 61)).toBe('Cobrança confirmada no Hunit');
    expect(columnJ('toCharge', 62)).toBe(
      'Recusado pelo Financeiro: cobrança não encontrada no Hunit',
    );
  });

  it('o próximo "Verificar agora" confere só as não encontradas que ainda exigem cobrança', async () => {
    hunitWith([{ n: 62, detail: reservationDetails.alreadyCharged() }]);
    const body = await checkAndFinish();
    expect(body.items.map((item) => item.reservationNumber)).toEqual([number(62)]);
    expect(await statusOf(62)).toMatchObject({ status: 'confirmed' });
  });

  it('sem relato para conferir: 409 no_reports_to_check; perfil consulta: 403', async () => {
    const response = await check();
    expect(response.statusCode).toBe(409);
    expectMatchesContract('checkCommercialHunitCharges', response);
    expect(response.json()).toMatchObject({ code: 'no_reports_to_check' });
    expect((await check(reader)).statusCode).toBe(403);
  });

  it('Hunit indisponível numa reserva: não verificada e a situação na fila não muda (FR-016)', async () => {
    await test.database.db.delete(commercialReports);
    await reported(64);
    await reported(65, 'hml_dois');
    hunitWith([{ n: 64 }, { n: 65, hotelCode: 'hml_dois' }], {
      hml_dois: { searchError: new HunitUnavailableError('teste') },
    });
    const body = await checkAndFinish();
    expect(outcomes(body)).toEqual({ [number(64)]: 'checked', [number(65)]: 'not_verified' });
    expect(await statusOf(65)).toMatchObject({ status: 'awaiting' });
    expect(await statusOf(64)).toMatchObject({ status: 'not_found' });
  });

  it('a lista padrão de envios nunca traz uma verificação; purpose=all e hunit_check trazem (R-02)', async () => {
    const list = async (query: string) => {
      const response = await test.app.inject({
        method: 'GET',
        url: `/v1/commercial-dispatches${query}`,
        headers: reader.headers,
      });
      expectMatchesContract('listCommercialDispatches', response);
      return response.json<{ items: Array<{ purpose: string }> }>().items;
    };
    expect((await list('')).every((item) => item.purpose === 'send')).toBe(true);
    const checks = await list('?purpose=hunit_check');
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((item) => item.purpose === 'hunit_check')).toBe(true);
    const all = await list('?purpose=all&limit=100');
    expect(new Set(all.map((item) => item.purpose))).toEqual(new Set(['send', 'hunit_check']));
  });

  it('cancelada antes do token e retomada: a retomada continua sendo verificação', async () => {
    await test.database.db.delete(commercialReports);
    await reported(66);
    hunitWith([{ n: 66 }]);
    const created = await check();
    const { id } = created.json<CheckBody>();
    await untilStatus(id, 'awaiting_2fa');
    const cancel = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-dispatches/${id}/cancel`,
      headers: operator.headers,
    });
    expect(cancel.statusCode).toBe(202);
    await untilStatus(id, 'cancelled');

    const resumed = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-dispatches/${id}/resume`,
      headers: operator.headers,
      payload: { credentials: credentials() },
    });
    expect(resumed.statusCode).toBe(202);
    const child = resumed.json<CheckBody>();
    expect(child).toMatchObject({ purpose: 'hunit_check', parentDispatchId: id });
    await untilStatus(child.id, 'awaiting_2fa');
    await sendToken(child.id);
    await untilStatus(child.id, 'completed');
    expect(await statusOf(66)).toMatchObject({ status: 'not_found' });
  });

  it('50 relatos numa verificação: todos com resultado (SC-005)', async () => {
    await test.database.db.delete(commercialReports);
    const numbers = Array.from({ length: 50 }, (_unused, i) => 700 + i);
    for (const n of numbers) await reported(n);
    hunitWith(
      numbers.map((n) => ({
        n,
        ...(n % 2 === 0 ? { detail: reservationDetails.alreadyCharged() } : {}),
      })),
    );
    const body = await checkAndFinish('completed', 45_000);
    expect(body.counts).toMatchObject({ total: 50, checked: 50, notVerified: 0, pending: 0 });
    expect(body.items.every((item) => item.checkResult !== null)).toBe(true);
    expect((await queue()).counts).toEqual({ awaiting: 0, notFound: 25, confirmed: 25 });
  }, 60_000);
});
