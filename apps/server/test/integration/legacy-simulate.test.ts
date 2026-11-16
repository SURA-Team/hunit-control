/**
 * Simulação da importação do histórico (specs/004, US1; FR-003, FR-005, FR-006, FR-006a; SC-001,
 * SC-002, SC-005) — tasks.md, T015. Planilha e anexos fictícios.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findImportRecord } from '../../src/persistence/legacy-import-repo.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertHotel, insertReservation } from '../helpers/factories.js';
import {
  legacyAttachmentPath,
  legacyFile,
  legacyReservationRow,
  legacyTreatmentRow,
  wallClock,
  writeLegacyAttachments,
  writeLegacyWorkbook,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace, reportId, writtenRows } from '../helpers/legacy-import.js';

let database: TestDatabase;
const workspace = legacyWorkspace();
const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];

/** Linha da aba "Reservas" do hotel "Um" com o número dado. */
const row = (number: number, overrides = {}) =>
  legacyReservationRow({ Reserva: String(number), ...overrides }, number - 900_000);

beforeAll(async () => {
  database = await createTestDatabase();
  await insertHotel(database.db, { code: 'HML1', name: 'Hotel Homologação Um' });
  await insertHotel(database.db, { code: 'HML2', name: 'Hotel Homologação Dois' });
  // Já verificadas pelo HUNIT Control.
  await insertReservation(database.db, { hotelCode: 'HML1', reservationNumber: '900010' });
  await insertReservation(database.db, { hotelCode: 'HML1', reservationNumber: '900012' });
  // Gravada antes da R-22 da 001 com a classificação obsoleta, sem origem no sistema anterior.
  await insertReservation(database.db, {
    hotelCode: 'HML2',
    reservationNumber: '800001',
    classification: 'not_virtual_card',
  });

  await writeLegacyWorkbook(workspace.xlsx, {
    reservations: [
      row(900001),
      row(900002, { 'Codigo hotel': 'legacy_hml_cinco', Hotel: 'Hotel Sem Par' }),
      row(900003, { Entrada: 'ontem' }),
      row(900004, { 'Total da reserva': 'abc' }),
      row(900005, { Saida: null }),
      row(900006, { Saida: wallClock('2026-05-01T00:00:00') }),
      row(900007, { 'Ultima verificacao': wallClock('2026-05-02T10:00:00') }),
      row(900007),
      row(900008, { 'Codigo status': 'not_virtual_card' }),
      row(900009, {
        Entrada: wallClock('2020-01-10T00:00:00'),
        Saida: wallClock('2020-01-12T00:00:00'),
      }),
      row(900010),
      legacyReservationRow(
        { 'Codigo hotel': 'legacy_hml_dois', Hotel: 'Hotel Homologação Dois', Reserva: '900013' },
        13,
      ),
    ],
    treatments: [
      legacyTreatmentRow('900001', {
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath('t_900001.pdf'),
        'Comprovante - arquivo no Dropbox': legacyAttachmentPath('nao_existe.pdf'),
      }),
      legacyTreatmentRow('900003', {
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath('t_900001.pdf'),
      }),
      legacyTreatmentRow('900008', {
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath('t_900008.png'),
      }),
      legacyTreatmentRow('900011', {
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath('t_900011.pdf'),
      }),
      legacyTreatmentRow('900010', {
        'Comprovante - arquivo no Dropbox': legacyAttachmentPath('renomeado.pdf'),
        'Valor manual': '50.00',
      }),
      legacyTreatmentRow('900012', {
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath('t_900012.eml'),
      }),
    ],
  });
  writeLegacyAttachments(workspace.files, {
    [legacyAttachmentPath('t_900001.pdf')]: legacyFile.pdf('1'),
    [legacyAttachmentPath('t_900008.png')]: legacyFile.png('8'),
    [legacyAttachmentPath('t_900011.pdf')]: legacyFile.pdf('11'),
    [legacyAttachmentPath('renomeado.pdf')]: legacyFile.executable(),
    [legacyAttachmentPath('t_900012.eml')]: legacyFile.eml('12'),
    'sobra.pdf': legacyFile.pdf('sobra'),
  });
});

afterAll(async () => {
  await database.close();
  workspace.cleanup();
});

describe('legacy-import simulate (US1)', () => {
  let before: Record<string, number>;

  it('primeira simulação: hotéis ainda sem associação confirmada, com as propostas', async () => {
    before = await writtenRows(database);
    const result = await legacyImport(database, ['simulate', ...files]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hotéis sem associação (linhas recusadas):');
    expect(result.stdout).toMatch(/legacy_hml_um .*proposta: HML1 \(Hotel Homologação Um\)/);
    expect(result.stdout).toMatch(/legacy_hml_dois .*proposta: HML2/);
    expect(result.stdout).toMatch(/legacy_hml_cinco .*sem proposta/);
    expect(result.stdout).toContain('Para importar: legacy-import run --simulation');
  });

  it('hotels lista as propostas; --accept-proposals confirma as que têm hotel', async () => {
    const list = await legacyImport(database, ['hotels']);
    expect(list.stdout).toMatch(/legacy_hml_um .*proposta .*HML1/);
    const accepted = await legacyImport(database, ['hotels', '--accept-proposals']);
    expect(accepted.stdout).toContain('2 associação(ões) confirmada(s).');
  });

  it('segunda simulação: contagens e motivos exatos (SC-001)', async () => {
    const result = await legacyImport(database, ['simulate', ...files]);
    expect(result.exitCode).toBe(0);
    const record = await findImportRecord(database.db, reportId(result.stdout));

    expect(record?.counts).toEqual({
      reservations: { created: 5, updated: 1, ignored: 1, rejected: 5 },
      requests: { created: 3, updated: 0, ignored: 0, rejected: 2 },
      proofs: { created: 0, updated: 0, ignored: 0, rejected: 2 },
      manualAmounts: { created: 0, updated: 0, ignored: 0, rejected: 1 },
      unreferencedFiles: 1,
    });
    // Cada uma das 12 linhas da aba "Reservas" em exatamente um desfecho.
    const counts = record!.counts!.reservations;
    expect(counts.created + counts.updated + counts.ignored + counts.rejected).toBe(12);

    const issues = record!.issues.map((issue) => [
      issue.reservationNumber,
      issue.entity,
      issue.reason,
      issue.column ?? null,
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        ['900002', 'reservation', 'hotel_not_mapped', null],
        ['900003', 'reservation', 'unreadable_date', 'Entrada'],
        ['900004', 'reservation', 'unreadable_amount', 'Total da reserva'],
        ['900005', 'reservation', 'missing_value', 'Saida'],
        ['900006', 'reservation', 'inconsistent_dates', null],
        ['900007', 'reservation', 'duplicated_in_sheet', null],
        ['900001', 'proof', 'file_not_found', 'Comprovante - arquivo no Dropbox'],
        ['900003', 'request', 'reservation_rejected', null],
        ['900011', 'request', 'reservation_not_in_sheet', null],
        ['900010', 'proof', 'file_type_mismatch', 'Comprovante - arquivo no Dropbox'],
        ['900010', 'manual_amount', 'manual_amount_without_proof', null],
      ]),
    );
    expect(record?.warnings).toEqual(
      expect.arrayContaining([
        { code: 'anonymized_on_import', count: 1 },
        { code: 'unreferenced_files', count: 1 },
        { code: 'obsolete_classification_in_use', count: 1 },
      ]),
    );
    expect(result.stdout).toContain('Reservas linha 4');
    expect(result.stdout).toContain('Data ilegível: Entrada');
  });

  it('não grava reservas, origens, arquivos, documentos, eventos nem valores (SC-002)', async () => {
    const after = await writtenRows(database);
    expect({ ...after, legacyImports: 0 }).toEqual({ ...before, legacyImports: 0 });
    expect(after.legacyImports).toBe((before.legacyImports ?? 0) + 2);
  });

  it('coluna obrigatória ausente: para antes de avaliar as linhas', async () => {
    const other = legacyWorkspace();
    try {
      await writeLegacyWorkbook(other.xlsx, { omitReservationColumns: ['Codigo status'] });
      writeLegacyAttachments(other.files, {});
      const result = await legacyImport(database, [
        'simulate',
        '--xlsx',
        other.xlsx,
        '--files',
        other.files,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Coluna obrigatória ausente: Reservas: Codigo status.');
    } finally {
      other.cleanup();
    }
  });

  it('a importação nunca usa a camada do Hunit (SC-005)', () => {
    const folder = path.resolve(import.meta.dirname, '../../src/legacy-import');
    for (const file of readdirSync(folder)) {
      const source = readFileSync(path.join(folder, file), 'utf8');
      expect(source, file).not.toMatch(/from '\.\.\/hunit\//);
      expect(source, file).not.toMatch(/executions\/runner/);
    }
  });
});
