import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  pool: pg.Pool;
  db: Database;
  /** Encerra todas as conexões. Depois disso a conexão não pode mais ser usada. */
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** Chamado quando uma conexão ociosa do pool falha (ex.: o banco reiniciou). */
  onPoolError?: (error: Error) => void;
}

/** As migrations ficam ao lado deste arquivo, tanto em `src/` quanto em `dist/` (ver build). */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/** Chave do bloqueio que impede duas aplicações de migrations ao mesmo tempo (valor arbitrário). */
const MIGRATION_LOCK_KEY = 4_815_162_342;

const CONNECTION_TIMEOUT_MS = 10_000;

export function connectDatabase(
  databaseUrl: string,
  options: ConnectOptions = {},
): DatabaseConnection {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });

  // Sem este listener, um erro em conexão ociosa derrubaria o processo.
  pool.on('error', (error) => options.onPoolError?.(error));

  return {
    pool,
    db: drizzle({ client: pool, schema }),
    close: () => pool.end(),
  };
}

/**
 * Aplica as migrations pendentes. Pode ser chamada em toda inicialização: migrations já
 * aplicadas são ignoradas.
 *
 * Um bloqueio no banco garante que só um processo aplica migrations por vez (ex.: o servidor
 * iniciando enquanto alguém roda o CLI).
 */
export async function runMigrations(connection: DatabaseConnection): Promise<void> {
  const lockClient = await connection.pool.connect();
  try {
    await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await lockClient.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
