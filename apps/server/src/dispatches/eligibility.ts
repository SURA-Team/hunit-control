/**
 * Quem aceita o envio ao Comercial (specs/005, FR-001, FR-003): a regra é a do domínio
 * (`dispatchEligibility`); aqui só se juntam os dados de cada reserva. Não acessa o Hunit.
 */
import { dispatchEligibility, type Classification, type DispatchEligibility } from '@hunit/domain';
import { sql } from 'drizzle-orm';
import type { Database } from '../persistence/db.js';
import { reservations } from '../persistence/schema.js';
import {
  loadTreatmentSummaries,
  reservationKeyOf,
  treatmentFlags,
  type ReservationKey,
} from '../persistence/treatments-repo.js';

export interface EligibilityItem extends ReservationKey {
  eligibility: DispatchEligibility;
  /** `null` = a reserva não existe. */
  classification: Classification | null;
  totalAmount: string | null;
  checkIn: string | null;
}

/** Tira as reservas repetidas, mantendo a ordem pedida. */
export function uniqueReservationKeys(keys: readonly ReservationKey[]): ReservationKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const mapKey = reservationKeyOf(key);
    if (seen.has(mapKey)) return false;
    seen.add(mapKey);
    return true;
  });
}

/** A elegibilidade de cada reserva, na ordem pedida, em quatro consultas. */
export async function checkDispatchEligibility(
  db: Database,
  keys: readonly ReservationKey[],
): Promise<EligibilityItem[]> {
  if (keys.length === 0) return [];
  const tuples = keys.map((key) => sql`(${key.hotelCode}, ${key.reservationNumber})`);
  const rows = await db
    .select({
      hotelCode: reservations.hotelCode,
      reservationNumber: reservations.reservationNumber,
      classification: reservations.classification,
      totalAmount: reservations.totalAmount,
      checkIn: reservations.checkIn,
    })
    .from(reservations)
    .where(
      sql`(${reservations.hotelCode}, ${reservations.reservationNumber}) in (${sql.join(tuples, sql`, `)})`,
    );
  const found = new Map(rows.map((row) => [reservationKeyOf(row), row]));
  const summaries = await loadTreatmentSummaries(db, keys);

  return keys.map((key) => {
    const row = found.get(reservationKeyOf(key));
    const summary = summaries.get(reservationKeyOf(key));
    const flags = summary
      ? treatmentFlags(summary)
      : { hasCurrentProof: false, hasReturnAwaiting: false };
    return {
      hotelCode: key.hotelCode,
      reservationNumber: key.reservationNumber,
      classification: row?.classification ?? null,
      totalAmount: row?.totalAmount ?? null,
      checkIn: row?.checkIn ?? null,
      eligibility: dispatchEligibility({
        classification: row?.classification ?? null,
        hasCurrentProof: flags.hasCurrentProof,
        hasReturnAwaiting: flags.hasReturnAwaiting,
        lineState: summary?.commercial?.lineState ?? null,
      }),
    };
  });
}
