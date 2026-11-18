/**
 * Importação × verificações do HUNIT Control (specs/004, US2; FR-007a, FR-010; research R-06) —
 * tasks.md, T022. Usa `commitHotel`, a gravação do coletor ao concluir um hotel.
 */
import { buildReservationData, type ReservationData } from '@hunit/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyHotelProgress } from '../../src/persistence/execution-hotels-repo.js';
import { setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
import { commitHotel } from '../../src/persistence/reservations-repo.js';
import { legacyReservations, reservations } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertExecution, insertHotel } from '../helpers/factories.js';
import {
  legacyReservationRow,
  writeLegacyAttachments,
  writeLegacyWorkbook,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace, reportId } from '../helpers/legacy-import.js';

let database: TestDatabase;
const workspace = legacyWorkspace();
const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];
const PERIOD = { from: '2026-05-01', to: '2026-05-31' };

/** O que uma execução no Hunit observaria da reserva (fora a classificação, como o coletor faz). */
function observed(hotelCode: string, number: string, overrides: Partial<ReservationData> = {}) {
  const base = buildReservationData({
    hotelCode,
    reservationNumber: number,
    listing: {
      bookingId: `b-${number}`,
      guestName: 'Hóspede Fictício',
      channel: 'Canal Fictício',
      checkIn: '2026-05-10',
      checkOut: '2026-05-12',
      stayPeriod: '10/05/2026 - 12/05/2026',
      totalAmount: '1234.56',
      reservationStatus: 'active',
    },
    snapshot: null,
    result: {
      classification: 'virtual_card_pending_charge',
      reason: 'pendente',
      reservationStatus: 'active',
    },
  } as Parameters<typeof buildReservationData>[0]);
  return { ...base, ...overrides };
}

async function collect(hotelCode: string, seen: ReservationData[], at: Date) {
  const execution = await insertExecution(database.db);
  await commitHotel(database.db, {
    executionId: execution.id,
    hotelCode,
    period: PERIOD,
    reservations: seen,
    progress: emptyHotelProgress(),
    now: at,
  });
}

async function importRows(rows: Parameters<typeof legacyReservationRow>[0][]) {
  await writeLegacyWorkbook(workspace.xlsx, {
    reservations: rows.map((row, index) => legacyReservationRow(row, index + 1)),
  });
  const simulation = await legacyImport(database, ['simulate', ...files]);
  const run = await legacyImport(database, [
    'run',
    '--simulation',
    reportId(simulation.stdout),
    ...files,
  ]);
  expect(run.exitCode, run.stderr).toBe(0);
}

async function find(hotelCode: string, number: string) {
  const [row] = await database.db
    .select()
    .from(reservations)
    .where(and(eq(reservations.hotelCode, hotelCode), eq(reservations.reservationNumber, number)));
  return row;
}

beforeAll(async () => {
  database = await createTestDatabase();
  for (const [code, name] of [
    ['HML1', 'Hotel Homologação Um'],
    ['HML2', 'Hotel Homologação Dois'],
  ] as const) {
    await insertHotel(database.db, { code, name });
  }
  writeLegacyAttachments(workspace.files, {});
  // Registra os dois hotéis do sistema anterior e confirma a associação.
  await writeLegacyWorkbook(workspace.xlsx, {
    reservations: [
      legacyReservationRow({ Reserva: '1' }),
      legacyReservationRow({
        'Codigo hotel': 'legacy_hml_dois',
        Hotel: 'Hotel Homologação Dois',
        Reserva: '2',
      }),
    ],
  });
  await legacyImport(database, ['simulate', ...files]);
  await setHotelMapping(database.db, 'legacy_hml_um', 'HML1');
  await setHotelMapping(database.db, 'legacy_hml_dois', 'HML2');
});

afterAll(async () => {
  await database.close();
  workspace.cleanup();
});

describe('ordem entre importação e verificação (R-06)', () => {
  it('importar e depois verificar = verificar e depois importar', async () => {
    const at = new Date('2026-11-10T12:00:00Z');

    // HML1: importa, depois o coletor verifica.
    await importRows([{ Reserva: '700001' }]);
    await collect('HML1', [observed('HML1', '700001')], at);

    // HML2: o coletor verifica, depois importa.
    await collect('HML2', [observed('HML2', '700001')], at);
    await importRows([
      { 'Codigo hotel': 'legacy_hml_dois', Hotel: 'Hotel Homologação Dois', Reserva: '700001' },
    ]);

    const importedFirst = await find('HML1', '700001');
    const collectedFirst = await find('HML2', '700001');
    expect(importedFirst?.verificationCount).toBe(4);
    expect(collectedFirst?.verificationCount).toBe(importedFirst?.verificationCount);
    expect(collectedFirst?.firstVerifiedAt).toEqual(importedFirst?.firstVerifiedAt);
    expect(importedFirst?.lastExecutionId).not.toBeNull();
  });
});

describe('"A revisar (sistema anterior)" (FR-007a)', () => {
  it('a verificação reclassifica e a mudança fica no histórico; a origem continua', async () => {
    await importRows([{ Reserva: '700010', 'Codigo status': 'not_virtual_card' }]);
    expect((await find('HML1', '700010'))?.classification).toBe('not_virtual_card');

    const at = new Date('2026-11-11T12:00:00Z');
    await collect('HML1', [observed('HML1', '700010', { classification: 'invoiced' })], at);

    expect(await find('HML1', '700010')).toMatchObject({
      classification: 'invoiced',
      previousClassification: 'not_virtual_card',
      statusChanged: true,
      statusChangedAt: at,
    });
    const [origin] = await database.db
      .select()
      .from(legacyReservations)
      .where(eq(legacyReservations.reservationNumber, '700010'));
    expect(origin?.originalClassification).toBe('not_virtual_card');
  });

  it('não encontrada pela verificação: marcada e continua "A revisar"', async () => {
    await importRows([{ Reserva: '700020', 'Codigo status': 'not_virtual_card' }]);
    const at = new Date('2026-11-12T12:00:00Z');
    // O hotel foi concluído e a reserva, com check-in no período, não apareceu.
    await collect('HML1', [], at);
    expect(await find('HML1', '700020')).toMatchObject({
      classification: 'not_virtual_card',
      notFoundSince: at,
    });
  });
});

describe('reserva importada sem total (FR-008)', () => {
  it('entra com o total vazio e a primeira verificação o preenche', async () => {
    await importRows([{ Reserva: '700040', 'Total da reserva': null }]);
    expect((await find('HML1', '700040'))?.totalAmount).toBeNull();
    await collect('HML1', [observed('HML1', '700040')], new Date('2026-11-14T12:00:00Z'));
    expect((await find('HML1', '700040'))?.totalAmount).toBe('1234.56');
  });
});

describe('importação e coleta ao mesmo tempo', () => {
  it('terminam sem erro e com a reserva gravada uma vez', async () => {
    await writeLegacyWorkbook(workspace.xlsx, {
      reservations: [legacyReservationRow({ Reserva: '700030' })],
    });
    const simulation = await legacyImport(database, ['simulate', ...files]);
    const [run] = await Promise.all([
      legacyImport(database, ['run', '--simulation', reportId(simulation.stdout), ...files]),
      collect('HML1', [observed('HML1', '700030')], new Date('2026-11-13T12:00:00Z')),
    ]);
    expect(run.exitCode, run.stderr).toBe(0);
    const row = await find('HML1', '700030');
    expect(row?.verificationCount).toBe(4);
  });
});
