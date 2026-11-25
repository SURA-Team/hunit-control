/**
 * Resumo do período para o módulo de Relatórios (specs/007, research R-02 a R-05; data-model §2):
 * uma consulta sobre a CTE dos fatos da tratativa das contagens da 006 (`treatmentFactsCte`), com a
 * faixa de cada reserva montada a partir das listas do domínio (`reportBucket`), agrupada por hotel.
 * Os totais do período são a soma das linhas, feita aqui. Sem dado de hóspede.
 */
import {
  CLASSIFICATIONS_REQUIRING_CHARGE,
  REPORT_CHARGED_SITUATIONS,
  REPORT_EXCLUDED_SITUATIONS,
  type Period,
} from '@hunit/domain';
import { and, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { Database } from './db.js';
import {
  factsDetailedSituation,
  filterConditions,
  treatmentFactsColumns,
  treatmentFactsCte,
  type ReservationFilters,
} from './reservations-repo.js';
import { hotels, reservations } from './schema.js';

/**
 * Filtros do relatório (specs/007, FR-005a, research R-14): os do painel "Filtros avançados" da área
 * Reservas e a Origem, com a mesma regra da lista. O período vem à parte.
 */
export type ReportFilters = Pick<
  ReservationFilters,
  | 'hotelCodes'
  | 'detailedSituations'
  | 'reservationStatuses'
  | 'channel'
  | 'fromLegacy'
  | 'notFound'
>;

/** Valores em reais como no banco: texto decimal com duas casas (`"1234.56"`). */
export type Amount = string;

export interface HotelReportRow {
  hotelCode: string;
  hotelName: string;
  reservations: number;
  treatmentsSent: number;
  openCount: number;
  openAmount: Amount;
  requested: Amount;
  pending: Amount;
  previousCharged: Amount;
  recovered: Amount;
  withoutAmount: number;
  lastVerifiedAt: Date | null;
}

export interface ReportOverview {
  period: Period;
  generatedAt: Date;
  lastVerifiedAt: Date | null;
  reservations: number;
  treatmentsSent: number;
  withoutAmount: number;
  hotels: { withData: number; total: number };
  open: { amount: Amount; count: number; requested: Amount; pending: Amount };
  charged: { amount: Amount; previous: Amount; recovered: Amount };
  hotelRows: HotelReportRow[];
}

function listSql(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/** Centavos de um valor `"1234.56"` (sem ponto flutuante). */
function centsOf(amount: Amount): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

function amountOf(cents: bigint): Amount {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${absolute / 100n}.${fraction}`;
}

function sumAmounts(values: readonly Amount[]): Amount {
  return amountOf(values.reduce((sum, value) => sum + centsOf(value), 0n));
}

function dateOf(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

interface RawRow extends Record<string, unknown> {
  hotel_code: string;
  hotel_name: string | null;
  reservations: number;
  treatments_sent: number;
  open_count: number;
  requested: string;
  pending: string;
  previous_charged: string;
  recovered: string;
  without_amount: number;
  last_verified_at: Date | string | null;
}

/**
 * Resumo do período de check-in (as duas pontas incluídas), com os filtros da lista, se vierem. O
 * período já vem validado (`validatePeriod`).
 */
export async function reportOverview(
  db: Database,
  period: Period,
  filters: ReportFilters = {},
  now: Date = new Date(),
): Promise<ReportOverview> {
  const where =
    and(
      gte(reservations.checkIn, period.from),
      lte(reservations.checkIn, period.to),
      ...filterConditions({
        hotelCodes: filters.hotelCodes,
        detailedSituations: filters.detailedSituations,
        reservationStatuses: filters.reservationStatuses,
        channel: filters.channel,
        fromLegacy: filters.fromLegacy,
        notFound: filters.notFound,
      }),
    ) ?? sql`true`;
  const facts = treatmentFactsColumns();
  const situation = factsDetailedSituation(facts);
  const pendingCharge = sql`(${facts.classification} in (${listSql(CLASSIFICATIONS_REQUIRING_CHARGE)}) and not ${facts.hasProof})`;
  // Mesma regra de `reportBucket` (domínio); o teste de paridade confere os dois.
  const bucket = sql`(case
    when ${situation} in (${listSql(REPORT_EXCLUDED_SITUATIONS)}) then 'excluded'
    when ${pendingCharge} then (case when ${facts.hasRequest} then 'requested' else 'pending' end)
    when ${situation} in (${listSql(REPORT_CHARGED_SITUATIONS)})
      then (case when ${facts.hasRequest} then 'recovered' else 'previous_charged' end)
    else 'none'
  end)`;
  // Mesma regra de `reportAmount`.
  const amount = sql`(case
    when rb.bucket in ('pending', 'requested') then rb.amount_to_charge
    when rb.bucket in ('previous_charged', 'recovered') then coalesce(rb.charged_amount_shown, rb.total_amount)
  end)`;
  const sumOf = (name: string) =>
    sql`coalesce(sum(rv.amount) filter (where rv.bucket = ${name}), 0)::numeric(16, 2)::text`;
  const result = await db.execute<RawRow>(sql`
    ${treatmentFactsCte(where)},
    report_buckets as (
      select facts.hotel_code, facts.last_verified_at, facts.has_request, facts.amount_to_charge,
        facts.charged_amount_shown, facts.total_amount, ${bucket} as bucket
      from facts
    ),
    report_values as (
      select rb.hotel_code, rb.last_verified_at, rb.has_request, rb.bucket, ${amount} as amount
      from report_buckets rb
      where rb.bucket <> 'excluded'
    )
    select rv.hotel_code,
      max(${hotels.name}) as hotel_name,
      count(*)::int as reservations,
      (count(*) filter (where rv.has_request))::int as treatments_sent,
      (count(*) filter (where rv.bucket in ('pending', 'requested')))::int as open_count,
      ${sumOf('requested')} as requested,
      ${sumOf('pending')} as pending,
      ${sumOf('previous_charged')} as previous_charged,
      ${sumOf('recovered')} as recovered,
      (count(*) filter (where rv.bucket <> 'none' and rv.amount is null))::int as without_amount,
      max(rv.last_verified_at) as last_verified_at
    from report_values rv
    left join ${hotels} on ${hotels.code} = rv.hotel_code
    group by rv.hotel_code
    order by rv.hotel_code`);

  const hotelRows: HotelReportRow[] = result.rows.map((row) => ({
    hotelCode: row.hotel_code,
    hotelName: row.hotel_name ?? row.hotel_code,
    reservations: row.reservations,
    treatmentsSent: row.treatments_sent,
    openCount: row.open_count,
    openAmount: sumAmounts([row.requested, row.pending]),
    requested: row.requested,
    pending: row.pending,
    previousCharged: row.previous_charged,
    recovered: row.recovered,
    withoutAmount: row.without_amount,
    lastVerifiedAt: dateOf(row.last_verified_at),
  }));

  // "X de Y" (research R-05): disponíveis mais os indisponíveis com dados no período; com filtro de
  // hotéis, só os escolhidos (FR-011, R-14).
  const chosen = filters.hotelCodes !== undefined && filters.hotelCodes.length > 0;
  const available = await db
    .select({ code: hotels.code })
    .from(hotels)
    .where(
      chosen
        ? and(sql`${hotels.available}`, inArray(hotels.code, [...(filters.hotelCodes ?? [])]))
        : sql`${hotels.available}`,
    );
  const catalog = new Set(available.map((hotel) => hotel.code));
  for (const row of hotelRows) catalog.add(row.hotelCode);

  const requested = sumAmounts(hotelRows.map((row) => row.requested));
  const pending = sumAmounts(hotelRows.map((row) => row.pending));
  const previous = sumAmounts(hotelRows.map((row) => row.previousCharged));
  const recovered = sumAmounts(hotelRows.map((row) => row.recovered));
  const verified = hotelRows
    .map((row) => row.lastVerifiedAt)
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime());
  const total = (pick: (row: HotelReportRow) => number) =>
    hotelRows.reduce((sum, row) => sum + pick(row), 0);

  return {
    period,
    generatedAt: now,
    lastVerifiedAt: verified[0] ?? null,
    reservations: total((row) => row.reservations),
    treatmentsSent: total((row) => row.treatmentsSent),
    withoutAmount: total((row) => row.withoutAmount),
    hotels: { withData: hotelRows.length, total: catalog.size },
    open: {
      amount: sumAmounts([requested, pending]),
      count: total((row) => row.openCount),
      requested,
      pending,
    },
    charged: { amount: sumAmounts([previous, recovered]), previous, recovered },
    hotelRows,
  };
}
