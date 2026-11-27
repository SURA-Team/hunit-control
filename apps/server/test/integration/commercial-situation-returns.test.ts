/**
 * Situação livre do Comercial validada pelo Financeiro (specs/009, US1; FR-001 a FR-009; research
 * R-02 a R-05) — tasks.md, T006 a T010. Planilha em memória; dados fictícios.
 */
import type { components } from '@hunit/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshCommercialLine } from '../../src/persistence/commercial-repo.js';
import { commercialReturns, reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  seedTestHotels,
  TEST_HOTELS,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';

type Commercial = components['schemas']['CommercialDetail'];
type Reservation = components['schemas']['Reservation'];
type ReportOverview = components['schemas']['ReportOverview'];
type Problem = { code: string; reason?: string };

const HOTEL_ONE = TEST_HOTELS[0];
const HOTEL_TWO = TEST_HOTELS[1];

let test: TestApp;
let reader: TestClient;
let operator: TestClient;

const number = (n: number) => String(700_000 + n);
const key = (n: number, hotelCode: string = HOTEL_ONE.code) => ({
  hotelCode,
  reservationNumber: number(n),
});

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true });
  reader = await test.createClient('reader');
  operator = await test.createClient('operator');
  await seedTestHotels(test.database.db);
});

afterAll(async () => {
  await test.close();
});

async function round() {
  const result = await test.sync?.runRound();
  expect(result?.ok).toBe(true);
}

/** Reserva enviada (números 700 001…), com a linha escrita em "A cobrar". */
async function sent(n: number, hotel: { code: string } = HOTEL_ONE): Promise<void> {
  await insertCommercialReservation(test.database.db, n - 200_000, { hotelCode: hotel.code });
  await insertLine(test.database.db, key(n, hotel.code));
  await round();
}

/** O Comercial preenche K a P. */
function fill(
  n: number,
  cells: readonly (string | number)[],
  hotel: { name: string } = HOTEL_ONE,
): void {
  test.sheet?.fillReturn(hotel.name, number(n), cells);
}

const columnJ = (tab: 'toCharge' | 'done', n: number) =>
  test.sheet?.rows(tab).find((row) => row[1] === number(n))?.[9];

async function get<T>(url: string, operationId: string): Promise<T> {
  const response = await test.app.inject({ method: 'GET', url, headers: reader.headers });
  expect(response.statusCode, response.body).toBe(200);
  expectMatchesContract(operationId, response);
  return response.json<T>();
}

const reservation = (n: number, hotelCode: string = HOTEL_ONE.code) =>
  get<Reservation>(`/v1/reservations/${hotelCode}/${number(n)}`, 'getReservation');

const commercial = (n: number, hotelCode: string = HOTEL_ONE.code) =>
  get<Commercial>(
    `/v1/reservations/${hotelCode}/${number(n)}/commercial`,
    'getReservationCommercial',
  );

/** Situação livre lida: o id do retorno, pela API. */
async function situationReturnId(n: number, hotelCode: string = HOTEL_ONE.code): Promise<string> {
  const id = (await reservation(n, hotelCode)).commercial?.situationReturn?.id;
  if (!id) throw new Error(`a reserva ${number(n)} não tem situação livre`);
  return id;
}

async function decide(
  returnId: string,
  payload: Record<string, unknown>,
  client: TestClient = operator,
) {
  return test.app.inject({
    method: 'POST',
    url: `/v1/commercial-returns/${returnId}/situation/confirm`,
    headers: client.headers,
    payload,
  });
}

async function storedReturn(id: string) {
  const [row] = await test.database.db
    .select()
    .from(commercialReturns)
    .where(eq(commercialReturns.id, id));
  return row ?? null;
}

describe('leitura da situação (FR-001 a FR-005, research R-02)', () => {
  it('situação livre com o responsável: aguarda validação, fora de currentReturn (R-03)', async () => {
    await sent(1);
    fill(1, ['', '', '', 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();

    const body = await reservation(1);
    expect(body.treatment.detailedSituation).toBe('return_pending');
    expect(body.commercial?.returnState).toBe('awaiting_validation');
    expect(body.commercial?.currentReturn).toBeNull();
    expect(body.commercial?.situationReturn).toMatchObject({
      state: 'awaiting_validation',
      situationText: 'Cobrada pela OTA',
      chargedBy: 'Comercial Fictício 1',
      authorizationCode: null,
      chargeHotel: null,
      chargedAmount: null,
      chargeDate: null,
      decision: null,
    });
    expect(columnJ('toCharge', 1)).toBe('Aguardando validação do Financeiro');
    const detail = await commercial(1);
    expect(detail.returns).toEqual([]);
    expect(detail.situationReturns).toHaveLength(1);
  });

  it('situação livre sem o responsável: pede só o responsável', async () => {
    await sent(2);
    fill(2, ['', '', 150, '', 'Paga em dinheiro']);
    await round();
    expect(columnJ('toCharge', 2)).toBe('Retorno incompleto: falta o responsável pela cobrança');
    expect((await reservation(2)).commercial?.situationReturn).toBeNull();
  });

  it('maquininha só com o responsável: pede código, hotel, valor e data', async () => {
    await sent(3);
    fill(3, ['', '', '', 'Comercial Fictício 1', 'Cobrada na maquininha']);
    await round();
    expect(columnJ('toCharge', 3)).toBe(
      'Retorno incompleto: faltam o código de autorização, o hotel da cobrança, o valor cobrado e a data da cobrança',
    );
  });

  it('"Cobrada no Hunit" sem data entra na fila (data opcional desde a 009)', async () => {
    await sent(4);
    fill(4, ['', '', '', 'Comercial Fictício 1', 'Cobrada no Hunit']);
    await round();
    expect((await reservation(4)).commercial?.report).toMatchObject({
      kind: 'charged_in_hunit',
      chargeDate: null,
    });
    expect(columnJ('toCharge', 4)).toBe('Aguardando verificação no Hunit');
  });

  it('"Cancelada" sem responsável: problema; já aguardando, continua aguardando (R-07)', async () => {
    await sent(5);
    fill(5, ['', '', '', '', 'Cancelada']);
    await round();
    expect(columnJ('toCharge', 5)).toBe('Retorno incompleto: falta o responsável pela cobrança');
    expect((await reservation(5)).commercial?.report).toBeNull();

    // Com o responsável, vai para validar; se depois ele for apagado, a regra da 005 vale.
    fill(5, ['', '', '', 'Comercial Fictício 1', 'Cancelada']);
    await round();
    expect((await reservation(5)).commercial?.report?.validation?.state).toBe(
      'awaiting_validation',
    );
    fill(5, ['', '', '', '', 'Cancelada']);
    await round();
    expect(columnJ('toCharge', 5)).toBe('Retorno incompleto: falta o responsável pela cobrança');
    expect((await reservation(5)).commercial?.report?.validation?.state).toBe(
      'awaiting_validation',
    );
  });

  it('relida sem mudança: nada novo; mudada: substitui; trocada para maquininha: retorno comum', async () => {
    await sent(6);
    fill(6, ['', '', '', 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();
    const first = await situationReturnId(6);
    await round();
    expect(await situationReturnId(6)).toBe(first);

    fill(6, ['', '', 99.9, 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();
    const second = await situationReturnId(6);
    expect(second).not.toBe(first);
    expect((await storedReturn(first))?.state).toBe('superseded');
    expect((await reservation(6)).commercial?.situationReturn?.chargedAmount).toBe('99.90');

    fill(6, [
      'AUT9',
      'Estabelecimento Fictício',
      99.9,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      '19/11/2026',
    ]);
    await round();
    const body = await reservation(6);
    expect(body.commercial?.situationReturn).toBeNull();
    expect(body.commercial?.currentReturn?.authorizationCode).toBe('AUT9');
  });
});

describe('decisões do Financeiro (FR-007 a FR-009, research R-04)', () => {
  it('"Confirmar como cobrada" sem valor do Comercial exige o valor; com ele, vira valor à mão', async () => {
    const id = await situationReturnId(1);
    expect((await decide(id, { as: 'charged' }, reader)).statusCode).toBe(403);

    const missing = await decide(id, { as: 'charged' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<Problem>().code).toBe('charged_amount_required');

    const response = await decide(id, { as: 'charged', chargedAmount: '321.00' });
    expect(response.statusCode, response.body).toBe(200);
    expectMatchesContract('confirmCommercialSituationReturn', response);
    const body = response.json<Reservation>();
    expect(body.treatment.detailedSituation).toBe('proof_sent');
    expect(body.treatment.effectiveChargedAmount).toBe('321.00');
    expect(body.treatment.chargedAmountOrigin).toBe('manual');
    expect(body.commercial?.situationReturn).toMatchObject({
      state: 'confirmed',
      decision: 'charged',
    });
    expect(body.commercial?.situationReturn?.decidedBy).toBeTruthy();
    await round();
    expect(columnJ('done', 1)).toBe('Confirmado pelo Financeiro');

    const again = await decide(id, { as: 'charged', chargedAmount: '1.00' });
    expect(again.statusCode).toBe(409);
    expect(again.json<Problem>().code).toBe('return_not_awaiting_validation');
  });

  it('desfazer a confirmação esconde o valor à mão e devolve para validar', async () => {
    const id = await situationReturnId(1);
    const undone = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-returns/${id}/undo-confirmation`,
      headers: operator.headers,
    });
    expect(undone.statusCode, undone.body).toBe(200);
    const body = await reservation(1);
    expect(body.commercial?.situationReturn?.state).toBe('awaiting_validation');
    expect(body.treatment.effectiveChargedAmount).toBeNull();
  });

  it('com o valor do Comercial: usa o dele e recusa outro valor', async () => {
    await sent(7);
    fill(7, ['', '', 50, 'Comercial Fictício 1', 'Link de pagamento']);
    await round();
    const withAmount = await situationReturnId(7);
    const refused = await decide(withAmount, { as: 'charged', chargedAmount: '60.00' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().code).toBe('charged_amount_from_commercial');

    const response = await decide(withAmount, { as: 'charged' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<Reservation>();
    expect(body.treatment.effectiveChargedAmount).toBe('50.00');
    expect(body.treatment.chargedAmountOrigin).toBe('commercial');
  });

  it('"Confirmar como cancelada sem cobrança" marca a reserva; desfazer volta para validar, sem vínculo', async () => {
    await sent(8);
    fill(8, ['', '', '', 'Comercial Fictício 1', 'Hóspede não compareceu']);
    await round();
    const id = await situationReturnId(8);
    expect((await decide(id, { as: 'no_charge', chargedAmount: '1.00' })).statusCode).toBe(400);

    const response = await decide(id, { as: 'no_charge', note: 'Conferido com o hotel' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<Reservation>();
    expect(body.treatment.detailedSituation).toBe('cancelled_no_charge');
    expect(body.noCharge?.note).toBe(
      'Situação informada pelo Comercial: Hóspede não compareceu. Conferido com o hotel',
    );
    expect(body.commercial?.situationReturn).toMatchObject({
      state: 'closed',
      decision: 'no_charge',
    });
    const detail = await commercial(8);
    expect(detail.history[0]).toMatchObject({
      type: 'cancellation_confirmed',
      returnId: id,
      reason: 'Hóspede não compareceu',
    });
    await round();
    expect(columnJ('done', 8)).toBe('Cancelada sem cobrança pelo Financeiro');

    const undone = await test.app.inject({
      method: 'POST',
      url: `/v1/reservations/hml_um/${number(8)}/no-charge/undo`,
      headers: operator.headers,
      payload: { markId: body.noCharge?.id },
    });
    expect(undone.statusCode, undone.body).toBe(200);
    const stored = await storedReturn(id);
    expect(stored).toMatchObject({ state: 'awaiting_validation', noChargeMarkId: null });
    await round();
    expect(columnJ('toCharge', 8)).toBe('Aguardando validação do Financeiro');

    // De volta para validar, pode ser confirmada como cobrada.
    const charged = await decide(id, { as: 'charged', chargedAmount: '10.00' });
    expect(charged.statusCode, charged.body).toBe(200);
  });

  it('recusar usa a rota de hoje; a coluna J mostra o motivo', async () => {
    await sent(9);
    fill(9, ['', '', '', 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();
    const id = await situationReturnId(9);
    const response = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-returns/${id}/reject`,
      headers: operator.headers,
      payload: { reason: 'Falta o comprovante da OTA' },
    });
    expect(response.statusCode, response.body).toBe(200);
    await round();
    expect(columnJ('toCharge', 9)).toBe('Recusado pelo Financeiro: Falta o comprovante da OTA');
    expect((await reservation(9)).commercial?.situationReturn?.state).toBe('rejected');
  });

  it('retorno que não é de situação livre: 409 not_a_situation_return', async () => {
    const detail = await commercial(6);
    const terminal = detail.returns[0]?.id ?? '';
    const response = await decide(terminal, { as: 'charged' });
    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().code).toBe('not_a_situation_return');
  });

  it('o Hunit deixa de exigir cobrança: o retorno é encerrado e a decisão é recusada (U1)', async () => {
    await sent(10);
    fill(10, ['', '', '', 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();
    const id = await situationReturnId(10);
    await test.database.db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({ classification: 'virtual_card_already_charged', lastVerifiedAt: new Date() })
        .where(
          and(eq(reservations.hotelCode, 'hml_um'), eq(reservations.reservationNumber, number(10))),
        );
      await refreshCommercialLine(tx, key(10), new Date());
    });
    expect(await storedReturn(id)).toMatchObject({ state: 'closed', noChargeMarkId: null });
    const response = await decide(id, { as: 'charged', chargedAmount: '1.00' });
    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().code).toBe('return_not_awaiting_validation');
  });
});

describe('apps da 1.11.0 não confirmam a situação livre (research R-03)', () => {
  it('/confirm recusa com situation_return_needs_decision; o lote deixa de fora', async () => {
    await sent(11);
    fill(11, ['AUT1', 'Estabelecimento Fictício', 80, 'Comercial Fictício 1', 'Paga em dinheiro']);
    await round();
    const id = await situationReturnId(11);
    const single = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-returns/${id}/confirm`,
      headers: operator.headers,
    });
    expect(single.statusCode).toBe(409);
    expect(single.json<Problem>().code).toBe('situation_return_needs_decision');

    const batch = await test.app.inject({
      method: 'POST',
      url: '/v1/commercial-returns/confirm',
      headers: operator.headers,
      payload: { reservations: [key(11)], includeCancellations: true },
    });
    expect(batch.statusCode, batch.body).toBe(200);
    expect(
      batch.json<{ items: Array<{ outcome: string; reason: string | null }> }>().items,
    ).toEqual([
      expect.objectContaining({ outcome: 'ignored', reason: 'no_return_awaiting_validation' }),
    ]);
    expect((await storedReturn(id))?.state).toBe('awaiting_validation');
  });
});

describe('valor cobrado com valor à mão: lista, detalhe e relatório dizem o mesmo (T007, R-05)', () => {
  it('confirmada como cobrada sem valor do Comercial', async () => {
    await sent(20, HOTEL_TWO);
    fill(20, ['', '', '', 'Comercial Fictício 1', 'Cobrada pela OTA'], HOTEL_TWO);
    await round();
    const id = await situationReturnId(20, HOTEL_TWO.code);
    const response = await decide(id, { as: 'charged', chargedAmount: '777.00' });
    expect(response.statusCode, response.body).toBe(200);

    const detail = await reservation(20, HOTEL_TWO.code);
    const list = await get<{ items: Reservation[] }>(
      `/v1/reservations?hotelCode=${HOTEL_TWO.code}&q=${number(20)}`,
      'listReservations',
    );
    const item = list.items.find((row) => row.reservationNumber === number(20));
    expect(item?.treatment.effectiveChargedAmount).toBe(detail.treatment.effectiveChargedAmount);
    expect(item?.treatment.chargedAmountOrigin).toBe('manual');

    const report = await get<ReportOverview>(
      `/v1/reports/overview?checkInFrom=2026-11-01&checkInTo=2026-11-30&hotelCode=${HOTEL_TWO.code}`,
      'getReportOverview',
    );
    const row = report.hotelRows.find((hotel) => hotel.hotelCode === HOTEL_TWO.code);
    expect(row?.recovered).toBe('777.00');
  });
});
