/**
 * Importação das tratativas, comprovantes e valores manuais do sistema anterior (specs/004, US3;
 * FR-012 a FR-017, FR-022; SC-003, SC-004) — tasks.md, T027. Planilha e anexos fictícios.
 */
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findImportRecord, setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
import { treatmentDocuments, treatmentFiles } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import {
  legacyAttachmentPath,
  legacyFile,
  legacyReservationRow,
  legacyTreatmentRow,
  wallClock,
  writeLegacyAttachments,
  writeLegacyWorkbook,
  type LegacyReservationRow,
  type LegacyTreatmentRow,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace, reportId } from '../helpers/legacy-import.js';
import {
  attach,
  pdfFile,
  treatmentDetail,
  type DocumentBody,
  type EventBody,
  type ReservationKey,
} from '../helpers/treatments.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;
const workspace = legacyWorkspace();
const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];
const key = (reservationNumber: string): ReservationKey => ({
  hotelCode: 'HML1',
  reservationNumber,
});
const path = legacyAttachmentPath;

const row = (number: string, overrides: LegacyReservationRow = {}) =>
  legacyReservationRow({ Reserva: number, ...overrides });
const treatment = (number: string, overrides: LegacyTreatmentRow) =>
  legacyTreatmentRow(number, overrides);

const ATTACHMENTS: Record<string, Buffer> = {
  [path('p1_request.eml')]: legacyFile.eml('p1'),
  [path('p1_proof.pdf')]: legacyFile.pdf('p1'),
  [path('p2_old.pdf')]: legacyFile.pdf('p2'),
  [path('p3_old.pdf')]: legacyFile.pdf('p3'),
  [path('p4_proof.pdf')]: legacyFile.pdf('p4'),
  [path('renomeado.pdf')]: legacyFile.executable(),
  [path('vazio.pdf')]: legacyFile.empty(),
  [path('grande.pdf')]: legacyFile.tooLarge(),
  [path('planilha.xlsx')]: Buffer.from('PK'),
  [path('p9_proof.pdf')]: legacyFile.pdf('p9'),
  [path('p10_request.pdf')]: legacyFile.pdf('p10'),
  [path('p11_request.pdf')]: legacyFile.pdf('p11'),
  [path('p13_request.pdf')]: legacyFile.pdf('p13-antiga'),
  [path('p20_request.pdf')]: legacyFile.pdf('p20'),
  [path('p21_request.pdf')]: legacyFile.pdf('p21'),
};

function workbook(overrides: { proofOf900001?: string } = {}) {
  return writeLegacyWorkbook(workspace.xlsx, {
    reservations: [
      row('900001'),
      row('900002'),
      row('900003', { 'Codigo status': 'virtual_card_charge_error' }),
      row('900004'),
      row('900005'),
      row('900006'),
      row('900007'),
      row('900008'),
      row('900009'),
      row('900010', { 'Codigo status': 'virtual_card_already_charged' }),
      row('900011', { 'Codigo status': 'not_virtual_card' }),
      row('900012'),
      row('900013', {
        Entrada: wallClock('2020-01-10T00:00:00'),
        Saida: wallClock('2020-01-12T00:00:00'),
      }),
    ],
    treatments: [
      treatment('900001', {
        'Tratativa - arquivo no Dropbox': path('p1_request.eml'),
        'Tratativa - nome original': 'Pedido de cobrança.eml',
        'Tratativa anexada em': '2026-05-02T09:30:00',
        'Comprovante - arquivo no Dropbox': path(overrides.proofOf900001 ?? 'p1_proof.pdf'),
        'Comprovante - nome original': 'Comprovante.pdf',
        'Comprovante anexado em': '2026-05-05T16:00:00',
        'Valor manual': '12.50',
        'Valor manual alterado em': '2026-05-05T16:05:00',
      }),
      treatment('900002', { 'Anexo antigo - arquivo no Dropbox': path('p2_old.pdf') }),
      treatment('900003', { 'Anexo antigo - arquivo no Dropbox': path('p3_old.pdf') }),
      treatment('900004', {
        'Comprovante - arquivo no Dropbox': path('p4_proof.pdf'),
        'Tratativa - arquivo no Dropbox': path('renomeado.pdf'),
      }),
      treatment('900005', { 'Tratativa - arquivo no Dropbox': path('vazio.pdf') }),
      treatment('900006', { 'Comprovante - arquivo no Dropbox': path('grande.pdf') }),
      treatment('900007', { 'Tratativa - arquivo no Dropbox': path('planilha.xlsx') }),
      treatment('900008', { 'Valor manual': '30.00' }),
      treatment('900009', { 'Comprovante - arquivo no Dropbox': path('p9_proof.pdf') }),
      treatment('900010', { 'Tratativa - arquivo no Dropbox': path('p10_request.pdf') }),
      treatment('900011', { 'Tratativa - arquivo no Dropbox': path('p11_request.pdf') }),
      // Mesmo arquivo do comprovante da 900001 (lote no sistema anterior).
      treatment('900012', { 'Comprovante - arquivo no Dropbox': path('p1_proof.pdf') }),
      treatment('900013', { 'Tratativa - arquivo no Dropbox': path('p13_request.pdf') }),
      treatment('900020', { 'Tratativa - arquivo no Dropbox': path('p20_request.pdf') }),
      treatment('900021', { 'Tratativa - arquivo no Dropbox': path('p21_request.pdf') }),
    ],
  });
}

async function importAll() {
  const simulation = await legacyImport(test.database, ['simulate', ...files]);
  expect(simulation.exitCode, simulation.stderr).toBe(0);
  const run = await legacyImport(test.database, [
    'run',
    '--simulation',
    reportId(simulation.stdout),
    ...files,
  ]);
  expect(run.exitCode, run.stderr).toBe(0);
  return findImportRecord(test.database.db, reportId(run.stdout));
}

async function download(document: DocumentBody): Promise<Buffer> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/treatment-documents/${document.id}/file`,
    headers: reader.headers,
  });
  expect(response.statusCode).toBe(200);
  return response.rawPayload;
}

const issue = (record: Awaited<ReturnType<typeof importAll>>, number: string, entity: string) =>
  record?.issues.find((item) => item.reservationNumber === number && item.entity === entity)
    ?.reason;

let firstImport: Awaited<ReturnType<typeof importAll>>;

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;
  await insertHotel(db, { code: 'HML1', name: 'Hotel Homologação Um' });
  const execution = await insertExecution(db);
  for (const number of ['900009', '900020']) {
    await insertReservation(db, {
      hotelCode: 'HML1',
      reservationNumber: number,
      lastExecutionId: execution.id,
    });
  }
  // Comprovante já registrado no HUNIT Control: prevalece (FR-014).
  await attach(test, operator, key('900009'), 'proof', 'do-hunit-control.pdf', pdfFile('hc'));

  await workbook();
  writeLegacyAttachments(workspace.files, ATTACHMENTS);
  await legacyImport(test.database, ['simulate', ...files]);
  await setHotelMapping(db, 'legacy_hml_um', 'HML1');
  firstImport = await importAll();
});

afterAll(async () => {
  await test.close();
  workspace.cleanup();
});

describe('documentos importados (US3)', () => {
  it('tratativa e comprovante com a data original, autor "Sistema anterior" e download idêntico', async () => {
    const detail = await treatmentDetail(test, reader, key('900001'));
    expect(detail.treatment.status).toBe('charged');
    expect(detail.treatment.situation).toBe('proof_sent');
    const proof = detail.treatment.proof!;
    expect(proof).toMatchObject({
      state: 'current',
      fileName: 'Comprovante.pdf',
      attachedBy: 'sistema-anterior',
      attachedAt: '2026-05-05T19:00:00.000Z',
      fromLegacy: true,
    });
    expect(detail.treatment.request).toMatchObject({
      fileName: 'Pedido de cobrança.eml',
      mediaType: 'message/rfc822',
      attachedAt: '2026-05-02T12:30:00.000Z',
    });
    expect((await download(proof)).equals(ATTACHMENTS[path('p1_proof.pdf')]!)).toBe(true);
    expect(
      (await download(detail.treatment.request!)).equals(ATTACHMENTS[path('p1_request.eml')]!),
    ).toBe(true);

    expect(detail.treatment.manualChargedAmount).toBe('12.50');
    const events = detail.events as (EventBody & { fromLegacy?: boolean })[];
    expect(events.map((event) => [event.type, event.client, event.at, event.fromLegacy])).toEqual(
      expect.arrayContaining([
        ['attached', 'sistema-anterior', '2026-05-02T12:30:00.000Z', true],
        ['attached', 'sistema-anterior', '2026-05-05T19:00:00.000Z', true],
        ['amount_set', 'sistema-anterior', '2026-05-05T19:05:00.000Z', true],
      ]),
    );
  });

  it('o detalhe da tratativa continua no contrato 1.6.0', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/reservations/HML1/900001/treatment',
      headers: reader.headers,
    });
    expectMatchesContract('getReservationTreatment', response);
  });

  it('anexo antigo: comprovante na pendente, tratativa na com erro de cobrança', async () => {
    expect((await treatmentDetail(test, reader, key('900002'))).treatment.status).toBe('charged');
    expect((await treatmentDetail(test, reader, key('900003'))).treatment.status).toBe('sent');
  });

  it('arquivos fora das regras: recusados com o motivo; a reserva e o outro documento entram', async () => {
    expect(issue(firstImport, '900004', 'request')).toBe('file_type_mismatch');
    expect((await treatmentDetail(test, reader, key('900004'))).treatment.status).toBe('charged');
    expect(issue(firstImport, '900005', 'request')).toBe('empty_file');
    expect(issue(firstImport, '900006', 'proof')).toBe('file_too_large');
    expect(issue(firstImport, '900007', 'request')).toBe('unsupported_file_type');
    expect(issue(firstImport, '900008', 'manual_amount')).toBe('manual_amount_without_proof');
    expect((await treatmentDetail(test, reader, key('900005'))).treatment.status).toBe('none');
  });

  it('comprovante do HUNIT Control prevalece e fica intacto (FR-014)', async () => {
    expect(issue(firstImport, '900009', 'proof')).toBe('kept_hunit_control');
    const proof = (await treatmentDetail(test, reader, key('900009'))).treatment.proof;
    expect(proof).toMatchObject({ fileName: 'do-hunit-control.pdf' });
    expect(proof).not.toHaveProperty('fromLegacy');
  });

  it('tratativa em reserva que hoje não exige cobrança: importada, com o alerta "Verificar" (FR-017)', async () => {
    const detail = await treatmentDetail(test, reader, key('900010'));
    expect(detail.treatment).toMatchObject({ status: 'sent', needsReview: true });
  });

  it('"A revisar (sistema anterior)" com tratativa: situação própria, sem alerta (FR-007a)', async () => {
    expect((await treatmentDetail(test, reader, key('900011'))).treatment).toMatchObject({
      status: 'sent',
      situation: 'not_virtual_card',
      needsReview: false,
    });
  });

  it('mesmo arquivo em duas reservas: guardado uma vez', async () => {
    const proof12 = (await treatmentDetail(test, reader, key('900012'))).treatment.proof!;
    expect((await download(proof12)).equals(ATTACHMENTS[path('p1_proof.pdf')]!)).toBe(true);
    const [row] = await test.database.db
      .select({ value: count() })
      .from(treatmentDocuments)
      .innerJoin(treatmentFiles, eq(treatmentFiles.sha256, treatmentDocuments.fileSha256))
      .where(eq(treatmentDocuments.reservationNumber, '900012'));
    expect(row?.value).toBe(1);
  });

  it('reserva com check-in há mais de 5 anos: documento só como registro, sem arquivo (FR-022)', async () => {
    const detail = await treatmentDetail(test, reader, key('900013'));
    expect(detail.treatment.request).toMatchObject({ state: 'purged', fileName: null });
  });

  it('reserva fora da aba: importada se já existe no HUNIT Control, recusada se não', async () => {
    expect((await treatmentDetail(test, reader, key('900020'))).treatment.status).toBe('sent');
    expect(issue(firstImport, '900021', 'request')).toBe('reservation_not_in_sheet');
  });

  it('documento importado pode ser desfeito pelo operador, como os demais (FR-016)', async () => {
    const proof = (await treatmentDetail(test, reader, key('900002'))).treatment.proof!;
    const response = await test.app.inject({
      method: 'DELETE',
      url: `/v1/treatment-documents/${proof.id}`,
      headers: operator.headers,
    });
    expect(response.statusCode).toBe(204);
    expect((await treatmentDetail(test, reader, key('900002'))).treatment.status).toBe('none');
  });
});

describe('reimportação (SC-003)', () => {
  it('igual: nada de novo, tudo "já importado"', async () => {
    const [before] = await test.database.db.select({ value: count() }).from(treatmentDocuments);
    const record = await importAll();
    const [after] = await test.database.db.select({ value: count() }).from(treatmentDocuments);
    expect(after?.value).toBe(before?.value);
    expect(record?.counts?.requests.created).toBe(0);
    expect(record?.counts?.proofs.created).toBe(0);
    expect(issue(record, '900001', 'proof')).toBe('already_imported');
    // O comprovante da 900002, desfeito pelo operador, não volta (FR-014).
    expect(issue(record, '900002', 'proof')).toBe('already_imported');
    expect((await treatmentDetail(test, reader, key('900002'))).treatment.status).toBe('none');
  });

  it('arquivo de origem com outro conteúdo: o importado é substituído', async () => {
    writeLegacyAttachments(workspace.files, { [path('p1_proof_v2.pdf')]: legacyFile.pdf('p1-v2') });
    await workbook({ proofOf900001: 'p1_proof_v2.pdf' });
    const record = await importAll();
    expect(record?.counts?.proofs.updated).toBe(1);
    const detail = await treatmentDetail(test, reader, key('900001'));
    expect(detail.documents.find((document) => document.state === 'replaced')).toBeDefined();
    expect(detail.events.some((event) => event.type === 'replaced')).toBe(true);
  });
});
