/**
 * Situação e data da cobrança e os relatos do Comercial (specs/008, US2 e US3; research R-06, R-07;
 * data-model §1.2) — tasks.md, T015, T016 e T021. Desde a homologação (R-19, T050): situação e data
 * obrigatórias e a "Cancelada", validada pelo Financeiro. Desde a 009 (research R-02), toda situação
 * exige o responsável e a data só é exigida na maquininha. Planilha em memória; dados fictícios.
 */
import type { components } from '@hunit/contracts';
import { HUNIT_NOT_FOUND_REASON, type Classification } from '@hunit/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshCommercialLine } from '../../src/persistence/commercial-repo.js';
import {
  commercialReports,
  commercialReturns,
  reservations,
} from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';

type Commercial = components['schemas']['CommercialDetail'];
type Reservation = components['schemas']['Reservation'];
type SheetStatus = components['schemas']['CommercialSheetStatus'];

const HOTEL = 'Hotel Homologação Um';
/** 19/11/2026 como o Google devolve uma data (dias desde 30/12/1899). */
const SERIAL_2026_11_19 = 46345;

let test: TestApp;
let reader: TestClient;
let operator: TestClient;

const number = (n: number) => String(800_000 + n);
const key = (n: number) => ({ hotelCode: 'hml_um', reservationNumber: number(n) });

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
  return result;
}

/** Reserva enviada (números 800 001…), com a linha já escrita em "A cobrar". */
async function sent(n: number): Promise<void> {
  await insertCommercialReservation(test.database.db, n - 100_000);
  await insertLine(test.database.db, key(n));
  await round();
}

/** O Comercial preenche K a P (as seis colunas de retorno). */
function fill(n: number, cells: readonly (string | number)[]): void {
  test.sheet?.fillReturn(HOTEL, number(n), cells);
}

const columnJ = (tab: 'toCharge' | 'done', n: number) =>
  test.sheet?.rows(tab).find((row) => row[1] === number(n))?.[9];

async function commercial(n: number): Promise<Commercial> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/reservations/hml_um/${number(n)}/commercial`,
    headers: reader.headers,
  });
  expectMatchesContract('getReservationCommercial', response);
  return response.json<Commercial>();
}

async function reservation(n: number): Promise<Reservation> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/reservations/hml_um/${number(n)}`,
    headers: reader.headers,
  });
  expectMatchesContract('getReservation', response);
  return response.json<Reservation>();
}

async function sheetStatus(): Promise<SheetStatus> {
  const response = await test.app.inject({
    method: 'GET',
    url: '/v1/commercial-sheet',
    headers: reader.headers,
  });
  expectMatchesContract('getCommercialSheetStatus', response);
  return response.json<SheetStatus>();
}

async function storedReport(n: number) {
  const [row] = await test.database.db
    .select()
    .from(commercialReports)
    .where(
      and(
        eq(commercialReports.hotelCode, 'hml_um'),
        eq(commercialReports.reservationNumber, number(n)),
      ),
    );
  return row ?? null;
}

/**
 * Uma leitura da reserva no Hunit (execução, envio ou verificação): grava a classificação lida e
 * atualiza a linha, como `commitVerifiedReservation` + `refreshCommercialLine`.
 */
async function hunitRead(n: number, classification: Classification, at = new Date()) {
  await test.database.db.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({ classification, lastVerifiedAt: at })
      .where(
        and(eq(reservations.hotelCode, 'hml_um'), eq(reservations.reservationNumber, number(n))),
      );
    await refreshCommercialLine(tx, key(n), at);
  });
}

describe('retorno com situação e data (US2, research R-06)', () => {
  it('retorno completo guarda a situação e a data; a API mostra as duas', async () => {
    await sent(1);
    fill(1, [
      'AUT1',
      'Maquininha Fictícia',
      655,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      SERIAL_2026_11_19,
    ]);
    expect(await round()).toMatchObject({ returnsReceived: 1 });

    const detail = await commercial(1);
    expect(detail.returns[0]).toMatchObject({
      state: 'awaiting_validation',
      chargeSituation: { kind: 'charged_at_terminal', text: 'Cobrada na maquininha' },
      chargeDate: '2026-11-19',
    });
    expect((await reservation(1)).commercial?.currentReturn).toMatchObject({
      chargeSituation: { kind: 'charged_at_terminal', text: 'Cobrada na maquininha' },
      chargeDate: '2026-11-19',
    });
    expect(columnJ('toCharge', 1)).toBe('Aguardando validação do Financeiro');
  });

  it('sem situação: "Retornos com problema" até o Comercial preencher (R-19; specs/009)', async () => {
    await sent(2);
    fill(2, ['AUT2', 'Maquininha Fictícia', 100, 'Comercial Fictício 1']);
    await round();
    expect(columnJ('toCharge', 2)).toBe('Retorno incompleto: falta a situação da cobrança');
    expect((await commercial(2)).returns).toEqual([]);

    fill(2, [
      'AUT2',
      'Maquininha Fictícia',
      100,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      SERIAL_2026_11_19,
    ]);
    await round();
    expect((await commercial(2)).returns[0]?.state).toBe('awaiting_validation');
  });

  it('mudar só a data é mudança do retorno: o anterior fica substituído', async () => {
    fill(1, [
      'AUT1',
      'Maquininha Fictícia',
      655,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      '18/11/2026',
    ]);
    expect(await round()).toMatchObject({ returnsChanged: 1 });
    expect((await commercial(1)).returns.map((row) => [row.state, row.chargeDate])).toEqual([
      ['awaiting_validation', '2026-11-18'],
      ['superseded', '2026-11-19'],
    ]);
  });

  it('data que não é data: problema na coluna J, nada muda na reserva', async () => {
    await sent(3);
    fill(3, [
      'AUT3',
      'Maquininha Fictícia',
      10,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      'ontem',
    ]);
    await round();
    expect(columnJ('toCharge', 3)).toBe('Retorno não entendido: data da cobrança não entendida');
    expect((await commercial(3)).returns).toEqual([]);
  });
});

describe('relatos "Cobrada no Hunit" e "Cancelada" (US2, FR-007a a FR-007c, FR-012)', () => {
  it('"Cobrada no Hunit" com o responsável: relato, sem retorno a validar; J laranja', async () => {
    await sent(11);
    fill(11, ['', '', '', 'Comercial Fictício 2', 'Cobrada no Hunit', SERIAL_2026_11_19]);
    expect(await round()).toMatchObject({ returnsReceived: 1 });
    await round();

    const detail = await commercial(11);
    expect(detail.returns).toEqual([]);
    expect(detail.report).toMatchObject({
      kind: 'charged_in_hunit',
      situationText: 'Cobrada no Hunit',
      chargedBy: 'Comercial Fictício 2',
      chargeDate: '2026-11-19',
      hunitStatus: 'awaiting',
    });
    // O histórico novo traz o relato; a lista da 1.8.0 continua sem os tipos novos (R-02).
    expect(detail.history[0]).toMatchObject({
      type: 'report_received',
      actor: { kind: 'commercial_sheet' },
      reason: 'Cobrada no Hunit',
    });
    expect(detail.events.some((event) => event.type === ('report_received' as never))).toBe(false);
    expect((await reservation(11)).commercial?.report?.kind).toBe('charged_in_hunit');
    expect(columnJ('toCharge', 11)).toBe('Aguardando verificação no Hunit');
  });

  it('a situação manda: relato com os quatro campos preenchidos continua relato', async () => {
    await sent(12);
    fill(12, [
      'AUT12',
      'Maquininha Fictícia',
      50,
      'Comercial Fictício 2',
      'cobrado no HUNIT',
      SERIAL_2026_11_19,
    ]);
    await round();
    expect((await commercial(12)).returns).toEqual([]);
    expect((await storedReport(12))?.situationText).toBe('cobrado no HUNIT');
  });

  it('"Cancelada" com o responsável: "Retornos a validar" e a coluna J em laranja (R-19; specs/009)', async () => {
    await sent(13);
    const before = (await sheetStatus()).awaitingValidation;
    fill(13, ['', '', '', 'Comercial Fictício 1', 'Cancelada']);
    await round();
    await round();
    expect(columnJ('toCharge', 13)).toBe('Cancelada: aguardando validação do Financeiro');
    const status = await sheetStatus();
    expect(status.reports).toContainEqual(
      expect.objectContaining({
        hotelCode: 'hml_um',
        reservationNumber: number(13),
        situationText: 'Cancelada',
        chargedBy: 'Comercial Fictício 1',
        chargeDate: null,
      }),
    );
    expect(status.awaitingValidation).toBe(before + 1);
    const report = (await commercial(13)).report;
    expect(report?.hunitStatus).toBeNull();
    expect(report?.validation).toMatchObject({ state: 'awaiting_validation', decidedBy: null });
    // A reserva continua pendente até o Financeiro decidir.
    expect((await reservation(13)).noCharge).toBeNull();
  });

  it('"Cobrada no Hunit" sem responsável: incompleto, pedindo só o responsável (specs/009)', async () => {
    await sent(14);
    fill(14, ['', '', '', '', 'Cobrada no Hunit']);
    await round();
    expect(columnJ('toCharge', 14)).toBe('Retorno incompleto: falta o responsável pela cobrança');
    expect(await storedReport(14)).toBeNull();
  });

  it('mudar o responsável renova a leitura (report_changed); a reserva volta a aguardar', async () => {
    const before = await storedReport(11);
    fill(11, ['', '', '', 'Comercial Fictício 4', 'Cobrada no Hunit', SERIAL_2026_11_19]);
    expect(await round()).toMatchObject({ returnsChanged: 1 });
    const after = await storedReport(11);
    expect(after?.chargedBy).toBe('Comercial Fictício 4');
    expect(after?.readAt.getTime()).toBeGreaterThan(before?.readAt.getTime() ?? 0);
    expect((await commercial(11)).history[0]?.type).toBe('report_changed');
    // Sem mudança, nada acontece.
    expect(await round()).toMatchObject({ returnsReceived: 0, returnsChanged: 0 });
  });

  it('trocar a situação para um retorno comum tira o relato (report_cleared) e cria o retorno', async () => {
    fill(12, [
      'AUT12',
      'Maquininha Fictícia',
      50,
      'Comercial Fictício 2',
      'Cobrada na maquininha',
      SERIAL_2026_11_19,
    ]);
    await round();
    expect(await storedReport(12)).toBeNull();
    const detail = await commercial(12);
    expect(detail.returns[0]?.state).toBe('awaiting_validation');
    expect(detail.history.map((event) => event.type)).toEqual(
      expect.arrayContaining(['report_cleared', 'return_received']),
    );
  });

  it('virar relato substitui o retorno aguardando validação', async () => {
    fill(2, ['', '', '', 'Comercial Fictício 1', 'Cancelada']);
    await round();
    const [row] = await test.database.db
      .select({ state: commercialReturns.state })
      .from(commercialReturns)
      .where(eq(commercialReturns.reservationNumber, number(2)));
    expect(row?.state).toBe('superseded');
    expect((await storedReport(2))?.kind).toBe('cancelled');
  });

  it('apagar a situação e o resto tira o relato', async () => {
    fill(13, ['', '', '', '', '', '']);
    await round();
    expect(await storedReport(13)).toBeNull();
    expect((await sheetStatus()).reports.map((report) => report.reservationNumber)).not.toContain(
      number(13),
    );
    expect((await commercial(13)).history[0]?.type).toBe('report_cleared');
  });

  it('linha reconstruída devolve o relato às colunas K a P, com a data como data', async () => {
    const index = test.sheet?.rowIndexOf('toCharge', HOTEL, number(11)) ?? -1;
    test.sheet?.deleteRow('toCharge', index);
    await round();
    expect(
      test.sheet
        ?.rows('toCharge')
        .find((row) => row[1] === number(11))
        ?.slice(10),
    ).toEqual(['', '', '', 'Comercial Fictício 4', 'Cobrada no Hunit', SERIAL_2026_11_19]);
  });
});

describe('confirmação sem bloqueio pela data (FR-011, SC-003)', () => {
  it('confirma um retorno com a data de hoje, pela rota única e pelo lote', async () => {
    const today = new Date();
    const serialToday = Math.floor((today.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
    for (const n of [21, 22]) {
      await sent(n);
      fill(n, [
        `AUT${n}`,
        'Maquininha Fictícia',
        300,
        'Comercial Fictício 1',
        'Cobrada na maquininha',
        serialToday,
      ]);
    }
    await round();

    const returnId = (await commercial(21)).returns[0]?.id ?? '';
    const single = await test.app.inject({
      method: 'POST',
      url: `/v1/commercial-returns/${returnId}/confirm`,
      headers: operator.headers,
    });
    expect(single.statusCode).toBe(200);
    expect(single.json<components['schemas']['ReservationTreatment']>().situation).toBe(
      'proof_sent',
    );

    const batch = await test.app.inject({
      method: 'POST',
      url: '/v1/commercial-returns/confirm',
      headers: operator.headers,
      payload: { reservations: [key(22)] },
    });
    expect(batch.statusCode).toBe(200);
    expect(batch.json<components['schemas']['ConfirmationBatchResult']>().items[0]?.outcome).toBe(
      'confirmed',
    );
  });
});

describe('fila "Cobradas no Hunit": situação na coluna J pela leitura no Hunit (US3, R-07)', () => {
  it('lida e o Hunit mostra a cobrança: "Cobrança confirmada no Hunit" e a linha vai para "Concluídas"', async () => {
    await sent(31);
    fill(31, ['', '', '', 'Comercial Fictício 1', 'Cobrada no Hunit', SERIAL_2026_11_19]);
    await round();
    await hunitRead(31, 'virtual_card_already_charged');
    await round();
    expect(columnJ('done', 31)).toBe('Cobrança confirmada no Hunit');
    expect((await commercial(31)).report?.hunitStatus).toBe('confirmed');
    expect((await storedReport(31))?.settledResult).toBe('confirmed');
  });

  it('lida e o Hunit não mostra a cobrança: a coluna J recusa com o motivo; continua em "A cobrar"', async () => {
    await sent(32);
    fill(32, ['', '', '', 'Comercial Fictício 1', 'Cobrada no Hunit', SERIAL_2026_11_19]);
    await round();
    await hunitRead(32, 'virtual_card_pending_charge');
    await round();
    expect(columnJ('toCharge', 32)).toBe(`Recusado pelo Financeiro: ${HUNIT_NOT_FOUND_REASON}`);
    expect((await commercial(32)).report?.hunitStatus).toBe('not_found');
  });

  it('cancelada sem cobrança no Hunit também é "não encontrada" (US3-6a); a linha vai para "Concluídas"', async () => {
    await sent(33);
    fill(33, ['', '', '', 'Comercial Fictício 1', 'Cobrada no Hunit', SERIAL_2026_11_19]);
    await round();
    await hunitRead(33, 'cancelled_no_charge');
    await round();
    expect(columnJ('done', 33)).toBe(`Recusado pelo Financeiro: ${HUNIT_NOT_FOUND_REASON}`);
    expect((await commercial(33)).report?.hunitStatus).toBe('not_found');
  });
});

describe('"Cancelada" validada pelo Financeiro (homologação, R-19; spec FR-007c)', () => {
  type Problem = { code: string; reason?: string };

  async function decide(
    n: number,
    action: 'confirm' | 'reject',
    reason?: string,
    client = operator,
  ) {
    return test.app.inject({
      method: 'POST',
      url: `/v1/reservations/hml_um/${number(n)}/commercial/cancellation/${action}`,
      headers: client.headers,
      ...(reason !== undefined && { payload: { reason } }),
    });
  }

  async function cancelled(n: number, text = 'Cancelada'): Promise<void> {
    await sent(n);
    fill(n, ['', '', '', 'Comercial Fictício 1', text]);
    await round();
  }

  const awaitingNumbers = async () =>
    (await sheetStatus()).reports.map((report) => report.reservationNumber);

  it('confirmar marca a reserva como cancelada sem cobrança e a linha vai para "Concluídas"', async () => {
    await cancelled(40, 'Cancelada na Expedia');
    expect(await awaitingNumbers()).toContain(number(40));
    expect((await decide(40, 'confirm', undefined, reader)).statusCode).toBe(403);

    const response = await decide(40, 'confirm');
    expect(response.statusCode, response.body).toBe(200);
    expectMatchesContract('confirmCommercialCancellation', response);
    const body = response.json<Reservation>();
    expect(body.treatment.detailedSituation).toBe('cancelled_no_charge');
    expect(body.noCharge?.note).toBe('Situação informada pelo Comercial: Cancelada na Expedia');
    expect(await awaitingNumbers()).not.toContain(number(40));
    const detail = await commercial(40);
    expect(detail.report?.validation).toMatchObject({ state: 'confirmed', rejectionReason: null });
    expect(detail.report?.validation?.decidedBy).toBeTruthy();
    expect(detail.history[0]?.type).toBe('cancellation_confirmed');
    // O app 0.3 não recebe o tipo novo (R-02).
    expect(detail.events.some((event) => event.type === ('cancellation_confirmed' as never))).toBe(
      false,
    );
    await round();
    expect(columnJ('done', 40)).toBe('Cancelada sem cobrança pelo Financeiro');

    // Já decidida: não há o que confirmar.
    const again = await decide(40, 'confirm');
    expect(again.statusCode).toBe(409);
    expect(again.json<Problem>().code).toBe('no_cancellation_awaiting_validation');
  });

  it('desfazer a marcação devolve a "Cancelada" para validar', async () => {
    const markId = (await reservation(40)).noCharge?.id ?? '';
    const undone = await test.app.inject({
      method: 'POST',
      url: `/v1/reservations/hml_um/${number(40)}/no-charge/undo`,
      headers: operator.headers,
      payload: { markId },
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await awaitingNumbers()).toContain(number(40));
    expect((await commercial(40)).report?.validation?.state).toBe('awaiting_validation');
    await round();
    expect(columnJ('toCharge', 40)).toBe('Cancelada: aguardando validação do Financeiro');
  });

  it('recusar pede o motivo, que vai para a coluna J; o Comercial muda a linha e volta a validar', async () => {
    await cancelled(41);
    const empty = await decide(41, 'reject', '');
    expect(empty.statusCode).toBe(400);

    const response = await decide(41, 'reject', 'Hóspede fez check-in');
    expect(response.statusCode, response.body).toBe(200);
    expectMatchesContract('rejectCommercialCancellation', response);
    expect(response.json<Reservation>().noCharge).toBeNull();
    expect(await awaitingNumbers()).not.toContain(number(41));
    const detail = await commercial(41);
    expect(detail.report?.validation).toMatchObject({
      state: 'rejected',
      rejectionReason: 'Hóspede fez check-in',
    });
    expect(detail.history[0]).toMatchObject({
      type: 'cancellation_rejected',
      reason: 'Hóspede fez check-in',
    });
    await round();
    expect(columnJ('toCharge', 41)).toBe('Recusado pelo Financeiro: Hóspede fez check-in');

    // O Comercial muda a linha: versão nova, volta a aguardar.
    fill(41, ['', '', '', 'Comercial Fictício 1', 'Cancelada no canal']);
    await round();
    expect(await awaitingNumbers()).toContain(number(41));
    expect((await commercial(41)).report?.validation?.state).toBe('awaiting_validation');
  });

  it('reserva que não aceita a marcação: 409 com o motivo, e nada muda', async () => {
    await cancelled(42);
    await test.database.db
      .update(reservations)
      .set({ classification: 'invoiced' })
      .where(
        and(eq(reservations.hotelCode, 'hml_um'), eq(reservations.reservationNumber, number(42))),
      );
    const response = await decide(42, 'confirm');
    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>()).toMatchObject({
      code: 'no_charge_not_accepted',
      reason: 'not_accepting',
    });
    expect((await commercial(42)).report?.validation?.state).toBe('awaiting_validation');
  });

  it('lote: só com includeCancellations a "Cancelada" é confirmada; a que não aceita fica de fora', async () => {
    await cancelled(43);
    const batch = (includeCancellations?: boolean) =>
      test.app.inject({
        method: 'POST',
        url: '/v1/commercial-returns/confirm',
        headers: operator.headers,
        payload: {
          reservations: [key(43), key(42)],
          ...(includeCancellations !== undefined && { includeCancellations }),
        },
      });

    // Sem o campo (app 0.3), como antes: a "Cancelada" fica de fora.
    const old = await batch();
    expect(old.json<{ items: Array<{ reason: string | null }> }>().items[0]?.reason).toBe(
      'no_return_awaiting_validation',
    );

    const response = await batch(true);
    expectMatchesContract('confirmCommercialReturns', response);
    const items = response.json<{ items: Array<{ outcome: string; reason: string | null }> }>()
      .items;
    expect(items[0]).toMatchObject({ outcome: 'confirmed', reason: null });
    expect(items[1]).toMatchObject({ outcome: 'ignored', reason: 'cancellation_not_accepted' });
    expect((await reservation(43)).treatment.detailedSituation).toBe('cancelled_no_charge');
  });
});
