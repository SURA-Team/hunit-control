/**
 * Média histórica de tempo dos hotéis concluídos (T054, research R-08a).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTimingHistory } from '../../src/persistence/execution-hotels-repo.js';
import type { Database } from '../../src/persistence/db.js';
import { executionHotels, type HotelRunStatus } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertExecution, insertHotel } from '../helpers/factories.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

interface HotelRunSample {
  seconds: number;
  opened: number;
  status?: HotelRunStatus;
  /** Quanto tempo atrás o hotel terminou, em minutos (ordena os mais recentes). */
  finishedMinutesAgo?: number;
}

/** Grava os hotéis numa execução nova e devolve o id dela. */
async function executionWith(db: Database, samples: HotelRunSample[]): Promise<string> {
  const execution = await insertExecution(db, { status: 'completed' });
  for (const sample of samples) {
    const hotel = await insertHotel(db);
    const finishedAt = new Date(Date.now() - (sample.finishedMinutesAgo ?? 0) * 60_000);
    await db.insert(executionHotels).values({
      executionId: execution.id,
      hotelCode: hotel.code,
      status: sample.status ?? 'completed',
      reservationsOpened: sample.opened,
      startedAt: new Date(finishedAt.getTime() - sample.seconds * 1000),
      finishedAt,
    });
  }
  return execution.id;
}

describe('loadTimingHistory', () => {
  it('sem hotéis concluídos, não há média', async () => {
    const own = await createTestDatabase();
    try {
      expect(await loadTimingHistory(own.db, { excludeExecutionId: randomUUID() })).toEqual({
        secondsPerReservation: null,
        secondsPerHotel: null,
      });
    } finally {
      await own.close();
    }
  });

  it('média por reserva aberta e por hotel; ignora hotéis não concluídos e a própria execução', async () => {
    const own = await executionWith(database.db, [{ seconds: 1000, opened: 1 }]);
    await executionWith(database.db, [
      { seconds: 100, opened: 10 },
      { seconds: 60, opened: 20 },
      // Sem reserva aberta: entra na média por hotel, não na média por reserva.
      { seconds: 20, opened: 0 },
      { seconds: 900, opened: 1, status: 'failed' },
    ]);

    const history = await loadTimingHistory(database.db, { excludeExecutionId: own });

    expect(history.secondsPerReservation).toBeCloseTo(160 / 30, 2);
    expect(history.secondsPerHotel).toBeCloseTo(60, 2);
  });

  it('usa só os hotéis concluídos mais recentes', async () => {
    const own = await createTestDatabase();
    try {
      await executionWith(own.db, [
        { seconds: 10, opened: 1, finishedMinutesAgo: 1 },
        { seconds: 20, opened: 1, finishedMinutesAgo: 2 },
        { seconds: 999, opened: 1, finishedMinutesAgo: 60 },
      ]);

      const history = await loadTimingHistory(own.db, {
        excludeExecutionId: randomUUID(),
        limit: 2,
      });

      expect(history).toEqual({ secondsPerReservation: 15, secondsPerHotel: 15 });
    } finally {
      await own.close();
    }
  });
});
