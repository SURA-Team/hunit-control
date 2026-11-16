/**
 * Retenção das reservas importadas (specs/004, FR-022) — tasks.md, T037: a rotina diária as
 * anonimiza quando o check-in passa de 5 anos e purga os documentos importados como os da 003,
 * mantendo a origem "Sistema anterior".
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../../src/maintenance/retention.js';
import { setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
import { legacyReservations, reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
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
import { treatmentDetail } from '../helpers/treatments.js';

let test: TestApp;
let reader: TestClient;
const workspace = legacyWorkspace();

beforeAll(async () => {
  test = await createTestApp();
  reader = await test.createClient('reader');
  await insertHotel(test.database.db, { code: 'HML1', name: 'Hotel Homologação Um' });
  await writeLegacyWorkbook(workspace.xlsx, {
    // Check-in em 10/05/2026: os 5 anos vencem depois de 10/05/2031.
    reservations: [legacyReservationRow({ Reserva: '900001' })],
    treatments: [
      legacyTreatmentRow('900001', {
        'Comprovante - arquivo no Dropbox': legacyAttachmentPath('comprovante.pdf'),
      }),
    ],
  });
  writeLegacyAttachments(workspace.files, {
    [legacyAttachmentPath('comprovante.pdf')]: legacyFile.pdf('retencao'),
  });
  const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];
  await legacyImport(test.database, ['simulate', ...files]);
  await setHotelMapping(test.database.db, 'legacy_hml_um', 'HML1');
  const simulation = await legacyImport(test.database, ['simulate', ...files]);
  const run = await legacyImport(test.database, [
    'run',
    '--simulation',
    reportId(simulation.stdout),
    ...files,
  ]);
  expect(run.exitCode, run.stderr).toBe(0);
});

afterAll(async () => {
  await test.close();
  workspace.cleanup();
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

const key = { hotelCode: 'HML1', reservationNumber: '900001' };

describe('retenção das reservas importadas (FR-022)', () => {
  it('antes dos 5 anos: nada muda', async () => {
    await retention(new Date('2031-05-10T15:00:00Z'));
    const [row] = await test.database.db
      .select()
      .from(reservations)
      .where(eq(reservations.reservationNumber, '900001'));
    expect(row?.anonymizedAt).toBeNull();
    expect((await treatmentDetail(test, reader, key)).treatment.proof?.state).toBe('current');
  });

  it('depois dos 5 anos: anonimizada, documento purgado, origem mantida', async () => {
    await retention(new Date('2031-05-11T15:00:00Z'));
    const [row] = await test.database.db
      .select()
      .from(reservations)
      .where(eq(reservations.reservationNumber, '900001'));
    expect(row?.guestName).toBeNull();
    expect(row?.anonymizedAt).not.toBeNull();

    const proof = (await treatmentDetail(test, reader, key)).treatment.proof;
    expect(proof).toMatchObject({ state: 'purged', fileName: null });

    const [origin] = await test.database.db
      .select()
      .from(legacyReservations)
      .where(eq(legacyReservations.reservationNumber, '900001'));
    expect(origin?.originalClassification).toBe('virtual_card_pending_charge');
  });
});
