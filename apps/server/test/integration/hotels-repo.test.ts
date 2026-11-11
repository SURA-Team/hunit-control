import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { knownCatalogOf, listHotels, saveCatalog } from '../../src/persistence/hotels-repo.js';
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
/** Contas do Hunit, identificadas como no banco (HMAC do usuário, research R-11). */
const ACCOUNT_A = 'conta-a';
const ACCOUNT_B = 'conta-b';

async function availability(): Promise<Record<string, boolean>> {
  const rows = await listHotels(database.db);
  return Object.fromEntries(rows.map((row) => [row.code, row.available]));
}

describe('saveCatalog (T030, FR-008)', () => {
  it('inclui os hotéis novos como disponíveis', async () => {
    await saveCatalog(
      database.db,
      ACCOUNT_A,
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
      ACCOUNT_A,
      [
        { code: '10', name: 'Hotel Alfa' },
        { code: '20', name: 'Hotel Beta' },
      ],
      MONDAY,
    );
    await saveCatalog(database.db, ACCOUNT_A, [{ code: '10', name: 'Hotel Alfa Centro' }], TUESDAY);

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
    await saveCatalog(database.db, ACCOUNT_A, [{ code: '10', name: 'Hotel Alfa' }], MONDAY);
    await saveCatalog(database.db, ACCOUNT_A, [], TUESDAY);
    expect((await listHotels(database.db))[0]?.available).toBe(false);

    await saveCatalog(database.db, ACCOUNT_A, [{ code: '10', name: 'Hotel Alfa' }], TUESDAY);
    expect((await listHotels(database.db))[0]).toMatchObject({ available: true });
  });

  it('aceita códigos repetidos no catálogo (fica o último)', async () => {
    await saveCatalog(
      database.db,
      ACCOUNT_A,
      [
        { code: '10', name: 'Nome antigo' },
        { code: '10', name: 'Nome novo' },
      ],
      MONDAY,
    );

    expect(await listHotels(database.db)).toMatchObject([{ code: '10', name: 'Nome novo' }]);
  });
});

describe('catálogo por conta (T069, FR-008, FR-009a)', () => {
  it('a leitura de uma conta não tira a disponibilidade dos hotéis que só outra conta acessa', async () => {
    await saveCatalog(database.db, ACCOUNT_A, [{ code: '10', name: 'Alfa' }], MONDAY);
    await saveCatalog(
      database.db,
      ACCOUNT_B,
      [
        { code: '20', name: 'Beta' },
        { code: '30', name: 'Gama' },
      ],
      MONDAY,
    );

    // A conta A lê de novo e continua sem acesso a 20 e 30: eles seguem disponíveis (conta B).
    await saveCatalog(database.db, ACCOUNT_A, [{ code: '10', name: 'Alfa' }], TUESDAY);

    expect(await availability()).toEqual({ '10': true, '20': true, '30': true });
  });

  it('o hotel fica indisponível quando nenhuma conta o acessa mais', async () => {
    await saveCatalog(database.db, ACCOUNT_A, [{ code: '10', name: 'Alfa' }], MONDAY);
    await saveCatalog(
      database.db,
      ACCOUNT_B,
      [
        { code: '10', name: 'Alfa' },
        { code: '20', name: 'Beta' },
      ],
      MONDAY,
    );

    await saveCatalog(database.db, ACCOUNT_B, [{ code: '20', name: 'Beta' }], TUESDAY);
    expect(await availability()).toEqual({ '10': true, '20': true });

    await saveCatalog(database.db, ACCOUNT_A, [], TUESDAY);
    expect(await availability()).toEqual({ '10': false, '20': true });
  });

  it('knownCatalogOf devolve os hotéis da última leitura da conta, ou null se ela nunca rodou', async () => {
    await saveCatalog(
      database.db,
      ACCOUNT_A,
      [
        { code: '10', name: 'Alfa' },
        { code: '20', name: 'Beta' },
      ],
      MONDAY,
    );
    await saveCatalog(database.db, ACCOUNT_A, [{ code: '20', name: 'Beta' }], TUESDAY);

    expect(await knownCatalogOf(database.db, ACCOUNT_A)).toEqual(new Set(['20']));
    expect(await knownCatalogOf(database.db, ACCOUNT_B)).toBeNull();
  });
});
