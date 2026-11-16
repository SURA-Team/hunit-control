/**
 * Repositório da importação do histórico (specs/004, research R-01, R-05, R-10) — tasks.md, T013.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey } from '../../src/http/auth.js';
import { findActiveClientByKeyHash } from '../../src/persistence/clients-repo.js';
import {
  ImportInProgressError,
  LEGACY_AUTHOR_NAME,
  acceptHotelProposals,
  confirmedHotelMappings,
  createImportRecord,
  ensureLegacyAuthor,
  finishImportRecord,
  findImportRecord,
  listHotelMappings,
  setHotelMapping,
  upsertHotelProposals,
  withImportLock,
} from '../../src/persistence/legacy-import-repo.js';
import { apiClients } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertHotel } from '../helpers/factories.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await insertHotel(database.db, { code: 'HML1', name: 'Hotel Homologação Um' });
  await insertHotel(database.db, { code: 'HML2', name: 'Hotel Homologação Dois' });
});

afterAll(async () => {
  await database.close();
});

describe('withImportLock (FR-020)', () => {
  it('uma por vez; o lock fica livre depois', async () => {
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withImportLock(database.pool, () => holding);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      withImportLock(database.pool, () => Promise.resolve('segunda')),
    ).rejects.toBeInstanceOf(ImportInProgressError);
    release();
    await first;
    await expect(withImportLock(database.pool, () => Promise.resolve('depois'))).resolves.toBe(
      'depois',
    );
  });

  it('solta o lock mesmo quando a função falha', async () => {
    await expect(
      withImportLock(database.pool, () => Promise.reject(new Error('falha'))),
    ).rejects.toThrow('falha');
    await expect(withImportLock(database.pool, () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

describe('ensureLegacyAuthor (R-05)', () => {
  it('cria uma vez, revogado, perfil consulta; nenhuma chave dá acesso como ele', async () => {
    const id = await ensureLegacyAuthor(database.db);
    expect(await ensureLegacyAuthor(database.db)).toBe(id);
    const [author] = await database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.name, LEGACY_AUTHOR_NAME));
    expect(author).toMatchObject({ id, role: 'reader' });
    expect(author?.revokedAt).not.toBeNull();
    expect(await findActiveClientByKeyHash(database.db, author!.keyHash)).toBeNull();
    expect(await findActiveClientByKeyHash(database.db, hashApiKey('qualquer'))).toBeNull();
  });
});

describe('associação de hotéis (R-10)', () => {
  it('proposta, confirmação, troca e sem associação', async () => {
    await upsertHotelProposals(database.db, [
      { legacyKey: 'legacy_hml_um', legacyName: 'Hotel Homologação Um', proposal: 'HML1' },
      { legacyKey: 'legacy_sem', legacyName: 'Sem Par', proposal: null },
    ]);
    expect(await confirmedHotelMappings(database.db)).toEqual(new Map());

    expect(await acceptHotelProposals(database.db)).toBe(1);
    expect(await confirmedHotelMappings(database.db)).toEqual(new Map([['legacy_hml_um', 'HML1']]));

    // Uma nova simulação não desfaz a confirmação.
    await upsertHotelProposals(database.db, [
      { legacyKey: 'legacy_hml_um', legacyName: 'Hotel Homologação Um', proposal: 'HML2' },
    ]);
    expect((await confirmedHotelMappings(database.db)).get('legacy_hml_um')).toBe('HML1');

    expect(await setHotelMapping(database.db, 'legacy_sem', 'HML2')).toBe(true);
    expect(await setHotelMapping(database.db, 'legacy_hml_um', null)).toBe(true);
    expect(await setHotelMapping(database.db, 'nao_existe', 'HML1')).toBe(false);

    const mappings = await listHotelMappings(database.db);
    expect(mappings.map((item) => [item.legacyKey, item.decision, item.hotelCode])).toEqual([
      ['legacy_hml_um', 'unmapped', null],
      ['legacy_sem', 'confirmed', 'HML2'],
    ]);
  });
});

describe('registro das simulações e importações (R-08)', () => {
  it('cria e fecha com contagens, recusas e avisos', async () => {
    const simulation = await createImportRecord(database.db, {
      kind: 'simulation',
      fingerprint: 'f',
    });
    await finishImportRecord(database.db, simulation, {
      status: 'completed',
      issues: [
        {
          sheet: 'Reservas',
          row: 2,
          legacyHotel: 'legacy_hml_um',
          reservationNumber: '900001',
          entity: 'reservation',
          outcome: 'rejected',
          reason: 'unreadable_date',
          column: 'Entrada',
        },
      ],
      warnings: [{ code: 'unreferenced_files', count: 3 }],
    });
    const record = await findImportRecord(database.db, simulation);
    expect(record).toMatchObject({ kind: 'simulation', status: 'completed', fingerprint: 'f' });
    expect(record?.finishedAt).not.toBeNull();

    const imported = await createImportRecord(database.db, {
      kind: 'import',
      fingerprint: 'f',
      simulationId: simulation,
    });
    expect((await findImportRecord(database.db, imported))?.simulationId).toBe(simulation);
  });
});
