/**
 * Nenhum dado pessoal ou financeiro da planilha na saída, nos erros nem em `legacy_imports`
 * (specs/004, FR-018, SC-006, research R-11) — tasks.md, T016. Valores marcados, fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legacyImports } from '../../src/persistence/schema.js';
import { setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertHotel } from '../helpers/factories.js';
import {
  legacyAttachmentPath,
  legacyFile,
  legacyReservationRow,
  legacyTreatmentRow,
  wallClock,
  writeLegacyAttachments,
  writeLegacyWorkbook,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace, reportId } from '../helpers/legacy-import.js';

const MARKERS = [
  'MARCADOR-HOSPEDE',
  'MARCADOR-COBRADOR',
  'MARCADOR-TRANSACAO',
  'MARCADOR-AUTORIZACAO',
  'MARCADOR-ARQUIVO',
  'MARCADOR-DATA',
  'MARCADOR-VALOR',
  'MARCADOR-MOTIVO',
  '987654.32',
  '987654,32',
  '2031-01-02',
  '02/01/2031',
];

let database: TestDatabase;
const workspace = legacyWorkspace();
const output: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  await insertHotel(database.db, { code: 'HML1', name: 'Hotel Homologação Um' });

  const sensitive = {
    Hospede: 'MARCADOR-HOSPEDE Fictício',
    'Cobrado por': 'MARCADOR-COBRADOR',
    'ID da transacao': 'MARCADOR-TRANSACAO',
    'Codigo de autorizacao': 'MARCADOR-AUTORIZACAO',
    'Valor cobrado': 987654.32,
    'Cobrado em': wallClock('2031-01-02T10:00:00'),
    Motivo: 'MARCADOR-MOTIVO',
  };
  await writeLegacyWorkbook(workspace.xlsx, {
    reservations: [
      legacyReservationRow({ ...sensitive, Reserva: '900001' }, 1),
      // Recusadas, com o marcador justamente na célula que causa a recusa.
      legacyReservationRow({ ...sensitive, Reserva: '900002', Entrada: 'MARCADOR-DATA' }, 2),
      legacyReservationRow(
        { ...sensitive, Reserva: '900003', 'Total da reserva': 'MARCADOR-VALOR' },
        3,
      ),
      legacyReservationRow(
        { ...sensitive, Reserva: '900004', 'Codigo status': 'MARCADOR-DATA' },
        4,
      ),
    ],
    treatments: [
      legacyTreatmentRow('900001', {
        'Comprovante - arquivo no Dropbox': legacyAttachmentPath('MARCADOR-ARQUIVO-1.pdf'),
        'Comprovante - nome original': 'MARCADOR-ARQUIVO comprovante.pdf',
        'Comprovante anexado em': '2031-01-02T10:00:00',
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath('MARCADOR-ARQUIVO-2.pdf'),
        'Valor manual': '987654,32',
      }),
      legacyTreatmentRow('900002', {
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath('MARCADOR-ARQUIVO-3.pdf'),
      }),
    ],
  });
  writeLegacyAttachments(workspace.files, {
    [legacyAttachmentPath('MARCADOR-ARQUIVO-1.pdf')]: legacyFile.pdf('marcador'),
  });

  const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];
  const collect = (result: { stdout: string; stderr: string }) => {
    output.push(result.stdout, result.stderr);
    return result;
  };
  collect(await legacyImport(database, ['simulate', ...files]));
  await setHotelMapping(database.db, 'legacy_hml_um', 'HML1');
  const simulation = collect(await legacyImport(database, ['simulate', ...files]));
  const imported = collect(
    await legacyImport(database, ['run', '--simulation', reportId(simulation.stdout), ...files]),
  );
  collect(await legacyImport(database, ['report', '--id', reportId(imported.stdout)]));
  collect(await legacyImport(database, ['hotels']));
});

afterAll(async () => {
  await database.close();
  workspace.cleanup();
});

describe('dados pessoais fora da importação (SC-006)', () => {
  it('a importação aconteceu (o teste não passa por nada ter sido lido)', () => {
    expect(output.join('\n')).toMatch(/criadas/);
    expect(output.join('\n')).toContain('Data ilegível: Entrada');
  });

  it.each(MARKERS)('saída e erros sem "%s"', (marker) => {
    expect(output.join('\n')).not.toContain(marker);
  });

  it.each(MARKERS)('legacy_imports sem "%s"', async (marker) => {
    const rows = await database.db.select().from(legacyImports);
    expect(JSON.stringify(rows)).not.toContain(marker);
  });
});
