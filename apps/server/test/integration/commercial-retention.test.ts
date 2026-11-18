/**
 * Retenção do envio ao Comercial (specs/005, FR-026; research R-15) — tasks.md, T057: a reserva
 * anonimizada perde os textos livres (motivo da recusa e último retorno lido) e a linha sai da
 * planilha; o resto do histórico fica.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemorySheetGateway } from '../../src/commercial-sheet/memory-sheet-gateway.js';
import { CommercialSheetSync } from '../../src/commercial-sheet/sync.js';
import { EvidenceStore } from '../../src/evidence/store.js';
import { runRetention } from '../../src/maintenance/retention.js';
import {
  findLine,
  getCommercialDetail,
  insertCommercialEvent,
} from '../../src/persistence/commercial-repo.js';
import { commercialLines, commercialReturns } from '../../src/persistence/schema.js';
import { SecretRegistry } from '../../src/secrets.js';
import {
  insertCommercialReservation,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { captureLogs } from '../helpers/log-capture.js';

const NOW = new Date('2031-12-01T12:00:00Z');
const OLD = { hotelCode: 'hml_um', reservationNumber: '900001' };
const RECENT = { hotelCode: 'hml_um', reservationNumber: '900002' };
let database: TestDatabase;
let evidenceDir: string;

beforeAll(async () => {
  database = await createTestDatabase();
  evidenceDir = await mkdtemp(path.join(tmpdir(), 'hunit-commercial-retention-'));
  await seedTestHotels(database.db);
  const { db } = database;
  // Check-in há mais de 5 anos (anonimiza) e uma recente (fica).
  await insertCommercialReservation(db, 1, { checkIn: '2026-11-03' });
  await insertCommercialReservation(db, 2, { checkIn: '2031-11-03' });
  for (const key of [OLD, RECENT]) {
    await insertLine(db, key);
    const rejected = await insertReturn(db, key, {
      state: 'rejected',
      rejectionReason: 'Hóspede Fictício ligou e pediu outro cartão',
    });
    await insertCommercialEvent(db, {
      ...key,
      type: 'return_rejected',
      clientId: null,
      returnId: rejected.id,
      reason: 'Hóspede Fictício ligou e pediu outro cartão',
      at: NOW,
    });
    await db
      .update(commercialLines)
      .set({
        lastReadReturn: {
          authorizationCode: 'AUT1',
          chargeHotel: 'Maquininha Fictícia',
          chargedAmount: '10.00',
          chargedBy: 'Comercial Fictício 1',
        },
      })
      .where(eq(commercialLines.reservationNumber, key.reservationNumber));
  }
});

afterAll(async () => {
  await database.close();
  await rm(evidenceDir, { recursive: true, force: true });
});

describe('anonimização do envio ao Comercial (T057)', () => {
  it('apaga os textos livres da reserva anonimizada e tira a linha da planilha', async () => {
    const { db } = database;
    const sheet = new MemorySheetGateway();
    const sync = new CommercialSheetSync({
      db,
      gateway: sheet,
      logger: captureLogs().logger,
      doneRetentionDays: 90,
      now: () => NOW,
    });
    await sync.runRound();
    expect(sheet.rows('toCharge')).toHaveLength(2);

    const result = await runRetention({
      db,
      evidence: new EvidenceStore({
        db,
        dir: evidenceDir,
        retentionDays: 30,
        secrets: new SecretRegistry(),
        now: () => NOW,
      }),
      reservationRetentionYears: 5,
      logger: captureLogs().logger,
      now: () => NOW,
    });
    expect(result.reservationsAnonymized).toBe(1);
    expect(result.commercialLinesAnonymized).toBe(1);

    const oldDetail = await getCommercialDetail(db, OLD);
    expect(oldDetail.returns[0]?.rejectionReason).toBeNull();
    expect(oldDetail.events.find((event) => event.type === 'return_rejected')?.reason).toBeNull();
    expect((await findLine(db, OLD))?.lastReadReturn).toBeNull();
    // A recente fica como estava.
    const recentDetail = await getCommercialDetail(db, RECENT);
    expect(recentDetail.returns[0]?.rejectionReason).toBe(
      'Hóspede Fictício ligou e pediu outro cartão',
    );

    await sync.runRound();
    expect(sheet.rows('toCharge').map((row) => row[1])).toEqual(['900002']);
    expect((await findLine(db, OLD))?.removedFromSheetAt).toEqual(NOW);
    // O retorno continua no sistema (código, valor, responsável).
    const [kept] = await db
      .select()
      .from(commercialReturns)
      .where(eq(commercialReturns.reservationNumber, OLD.reservationNumber));
    expect(kept).toMatchObject({ authorizationCode: 'AUT123', chargedAmount: '1234.56' });
  });
});
