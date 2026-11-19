/**
 * Importação das reservas do sistema anterior (specs/004, US2; FR-005a, FR-008 a FR-010a, FR-021,
 * FR-022; SC-003, SC-007) — tasks.md, T021. Planilha fictícia.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findImportRecord, setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
import { legacyReservations, reservations } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertHotel, insertReservation } from '../helpers/factories.js';
import {
  legacyReservationRow,
  wallClock,
  writeLegacyAttachments,
  writeLegacyWorkbook,
  type LegacyReservationRow,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace, reportId, writtenRows } from '../helpers/legacy-import.js';

let database: TestDatabase;
const workspace = legacyWorkspace();
const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];
const NOW = new Date('2026-11-16T15:00:00Z');

const row = (number: number, overrides: LegacyReservationRow = {}) =>
  legacyReservationRow({ Reserva: String(number), ...overrides }, number - 900_000);

const baseRows = (): LegacyReservationRow[] => [
  row(900001),
  row(900002, { 'Codigo status': 'not_virtual_card', Hospede: 'Hóspede Fictício Dois' }),
  row(900003, {
    Entrada: wallClock('2020-01-10T00:00:00'),
    Saida: wallClock('2020-01-12T00:00:00'),
  }),
  row(900010, { 'Codigo status': 'virtual_card_already_charged' }),
];

async function simulateAndRun(options: Parameters<typeof legacyImport>[2] = {}) {
  const simulation = await legacyImport(database, ['simulate', ...files], { now: () => NOW });
  expect(simulation.exitCode, simulation.stderr).toBe(0);
  const id = reportId(simulation.stdout);
  const run = await legacyImport(database, ['run', '--simulation', id, ...files], {
    now: () => NOW,
    ...options,
  });
  return { simulationId: id, run };
}

async function reservation(number: string) {
  const [found] = await database.db
    .select()
    .from(reservations)
    .where(and(eq(reservations.hotelCode, 'HML1'), eq(reservations.reservationNumber, number)));
  return found;
}

async function origin(number: string) {
  const [found] = await database.db
    .select()
    .from(legacyReservations)
    .where(eq(legacyReservations.reservationNumber, number));
  return found;
}

beforeAll(async () => {
  database = await createTestDatabase();
  await insertHotel(database.db, { code: 'HML1', name: 'Hotel Homologação Um' });
  // Já verificada pelo HUNIT Control: os dados e a classificação dele prevalecem (FR-010).
  await insertReservation(database.db, {
    hotelCode: 'HML1',
    reservationNumber: '900010',
    classification: 'virtual_card_pending_charge',
    firstVerifiedAt: new Date('2026-11-10T12:00:00Z'),
    lastVerifiedAt: new Date('2026-11-12T12:00:00Z'),
    verificationCount: 2,
  });
  await writeLegacyWorkbook(workspace.xlsx, { reservations: baseRows() });
  writeLegacyAttachments(workspace.files, {});
  await legacyImport(database, ['simulate', ...files]);
  await setHotelMapping(database.db, 'legacy_hml_um', 'HML1');
});

afterAll(async () => {
  await database.close();
  workspace.cleanup();
});

describe('legacy-import run (US2)', () => {
  it('importa com os dados do sistema anterior e a marcação de origem', async () => {
    const { run } = await simulateAndRun();
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain('Nenhuma diferença em relação à simulação.');

    const created = await reservation('900001');
    expect(created).toMatchObject({
      reservationStatus: 'unknown',
      classification: 'virtual_card_pending_charge',
      lastExecutionId: null,
      changedFields: [],
      verificationCount: 3,
      firstVerifiedAt: new Date('2026-05-01T13:00:00Z'),
      lastVerifiedAt: new Date('2026-05-08T13:00:00Z'),
      totalAmount: '1234.56',
      paymentForm: null,
    });
    expect(await origin('900001')).toMatchObject({
      legacyHotelKey: 'legacy_hml_um',
      originalClassification: 'virtual_card_pending_charge',
      merged: false,
      appliedCount: 3,
    });

    // "Sem cartão virtual" → "A revisar (sistema anterior)".
    expect((await reservation('900002'))?.classification).toBe('not_virtual_card');
  });

  it('reserva já verificada: classificação e dados do HUNIT Control, verificações somadas (SC-007)', async () => {
    expect(await reservation('900010')).toMatchObject({
      classification: 'virtual_card_pending_charge',
      reservationStatus: 'active',
      firstVerifiedAt: new Date('2026-05-01T13:00:00Z'),
      lastVerifiedAt: new Date('2026-11-12T12:00:00Z'),
      verificationCount: 5,
    });
    expect(await origin('900010')).toMatchObject({
      merged: true,
      appliedCount: 3,
      originalClassification: 'virtual_card_already_charged',
    });
  });

  it('check-in há mais de 5 anos: gravada já anonimizada (FR-022)', async () => {
    const old = await reservation('900003');
    expect(old?.guestName).toBeNull();
    expect(old?.anonymizedAt).not.toBeNull();
  });

  it('reimportar a mesma planilha não muda nada (SC-003)', async () => {
    const before = await writtenRows(database);
    const before900010 = await reservation('900010');
    const { run } = await simulateAndRun();
    expect(run.exitCode).toBe(0);
    const record = await findImportRecord(database.db, reportId(run.stdout));
    expect(record?.counts?.reservations).toEqual({
      created: 0,
      updated: 0,
      ignored: 4,
      rejected: 0,
    });
    // Os "já importados" aparecem resumidos; a lista completa só com --all (FR-005).
    expect(run.stdout).toContain('Já importados, sem mudança: 4 reservas.');
    expect(run.stdout).not.toContain('Já importada, sem mudança');
    const full = await legacyImport(database, ['report', '--id', reportId(run.stdout), '--all']);
    expect(full.stdout.match(/Já importada, sem mudança/g)).toHaveLength(4);
    const after = await writtenRows(database);
    expect({ ...after, legacyImports: 0 }).toEqual({ ...before, legacyImports: 0 });
    expect(await reservation('900010')).toEqual(before900010);
  });

  it('linha mudada numa importada ainda não verificada: atualiza (FR-010a)', async () => {
    await writeLegacyWorkbook(workspace.xlsx, {
      reservations: [row(900001, { Canal: 'Canal Novo' }), ...baseRows().slice(1)],
    });
    const { run } = await simulateAndRun();
    const record = await findImportRecord(database.db, reportId(run.stdout));
    expect(record?.counts?.reservations).toMatchObject({ created: 0, updated: 1, ignored: 3 });
    expect((await reservation('900001'))?.channel).toBe('Canal Novo');
  });

  it('a impressão digital mudou desde a simulação: recusa e não grava nada (FR-005a)', async () => {
    const simulation = await legacyImport(database, ['simulate', ...files]);
    await writeLegacyWorkbook(workspace.xlsx, {
      reservations: [...baseRows(), row(900020)],
    });
    const before = await writtenRows(database);
    const run = await legacyImport(database, [
      'run',
      '--simulation',
      reportId(simulation.stdout),
      ...files,
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('mudou desde a simulação');
    expect(await writtenRows(database)).toEqual(before);
  });

  it('reserva gravada entre a simulação e a importação aparece nas diferenças', async () => {
    await writeLegacyWorkbook(workspace.xlsx, { reservations: [...baseRows(), row(900030)] });
    const simulation = await legacyImport(database, ['simulate', ...files]);
    // Uma execução no Hunit grava a reserva no meio.
    await insertReservation(database.db, { hotelCode: 'HML1', reservationNumber: '900030' });
    const run = await legacyImport(database, [
      'run',
      '--simulation',
      reportId(simulation.stdout),
      ...files,
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Diferenças em relação à simulação:');
    expect(run.stdout).toMatch(/900030 .*simulação: created .*importação: updated/);
    expect((await origin('900030'))?.merged).toBe(true);
  });

  it('interrompida no meio: o que entrou está completo; um novo run completa o resto (FR-021)', async () => {
    await writeLegacyWorkbook(workspace.xlsx, {
      reservations: [...baseRows(), row(900040), row(900041), row(900042)],
    });
    let calls = 0;
    const first = await simulateAndRun({ shouldStop: () => ++calls > 5 });
    expect(first.run.exitCode).toBe(1);
    expect(first.run.stderr).toContain('Importação interrompida');
    const pending = await legacyImport(database, ['simulate', ...files]);
    expect(pending.stdout).toMatch(/1 importação\(ões\) anterior\(es\) não terminou/);
    expect(await reservation('900040')).toBeDefined();
    expect(await reservation('900041')).toBeUndefined();

    const second = await simulateAndRun();
    expect(second.run.exitCode).toBe(0);
    for (const number of ['900040', '900041', '900042']) {
      expect(await origin(number)).toBeDefined();
    }
    // A importação completa depois da interrompida já completou o que faltava: sem aviso.
    const simulation = await legacyImport(database, ['simulate', ...files]);
    expect(simulation.stdout).not.toMatch(/não terminou/);
  });
});
