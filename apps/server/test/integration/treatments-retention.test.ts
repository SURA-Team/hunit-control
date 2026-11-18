/**
 * Retenção dos documentos das tratativas na rotina diária (specs/003, T049, research R-07):
 * purga 30 dias depois de substituído ou desfeito (FR-013), purga na anonimização da reserva
 * (FR-016) e limpeza dos arquivos sem documento. O registro e o histórico ficam.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../../src/maintenance/retention.js';
import { reservations, treatmentFiles } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import {
  attach,
  emlFile,
  pdfFile,
  treatmentDetail,
  uploadedFile,
  type ReservationKey,
} from '../helpers/treatments.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date('2026-11-13T12:00:00.000Z');
const H = 'RET';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;
let clock = START;
let lastExecutionId: string;

const key = (reservationNumber: string): ReservationKey => ({ hotelCode: H, reservationNumber });

beforeAll(async () => {
  test = await createTestApp({ now: () => clock });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;

  await insertHotel(db, { code: H, name: 'Hotel Retenção' });
  lastExecutionId = (await insertExecution(db)).id;
  for (const number of ['R1', 'R2', 'R3']) {
    await insertReservation(db, { hotelCode: H, lastExecutionId, reservationNumber: number });
  }
});

afterAll(async () => {
  await test.close();
});

function retention(now: Date) {
  return runRetention({
    db: test.database.db,
    evidence: test.harness.evidence,
    reservationRetentionYears: 5,
    logger: test.logs.logger,
    now: () => now,
  });
}

async function fileExists(sha256: string): Promise<boolean> {
  const rows = await test.database.db
    .select({ sha256: treatmentFiles.sha256 })
    .from(treatmentFiles)
    .where(eq(treatmentFiles.sha256, sha256));
  return rows.length > 0;
}

const download = (documentId: string | null | undefined) =>
  test.app.inject({
    method: 'GET',
    url: `/v1/treatment-documents/${documentId ?? ''}/file`,
    headers: reader.headers,
  });

describe('documentos substituídos ou desfeitos (FR-013)', () => {
  it('ficam até o dia 30 e são purgados depois, mantendo o registro e o histórico', async () => {
    const replacedFile = await uploadedFile(test, operator, 'antigo.pdf', pdfFile('r1-antigo'));
    const first = await attach(
      test,
      operator,
      key('R1'),
      'proof',
      'antigo.pdf',
      pdfFile('r1-antigo'),
    );
    const second = await attach(test, operator, key('R1'), 'proof', 'novo.pdf', pdfFile('r1-novo'));

    // Um instante antes do prazo: nada muda.
    const early = await retention(new Date(START.getTime() + 30 * DAY_MS - 1));
    expect(early.treatmentDocumentsPurged).toBe(0);
    expect((await download(first.documentId)).statusCode).toBe(200);

    // No prazo: o substituído é purgado; o arquivo, sem mais nenhum documento, é apagado.
    const now = new Date(START.getTime() + 30 * DAY_MS);
    clock = now;
    try {
      const result = await retention(now);
      expect(result.treatmentDocumentsPurged).toBe(1);
      expect(result.treatmentFilesRemoved).toBeGreaterThanOrEqual(1);
      expect(await fileExists(replacedFile.fileId)).toBe(false);

      const detail = await treatmentDetail(test, reader, key('R1'));
      expect(detail.documents.find((document) => document.id === first.documentId)).toMatchObject({
        state: 'purged',
        fileName: null,
        revertibleUntil: null,
        sizeBytes: replacedFile.sizeBytes,
        attachedBy: operator.name,
      });
      // O vigente não é tocado, e o histórico continua completo.
      expect(detail.treatment.proof).toMatchObject({ id: second.documentId, state: 'current' });
      expect(detail.events.map((event) => event.type)).toEqual(['replaced', 'attached']);

      const purged = await download(first.documentId);
      expect(purged.statusCode).toBe(410);
      expect(purged.json()).toMatchObject({ code: 'document_purged' });
      expect((await download(second.documentId)).statusCode).toBe(200);

      // A reversão já não é possível.
      const revert = await test.app.inject({
        method: 'POST',
        url: `/v1/treatment-documents/${first.documentId ?? ''}/revert`,
        headers: operator.headers,
      });
      expect(revert.statusCode).toBe(409);
    } finally {
      clock = START;
    }
  });

  it('o atraso de uma rodada é recuperado na seguinte (specs/001, FR-029)', async () => {
    const proof = await attach(test, operator, key('R2'), 'proof', 'c.pdf', pdfFile('r2'));
    await test.app.inject({
      method: 'DELETE',
      url: `/v1/treatment-documents/${proof.documentId ?? ''}`,
      headers: operator.headers,
    });

    // Servidor desligado por 90 dias: a primeira rodada depois disso trata tudo o que venceu.
    const result = await retention(new Date(START.getTime() + 90 * DAY_MS));

    expect(result.treatmentDocumentsPurged).toBe(1);
    const detail = await treatmentDetail(test, reader, key('R2'));
    expect(detail.documents[0]).toMatchObject({ state: 'purged', fileName: null });
    expect(detail.events.map((event) => event.type)).toEqual(['removed', 'attached']);
  });
});

describe('reservas anonimizadas (FR-016)', () => {
  it('os arquivos são apagados, e a situação e o valor manual ficam', async () => {
    // Check-in há mais de 5 anos: a próxima rodada da rotina anonimiza a reserva.
    await insertReservation(test.database.db, {
      hotelCode: H,
      lastExecutionId,
      reservationNumber: 'ANTIGA',
      guestName: 'Hóspede Fictício',
      checkIn: '2021-01-10',
      checkOut: '2021-01-12',
    });
    await attach(test, operator, key('ANTIGA'), 'request', 'pedido.eml', emlFile('antiga'));
    const proof = await attach(test, operator, key('ANTIGA'), 'proof', 'c.pdf', pdfFile('antiga'));
    await test.app.inject({
      method: 'PUT',
      url: `/v1/reservations/${H}/ANTIGA/manual-amount`,
      headers: operator.headers,
      payload: { amount: '410.00' },
    });

    // Mesma rodada: anonimiza a reserva e purga os documentos dela.
    const result = await retention(START);

    expect(result.reservationsAnonymized).toBe(1);
    expect(result.treatmentDocumentsPurged).toBe(2);
    const [row] = await test.database.db
      .select({ guestName: reservations.guestName })
      .from(reservations)
      .where(and(eq(reservations.hotelCode, H), eq(reservations.reservationNumber, 'ANTIGA')));
    expect(row?.guestName).toBeNull();

    const detail = await treatmentDetail(test, reader, key('ANTIGA'));
    expect(detail.treatment).toMatchObject({
      // Fica o registro de que houve tratativa e comprovante.
      status: 'charged',
      request: { state: 'purged', fileName: null },
      proof: { id: proof.documentId, state: 'purged', fileName: null },
      manualChargedAmount: '410.00',
      effectiveChargedAmount: '410.00',
    });
    expect(detail.events).toHaveLength(3);
    expect((await download(proof.documentId)).statusCode).toBe(410);

    // Rodar de novo não purga nada outra vez.
    expect((await retention(START)).treatmentDocumentsPurged).toBe(0);
  });
});

describe('arquivos sem documento', () => {
  it('o enviado e nunca registrado é apagado depois de 24 h, não antes', async () => {
    const orphan = await uploadedFile(test, operator, 'sem-uso.pdf', pdfFile('orfao'));
    const inUse = await uploadedFile(test, operator, 'em-uso.pdf', pdfFile('r3'));
    await attach(test, operator, key('R3'), 'proof', 'em-uso.pdf', pdfFile('r3'));

    await retention(new Date(START.getTime() + DAY_MS - 1));
    expect(await fileExists(orphan.fileId)).toBe(true);

    await retention(new Date(START.getTime() + DAY_MS));
    expect(await fileExists(orphan.fileId)).toBe(false);
    // O arquivo de um documento vigente nunca é apagado por esta regra.
    expect(await fileExists(inUse.fileId)).toBe(true);
  });
});
