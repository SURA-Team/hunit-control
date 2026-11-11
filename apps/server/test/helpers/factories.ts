/**
 * Fábricas de registros para testes: inserem linhas válidas com valores padrão, para que cada
 * teste informe só o que importa para ele.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/persistence/db.js';
import { apiClients, executions, hotels } from '../../src/persistence/schema.js';

type NewClient = typeof apiClients.$inferInsert;
type NewExecution = typeof executions.$inferInsert;
type NewHotel = typeof hotels.$inferInsert;

export async function insertClient(db: Database, overrides: Partial<NewClient> = {}) {
  const unique = randomUUID();
  const [row] = await db
    .insert(apiClients)
    .values({
      name: `cliente-${unique}`,
      role: 'operator',
      keyHash: `hash-${unique}`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insertClient não devolveu a linha inserida');
  return row;
}

export async function insertHotel(db: Database, overrides: Partial<NewHotel> = {}) {
  const unique = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(hotels)
    .values({ code: `hotel-${unique}`, name: `Hotel ${unique}`, ...overrides })
    .returning();
  if (!row) throw new Error('insertHotel não devolveu a linha inserida');
  return row;
}

/** Insere uma execução; cria um cliente se `clientId` não for informado. */
export async function insertExecution(db: Database, overrides: Partial<NewExecution> = {}) {
  const clientId = overrides.clientId ?? (await insertClient(db)).id;
  const [row] = await db
    .insert(executions)
    .values({
      accountKey: `conta-${randomUUID()}`,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-07',
      ...overrides,
      clientId,
    })
    .returning();
  if (!row) throw new Error('insertExecution não devolveu a linha inserida');
  return row;
}
