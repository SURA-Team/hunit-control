import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listHotels, saveCatalog } from '../../src/persistence/hotels-repo.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

let database: TestDatabase;

// Cada teste começa com o catálogo vazio.
beforeEach(async () => {
  database = await createTestDatabase();
});

afterEach(async () => {
  await database.close();
});

const MONDAY = new Date('2026-11-09T10:00:00Z');
const TUESDAY = new Date('2026-11-10T10:00:00Z');

describe('saveCatalog (T030, FR-008)', () => {
  it('inclui os hotéis novos como disponíveis', async () => {
    await saveCatalog(
      database.db,
      [
        { code: '20', name: 'Hotel Beta' },
        { code: '10', name: 'Hotel Alfa' },
      ],
      MONDAY,
    );

    expect(await listHotels(database.db)).toEqual([
      { code: '10', name: 'Hotel Alfa', available: true, firstSeenAt: MONDAY, lastSeenAt: MONDAY },
      { code: '20', name: 'Hotel Beta', available: true, firstSeenAt: MONDAY, lastSeenAt: MONDAY },
    ]);
  });

  it('atualiza nome e last_seen_at, preserva first_seen_at e marca os ausentes como indisponíveis', async () => {
    await saveCatalog(
      database.db,
      [
        { code: '10', name: 'Hotel Alfa' },
        { code: '20', name: 'Hotel Beta' },
      ],
      MONDAY,
    );
    await saveCatalog(database.db, [{ code: '10', name: 'Hotel Alfa Centro' }], TUESDAY);

    expect(await listHotels(database.db)).toEqual([
      {
        code: '10',
        name: 'Hotel Alfa Centro',
        available: true,
        firstSeenAt: MONDAY,
        lastSeenAt: TUESDAY,
      },
      { code: '20', name: 'Hotel Beta', available: false, firstSeenAt: MONDAY, lastSeenAt: MONDAY },
    ]);
  });

  it('um hotel que volta a aparecer fica disponível de novo', async () => {
    await saveCatalog(database.db, [{ code: '10', name: 'Hotel Alfa' }], MONDAY);
    await saveCatalog(database.db, [], TUESDAY);
    expect((await listHotels(database.db))[0]?.available).toBe(false);

    await saveCatalog(database.db, [{ code: '10', name: 'Hotel Alfa' }], TUESDAY);
    expect((await listHotels(database.db))[0]).toMatchObject({ available: true });
  });

  it('aceita códigos repetidos no catálogo (fica o último)', async () => {
    await saveCatalog(
      database.db,
      [
        { code: '10', name: 'Nome antigo' },
        { code: '10', name: 'Nome novo' },
      ],
      MONDAY,
    );

    expect(await listHotels(database.db)).toMatchObject([{ code: '10', name: 'Nome novo' }]);
  });
});
