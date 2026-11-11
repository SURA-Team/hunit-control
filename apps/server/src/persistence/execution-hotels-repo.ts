import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import {
  executionHotels,
  hotels,
  type ClassificationCounts,
  type HotelRunStatus,
} from './schema.js';

/** Andamento de um hotel dentro de uma execução (FR-021, FR-021a). */
export interface HotelProgress {
  pagesTotal: number;
  pagesDone: number;
  /** Reservas que o Hunit informou na listagem (base da estimativa, research R-08a). */
  reservationsTotal: number;
  reservationsSeen: number;
  /** Reservas efetivamente abertas (exclui as "258-"); base do tempo médio (research R-08a). */
  reservationsOpened: number;
  counts: ClassificationCounts;
}

export function emptyHotelProgress(): HotelProgress {
  return {
    pagesTotal: 0,
    pagesDone: 0,
    reservationsTotal: 0,
    reservationsSeen: 0,
    reservationsOpened: 0,
    counts: {},
  };
}

/**
 * Inclui os hotéis na execução como `pending`. Só entram hotéis conhecidos no catálogo (a tabela
 * `hotels`); códigos repetidos ou já incluídos são ignorados.
 *
 * @returns os códigos incluídos.
 */
export async function registerExecutionHotels(
  db: Database,
  executionId: string,
  hotelCodes: readonly string[],
): Promise<string[]> {
  if (hotelCodes.length === 0) return [];
  const known = await db
    .select({ code: hotels.code })
    .from(hotels)
    .where(inArray(hotels.code, [...new Set(hotelCodes)]));
  const knownCodes = new Set(known.map((row) => row.code));
  const codes = [...new Set(hotelCodes)].filter((code) => knownCodes.has(code));
  if (codes.length === 0) return [];

  await db
    .insert(executionHotels)
    .values(codes.map((hotelCode) => ({ executionId, hotelCode })))
    .onConflictDoNothing();
  return codes;
}

function where(executionId: string, hotelCode: string) {
  return and(
    eq(executionHotels.executionId, executionId),
    eq(executionHotels.hotelCode, hotelCode),
  );
}

/** O hotel começou a ser processado: zera o andamento e marca o início (FR-021a). */
export async function startExecutionHotel(
  db: Database,
  executionId: string,
  hotelCode: string,
  now: Date,
): Promise<void> {
  await db
    .update(executionHotels)
    .set({
      ...emptyHotelProgress(),
      status: 'running',
      failureReason: null,
      startedAt: now,
      finishedAt: null,
    })
    .where(where(executionId, hotelCode));
}

/** Atualiza o andamento do hotel em processamento. */
export async function updateExecutionHotelProgress(
  db: Database,
  executionId: string,
  hotelCode: string,
  progress: HotelProgress,
): Promise<void> {
  await db
    .update(executionHotels)
    .set({ ...progress, counts: { ...progress.counts } })
    .where(where(executionId, hotelCode));
}

/**
 * Encerra o hotel sem gravar reservas (FR-019): `failed` (com o motivo) ou `cancelled`.
 * O andamento até o momento fica registrado.
 */
export async function finishExecutionHotelWithoutResults(
  db: Database,
  executionId: string,
  hotelCode: string,
  outcome: { status: Extract<HotelRunStatus, 'failed' | 'cancelled'>; reason: string },
  now: Date,
  progress?: HotelProgress,
): Promise<void> {
  await db
    .update(executionHotels)
    .set({
      ...(progress && { ...progress, counts: { ...progress.counts } }),
      status: outcome.status,
      failureReason: outcome.reason,
      // Um hotel que nem começou não tem início; a duração dele fica sem valor.
      finishedAt: sql`case when ${executionHotels.startedAt} is null then null else ${now.toISOString()}::timestamptz end`,
    })
    .where(where(executionId, hotelCode));
}

/** Médias de tempo das execuções anteriores (research R-08a). */
export interface TimingHistoryRow {
  secondsPerReservation: number | null;
  secondsPerHotel: number | null;
}

function toSeconds(value: string | number | null): number | null {
  if (value === null) return null;
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Médias por reserva aberta e por hotel dos últimos hotéis concluídos em outras execuções. É a
 * base da estimativa no início de uma execução, antes de ela medir o próprio tempo (FR-021a).
 */
export async function loadTimingHistory(
  db: Database,
  options: { excludeExecutionId: string; limit?: number },
): Promise<TimingHistoryRow> {
  const recent = db
    .select({
      seconds:
        sql<string>`extract(epoch from ${executionHotels.finishedAt} - ${executionHotels.startedAt})`.as(
          'seconds',
        ),
      opened: executionHotels.reservationsOpened,
    })
    .from(executionHotels)
    .where(
      and(
        eq(executionHotels.status, 'completed'),
        isNotNull(executionHotels.startedAt),
        isNotNull(executionHotels.finishedAt),
        ne(executionHotels.executionId, options.excludeExecutionId),
      ),
    )
    .orderBy(desc(executionHotels.finishedAt))
    .limit(options.limit ?? 50)
    .as('recent');

  const [row] = await db
    .select({
      // Só hotéis que abriram reservas entram na média por reserva.
      perReservation: sql<
        string | null
      >`sum(${recent.seconds}) filter (where ${recent.opened} > 0) / nullif(sum(${recent.opened}), 0)`,
      perHotel: sql<string | null>`avg(${recent.seconds})`,
    })
    .from(recent);
  return {
    secondsPerReservation: toSeconds(row?.perReservation ?? null),
    secondsPerHotel: toSeconds(row?.perHotel ?? null),
  };
}

/**
 * Encerra sem resultados os hotéis que estavam em processamento nas execuções informadas: `failed`
 * quando o servidor caiu no meio deles, `cancelled` quando a execução foi cancelada sem estar
 * neste processo. Os pendentes continuam pendentes, para a retomada (FR-023).
 */
export async function failRunningExecutionHotels(
  db: Database,
  executionIds: readonly string[],
  reason: string,
  now: Date = new Date(),
  status: Extract<HotelRunStatus, 'failed' | 'cancelled'> = 'failed',
): Promise<void> {
  if (executionIds.length === 0) return;
  await db
    .update(executionHotels)
    .set({ status, failureReason: reason, finishedAt: now })
    .where(
      and(
        inArray(executionHotels.executionId, [...executionIds]),
        eq(executionHotels.status, 'running'),
      ),
    );
}
