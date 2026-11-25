/**
 * "Cancelada sem cobrança" do Financeiro (specs/008, US4, T028 e T029; FR-018 a FR-023; research
 * R-08): marcar e desfazer pela API, com o efeito na reserva, nos filtros, no envio e na planilha.
 * Planilha em memória; dados fictícios.
 */
import type { components } from '@hunit/contracts';
import { and, eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLine, refreshCommercialLine } from '../../src/persistence/commercial-repo.js';
import { commercialReports, reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { attach, pdfFile } from '../helpers/treatments.js';

type Reservation = components['schemas']['Reservation'];
type Problem = components['schemas']['Problem'];

const HOTEL = 'Hotel Homologação Um';
let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const number = (n: number) => String(700_000 + n);
const key = (n: number) => ({ hotelCode: 'hml_um', reservationNumber: number(n) });

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  await seedTestHotels(test.database.db);
});

afterAll(async () => {
  await test.close();
});

/** Reserva pendente de cobrança (700 001…), valor R$ 655,00. */
async function pending(
  n: number,
  overrides: Parameters<typeof insertCommercialReservation>[2] = {},
) {
  await insertCommercialReservation(test.database.db, n - 200_000, {
    totalAmount: '655.00',
    ...overrides,
  });
}

function mark(
  n: number,
  body: object = { expectedSituation: 'virtual_card_pending_charge' },
  client = operator,
): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'POST',
    url: `/v1/reservations/hml_um/${number(n)}/no-charge`,
    headers: client.headers,
    payload: body,
  });
}

function undo(n: number, markId: string, client = operator): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'POST',
    url: `/v1/reservations/hml_um/${number(n)}/no-charge/undo`,
    headers: client.headers,
    payload: { markId },
  });
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

async function round() {
  expect((await test.sync?.runRound())?.ok).toBe(true);
}

const sheetRow = (tab: 'toCharge' | 'done', n: number) =>
  test.sheet?.rows(tab).find((row) => row[1] === number(n));

describe('marcar como cancelada sem cobrança (FR-018 a FR-020)', () => {
  it('marca com observação: R$ 0,00, situação "Cancelada sem cobrança", só em "Concluídas"', async () => {
    await pending(1);
    const response = await mark(1, {
      expectedSituation: 'virtual_card_pending_charge',
      note: '  hóspede cancelou antes do check-in  ',
    });
    expect(response.statusCode).toBe(200);
    expectMatchesContract('markReservationNoCharge', response);
    const body = response.json<Reservation>();
    expect(body).toMatchObject({
      classification: 'virtual_card_pending_charge',
      totalAmount: '655.00',
      amountToCharge: '0.00',
      noCharge: {
        note: 'hóspede cancelou antes do check-in',
        previousAmount: '655.00',
        undoneAt: null,
        hunitShowsCharge: false,
      },
      treatment: {
        situation: 'cancelled_no_charge',
        detailedSituation: 'cancelled_no_charge',
        needsReview: false,
        acceptsDocuments: false,
      },
    });
    expect(body.noCharge?.markedBy).toMatch(/^operator-/);
    expect(body.treatment.noChargeHistory).toHaveLength(1);

    const done = await test.app.inject({
      method: 'GET',
      url: `/v1/reservations?quickFilter=done&q=${number(1)}`,
      headers: reader.headers,
    });
    expect(
      done.json<{ items: Reservation[] }>().items.map((item) => item.reservationNumber),
    ).toEqual([number(1)]);
    const stillPending = await test.app.inject({
      method: 'GET',
      url: `/v1/reservations?pendingCharge=true&q=${number(1)}`,
      headers: reader.headers,
    });
    expect(stillPending.json<{ items: Reservation[] }>().items).toEqual([]);
  });

  it('a linha da planilha vai para "Concluídas", com R$ 0,00 e a coluna J do Financeiro', async () => {
    await pending(2);
    await insertLine(test.database.db, key(2));
    await round();
    expect(sheetRow('toCharge', 2)?.[4]).toBe('R$ 655,00');

    expect((await mark(2, { expectedSituation: 'treatment_sent' })).statusCode).toBe(200);
    await round();
    const row = sheetRow('done', 2);
    expect(row?.[4]).toBe('R$ 0,00');
    expect(row?.[7]).toBe('Cancelada sem cobrança');
    expect(row?.[9]).toBe('Cancelada sem cobrança pelo Financeiro');
    expect(sheetRow('toCharge', 2)).toBeUndefined();
  });

  it('não vai mais ao Comercial: a conferência do envio a deixa de fora', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/commercial-dispatches/check',
      headers: operator.headers,
      payload: { reservations: [key(1)] },
    });
    expect(response.json<components['schemas']['CommercialDispatchCheck']>().ignored).toEqual([
      { ...key(1), reason: 'not_accepting' },
    ]);
  });

  it('a situação mudou desde que a pessoa abriu o diálogo: 409 reservation_changed, nada gravado', async () => {
    await pending(3);
    const response = await mark(3, { expectedSituation: 'treatment_sent' });
    expect(response.statusCode).toBe(409);
    expectMatchesContract('markReservationNoCharge', response);
    expect(response.json<Problem>().code).toBe('reservation_changed');
    expect((await reservation(3)).noCharge).toBeNull();
  });

  it('recusa com o motivo: já marcada, concluída, com comprovante, com retorno a validar (FR-022)', async () => {
    // A situação que a pessoa vê é a que o app manda (a da própria reserva).
    const refused = async (n: number, reason: string) => {
      const expectedSituation = (await reservation(n)).treatment.detailedSituation;
      const response = await mark(n, { expectedSituation });
      expect(response.statusCode).toBe(409);
      expectMatchesContract('markReservationNoCharge', response);
      expect(response.json<Problem>()).toMatchObject({ code: 'no_charge_not_accepted', reason });
    };
    await refused(1, 'already_marked');

    await pending(4, { classification: 'virtual_card_already_charged' });
    await refused(4, 'not_accepting');

    await pending(5);
    const attached = await attach(
      test,
      operator,
      key(5),
      'proof',
      'comprovante.pdf',
      pdfFile('no-charge-5'),
    );
    expect(attached.outcome, JSON.stringify(attached)).toBe('registered');
    expect((await reservation(5)).treatment.status).toBe('charged');
    await refused(5, 'has_proof');

    await pending(6);
    await insertLine(test.database.db, key(6));
    await insertReturn(test.database.db, key(6));
    await refused(6, 'return_awaiting_validation');
  });

  it('aceita a reserva enviada sem retorno e a cancelada no Hunit que ainda aceita tratativa', async () => {
    await pending(7, { reservationStatus: 'cancelled' });
    expect((await mark(7)).statusCode).toBe(200);
  });

  it('duas marcações ao mesmo tempo: uma vale, a outra recebe 409', async () => {
    await pending(8);
    const responses = await Promise.all([mark(8), mark(8)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await reservation(8)).treatment.noChargeHistory).toHaveLength(1);
  });

  it('o perfil consulta não marca nem desfaz (403); reserva inexistente, 404', async () => {
    await pending(9);
    expect((await mark(9, undefined, reader)).statusCode).toBe(403);
    expect((await undo(9, '00000000-0000-4000-8000-000000000000', reader)).statusCode).toBe(403);
    const missing = await mark(999);
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('markReservationNoCharge', missing);
  });
});

describe('desfazer (FR-021)', () => {
  it('desfazer: tudo volta, a linha volta para "A cobrar" e o histórico guarda os dois', async () => {
    const markId = (await reservation(2)).noCharge?.id ?? '';
    const response = await undo(2, markId);
    expect(response.statusCode).toBe(200);
    expectMatchesContract('undoReservationNoCharge', response);
    const body = response.json<Reservation>();
    expect(body).toMatchObject({
      amountToCharge: '655.00',
      noCharge: null,
      treatment: { detailedSituation: 'treatment_sent' },
    });
    expect(body.treatment.noChargeHistory[0]).toMatchObject({ id: markId });
    expect(body.treatment.noChargeHistory[0]?.undoneAt).not.toBeNull();
    expect(body.treatment.noChargeHistory[0]?.undoneBy).toMatch(/^operator-/);

    expect((await findLine(test.database.db, key(2)))?.state).toBe('open');
    await round();
    expect(sheetRow('toCharge', 2)?.[4]).toBe('R$ 655,00');
    expect(sheetRow('toCharge', 2)?.[9]).toBe('Aguardando retorno do Comercial');
  });

  it('desfazer de novo, ou outra marcação: 409 no_charge_not_active', async () => {
    const markId = (await reservation(2)).treatment.noChargeHistory[0]?.id ?? '';
    const response = await undo(2, markId);
    expect(response.statusCode).toBe(409);
    expectMatchesContract('undoReservationNoCharge', response);
    expect(response.json<Problem>().code).toBe('no_charge_not_active');
  });

  it('marcar de novo depois de desfazer cria outra marcação', async () => {
    expect((await mark(2, { expectedSituation: 'treatment_sent' })).statusCode).toBe(200);
    expect((await reservation(2)).treatment.noChargeHistory).toHaveLength(2);
  });
});

describe('o Hunit continua valendo por baixo (FR-023)', () => {
  it('uma nova leitura no Hunit muda a classificação, a marcação continua e avisa se o Hunit mostra cobrada', async () => {
    const { db } = test.database;
    await db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({ classification: 'virtual_card_already_charged', lastVerifiedAt: new Date() })
        .where(
          and(eq(reservations.hotelCode, 'hml_um'), eq(reservations.reservationNumber, number(1))),
        );
      await refreshCommercialLine(tx, key(1), new Date());
    });
    expect(await reservation(1)).toMatchObject({
      classification: 'virtual_card_already_charged',
      noCharge: { hunitShowsCharge: true },
      treatment: { detailedSituation: 'cancelled_no_charge' },
    });
  });
});

describe('"Cancelada" do Comercial de reserva marcada (FR-007c, FR-020; homologação, R-19)', () => {
  it('sai de "Retornos a validar" com a marcação e volta ao desfazer', async () => {
    await pending(10);
    await insertLine(test.database.db, key(10));
    await test.database.db.insert(commercialReports).values({
      ...key(10),
      kind: 'cancelled',
      situationText: 'Cancelada',
      chargedBy: null,
      readAt: new Date(),
      validationState: 'awaiting_validation',
    });
    const reports = async () =>
      (
        await test.app.inject({
          method: 'GET',
          url: '/v1/commercial-sheet',
          headers: reader.headers,
        })
      )
        .json<components['schemas']['CommercialSheetStatus']>()
        .reports.map((report) => report.reservationNumber);

    expect(await reports()).toContain(number(10));
    const marked = await mark(10, { expectedSituation: 'treatment_sent' });
    expect(marked.statusCode).toBe(200);
    expect(await reports()).not.toContain(number(10));
    const undone = await undo(10, marked.json<Reservation>().noCharge?.id ?? '');
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await reports()).toContain(number(10));
  });
});

it('nenhum dado do hóspede na planilha (FR-010)', () => {
  expect(JSON.stringify(test.sheet?.rows('done') ?? [])).not.toContain('Hóspede Fictício');
  expect(HOTEL).toBeTruthy();
});
