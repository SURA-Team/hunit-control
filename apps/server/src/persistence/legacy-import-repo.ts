/**
 * Persistência da importação do histórico do sistema anterior (specs/004, data-model §1, research
 * R-01, R-05, R-08, R-10): exclusão mútua, autor reservado, associação de hotéis e registro de
 * cada simulação ou importação.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Database } from './db.js';
import {
  apiClients,
  legacyHotelMappings,
  legacyImports,
  legacyReservations,
  type LegacyImportCounts,
  type LegacyImportDifference,
  type LegacyImportIssue,
  type LegacyImportWarningEntry,
} from './schema.js';

/** Autor dos registros importados (research R-05): revogado e sem chave. Nome reservado. */
export const LEGACY_AUTHOR_NAME = 'sistema-anterior';

/** Chave do *advisory lock* da importação (valor arbitrário, diferente do das migrations). */
const IMPORT_LOCK_KEY = 4_004_004_004;

/** Já existe uma simulação ou importação em andamento (FR-020). */
export class ImportInProgressError extends Error {
  constructor() {
    super('Já existe uma importação em andamento.');
    this.name = 'ImportInProgressError';
  }
}

/**
 * Executa `fn` segurando o lock da importação numa conexão própria. O lock some sozinho se o
 * processo cair (a conexão fecha), sem estado preso no banco (research R-01).
 */
export async function withImportLock<T>(pool: pg.Pool, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [IMPORT_LOCK_KEY],
    );
    if (!result.rows[0]?.locked) throw new ImportInProgressError();
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [IMPORT_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Id do autor reservado; cria na primeira vez (perfil consulta, revogado, chave inexistente). */
export async function ensureLegacyAuthor(db: Database): Promise<string> {
  const keyHash = createHash('sha256').update(randomBytes(32)).digest('hex');
  await db
    .insert(apiClients)
    .values({ name: LEGACY_AUTHOR_NAME, role: 'reader', keyHash, revokedAt: new Date() })
    .onConflictDoNothing({ target: apiClients.name });
  const [author] = await db
    .select({ id: apiClients.id })
    .from(apiClients)
    .where(eq(apiClients.name, LEGACY_AUTHOR_NAME));
  if (!author) throw new Error('autor reservado do sistema anterior não encontrado');
  return author.id;
}

// ---------------------------------------------------------------------------
// Associação de hotéis (FR-006a, research R-10)
// ---------------------------------------------------------------------------

export type HotelMapping = typeof legacyHotelMappings.$inferSelect;

export async function listHotelMappings(db: Database): Promise<HotelMapping[]> {
  return db.select().from(legacyHotelMappings).orderBy(legacyHotelMappings.legacyKey);
}

/**
 * Registra os hotéis vistos numa simulação: os novos entram como `proposed` com a proposta (ou sem
 * hotel); os já conhecidos só atualizam o nome, e uma proposta ainda não confirmada é recalculada.
 */
export async function upsertHotelProposals(
  db: Database,
  hotels: readonly { legacyKey: string; legacyName: string; proposal: string | null }[],
): Promise<void> {
  for (const hotel of hotels) {
    await db
      .insert(legacyHotelMappings)
      .values({
        legacyKey: hotel.legacyKey,
        legacyName: hotel.legacyName,
        decision: 'proposed',
        hotelCode: hotel.proposal,
      })
      .onConflictDoUpdate({
        target: legacyHotelMappings.legacyKey,
        set: {
          legacyName: hotel.legacyName,
          hotelCode: sql`case when ${legacyHotelMappings.decision} = 'proposed' then ${hotel.proposal}::text else ${legacyHotelMappings.hotelCode} end`,
          updatedAt: new Date(),
        },
      });
  }
}

/** Confirma (ou troca) a associação; `null` = sem associação. Devolve `false` se o código não existe. */
export async function setHotelMapping(
  db: Database,
  legacyKey: string,
  hotelCode: string | null,
): Promise<boolean> {
  const updated = await db
    .update(legacyHotelMappings)
    .set({
      decision: hotelCode === null ? 'unmapped' : 'confirmed',
      hotelCode,
      updatedAt: new Date(),
    })
    .where(eq(legacyHotelMappings.legacyKey, legacyKey))
    .returning({ legacyKey: legacyHotelMappings.legacyKey });
  return updated.length > 0;
}

/** Confirma todas as propostas com hotel; devolve quantas. */
export async function acceptHotelProposals(db: Database): Promise<number> {
  const updated = await db
    .update(legacyHotelMappings)
    .set({ decision: 'confirmed', updatedAt: new Date() })
    .where(
      and(eq(legacyHotelMappings.decision, 'proposed'), isNotNull(legacyHotelMappings.hotelCode)),
    )
    .returning({ legacyKey: legacyHotelMappings.legacyKey });
  return updated.length;
}

/** Só as associações confirmadas valem na simulação e na importação (research R-10). */
export async function confirmedHotelMappings(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({ legacyKey: legacyHotelMappings.legacyKey, hotelCode: legacyHotelMappings.hotelCode })
    .from(legacyHotelMappings)
    .where(eq(legacyHotelMappings.decision, 'confirmed'));
  return new Map(
    rows.flatMap((row) => (row.hotelCode === null ? [] : [[row.legacyKey, row.hotelCode]])),
  );
}

// ---------------------------------------------------------------------------
// Simulações e importações (FR-005, FR-005a, research R-08, R-09)
// ---------------------------------------------------------------------------

export type LegacyImportRow = typeof legacyImports.$inferSelect;

export async function createImportRecord(
  db: Database,
  record: { kind: 'simulation' | 'import'; fingerprint: string; simulationId?: string },
): Promise<string> {
  const [created] = await db
    .insert(legacyImports)
    .values({
      kind: record.kind,
      fingerprint: record.fingerprint,
      simulationId: record.simulationId ?? null,
    })
    .returning({ id: legacyImports.id });
  if (!created) throw new Error('registro da importação não foi criado');
  return created.id;
}

export async function finishImportRecord(
  db: Database,
  id: string,
  result: {
    status: 'completed' | 'failed' | 'interrupted';
    counts?: LegacyImportCounts;
    issues?: LegacyImportIssue[];
    warnings?: LegacyImportWarningEntry[];
    differences?: LegacyImportDifference[];
    outcomes?: Record<string, string>;
  },
): Promise<void> {
  await db
    .update(legacyImports)
    .set({
      status: result.status,
      finishedAt: new Date(),
      ...(result.counts ? { counts: result.counts } : {}),
      ...(result.issues ? { issues: result.issues } : {}),
      ...(result.warnings ? { warnings: result.warnings } : {}),
      ...(result.differences ? { differences: result.differences } : {}),
      ...(result.outcomes ? { outcomes: result.outcomes } : {}),
    })
    .where(eq(legacyImports.id, id));
}

export async function findImportRecord(db: Database, id: string): Promise<LegacyImportRow | null> {
  const [row] = await db.select().from(legacyImports).where(eq(legacyImports.id, id));
  return row ?? null;
}

/** Importações que não terminaram (para o aviso `previous_import_incomplete`). */
export async function countIncompleteImports(db: Database): Promise<number> {
  const rows = await db
    .select({ id: legacyImports.id })
    .from(legacyImports)
    .where(
      and(
        eq(legacyImports.kind, 'import'),
        inArray(legacyImports.status, ['running', 'interrupted', 'failed']),
      ),
    );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Origem das reservas (FR-010, FR-011)
// ---------------------------------------------------------------------------

export type LegacyReservationRow = typeof legacyReservations.$inferSelect;

export async function findLegacyOrigin(
  db: Database,
  hotelCode: string,
  reservationNumber: string,
): Promise<LegacyReservationRow | null> {
  const [row] = await db
    .select()
    .from(legacyReservations)
    .where(
      and(
        eq(legacyReservations.hotelCode, hotelCode),
        eq(legacyReservations.reservationNumber, reservationNumber),
      ),
    );
  return row ?? null;
}
