import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import {
  connectDatabase,
  runMigrations,
  type DatabaseConnection,
} from '../../src/persistence/db.js';

export interface TestDatabase extends DatabaseConnection {
  /** URL de conexão deste banco de teste. */
  url: string;
}

/**
 * Cria um banco PostgreSQL vazio e exclusivo, já com as migrations aplicadas.
 *
 * Use em `beforeAll` e chame `close()` em `afterAll`. Cada arquivo de teste tem o seu banco,
 * então os arquivos podem rodar em paralelo sem interferir uns nos outros. O banco é descartado
 * junto com o container ao fim da rodada.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('postgresAdminUrl');
  const databaseName = `test_${randomUUID().replaceAll('-', '')}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // O nome é gerado aqui (só letras, números e "_"), então pode ir direto no comando.
    await admin.query(`create database ${databaseName}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;

  const connection = connectDatabase(url.toString());
  await runMigrations(connection);

  return { ...connection, url: url.toString() };
}
