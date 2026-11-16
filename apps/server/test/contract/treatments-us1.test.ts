/**
 * Testes de contrato da US1 da feature 003 (T022): envio do arquivo, registro do comprovante,
 * substituir e reverter, valor cobrado informado à mão, download e histórico. As respostas são
 * validadas contra o `openapi.yaml` 1.5.0 (specs/003, contracts/api-changes.md). Todos os nomes,
 * códigos e arquivos são fictícios.
 */
import { MAX_TREATMENT_FILE_BYTES } from '@hunit/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import {
  attach,
  executableFile,
  getTreatment,
  pdfFile,
  pngFile,
  registerDocuments,
  reservationPath,
  treatmentDetail,
  uploadFile,
  uploadedFile,
  type DocumentBody,
  type OutcomeBody,
  type ReservationKey,
  type TreatmentBody,
} from '../helpers/treatments.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date('2026-11-13T12:00:00.000Z');

let test: TestApp;
let operator: TestClient;
let reader: TestClient;
/** Relógio da API; os testes de prazo o adiantam. */
let clock = START;

const H = 'H1';
const key = (reservationNumber: string): ReservationKey => ({ hotelCode: H, reservationNumber });

beforeAll(async () => {
  test = await createTestApp({ now: () => clock });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;

  await insertHotel(db, { code: H, name: 'Hotel Um' });
  const { id: lastExecutionId } = await insertExecution(db);
  const base = { hotelCode: H, lastExecutionId };

  // Uma reserva por cenário, para os testes não dependerem uns dos outros.
  for (const number of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']) {
    await insertReservation(db, { ...base, reservationNumber: number, totalAmount: '540.00' });
  }
  await insertReservation(db, { ...base, reservationNumber: 'FAT', classification: 'invoiced' });
  await insertReservation(db, {
    ...base,
    reservationNumber: 'COB',
    classification: 'virtual_card_already_charged',
    chargedAmount: '320.00',
  });
  await insertReservation(db, {
    ...base,
    reservationNumber: 'MAQ',
    classification: 'charge_at_terminal',
    prePaymentFound: false,
  });
  await insertReservation(db, {
    ...base,
    reservationNumber: 'ERR',
    classification: 'virtual_card_charge_error',
  });
});

afterAll(async () => {
  await test.close();
});

async function treatmentOf(reservation: ReservationKey): Promise<TreatmentBody> {
  return (await treatmentDetail(test, reader, reservation)).treatment;
}

describe('POST /v1/treatment-files', () => {
  it('recebe o arquivo e devolve o fileId, o tamanho e o tipo decidido pelo conteúdo', async () => {
    const content = pdfFile('envio');
    const response = await uploadFile(test, operator, 'comprovante.pdf', content);

    expect(response.statusCode).toBe(201);
    expectMatchesContract('uploadTreatmentFile', response);
    expect(response.json()).toEqual({
      fileId: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      sizeBytes: content.length,
      mediaType: 'application/pdf',
    });
  });

  it('o mesmo conteúdo enviado de novo devolve o mesmo fileId, sem outra cópia', async () => {
    const content = pngFile('repetido');
    const first = await uploadedFile(test, operator, 'tela.png', content);
    const second = await uploadedFile(test, operator, 'outro-nome.png', content);

    expect(second.fileId).toBe(first.fileId);
    const { rows } = await test.database.pool.query(
      'select count(*)::int as total from treatment_files where sha256 = $1',
      [first.fileId],
    );
    expect(rows[0]).toEqual({ total: 1 });
  });

  it('recusa arquivo vazio com empty_file', async () => {
    const response = await uploadFile(test, operator, 'vazio.pdf', Buffer.alloc(0));

    expect(response.statusCode).toBe(400);
    expectMatchesContract('uploadTreatmentFile', response);
    expect(response.json()).toMatchObject({ code: 'empty_file' });
  });

  it('recusa arquivo acima de 25 MiB com file_too_large', async () => {
    const content = Buffer.alloc(MAX_TREATMENT_FILE_BYTES + 1, 0x20);
    pdfFile().copy(content);
    const response = await uploadFile(test, operator, 'grande.pdf', content);

    expect(response.statusCode).toBe(413);
    expectMatchesContract('uploadTreatmentFile', response);
    expect(response.json()).toMatchObject({ code: 'file_too_large' });
  });

  it.each([
    ['executável renomeado para .pdf', 'boleto.pdf', executableFile()],
    ['extensão fora da lista', 'planilha.xlsx', pdfFile()],
  ])('recusa %s com unsupported_file_type', async (_case, name, content) => {
    const response = await uploadFile(test, operator, name, content);

    expect(response.statusCode).toBe(415);
    expectMatchesContract('uploadTreatmentFile', response);
    expect(response.json()).toMatchObject({ code: 'unsupported_file_type' });
  });

  it('recusa nome com barra e requisição sem o nome', async () => {
    const withSlash = await uploadFile(test, operator, 'pasta/arquivo.pdf', pdfFile());
    expect(withSlash.statusCode).toBe(400);
    expect(withSlash.json()).toMatchObject({ code: 'validation_error' });

    const withoutName = await test.app.inject({
      method: 'POST',
      url: '/v1/treatment-files',
      headers: { ...operator.headers, 'content-type': 'application/octet-stream' },
      payload: pdfFile(),
    });
    expect(withoutName.statusCode).toBe(400);
    expectMatchesContract('uploadTreatmentFile', withoutName);
  });

  it('recusa o perfil consulta', async () => {
    const response = await uploadFile(test, reader, 'comprovante.pdf', pdfFile());

    expect(response.statusCode).toBe(403);
    expectMatchesContract('uploadTreatmentFile', response);
    expect(response.json()).toMatchObject({ code: 'forbidden_for_role' });
  });
});

describe('POST /v1/treatment-documents — comprovante', () => {
  it('registra numa reserva pendente, que passa a Cobrada', async () => {
    const file = await uploadedFile(test, operator, 'comprovante.pdf', pdfFile('p1'));
    const response = await registerDocuments(test, operator, {
      kind: 'proof',
      fileId: file.fileId,
      fileName: 'comprovante.pdf',
      reservations: [key('P1')],
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('registerTreatmentDocuments', response);
    const body = response.json<{ batchId: string; items: OutcomeBody[] }>();
    expect(body.items).toEqual([
      {
        hotelCode: H,
        reservationNumber: 'P1',
        outcome: 'registered',
        reason: null,
        classification: 'virtual_card_pending_charge',
        totalAmount: '540.00',
        documentId: expect.any(String) as string,
      },
    ]);

    const reservation = await test.app.inject({
      method: 'GET',
      url: reservationPath(key('P1')),
      headers: reader.headers,
    });
    expectMatchesContract('getReservation', reservation);
    const view = reservation.json<{ classification: string; treatment: TreatmentBody }>();
    // A classificação calculada não muda; só a situação exibida (FR-002).
    expect(view.classification).toBe('virtual_card_pending_charge');
    expect(view.treatment).toMatchObject({
      status: 'charged',
      request: null,
      proof: {
        kind: 'proof',
        state: 'current',
        fileName: 'comprovante.pdf',
        sizeBytes: file.sizeBytes,
        mediaType: 'application/pdf',
        attachedAt: START.toISOString(),
        attachedBy: operator.name,
        endedAt: null,
        revertibleUntil: null,
      },
      acceptsDocuments: true,
    });
  });

  it('outro comprovante substitui o atual, que fica revertível por 30 dias', async () => {
    const first = await attach(test, operator, key('P2'), 'proof', 'primeiro.pdf', pdfFile('p2a'));
    const second = await attach(test, operator, key('P2'), 'proof', 'segundo.pdf', pdfFile('p2b'));

    expect(first.outcome).toBe('registered');
    expect(second.outcome).toBe('replaced');

    const detail = await treatmentDetail(test, reader, key('P2'));
    expect(detail.treatment.proof).toMatchObject({
      id: second.documentId,
      fileName: 'segundo.pdf',
    });
    const replaced = detail.documents.find((document) => document.id === first.documentId);
    expect(replaced).toMatchObject({
      state: 'replaced',
      endedAt: START.toISOString(),
      endedBy: operator.name,
      revertibleUntil: new Date(START.getTime() + 30 * DAY_MS).toISOString(),
    });
    expect(detail.events.map((event) => event.type)).toEqual(['replaced', 'attached']);
    expect(detail.events[0]).toMatchObject({
      kind: 'proof',
      documentId: second.documentId,
      previousDocumentId: first.documentId,
      client: operator.name,
    });
  });

  it('o mesmo arquivo de novo é ignorado com same_file', async () => {
    const content = pdfFile('p3');
    await attach(test, operator, key('P3'), 'proof', 'comprovante.pdf', content);
    const again = await attach(test, operator, key('P3'), 'proof', 'comprovante.pdf', content);

    expect(again).toMatchObject({ outcome: 'ignored', reason: 'same_file', documentId: null });
    expect((await treatmentDetail(test, reader, key('P3'))).documents).toHaveLength(1);
  });

  it.each([
    ['faturada', 'FAT', 'invoiced'],
    ['já cobrada', 'COB', 'virtual_card_already_charged'],
  ])('recusa reserva %s com not_eligible', async (_case, number, classification) => {
    const outcome = await attach(test, operator, key(number), 'proof', 'c.pdf', pdfFile(number));

    expect(outcome).toMatchObject({ outcome: 'ignored', reason: 'not_eligible', classification });
    expect(await treatmentOf(key(number))).toMatchObject({
      status: 'none',
      acceptsDocuments: false,
    });
  });

  it.each([
    ['cobrar na maquininha', 'MAQ'],
    ['erro na cobrança', 'ERR'],
  ])('aceita reserva %s', async (_case, number) => {
    const outcome = await attach(test, operator, key(number), 'proof', 'c.pdf', pdfFile(number));

    expect(outcome.outcome).toBe('registered');
    expect((await treatmentOf(key(number))).status).toBe('charged');
  });

  it('reserva inexistente é ignorada com not_found', async () => {
    const outcome = await attach(test, operator, key('NAO-EXISTE'), 'proof', 'c.pdf', pdfFile());

    expect(outcome).toMatchObject({ outcome: 'ignored', reason: 'not_found' });
  });

  it('recusa fileId desconhecido com 422 e nome com extensão de outro tipo com 415', async () => {
    const unknown = await registerDocuments(test, operator, {
      kind: 'proof',
      fileId: 'f'.repeat(64),
      fileName: 'comprovante.pdf',
      reservations: [key('P1')],
    });
    expect(unknown.statusCode).toBe(422);
    expectMatchesContract('registerTreatmentDocuments', unknown);
    expect(unknown.json()).toMatchObject({ code: 'file_not_found' });

    const file = await uploadedFile(test, operator, 'comprovante.pdf', pdfFile('tipo'));
    const wrongName = await registerDocuments(test, operator, {
      kind: 'proof',
      fileId: file.fileId,
      fileName: 'comprovante.png',
      reservations: [key('P1')],
    });
    expect(wrongName.statusCode).toBe(415);
    expectMatchesContract('registerTreatmentDocuments', wrongName);
    expect(wrongName.json()).toMatchObject({ code: 'unsupported_file_type' });
  });

  it('recusa o perfil consulta', async () => {
    const response = await registerDocuments(test, reader, {
      kind: 'proof',
      fileId: 'f'.repeat(64),
      fileName: 'comprovante.pdf',
      reservations: [key('P1')],
    });

    expect(response.statusCode).toBe(403);
    expectMatchesContract('registerTreatmentDocuments', response);
  });
});

describe('POST /v1/treatment-documents/{documentId}/revert', () => {
  const revert = (documentId: string | null, client = operator) =>
    test.app.inject({
      method: 'POST',
      url: `/v1/treatment-documents/${documentId ?? ''}/revert`,
      headers: client.headers,
    });

  it('o substituído volta a ser o atual e o que estava atual passa a substituído', async () => {
    const first = await attach(test, operator, key('P4'), 'proof', 'primeiro.pdf', pdfFile('p4a'));
    const second = await attach(test, operator, key('P4'), 'proof', 'segundo.pdf', pdfFile('p4b'));

    const response = await revert(first.documentId);

    expect(response.statusCode).toBe(200);
    expectMatchesContract('revertTreatmentDocument', response);
    expect(response.json<TreatmentBody>().proof).toMatchObject({
      id: first.documentId,
      state: 'current',
      endedAt: null,
    });

    const detail = await treatmentDetail(test, reader, key('P4'));
    expect(detail.documents.find((document) => document.id === second.documentId)).toMatchObject({
      state: 'replaced',
    });
    expect(detail.events[0]).toMatchObject({
      type: 'reverted',
      documentId: first.documentId,
      previousDocumentId: second.documentId,
    });
  });

  it('recusa documento atual e documento com o prazo de 30 dias vencido', async () => {
    const first = await attach(test, operator, key('P5'), 'proof', 'primeiro.pdf', pdfFile('p5a'));
    const second = await attach(test, operator, key('P5'), 'proof', 'segundo.pdf', pdfFile('p5b'));

    const current = await revert(second.documentId);
    expect(current.statusCode).toBe(409);
    expectMatchesContract('revertTreatmentDocument', current);
    expect(current.json()).toMatchObject({ code: 'document_not_revertible' });

    clock = new Date(START.getTime() + 30 * DAY_MS);
    try {
      const expired = await revert(first.documentId);
      expect(expired.statusCode).toBe(409);
      expect(expired.json()).toMatchObject({ code: 'document_not_revertible' });

      const detail = await treatmentDetail(test, reader, key('P5'));
      expect(
        detail.documents.find((document) => document.id === first.documentId)?.revertibleUntil,
      ).toBeNull();
    } finally {
      clock = START;
    }
  });

  it('recusa quando a classificação da reserva deixou de exigir cobrança', async () => {
    const first = await attach(test, operator, key('P6'), 'proof', 'primeiro.pdf', pdfFile('p6a'));
    await attach(test, operator, key('P6'), 'proof', 'segundo.pdf', pdfFile('p6b'));
    await test.database.db
      .update(reservations)
      .set({ classification: 'invoiced' })
      .where(and(eq(reservations.hotelCode, H), eq(reservations.reservationNumber, 'P6')));

    const response = await revert(first.documentId);

    expect(response.statusCode).toBe(409);
    expectMatchesContract('revertTreatmentDocument', response);
    expect(response.json()).toMatchObject({ code: 'not_eligible_for_treatment' });
    // Os documentos já registrados continuam lá (caso-limite da spec).
    expect((await treatmentOf(key('P6'))).status).toBe('charged');
  });

  it('responde 404 para documento inexistente e 403 para o perfil consulta', async () => {
    const missing = await revert('00000000-0000-4000-8000-000000000000');
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('revertTreatmentDocument', missing);

    const forbidden = await revert('00000000-0000-4000-8000-000000000000', reader);
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('valor cobrado informado à mão', () => {
  const setAmount = (reservation: ReservationKey, amount: string, client = operator) =>
    test.app.inject({
      method: 'PUT',
      url: `${reservationPath(reservation)}/manual-amount`,
      headers: client.headers,
      payload: { amount },
    });
  const clearAmount = (reservation: ReservationKey, client = operator) =>
    test.app.inject({
      method: 'DELETE',
      url: `${reservationPath(reservation)}/manual-amount`,
      headers: client.headers,
    });

  it('exige comprovante na reserva', async () => {
    const response = await setAmount(key('P7'), '500.00');

    expect(response.statusCode).toBe(409);
    expectMatchesContract('setManualChargedAmount', response);
    expect(response.json()).toMatchObject({ code: 'proof_required' });
  });

  it('grava, mostra como valor efetivo e remove', async () => {
    await attach(test, operator, key('P7'), 'proof', 'c.pdf', pdfFile('p7'));

    const set = await setAmount(key('P7'), '500.00');
    expect(set.statusCode).toBe(200);
    expectMatchesContract('setManualChargedAmount', set);
    expect(set.json()).toMatchObject({
      manualChargedAmount: '500.00',
      effectiveChargedAmount: '500.00',
    });

    // A busca por valor também acha o valor informado à mão.
    const search = await test.app.inject({
      method: 'GET',
      url: '/v1/reservations?amount=500.00',
      headers: reader.headers,
    });
    expect(
      search.json<{ items: ReservationKey[] }>().items.map((item) => item.reservationNumber),
    ).toEqual(['P7']);

    const cleared = await clearAmount(key('P7'));
    expect(cleared.statusCode).toBe(200);
    expectMatchesContract('clearManualChargedAmount', cleared);
    expect(cleared.json()).toMatchObject({
      manualChargedAmount: null,
      effectiveChargedAmount: null,
    });

    // Remover de novo não muda nada nem cria evento.
    expect((await clearAmount(key('P7'))).statusCode).toBe(200);
    const { events } = await treatmentDetail(test, reader, key('P7'));
    expect(events.map((event) => event.type)).toEqual(['amount_cleared', 'amount_set', 'attached']);
    expect(events[1]).toMatchObject({ amount: '500.00', client: operator.name });
  });

  it('o valor do Hunit prevalece quando existe, e os dois ficam visíveis', async () => {
    await attach(test, operator, key('P8'), 'proof', 'c.pdf', pdfFile('p8'));
    await setAmount(key('P8'), '90.00');
    await test.database.db
      .update(reservations)
      .set({ chargedAmount: '100.00' })
      .where(and(eq(reservations.hotelCode, H), eq(reservations.reservationNumber, 'P8')));

    expect(await treatmentOf(key('P8'))).toMatchObject({
      manualChargedAmount: '90.00',
      effectiveChargedAmount: '100.00',
    });
  });

  it('recusa valor zero, reserva inexistente e o perfil consulta', async () => {
    const zero = await setAmount(key('P7'), '0.00');
    expect(zero.statusCode).toBe(400);
    expectMatchesContract('setManualChargedAmount', zero);

    const missing = await setAmount(key('NAO-EXISTE'), '10.00');
    expect(missing.statusCode).toBe(404);

    expect((await setAmount(key('P7'), '10.00', reader)).statusCode).toBe(403);
    expect((await clearAmount(key('P7'), reader)).statusCode).toBe(403);
  });
});

describe('GET /v1/treatment-documents/{documentId}/file', () => {
  const download = (documentId: string | null, client = reader) =>
    test.app.inject({
      method: 'GET',
      url: `/v1/treatment-documents/${documentId ?? ''}/file`,
      headers: client.headers,
    });

  it('devolve o arquivo idêntico ao enviado, com o nome original, para os dois perfis', async () => {
    await insertReservation(test.database.db, {
      hotelCode: H,
      reservationNumber: 'DOWN',
      lastExecutionId: (await insertExecution(test.database.db)).id,
    });
    const content = pdfFile('download-ção');
    const name = 'Comprovante de cobrança (nº 1).pdf';
    const outcome = await attach(test, operator, key('DOWN'), 'proof', name, content);

    for (const client of [reader, operator]) {
      const response = await download(outcome.documentId, client);

      expect(response.statusCode).toBe(200);
      expectMatchesContract('getTreatmentDocumentFile', response);
      expect(response.rawPayload.equals(content)).toBe(true);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBe('sandbox');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="Comprovante de cobran_a (n_ 1).pdf"; ' +
          `filename*=UTF-8''${encodeURIComponent(name).replace('(', '%28').replace(')', '%29')}`,
      );
    }
  });

  it('também devolve o arquivo de um documento substituído', async () => {
    const detail = await treatmentDetail(test, reader, key('P2'));
    const replaced = detail.documents.find((document) => document.state === 'replaced');

    const response = await download(replaced?.id ?? null);

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(pdfFile('p2a'))).toBe(true);
  });

  it('responde 404 para documento inexistente e 400 para id inválido', async () => {
    const missing = await download('00000000-0000-4000-8000-000000000000');
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('getTreatmentDocumentFile', missing);

    const invalid = await download('nao-e-uuid');
    expect(invalid.statusCode).toBe(400);
    expectMatchesContract('getTreatmentDocumentFile', invalid);
  });
});

describe('GET /v1/reservations/{hotelCode}/{reservationNumber}/treatment', () => {
  it('devolve a tratativa, os documentos e o histórico no formato do contrato', async () => {
    const response = await getTreatment(test, reader, key('P2'));

    expect(response.statusCode).toBe(200);
    expectMatchesContract('getReservationTreatment', response);
    const body = response.json<{ documents: DocumentBody[] }>();
    expect(body.documents.map((document) => document.state)).toEqual(['current', 'replaced']);
  });

  it('reserva sem nada registrado devolve tudo vazio; reserva inexistente, 404', async () => {
    const empty = await getTreatment(test, reader, key('FAT'));
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      treatment: {
        status: 'none',
        situation: 'invoiced',
        needsReview: false,
        request: null,
        proof: null,
        manualChargedAmount: null,
        effectiveChargedAmount: null,
        acceptsDocuments: false,
      },
      documents: [],
      events: [],
    });

    const missing = await getTreatment(test, reader, key('NAO-EXISTE'));
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('getReservationTreatment', missing);
  });
});
