/** Uma importação por vez (specs/004, FR-020, research R-01) — tasks.md, T017. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withImportLock } from '../../src/persistence/legacy-import-repo.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import {
  legacyReservationRow,
  writeLegacyAttachments,
  writeLegacyWorkbook,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace } from '../helpers/legacy-import.js';

let database: TestDatabase;
const workspace = legacyWorkspace();
const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];

beforeAll(async () => {
  database = await createTestDatabase();
  await writeLegacyWorkbook(workspace.xlsx, { reservations: [legacyReservationRow()] });
  writeLegacyAttachments(workspace.files, {});
});

afterAll(async () => {
  await database.close();
  workspace.cleanup();
});

describe('legacy-import com outra em andamento', () => {
  it('recusa com código 1 enquanto a outra não termina; depois funciona', async () => {
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Outro processo segurando o lock (uma conexão própria, como o comando faz).
    const other = withImportLock(database.pool, () => holding);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const blocked = await legacyImport(database, ['simulate', ...files]);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain('Já existe uma importação em andamento.');

    release();
    await other;
    const after = await legacyImport(database, ['simulate', ...files]);
    expect(after.exitCode).toBe(0);
  });

  it('um processo que cai solta o lock (a conexão fecha)', async () => {
    const pool = (await import('pg')).default.Pool;
    const separate = new pool({ connectionString: database.url });
    const client = await separate.connect();
    await client.query('select pg_advisory_lock(4004004004)');
    expect((await legacyImport(database, ['simulate', ...files])).exitCode).toBe(1);
    client.release(true);
    await separate.end();
    expect((await legacyImport(database, ['simulate', ...files])).exitCode).toBe(0);
  });
});
