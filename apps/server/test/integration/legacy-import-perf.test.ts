/**
 * Desempenho da importação do histórico (specs/004, SC-008) — tasks.md, T038. Fica desligado nas
 * rodadas normais; para medir:
 *
 *   $env:HUNIT_LEGACY_PERF = "1"; pnpm test --project server-db legacy-import-perf
 *
 * 20 000 linhas e 2 000 anexos pequenos: simulação em até 5 min e importação em até 15 min.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
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

const ENABLED = process.env['HUNIT_LEGACY_PERF'] === '1';
const RESERVATIONS = 20_000;
const ATTACHMENTS = 2_000;
const MINUTE_MS = 60_000;

describe.runIf(ENABLED)('desempenho da importação (SC-008)', () => {
  let database: TestDatabase;
  const workspace = legacyWorkspace();
  const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];
  let simulationId = '';

  beforeAll(async () => {
    database = await createTestDatabase();
    await insertHotel(database.db, { code: 'HML1', name: 'Hotel Homologação Um' });
    const numbers = Array.from({ length: RESERVATIONS }, (_, i) => String(1_000_000 + i));
    const attachments: Record<string, Buffer> = {};
    const treatments = numbers.slice(0, ATTACHMENTS).map((number) => {
      const name = `t_${number}.pdf`;
      attachments[legacyAttachmentPath(name)] = legacyFile.pdf(number);
      return legacyTreatmentRow(number, {
        'Tratativa - arquivo no Dropbox': legacyAttachmentPath(name),
      });
    });
    await writeLegacyWorkbook(workspace.xlsx, {
      reservations: numbers.map((number, i) => legacyReservationRow({ Reserva: number }, i)),
      treatments,
    });
    writeLegacyAttachments(workspace.files, attachments);
    await legacyImport(database, ['simulate', ...files]);
    await setHotelMapping(database.db, 'legacy_hml_um', 'HML1');
  }, 10 * MINUTE_MS);

  afterAll(async () => {
    await database?.close();
    workspace.cleanup();
  });

  it(
    'simulação em até 5 min',
    async () => {
      const started = Date.now();
      const result = await legacyImport(database, ['simulate', ...files]);
      const elapsed = Date.now() - started;
      expect(result.exitCode, result.stderr).toBe(0);
      simulationId = reportId(result.stdout);
      process.stdout.write(`Simulação: ${(elapsed / 1000).toFixed(1)} s\n`);
      expect(elapsed).toBeLessThan(5 * MINUTE_MS);
    },
    10 * MINUTE_MS,
  );

  it(
    'importação em até 15 min',
    async () => {
      const started = Date.now();
      const result = await legacyImport(database, ['run', '--simulation', simulationId, ...files]);
      const elapsed = Date.now() - started;
      expect(result.exitCode, result.stderr).toBe(0);
      process.stdout.write(`Importação: ${(elapsed / 1000).toFixed(1)} s\n`);
      expect(elapsed).toBeLessThan(15 * MINUTE_MS);
    },
    20 * MINUTE_MS,
  );
});
