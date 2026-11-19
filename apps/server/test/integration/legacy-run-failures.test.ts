/**
 * Falhas ao gravar na importação (specs/004, FR-015, FR-021, research R-09; achado da importação
 * real, T045): uma falha deixa só a reserva de fora, com a causa técnica no relatório e no registro,
 * sem valores; 10 falhas seguidas param a importação; valor manual zerado é recusado na simulação.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { findImportRecord, setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
import { legacyReservations, reservations } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertHotel } from '../helpers/factories.js';
import {
  legacyAttachmentPath,
  legacyFile,
  legacyReservationRow,
  legacyTreatmentRow,
  writeLegacyAttachments,
  writeLegacyWorkbook,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace, reportId } from '../helpers/legacy-import.js';

let database: TestDatabase;
const workspace = legacyWorkspace();
const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    legacyReservationRow({ Reserva: String(900_001 + i), Hospede: `MARCADOR-HOSPEDE-${i}` }, i + 1),
  );

async function simulateAndRun() {
  const simulation = await legacyImport(database, ['simulate', ...files]);
  const run = await legacyImport(database, [
    'run',
    '--simulation',
    reportId(simulation.stdout),
    ...files,
  ]);
  return { simulation, run };
}

beforeEach(async () => {
  await database?.close();
  database = await createTestDatabase();
  await insertHotel(database.db, { code: 'HML1', name: 'Hotel Homologação Um' });
  writeLegacyAttachments(workspace.files, {
    [legacyAttachmentPath('comprovante.pdf')]: legacyFile.pdf('zero'),
  });
  await writeLegacyWorkbook(workspace.xlsx, { reservations: rows(1) });
  await legacyImport(database, ['simulate', ...files]);
  await setHotelMapping(database.db, 'legacy_hml_um', 'HML1');
});

afterAll(async () => {
  await database.close();
  workspace.cleanup();
});

async function exists(number: string) {
  const [row] = await database.db
    .select({ n: reservations.reservationNumber })
    .from(reservations)
    .where(and(eq(reservations.hotelCode, 'HML1'), eq(reservations.reservationNumber, number)));
  return row !== undefined;
}

describe('falha ao gravar uma reserva (FR-021)', () => {
  it('só ela fica de fora; o relatório e o registro mostram a causa, sem valores', async () => {
    await writeLegacyWorkbook(workspace.xlsx, { reservations: rows(3) });
    // Uma regra do banco que só a segunda reserva viola, como o valor manual zerado na produção.
    await database.pool.query(
      "alter table legacy_reservations add constraint teste_falha check (reservation_number <> '900002')",
    );

    const { run } = await simulateAndRun();

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('1 reserva(s) com falha ao gravar ficaram de fora');
    expect(run.stdout).toMatch(/900002 .*Falha ao gravar \(23514 teste_falha\)/);
    expect(await exists('900001')).toBe(true);
    expect(await exists('900002')).toBe(false); // tudo ou nada: a linha de reservas também saiu
    expect(await exists('900003')).toBe(true);

    const record = await findImportRecord(database.db, reportId(run.stdout));
    expect(record?.status).toBe('completed');
    expect(record?.issues).toContainEqual(
      expect.objectContaining({
        reservationNumber: '900002',
        reason: 'import_failed',
        detail: '23514 teste_falha',
      }),
    );
    expect(record?.differences).toContainEqual(
      expect.objectContaining({ reservationNumber: '900002', imported: 'rejected:import_failed' }),
    );
    // Nem a saída nem o registro levam valores da linha (o `detail` do erro do banco os repete).
    expect(`${run.stdout}${run.stderr}${JSON.stringify(record)}`).not.toContain('MARCADOR');

    // Corrigida a causa, uma nova simulação e importação completam o que faltou.
    await database.pool.query('alter table legacy_reservations drop constraint teste_falha');
    const again = await simulateAndRun();
    expect(again.run.exitCode).toBe(0);
    expect(await exists('900002')).toBe(true);
  });

  it('10 falhas seguidas param a importação', async () => {
    await writeLegacyWorkbook(workspace.xlsx, { reservations: rows(12) });
    await database.pool.query(
      'alter table legacy_reservations add constraint teste_tudo check (verification_count < 0)',
    );

    const { run } = await simulateAndRun();

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Importação parada depois de 10 falhas seguidas');
    const record = await findImportRecord(database.db, reportId(run.stdout));
    expect(record?.status).toBe('failed');
    expect(record?.issues.filter((issue) => issue.reason === 'import_failed')).toHaveLength(10);
    const [count] = await database.db
      .select({ n: legacyReservations.reservationNumber })
      .from(legacyReservations);
    expect(count).toBeUndefined();
  });
});

describe('valor manual zerado (FR-015)', () => {
  it('recusado já na simulação; a reserva e o comprovante entram', async () => {
    await writeLegacyWorkbook(workspace.xlsx, {
      reservations: rows(1),
      treatments: [
        legacyTreatmentRow('900001', {
          'Comprovante - arquivo no Dropbox': legacyAttachmentPath('comprovante.pdf'),
          'Valor manual': '0.00',
        }),
      ],
    });

    const { simulation, run } = await simulateAndRun();

    expect(simulation.stdout).toContain('Valor manual igual a zero');
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain('Nenhuma diferença em relação à simulação.');
    expect(await exists('900001')).toBe(true);
  });
});
