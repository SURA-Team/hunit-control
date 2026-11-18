/**
 * Testes de contrato dos ajustes da homologação da feature 003 (T060; FR-002, FR-002a, FR-015;
 * research R-14): a situação da reserva numa coluna só, o filtro `situation`, o alerta "Verificar"
 * (`needsReview`) e a confirmação dele. Todos os dados são fictícios.
 */
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import {
  attach,
  emlFile,
  pdfFile,
  reservationPath,
  treatmentDetail,
  type ReservationKey,
  type TreatmentBody,
} from '../helpers/treatments.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const key = (reservationNumber: string): ReservationKey => ({ hotelCode: 'H1', reservationNumber });

/** O Hunit muda a situação da reserva, como uma nova verificação faria (`status_changed_at`). */
async function reclassify(reservationNumber: string, classification: string, changedAt: string) {
  await test.database.pool.query(
    `update reservations set classification = $1, status_changed = true,
       previous_classification = classification, status_changed_at = $2::timestamptz
     where hotel_code = 'H1' and reservation_number = $3`,
    [classification, changedAt, reservationNumber],
  );
}

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;

  await insertHotel(db, { code: 'H1', name: 'Hotel Um' });
  const execution = await insertExecution(db);
  const h1 = { lastExecutionId: execution.id, hotelCode: 'H1' };

  await insertReservation(db, { ...h1, reservationNumber: 'PEND-SEM' });
  await insertReservation(db, { ...h1, reservationNumber: 'PEND-ENV' });
  await insertReservation(db, { ...h1, reservationNumber: 'PEND-COB' });
  await insertReservation(db, { ...h1, reservationNumber: 'ENV-JA' });
  await insertReservation(db, { ...h1, reservationNumber: 'COB-CANC' });
  await insertReservation(db, {
    ...h1,
    reservationNumber: 'JA-SEM',
    classification: 'virtual_card_already_charged',
  });
  await insertReservation(db, { ...h1, reservationNumber: 'FAT', classification: 'invoiced' });

  await attach(test, operator, key('PEND-ENV'), 'request', 'pedido.eml', emlFile('env'));
  await attach(test, operator, key('PEND-COB'), 'proof', 'comprovante.pdf', pdfFile('cob'));
  await attach(test, operator, key('ENV-JA'), 'request', 'pedido.eml', emlFile('ja'));
  await attach(test, operator, key('COB-CANC'), 'proof', 'comprovante.pdf', pdfFile('canc'));

  // Depois das tratativas, o Hunit passa a mostrar outra situação.
  await reclassify('ENV-JA', 'virtual_card_already_charged', '2026-11-16T10:00:00Z');
  await reclassify('COB-CANC', 'cancelled_no_charge', '2026-11-16T10:00:00Z');
});

afterAll(async () => {
  await test.close();
});

function list(query: string, client = reader): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'GET',
    url: `/v1/reservations?${query}`,
    headers: client.headers,
  });
}

interface Item extends ReservationKey {
  classification: string;
  treatment: TreatmentBody;
}

async function items(query: string): Promise<Item[]> {
  const response = await list(query);
  expect(response.statusCode, response.body).toBe(200);
  expectMatchesContract('listReservations', response);
  return response.json<{ items: Item[] }>().items;
}

const numbersOf = (rows: Item[]) => rows.map((row) => row.reservationNumber).sort();

function confirm(reservationNumber: string, client = operator): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'POST',
    url: `${reservationPath(key(reservationNumber))}/treatment/review`,
    headers: client.headers,
  });
}

describe('situação da reserva (FR-002)', () => {
  it('cada reserva tem a situação da coluna única', async () => {
    const all = await items('hotelCode=H1');
    const situationOf = Object.fromEntries(
      all.map((row) => [row.reservationNumber, row.treatment.situation]),
    );

    expect(situationOf).toEqual({
      'PEND-SEM': 'virtual_card_pending_charge',
      'PEND-ENV': 'treatment_sent',
      'PEND-COB': 'proof_sent',
      // Só tratativa e o Hunit passou a "já cobrada": vale a do Hunit (com o alerta).
      'ENV-JA': 'virtual_card_already_charged',
      // O comprovante sempre prevalece; o status do Hunit muda só no detalhe.
      'COB-CANC': 'proof_sent',
      'JA-SEM': 'virtual_card_already_charged',
      FAT: 'invoiced',
    });
    const covCanc = all.find((row) => row.reservationNumber === 'COB-CANC');
    expect(covCanc?.classification).toBe('cancelled_no_charge');
  });

  it('o filtro devolve exatamente as reservas que a coluna mostra com cada situação', async () => {
    const all = await items('hotelCode=H1');
    const situations = [...new Set(all.map((row) => row.treatment.situation))];

    for (const situation of situations) {
      const expected = numbersOf(all.filter((row) => row.treatment.situation === situation));
      expect(numbersOf(await items(`hotelCode=H1&situation=${situation}`)), situation).toEqual(
        expected,
      );
    }
  });

  it('"Pendente de cobrança" traz só as pendentes sem tratativa e sem comprovante (SC-008)', async () => {
    expect(numbersOf(await items('situation=virtual_card_pending_charge'))).toEqual(['PEND-SEM']);
  });

  it('aceita mais de uma situação e recusa valor fora da lista', async () => {
    expect(numbersOf(await items('situation=proof_sent&situation=treatment_sent'))).toEqual([
      'COB-CANC',
      'PEND-COB',
      'PEND-ENV',
    ]);

    const response = await list('situation=cobrada');
    expect(response.statusCode).toBe(400);
    expectMatchesContract('listReservations', response);
  });
});

describe('alerta "Verificar" (FR-002a)', () => {
  it('aparece só na reserva com tratativa que o Hunit passou a não exigir cobrança', async () => {
    const all = await items('hotelCode=H1');
    expect(
      all.filter((row) => row.treatment.needsReview).map((row) => row.reservationNumber),
    ).toEqual(['ENV-JA']);
    expect(numbersOf(await items('needsReview=true'))).toEqual(['ENV-JA']);
    expect(numbersOf(await items('needsReview=false'))).not.toContain('ENV-JA');
  });

  it('perfil consulta não confirma', async () => {
    const response = await confirm('ENV-JA', reader);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'forbidden_for_role' });
  });

  it('confirmar tira o alerta, mantém a tratativa e fica no histórico', async () => {
    const response = await confirm('ENV-JA');

    expect(response.statusCode).toBe(200);
    expectMatchesContract('confirmTreatmentReview', response);
    expect(response.json<TreatmentBody>()).toMatchObject({
      status: 'sent',
      situation: 'virtual_card_already_charged',
      needsReview: false,
    });
    expect(response.json<TreatmentBody>().request).not.toBeNull();
    expect(numbersOf(await items('needsReview=true'))).toEqual([]);

    const detail = await treatmentDetail(test, reader, key('ENV-JA'));
    expect(detail.events[0]).toMatchObject({
      type: 'review_confirmed',
      classification: 'virtual_card_already_charged',
      client: operator.name,
    });
  });

  it('sem alerta, confirmar responde 200 sem gravar nada', async () => {
    const before = (await treatmentDetail(test, reader, key('ENV-JA'))).events.length;

    expect((await confirm('ENV-JA')).statusCode).toBe(200);
    expect((await confirm('PEND-SEM')).statusCode).toBe(200);
    expect((await treatmentDetail(test, reader, key('ENV-JA'))).events).toHaveLength(before);
    expect((await treatmentDetail(test, reader, key('PEND-SEM'))).events).toHaveLength(0);
  });

  it('volta se o Hunit mudar de novo depois da confirmação; some se voltar a exigir cobrança', async () => {
    await reclassify('ENV-JA', 'cancelled_no_charge', '2999-01-01T00:00:00Z');
    expect(numbersOf(await items('needsReview=true'))).toEqual(['ENV-JA']);

    await reclassify('ENV-JA', 'virtual_card_pending_charge', '2999-01-02T00:00:00Z');
    const [row] = await items('needsReview=false&situation=treatment_sent');
    expect(row).toMatchObject({ reservationNumber: 'ENV-JA' });
    expect(row?.treatment.needsReview).toBe(false);
  });

  it('reserva inexistente → 404', async () => {
    const response = await confirm('NAO-EXISTE');
    expect(response.statusCode).toBe(404);
    expectMatchesContract('confirmTreatmentReview', response);
  });
});
