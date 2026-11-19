/**
 * Testes de contrato da US4 da feature 003 (T036): filtros `treatmentStatus` e `pendingCharge`
 * ("Falta cobrar") combinados com os filtros existentes, o perfil consulta e o tempo do filtro
 * com volume (SC-006, SC-008). Todos os dados são fictícios.
 */
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract, contractOperations } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import { attach, emlFile, pdfFile, type ReservationKey } from '../helpers/treatments.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;
let executionId: string;

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;

  await insertHotel(db, { code: 'H1', name: 'Hotel Um' });
  await insertHotel(db, { code: 'H2', name: 'Hotel Dois' });
  executionId = (await insertExecution(db)).id;
  const base = { lastExecutionId: executionId };
  const h1 = { ...base, hotelCode: 'H1' };

  // Pendentes: sem tratativa, Enviada e Cobrada.
  await insertReservation(db, { ...h1, reservationNumber: 'PEND-SEM' });
  await insertReservation(db, { ...h1, reservationNumber: 'PEND-ENV', checkIn: '2026-12-10' });
  await insertReservation(db, { ...h1, reservationNumber: 'PEND-COB' });
  await insertReservation(db, {
    ...base,
    hotelCode: 'H2',
    reservationNumber: 'PEND-SEM-H2',
    reservationStatus: 'cancelled',
  });
  // Outras classificações que exigem cobrança.
  await insertReservation(db, {
    ...h1,
    reservationNumber: 'MAQ-SEM',
    classification: 'charge_at_terminal',
  });
  await insertReservation(db, {
    ...h1,
    reservationNumber: 'ERR-COB',
    classification: 'virtual_card_charge_error',
  });
  // Classificações que não exigem cobrança.
  await insertReservation(db, { ...h1, reservationNumber: 'FAT', classification: 'invoiced' });
  await insertReservation(db, {
    ...h1,
    reservationNumber: 'JA-COB',
    classification: 'virtual_card_already_charged',
  });

  const key = (reservationNumber: string): ReservationKey => ({
    hotelCode: 'H1',
    reservationNumber,
  });
  await attach(test, operator, key('PEND-ENV'), 'request', 'pedido.eml', emlFile('env'));
  await attach(test, operator, key('PEND-COB'), 'request', 'pedido.eml', emlFile('cob'));
  await attach(test, operator, key('PEND-COB'), 'proof', 'comprovante.pdf', pdfFile('cob'));
  await attach(test, operator, key('ERR-COB'), 'proof', 'comprovante.pdf', pdfFile('err'));
  await test.app.inject({
    method: 'PUT',
    url: '/v1/reservations/H1/ERR-COB/manual-amount',
    headers: operator.headers,
    payload: { amount: '777.70' },
  });
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

async function numbers(query: string): Promise<string[]> {
  const response = await list(query);
  expect(response.statusCode).toBe(200);
  expectMatchesContract('listReservations', response);
  return response
    .json<{ items: ReservationKey[] }>()
    .items.map((item) => item.reservationNumber)
    .sort();
}

describe('GET /v1/reservations?treatmentStatus=', () => {
  it('filtra por cada situação da tratativa', async () => {
    expect(await numbers('treatmentStatus=charged')).toEqual(['ERR-COB', 'PEND-COB']);
    expect(await numbers('treatmentStatus=sent')).toEqual(['PEND-ENV']);
    expect(await numbers('treatmentStatus=none')).toEqual([
      'FAT',
      'JA-COB',
      'MAQ-SEM',
      'PEND-SEM',
      'PEND-SEM-H2',
    ]);
  });

  it('aceita mais de uma situação', async () => {
    expect(await numbers('treatmentStatus=sent&treatmentStatus=charged')).toEqual([
      'ERR-COB',
      'PEND-COB',
      'PEND-ENV',
    ]);
  });

  it('combina com classificação, hotel, período e situação da reserva', async () => {
    const pending = 'classification=virtual_card_pending_charge';
    // "pendente de cobrança" + "sem tratativa": as pendentes em que ninguém agiu (SC-008).
    expect(await numbers(`${pending}&treatmentStatus=none`)).toEqual(['PEND-SEM', 'PEND-SEM-H2']);
    expect(await numbers(`${pending}&treatmentStatus=none&hotelCode=H1`)).toEqual(['PEND-SEM']);
    expect(await numbers(`${pending}&treatmentStatus=none&reservationStatus=cancelled`)).toEqual([
      'PEND-SEM-H2',
    ]);
    expect(
      await numbers('treatmentStatus=sent&checkInFrom=2026-12-01&checkInTo=2026-12-31'),
    ).toEqual(['PEND-ENV']);
    expect(await numbers('treatmentStatus=sent&checkInTo=2026-11-30')).toEqual([]);
    // O filtro por classificação continua mostrando a classificação calculada (FR-002).
    expect(await numbers(pending)).toEqual(['PEND-COB', 'PEND-ENV', 'PEND-SEM', 'PEND-SEM-H2']);
  });

  it('recusa valor fora da lista', async () => {
    const response = await list('treatmentStatus=cobrada');

    expect(response.statusCode).toBe(400);
    expectMatchesContract('listReservations', response);
  });
});

describe('GET /v1/reservations?pendingCharge= ("Falta cobrar")', () => {
  it('true: exige cobrança e não tem comprovante — inclui as Enviadas e a maquininha', async () => {
    expect(await numbers('pendingCharge=true')).toEqual([
      'MAQ-SEM',
      'PEND-ENV',
      'PEND-SEM',
      'PEND-SEM-H2',
    ]);
  });

  it('false: o complemento', async () => {
    expect(await numbers('pendingCharge=false')).toEqual(['ERR-COB', 'FAT', 'JA-COB', 'PEND-COB']);
  });

  it('combina com os demais filtros', async () => {
    expect(await numbers('pendingCharge=true&hotelCode=H2')).toEqual(['PEND-SEM-H2']);
    expect(await numbers('pendingCharge=true&treatmentStatus=sent')).toEqual(['PEND-ENV']);
    expect(await numbers(`pendingCharge=true&executionId=${executionId}`)).toEqual([]);
  });
});

describe('busca por valor', () => {
  it('acha a reserva pelo valor cobrado informado à mão', async () => {
    expect(await numbers('amount=777.70')).toEqual(['ERR-COB']);
  });
});

describe('perfil consulta (SC-006)', () => {
  it('vê a lista com a tratativa de cada reserva', async () => {
    const response = await list('treatmentStatus=charged&hotelCode=H1');
    const items = response.json<{
      items: Array<{ reservationNumber: string; treatment: { status: string; proof: unknown } }>;
    }>().items;

    expect(items.every((item) => item.treatment.status === 'charged')).toBe(true);
    expect(items.every((item) => item.treatment.proof !== null)).toBe(true);
  });

  it('é recusado em todas as operações de registro das tratativas', async () => {
    const writes = contractOperations.filter(
      (operation) =>
        operation.path.includes('treatment') || operation.path.includes('manual-amount'),
    );
    const nonGet = writes.filter((operation) => operation.method !== 'GET');
    expect(nonGet.map((operation) => operation.operationId).sort()).toEqual([
      'checkTreatmentDocuments',
      'clearManualChargedAmount',
      'confirmTreatmentReview',
      // "Verificar" em lote (specs/005, FR-029).
      'confirmTreatmentReviews',
      'registerTreatmentDocuments',
      'removeTreatmentDocument',
      'revertTreatmentDocument',
      'setManualChargedAmount',
      'uploadTreatmentFile',
    ]);

    for (const operation of nonGet) {
      const url = `/v1${operation.path}`
        .replace('{hotelCode}', 'H1')
        .replace('{reservationNumber}', 'PEND-SEM')
        .replace('{documentId}', '00000000-0000-4000-8000-000000000000');
      const response = await test.app.inject({
        method: operation.method as 'POST' | 'PUT' | 'DELETE',
        url,
        headers: reader.headers,
      });

      expect(response.statusCode, operation.operationId).toBe(403);
      expect(response.json(), operation.operationId).toMatchObject({ code: 'forbidden_for_role' });
    }
  });
});

describe('com volume (SC-008)', () => {
  it('"pendente + sem tratativa" responde em menos de 5 s e traz exatamente as esperadas', async () => {
    const { pool } = test.database;
    await pool.query(`insert into hotels (code, name) values ('VOL', 'Hotel Volume')`);
    // 20 000 reservas pendentes fictícias; as 2 000 primeiras ganham um comprovante.
    await pool.query(
      `insert into reservations (
         hotel_code, reservation_number, channel, check_in, check_out, stay_period, total_amount,
         reservation_status, classification, reason, pre_payment_found, charge_action_visible,
         first_verified_at, last_verified_at, last_execution_id)
       select 'VOL', 'V' || lpad(n::text, 5, '0'), 'Canal', '2026-11-03', '2026-11-05', 'x', 10.00,
         'active', 'virtual_card_pending_charge', 'teste', true, true, now(), now(), $1
       from generate_series(1, 20000) as n`,
      [executionId],
    );
    await pool.query(
      `insert into treatment_files (sha256, content, size_bytes, media_type, uploaded_by_client_id)
       values ($1, $2, 4, 'application/pdf', $3)`,
      ['a'.repeat(64), Buffer.from('%PDF'), operator.id],
    );
    await pool.query(
      `insert into treatment_documents (
         hotel_code, reservation_number, kind, file_sha256, original_name, size_bytes, media_type,
         attached_by_client_id)
       select 'VOL', 'V' || lpad(n::text, 5, '0'), 'proof', $1, 'c.pdf', 4, 'application/pdf', $2
       from generate_series(1, 2000) as n`,
      ['a'.repeat(64), operator.id],
    );
    await pool.query('analyze reservations; analyze treatment_documents;');

    const query =
      'hotelCode=VOL&classification=virtual_card_pending_charge&treatmentStatus=none&limit=500';
    const startedAt = performance.now();
    const first = await list(query);
    const elapsedMs = performance.now() - startedAt;

    expect(first.statusCode).toBe(200);
    expect(elapsedMs).toBeLessThan(5000);

    // Percorre todas as páginas: exatamente as 18 000 sem comprovante.
    let total = 0;
    let lowest: string | undefined;
    let page = first.json<{ items: ReservationKey[]; nextCursor: string | null }>();
    for (;;) {
      total += page.items.length;
      lowest ??= page.items[0]?.reservationNumber;
      const cursor = page.nextCursor;
      if (cursor === null) break;
      page = (await list(`${query}&cursor=${encodeURIComponent(cursor)}`)).json();
    }
    expect(total).toBe(18_000);
    expect(lowest).toBe('V02001');
  }, 60_000);
});
