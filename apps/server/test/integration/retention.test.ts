/**
 * Rotina diária de manutenção (T058): remove evidências vencidas (FR-025) e anonimiza o nome do
 * hóspede das reservas com check-in antigo (FR-026/FR-027), recuperando o que atrasou com o
 * servidor desligado (FR-029).
 */
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EvidenceStore } from '../../src/evidence/store.js';
import { runRetention, startRetentionSchedule } from '../../src/maintenance/retention.js';
import { evidence, reservations } from '../../src/persistence/schema.js';
import { SecretRegistry } from '../../src/secrets.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import { captureLogs } from '../helpers/log-capture.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 11/11/2026, 09:00 em São Paulo. */
const NOW = new Date('2026-11-11T12:00:00.000Z');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let database: TestDatabase;
let dir: string;

beforeAll(async () => {
  database = await createTestDatabase();
  dir = await mkdtemp(path.join(tmpdir(), 'hunit-retention-'));
});

afterAll(async () => {
  await database.close();
  await rm(dir, { recursive: true, force: true });
});

/** Loja de evidências com o relógio parado em `now`. */
function storeAt(now: Date): EvidenceStore {
  return new EvidenceStore({
    db: database.db,
    dir,
    retentionDays: 30,
    secrets: new SecretRegistry(),
    now: () => now,
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function retentionOptions(now: Date = NOW) {
  const logs = captureLogs();
  return {
    logs,
    options: {
      db: database.db,
      evidence: storeAt(now),
      reservationRetentionYears: 5,
      logger: logs.logger,
      now: () => now,
    },
  };
}

describe('runRetention — evidências (FR-025)', () => {
  it('remove os arquivos e o registro das evidências vencidas e mantém as que estão no prazo', async () => {
    const execution = await insertExecution(database.db);
    const old = await storeAt(new Date(NOW.getTime() - 31 * DAY_MS)).save({
      executionId: execution.id,
      kind: 'screen_not_recognized',
      reason: 'tela antiga',
      material: { screenshot: PNG, html: '<p>antiga</p>' },
    });
    const recent = await storeAt(new Date(NOW.getTime() - 29 * DAY_MS)).save({
      executionId: execution.id,
      kind: 'screen_not_recognized',
      reason: 'tela recente',
      material: { response: '{"recente":true}' },
    });
    if (!old || !recent) throw new Error('as evidências deveriam ter sido gravadas');

    const { options } = retentionOptions();
    const result = await runRetention(options);

    expect(result.evidenceRemoved).toBeGreaterThanOrEqual(1);
    const remaining = await database.db
      .select({ id: evidence.id })
      .from(evidence)
      .where(eq(evidence.executionId, execution.id));
    expect(remaining).toEqual([{ id: recent.id }]);
    expect(await exists(options.evidence.resolve(old.screenshotPath ?? ''))).toBe(false);
    expect(await exists(options.evidence.resolve(old.htmlPath ?? ''))).toBe(false);
    expect(await exists(options.evidence.resolve(recent.responsePath ?? ''))).toBe(true);
  });

  it('apaga a pasta da execução quando ela fica vazia', async () => {
    const execution = await insertExecution(database.db);
    await storeAt(new Date(NOW.getTime() - 40 * DAY_MS)).save({
      executionId: execution.id,
      kind: 'navigation_failure',
      reason: 'falha',
      material: { response: '{}' },
    });

    const { options } = retentionOptions();
    await runRetention(options);

    expect(await exists(path.join(dir, execution.id))).toBe(false);
  });

  it('remove o registro mesmo quando os arquivos já não existem', async () => {
    const execution = await insertExecution(database.db);
    const old = await storeAt(new Date(NOW.getTime() - 40 * DAY_MS)).save({
      executionId: execution.id,
      kind: 'navigation_failure',
      reason: 'falha',
      material: { response: '{}' },
    });
    if (!old) throw new Error('a evidência deveria ter sido gravada');
    await rm(path.join(dir, execution.id), { recursive: true, force: true });

    const { options } = retentionOptions();
    await runRetention(options);

    expect(await database.db.select().from(evidence).where(eq(evidence.id, old.id))).toEqual([]);
  });

  it('não apaga arquivos de outras evidências da mesma pasta', async () => {
    const execution = await insertExecution(database.db);
    await storeAt(new Date(NOW.getTime() - 40 * DAY_MS)).save({
      executionId: execution.id,
      kind: 'navigation_failure',
      reason: 'antiga',
      material: { response: '{}' },
    });
    const recent = await storeAt(NOW).save({
      executionId: execution.id,
      kind: 'navigation_failure',
      reason: 'nova',
      material: { response: '{}' },
    });

    const { options } = retentionOptions();
    await runRetention(options);

    expect(await readdir(path.join(dir, execution.id))).toEqual([`${recent?.id}.json`]);
  });
});

describe('runRetention — anonimização (FR-026/FR-027)', () => {
  async function reservation(checkIn: string, overrides: { anonymizedAt?: Date } = {}) {
    const hotel = await insertHotel(database.db);
    return insertReservation(database.db, {
      hotelCode: hotel.code,
      guestName: 'Hóspede Fictício',
      checkIn,
      checkOut: checkIn,
      ...overrides,
    });
  }

  async function reload(row: { hotelCode: string; reservationNumber: string }) {
    const [found] = await database.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.hotelCode, row.hotelCode),
          eq(reservations.reservationNumber, row.reservationNumber),
        ),
      );
    if (!found) throw new Error('reserva não encontrada');
    return found;
  }

  it('apaga o nome do hóspede das reservas com check-in há mais de 5 anos e mantém o resto', async () => {
    const old = await reservation('2021-11-10');
    const { options } = retentionOptions();

    const result = await runRetention(options);

    expect(result.reservationsAnonymized).toBeGreaterThanOrEqual(1);
    const after = await reload(old);
    expect(after.guestName).toBeNull();
    expect(after.anonymizedAt).toEqual(NOW);
    expect(after).toMatchObject({
      checkIn: old.checkIn,
      totalAmount: old.totalAmount,
      classification: old.classification,
      reservationStatus: old.reservationStatus,
      verificationCount: old.verificationCount,
    });
  });

  it('mantém o nome enquanto o check-in não completou 5 anos (inclusive no dia exato)', async () => {
    const exact = await reservation('2021-11-11');
    const recent = await reservation('2025-01-01');

    await runRetention(retentionOptions().options);

    expect((await reload(exact)).guestName).toBe('Hóspede Fictício');
    expect((await reload(recent)).guestName).toBe('Hóspede Fictício');
  });

  it('usa a data de São Paulo, não a de UTC, para contar os anos', async () => {
    const exact = await reservation('2021-11-11');
    // 12/11/2026 às 01:00 em UTC ainda é 11/11/2026 em São Paulo.
    const lateNight = new Date('2026-11-12T01:00:00.000Z');

    await runRetention(retentionOptions(lateNight).options);

    expect((await reload(exact)).guestName).toBe('Hóspede Fictício');
  });

  it('não refaz reservas já anonimizadas', async () => {
    const earlier = new Date('2026-01-01T00:00:00.000Z');
    const done = await reservation('2015-03-01', { anonymizedAt: earlier });

    await runRetention(retentionOptions().options);

    expect((await reload(done)).anonymizedAt).toEqual(earlier);
  });

  it('não escreve nome de hóspede no log', async () => {
    await reservation('2019-05-05');
    const { options, logs } = retentionOptions();

    await runRetention(options);

    expect(logs.text()).not.toContain('Hóspede Fictício');
  });
});

describe('startRetentionSchedule (FR-029)', () => {
  it('roda ao iniciar, recuperando o que venceu com o servidor desligado, e de novo a cada intervalo', async () => {
    const execution = await insertExecution(database.db);
    const old = await storeAt(new Date(NOW.getTime() - 60 * DAY_MS)).save({
      executionId: execution.id,
      kind: 'navigation_failure',
      reason: 'vencida enquanto o servidor estava desligado',
      material: { response: '{}' },
    });
    if (!old) throw new Error('a evidência deveria ter sido gravada');
    const { options, logs } = retentionOptions();
    const runs = () =>
      logs.records().filter((record) => record.msg === 'rotina de manutenção concluída').length;

    const schedule = startRetentionSchedule({ ...options, intervalMs: 50 });
    try {
      await vi.waitFor(async () => {
        expect(await database.db.select().from(evidence).where(eq(evidence.id, old.id))).toEqual(
          [],
        );
      });
      await vi.waitFor(() => expect(runs()).toBeGreaterThanOrEqual(2));
    } finally {
      await schedule.stop();
    }

    const afterStop = runs();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(runs()).toBe(afterStop);
  });

  it('registra a falha de uma rodada e continua agendando as próximas', async () => {
    const logs = captureLogs();
    let calls = 0;
    const failingDb = new Proxy(database.db, {
      get(target, property, receiver) {
        if (property === 'select' && calls++ === 0) {
          return () => {
            throw new Error('banco indisponível');
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const schedule = startRetentionSchedule({
      db: failingDb,
      evidence: storeAt(NOW),
      reservationRetentionYears: 5,
      logger: logs.logger,
      now: () => NOW,
      intervalMs: 50,
    });
    try {
      await vi.waitFor(() => {
        const messages = logs.records().map((record) => record.msg);
        expect(messages).toContain('falha na rotina de manutenção');
        expect(messages).toContain('rotina de manutenção concluída');
      });
    } finally {
      await schedule.stop();
    }
  });
});
