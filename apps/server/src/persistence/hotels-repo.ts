import { asc, notInArray, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { hotels } from './schema.js';

export type HotelRow = typeof hotels.$inferSelect;

export interface CatalogHotel {
  code: string;
  name: string;
}

/**
 * Grava o catálogo de hotéis lido do Hunit (FR-008), numa transação:
 * - hotel novo é incluído; hotel conhecido tem o nome atualizado;
 * - todo hotel do catálogo fica `available = true`, com `last_seen_at` = agora;
 * - hotel conhecido que não veio neste catálogo fica `available = false` (o histórico dele
 *   continua no banco).
 */
export async function saveCatalog(
  db: Database,
  catalog: readonly CatalogHotel[],
  now: Date = new Date(),
): Promise<void> {
  // Um código repetido faria o upsert alterar a mesma linha duas vezes (erro no PostgreSQL).
  const unique = [...new Map(catalog.map((hotel) => [hotel.code, hotel])).values()];
  const codes = unique.map((hotel) => hotel.code);

  await db.transaction(async (tx) => {
    if (unique.length > 0) {
      await tx
        .insert(hotels)
        .values(
          unique.map((hotel) => ({
            code: hotel.code,
            name: hotel.name,
            firstSeenAt: now,
            lastSeenAt: now,
            available: true,
          })),
        )
        .onConflictDoUpdate({
          target: hotels.code,
          set: { name: sql`excluded.name`, lastSeenAt: now, available: true },
        });
    }

    await tx
      .update(hotels)
      .set({ available: false })
      .where(codes.length > 0 ? notInArray(hotels.code, codes) : undefined);
  });
}

/** Catálogo conhecido, em ordem alfabética, incluindo os hotéis que não estão mais disponíveis. */
export async function listHotels(db: Database): Promise<HotelRow[]> {
  return db.select().from(hotels).orderBy(asc(hotels.name), asc(hotels.code));
}
