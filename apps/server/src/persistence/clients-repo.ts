import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db.js';
import { isConstraintViolation, PG_UNIQUE_VIOLATION } from './errors.js';
import { apiClients, type ClientRole } from './schema.js';

export interface ClientIdentity {
  id: string;
  name: string;
  role: ClientRole;
}

/** Já existe um cliente (ativo ou revogado) com o nome informado. */
export class ClientNameTakenError extends Error {
  constructor(name: string) {
    super(`Já existe um cliente chamado "${name}".`);
    this.name = 'ClientNameTakenError';
  }
}

/** Cliente dono da chave, se ela existir e não estiver revogada. */
export async function findActiveClientByKeyHash(
  db: Database,
  keyHash: string,
): Promise<ClientIdentity | null> {
  const [client] = await db
    .select({ id: apiClients.id, name: apiClients.name, role: apiClients.role })
    .from(apiClients)
    .where(and(eq(apiClients.keyHash, keyHash), isNull(apiClients.revokedAt)))
    .limit(1);
  return client ?? null;
}

/** Cadastra um cliente. Só o hash da chave é guardado (research R-10). */
export async function createClient(
  db: Database,
  client: { name: string; role: ClientRole; keyHash: string },
): Promise<ClientIdentity> {
  try {
    const [created] = await db
      .insert(apiClients)
      .values(client)
      .returning({ id: apiClients.id, name: apiClients.name, role: apiClients.role });
    if (!created) throw new Error('O banco não devolveu o cliente criado.');
    return created;
  } catch (error) {
    if (isConstraintViolation(error, PG_UNIQUE_VIOLATION, 'api_clients_name_unique')) {
      throw new ClientNameTakenError(client.name);
    }
    throw error;
  }
}

export type RevokeResult = 'revoked' | 'already_revoked' | 'not_found';

/** Revoga um cliente pelo nome: a chave dele deixa de ser aceita imediatamente. */
export async function revokeClient(db: Database, name: string): Promise<RevokeResult> {
  const revoked = await db
    .update(apiClients)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiClients.name, name), isNull(apiClients.revokedAt)))
    .returning({ id: apiClients.id });
  if (revoked.length > 0) return 'revoked';

  const [existing] = await db
    .select({ id: apiClients.id })
    .from(apiClients)
    .where(eq(apiClients.name, name))
    .limit(1);
  return existing ? 'already_revoked' : 'not_found';
}
