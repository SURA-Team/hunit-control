/**
 * Testes de contrato da US3 da feature 003 (T041): conferência sem gravar (`check`) e registro
 * do mesmo documento em várias reservas, com o desfecho de cada uma (FR-006, FR-011). Todos os
 * dados são fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import {
  attach,
  pdfFile,
  registerDocuments,
  treatmentDetail,
  uploadedFile,
  type OutcomeBody,
  type ReservationKey,
} from '../helpers/treatments.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const H = 'H1';
const key = (reservationNumber: string): ReservationKey => ({ hotelCode: H, reservationNumber });

interface CheckBody {
  items: OutcomeBody[];
  acceptedCount: number;
  replacingCount: number;
  ignoredCount: number;
  acceptedTotalAmount: string;
}

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;

  await insertHotel(db, { code: H, name: 'Hotel Um' });
  await insertHotel(db, { code: 'H2', name: 'Hotel Dois' });
  const { id: lastExecutionId } = await insertExecution(db);
  const base = { hotelCode: H, lastExecutionId };

  await insertReservation(db, { ...base, reservationNumber: 'A1', totalAmount: '100.10' });
  await insertReservation(db, { ...base, reservationNumber: 'A2', totalAmount: '200.20' });
  await insertReservation(db, {
    ...base,
    hotelCode: 'H2',
    reservationNumber: 'A3',
    totalAmount: '0.70',
  });
  await insertReservation(db, {
    ...base,
    reservationNumber: 'COB',
    classification: 'virtual_card_already_charged',
    totalAmount: '999.00',
  });
  await insertReservation(db, { ...base, reservationNumber: 'FALHA', totalAmount: '50.00' });
  await insertReservation(db, { ...base, reservationNumber: 'B1', totalAmount: '10.00' });
  await insertReservation(db, { ...base, reservationNumber: 'B2', totalAmount: '20.00' });
});

afterAll(async () => {
  await test.close();
});

const check = (kind: 'request' | 'proof', reservations: ReservationKey[], client = operator) =>
  test.app.inject({
    method: 'POST',
    url: '/v1/treatment-documents/check',
    headers: client.headers,
    payload: { kind, reservations },
  });

async function documentCount(): Promise<number> {
  const { rows } = await test.database.pool.query<{ total: number }>(
    'select count(*)::int as total from treatment_documents',
  );
  return rows[0]?.total ?? 0;
}

describe('POST /v1/treatment-documents/check', () => {
  it('diz o desfecho de cada reserva e os totais, sem gravar nada', async () => {
    await attach(test, operator, key('A2'), 'proof', 'antigo.pdf', pdfFile('a2-antigo'));
    const before = await documentCount();

    const response = await check('proof', [
      key('A1'),
      key('A2'),
      { hotelCode: 'H2', reservationNumber: 'A3' },
      key('COB'),
      key('NAO-EXISTE'),
    ]);

    expect(response.statusCode).toBe(200);
    expectMatchesContract('checkTreatmentDocuments', response);
    const body = response.json<CheckBody>();
    expect(body.items.map((item) => [item.reservationNumber, item.outcome, item.reason])).toEqual([
      ['A1', 'registered', null],
      ['A2', 'replaced', null],
      ['A3', 'registered', null],
      ['COB', 'ignored', 'not_eligible'],
      ['NAO-EXISTE', 'ignored', 'not_found'],
    ]);
    expect(body).toMatchObject({
      acceptedCount: 3,
      replacingCount: 1,
      ignoredCount: 2,
      // 100.10 + 200.20 + 0.70, somados em centavos.
      acceptedTotalAmount: '301.00',
    });
    expect(await documentCount()).toBe(before);
  });

  it('a conferência é por tipo de documento: tratativa não substitui comprovante', async () => {
    const body = (await check('request', [key('A2')])).json<CheckBody>();

    expect(body.items[0]).toMatchObject({ outcome: 'registered' });
    expect(body.replacingCount).toBe(0);
  });

  it('reserva repetida no pedido conta uma vez só', async () => {
    const body = (await check('proof', [key('A1'), key('A1')])).json<CheckBody>();

    expect(body.items).toHaveLength(1);
    expect(body.acceptedTotalAmount).toBe('100.10');
  });

  it('recusa lista vazia, mais de 200 reservas e o perfil consulta', async () => {
    const empty = await check('proof', []);
    expect(empty.statusCode).toBe(400);
    expectMatchesContract('checkTreatmentDocuments', empty);

    const many = Array.from({ length: 201 }, (_unused, index) => key(`N${index}`));
    expect((await check('proof', many)).statusCode).toBe(400);
    expect((await check('proof', many.slice(0, 200))).statusCode).toBe(200);

    const forbidden = await check('proof', [key('A1')], reader);
    expect(forbidden.statusCode).toBe(403);
    expectMatchesContract('checkTreatmentDocuments', forbidden);
  });
});

describe('POST /v1/treatment-documents — lote', () => {
  it('registra nas que aceitam, ignora as demais e usa o mesmo batchId nos eventos', async () => {
    const file = await uploadedFile(test, operator, 'lote.pdf', pdfFile('lote'));
    const response = await registerDocuments(test, operator, {
      kind: 'proof',
      fileId: file.fileId,
      fileName: 'lote.pdf',
      reservations: [
        key('A1'),
        key('A2'),
        { hotelCode: 'H2', reservationNumber: 'A3' },
        key('COB'),
        key('NAO-EXISTE'),
      ],
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('registerTreatmentDocuments', response);
    const body = response.json<{ batchId: string; items: OutcomeBody[] }>();
    expect(body.items.map((item) => [item.reservationNumber, item.outcome, item.reason])).toEqual([
      ['A1', 'registered', null],
      ['A2', 'replaced', null],
      ['A3', 'registered', null],
      ['COB', 'ignored', 'not_eligible'],
      ['NAO-EXISTE', 'ignored', 'not_found'],
    ]);

    for (const reservation of [
      key('A1'),
      key('A2'),
      { hotelCode: 'H2', reservationNumber: 'A3' },
    ]) {
      const detail = await treatmentDetail(test, reader, reservation);
      expect(detail.treatment.status).toBe('charged');
      expect(detail.events[0]?.batchId).toBe(body.batchId);
    }

    // O mesmo arquivo em várias reservas é guardado uma vez só (research R-01).
    const { rows } = await test.database.pool.query(
      'select count(*)::int as total from treatment_files where sha256 = $1',
      [file.fileId],
    );
    expect(rows[0]).toEqual({ total: 1 });
  });

  it('a reserva que falha fica como estava; as outras do lote são gravadas', async () => {
    // Um erro de banco só para a reserva FALHA, como aconteceria numa falha inesperada.
    await test.database.pool.query(`
      create function fail_for_test() returns trigger language plpgsql as $$
      begin
        if new.reservation_number = 'FALHA' then raise exception 'falha simulada'; end if;
        return new;
      end $$;
      create trigger fail_for_test before insert on treatment_documents
        for each row execute function fail_for_test();
    `);
    try {
      const file = await uploadedFile(test, operator, 'falha.pdf', pdfFile('falha'));
      const response = await registerDocuments(test, operator, {
        kind: 'proof',
        fileId: file.fileId,
        fileName: 'falha.pdf',
        reservations: [key('B1'), key('FALHA'), key('B2')],
      });

      expect(response.statusCode).toBe(200);
      expectMatchesContract('registerTreatmentDocuments', response);
      const { items } = response.json<{ items: OutcomeBody[] }>();
      expect(items.map((item) => [item.reservationNumber, item.outcome])).toEqual([
        ['B1', 'registered'],
        ['FALHA', 'failed'],
        ['B2', 'registered'],
      ]);
      // O erro interno não vai para o cliente.
      expect(response.body).not.toContain('falha simulada');

      const failed = await treatmentDetail(test, reader, key('FALHA'));
      expect(failed).toMatchObject({ treatment: { status: 'none' }, documents: [], events: [] });
    } finally {
      await test.database.pool.query(
        'drop trigger fail_for_test on treatment_documents; drop function fail_for_test();',
      );
    }
  });

  it('recusa mais de 200 reservas num pedido', async () => {
    const file = await uploadedFile(test, operator, 'muitas.pdf', pdfFile('muitas'));
    const response = await registerDocuments(test, operator, {
      kind: 'proof',
      fileId: file.fileId,
      fileName: 'muitas.pdf',
      reservations: Array.from({ length: 201 }, (_unused, index) => key(`N${index}`)),
    });

    expect(response.statusCode).toBe(400);
    expectMatchesContract('registerTreatmentDocuments', response);
  });
});
