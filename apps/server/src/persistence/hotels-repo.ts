import { and, asc, eq, exists, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { accountHotels, hotels } from './schema.js';

export type HotelRow = typeof hotels.$inferSelect;

export interface CatalogHotel {
  code: string;
  name: string;
}

/**
 * Grava o catálogo de hotéis que uma conta do Hunit acabou de ler (FR-008), numa transação:
 * - hotel novo é incluído; hotel conhecido tem o nome e `last_seen_at` atualizados;
 * - o catálogo da conta (`account_hotels`) passa a ser exatamente o lido;
 * - `hotels.available` = alguma conta acessa o hotel. Contas diferentes podem acessar hotéis
 *   diferentes: a leitura de uma conta não tira a disponibilidade dos hotéis de outra (FR-009a).
 *   O hotel que nenhuma conta acessa mais fica indisponível (o histórico dele continua no banco).
 *
 * @param accountKey HMAC do usuário do Hunit (research R-11).
 */
export async function saveCatalog(
  db: Database,
  accountKey: string,
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
          set: { name: sql`excluded.name`, lastSeenAt: now },
        });
      await tx
        .insert(accountHotels)
        .values(codes.map((hotelCode) => ({ accountKey, hotelCode, lastSeenAt: now })))
        .onConflictDoUpdate({
          target: [accountHotels.accountKey, accountHotels.hotelCode],
          set: { lastSeenAt: now },
        });
    }

    await tx
      .delete(accountHotels)
      .where(
        and(
          eq(accountHotels.accountKey, accountKey),
          codes.length > 0 ? notInArray(accountHotels.hotelCode, codes) : undefined,
        ),
      );

    await tx.update(hotels).set({
      available: exists(
        tx
          .select({ one: sql`1` })
          .from(accountHotels)
          .where(eq(accountHotels.hotelCode, hotels.code)),
      ),
    });
  });
}

/**
 * Hotéis da última leitura do catálogo da conta, ou `null` se a conta ainda não tem catálogo
 * conhecido (nunca rodou, ou o último catálogo dela veio vazio).
 */
export async function knownCatalogOf(
  db: Database,
  accountKey: string,
): Promise<ReadonlySet<string> | null> {
  const rows = await db
    .select({ code: accountHotels.hotelCode })
    .from(accountHotels)
    .where(eq(accountHotels.accountKey, accountKey));
  return rows.length === 0 ? null : new Set(rows.map((row) => row.code));
}

/**
 * Hotéis, entre os informados, que alguma conta do Hunit diferente da informada acessa: ficam
 * pendentes para uma retomada com outra conta (FR-009a).
 */
export async function hotelsAccessibleByOtherAccounts(
  db: Database,
  accountKey: string,
  hotelCodes: readonly string[],
): Promise<Set<string>> {
  if (hotelCodes.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ code: accountHotels.hotelCode })
    .from(accountHotels)
    .where(
      and(
        ne(accountHotels.accountKey, accountKey),
        inArray(accountHotels.hotelCode, [...hotelCodes]),
      ),
    );
  return new Set(rows.map((row) => row.code));
}

/** Catálogo conhecido, em ordem alfabética, incluindo os hotéis que não estão mais disponíveis. */
export async function listHotels(db: Database): Promise<HotelRow[]> {
  return db.select().from(hotels).orderBy(asc(hotels.name), asc(hotels.code));
}
