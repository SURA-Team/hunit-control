/**
 * Testes de contrato da US2 da feature 003 (T031): a tratativa (pedido de cobrança) deixa a
 * reserva "Enviada", o comprovante a deixa "Cobrada", e qualquer documento pode ser desfeito e
 * revertido. Todos os dados são fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import {
  attach,
  emlFile,
  pdfFile,
  treatmentDetail,
  type ReservationKey,
  type TreatmentBody,
} from '../helpers/treatments.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date('2026-11-13T12:00:00.000Z');

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const H = 'H1';
const key = (reservationNumber: string): ReservationKey => ({ hotelCode: H, reservationNumber });

beforeAll(async () => {
  test = await createTestApp({ now: () => START });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;

  await insertHotel(db, { code: H, name: 'Hotel Um' });
  const { id: lastExecutionId } = await insertExecution(db);
  for (const number of ['E1', 'E2', 'E3', 'E4', 'E5']) {
    await insertReservation(db, { hotelCode: H, lastExecutionId, reservationNumber: number });
  }
});

afterAll(async () => {
  await test.close();
});

const remove = (documentId: string | null | undefined, client = operator) =>
  test.app.inject({
    method: 'DELETE',
    url: `/v1/treatment-documents/${documentId ?? ''}`,
    headers: client.headers,
  });

const revert = (documentId: string | null | undefined) =>
  test.app.inject({
    method: 'POST',
    url: `/v1/treatment-documents/${documentId ?? ''}/revert`,
    headers: operator.headers,
  });

async function treatmentOf(reservation: ReservationKey): Promise<TreatmentBody> {
  return (await treatmentDetail(test, reader, reservation)).treatment;
}

async function pendingNumbers(): Promise<string[]> {
  const response = await test.app.inject({
    method: 'GET',
    url: '/v1/reservations?classification=virtual_card_pending_charge',
    headers: reader.headers,
  });
  return response.json<{ items: ReservationKey[] }>().items.map((item) => item.reservationNumber);
}

describe('tratativa → Enviada', () => {
  it('a reserva fica Enviada e continua na classificação original', async () => {
    const outcome = await attach(test, operator, key('E1'), 'request', 'pedido.eml', emlFile('e1'));

    expect(outcome.outcome).toBe('registered');
    expect(await treatmentOf(key('E1'))).toMatchObject({
      status: 'sent',
      request: { kind: 'request', fileName: 'pedido.eml', mediaType: 'message/rfc822' },
      proof: null,
    });
    expect(await pendingNumbers()).toContain('E1');
  });

  it('o comprovante depois da tratativa deixa Cobrada, com os dois documentos', async () => {
    await attach(test, operator, key('E2'), 'request', 'pedido.eml', emlFile('e2'));
    await attach(test, operator, key('E2'), 'proof', 'comprovante.pdf', pdfFile('e2'));

    expect(await treatmentOf(key('E2'))).toMatchObject({
      status: 'charged',
      request: { fileName: 'pedido.eml', attachedBy: operator.name },
      proof: { fileName: 'comprovante.pdf', attachedBy: operator.name },
    });
  });

  it('a tratativa anexada depois do comprovante não muda a situação', async () => {
    await attach(test, operator, key('E3'), 'proof', 'comprovante.pdf', pdfFile('e3'));
    await attach(test, operator, key('E3'), 'request', 'pedido.eml', emlFile('e3'));

    expect(await treatmentOf(key('E3'))).toMatchObject({
      status: 'charged',
      request: { fileName: 'pedido.eml' },
    });
  });
});

describe('DELETE /v1/treatment-documents/{documentId}', () => {
  it('desfazer o comprovante volta a Enviada, e o histórico registra quem desfez', async () => {
    await attach(test, operator, key('E4'), 'request', 'pedido.eml', emlFile('e4'));
    const proof = await attach(test, operator, key('E4'), 'proof', 'c.pdf', pdfFile('e4'));

    const response = await remove(proof.documentId);

    expect(response.statusCode).toBe(204);
    expectMatchesContract('removeTreatmentDocument', response);

    const detail = await treatmentDetail(test, reader, key('E4'));
    expect(detail.treatment).toMatchObject({ status: 'sent', proof: null });
    expect(detail.documents.find((document) => document.id === proof.documentId)).toMatchObject({
      state: 'removed',
      endedBy: operator.name,
      revertibleUntil: new Date(START.getTime() + 30 * DAY_MS).toISOString(),
    });
    expect(detail.events[0]).toMatchObject({
      type: 'removed',
      kind: 'proof',
      documentId: proof.documentId,
      client: operator.name,
    });
  });

  it('recusa desfazer o que já não é o atual', async () => {
    const detail = await treatmentDetail(test, reader, key('E4'));
    const removed = detail.documents.find((document) => document.state === 'removed');

    const response = await remove(removed?.id);

    expect(response.statusCode).toBe(409);
    expectMatchesContract('removeTreatmentDocument', response);
    expect(response.json()).toMatchObject({ code: 'document_not_current' });
  });

  it('o desfeito pode ser revertido dentro do prazo e volta a Cobrada', async () => {
    const detail = await treatmentDetail(test, reader, key('E4'));
    const removed = detail.documents.find((document) => document.state === 'removed');

    const response = await revert(removed?.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'charged', proof: { id: removed?.id } });
  });

  it('desfazer não apaga o valor informado à mão: ele volta com a reversão', async () => {
    const proof = await attach(test, operator, key('E5'), 'proof', 'c.pdf', pdfFile('e5'));
    await test.app.inject({
      method: 'PUT',
      url: `/v1/reservations/${H}/E5/manual-amount`,
      headers: operator.headers,
      payload: { amount: '250.00' },
    });

    await remove(proof.documentId);
    // Sem comprovante, o valor manual fica guardado, mas sem efeito.
    expect(await treatmentOf(key('E5'))).toMatchObject({
      status: 'none',
      manualChargedAmount: '250.00',
      effectiveChargedAmount: null,
    });

    await revert(proof.documentId);
    expect(await treatmentOf(key('E5'))).toMatchObject({
      status: 'charged',
      effectiveChargedAmount: '250.00',
    });
  });

  it('responde 404 para documento inexistente e 403 para o perfil consulta', async () => {
    const missing = await remove('00000000-0000-4000-8000-000000000000');
    expect(missing.statusCode).toBe(404);
    expectMatchesContract('removeTreatmentDocument', missing);

    const forbidden = await remove('00000000-0000-4000-8000-000000000000', reader);
    expect(forbidden.statusCode).toBe(403);
    expectMatchesContract('removeTreatmentDocument', forbidden);
  });
});
