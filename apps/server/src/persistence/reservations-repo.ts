import {
  markNotFound,
  mergeVerification,
  selectNotFound,
  type Classification,
  type Period,
  type ReservationData,
  type ReservationRecord,
  type ReservationStatus,
} from '@hunit/domain';
import {
  and,
  asc,
  between,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Database } from './db.js';
import type { HotelProgress } from './execution-hotels-repo.js';
import { InvalidCursorError } from './executions-repo.js';
import { executionHotels, reservationObservations, reservations } from './schema.js';

export type ReservationRow = typeof reservations.$inferSelect;
type ReservationInsert = typeof reservations.$inferInsert;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Linhas por comando de inserção (o PostgreSQL aceita no máximo 65 535 parâmetros por comando). */
const INSERT_BATCH = 500;

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += INSERT_BATCH) {
    result.push(items.slice(start, start + INSERT_BATCH));
  }
  return result;
}

/**
 * Linha do banco → registro do domínio (data do pagamento em ISO, como no domínio). Colunas que
 * o domínio não usa (ex.: `last_execution_id`) seguem junto e são ignoradas por ele.
 */
export function toReservationRecord(row: ReservationRow): ReservationRecord {
  const { chargedAt, ...rest } = row;
  return { ...rest, chargedAt: chargedAt ? chargedAt.toISOString() : null };
}

function toInsert(record: ReservationRecord, executionId: string): ReservationInsert {
  return {
    ...record,
    chargedAt: record.chargedAt ? new Date(record.chargedAt) : null,
    lastExecutionId: executionId,
  };
}

/** Colunas atualizadas quando a reserva já existe: todas, menos a chave. */
const UPSERT_SET = Object.fromEntries(
  Object.entries(getTableColumns(reservations))
    .filter(([key]) => key !== 'hotelCode' && key !== 'reservationNumber')
    .map(([key, column]) => [key, sql.raw(`excluded.${column.name}`)]),
) as Partial<Record<keyof ReservationInsert, SQL>>;

export interface HotelResult {
  executionId: string;
  hotelCode: string;
  /** Período consultado na execução (todo ele, não os blocos). */
  period: Period;
  /** Reservas vistas no hotel, uma por número (sem repetições). */
  reservations: readonly ReservationData[];
  progress: HotelProgress;
  now: Date;
}

export interface CommitSummary {
  inserted: number;
  updated: number;
  /** Reservas marcadas agora como "não encontradas na última verificação" (FR-018a). */
  markedNotFound: number;
}

/**
 * Grava o resultado de um hotel concluído numa única transação (FR-019, research R-15):
 * 1. inclui ou atualiza cada reserva com o histórico de verificação (FR-017, FR-018);
 * 2. registra o que esta execução observou (`reservation_observations`, FR-020);
 * 3. marca como "não encontradas" as reservas gravadas do hotel, com check-in no período, que
 *    não apareceram (FR-018a);
 * 4. marca o hotel como `completed`, com o andamento final.
 *
 * Se qualquer passo falhar, nada é gravado.
 */
export async function commitHotel(db: Database, result: HotelResult): Promise<CommitSummary> {
  const { executionId, hotelCode, period, now } = result;
  const numbers = [...new Set(result.reservations.map((item) => item.reservationNumber))];
  if (numbers.length !== result.reservations.length) {
    throw new Error('commitHotel recebeu a mesma reserva mais de uma vez.');
  }

  return db.transaction(async (tx) => {
    const existing = await lockHotelReservations(tx, hotelCode, numbers, period);
    const byNumber = new Map(existing.map((record) => [record.reservationNumber, record]));

    const merged = result.reservations.map((observed) =>
      mergeVerification(byNumber.get(observed.reservationNumber) ?? null, observed, now),
    );
    for (const batch of batches(merged)) {
      await tx
        .insert(reservations)
        .values(batch.map((record) => toInsert(record, executionId)))
        .onConflictDoUpdate({
          target: [reservations.hotelCode, reservations.reservationNumber],
          set: UPSERT_SET,
        });
    }

    for (const batch of batches(result.reservations)) {
      await tx.insert(reservationObservations).values(
        batch.map((observed) => ({
          executionId,
          hotelCode,
          reservationNumber: observed.reservationNumber,
          classification: observed.classification,
          reservationStatus: observed.reservationStatus,
          observedAt: now,
        })),
      );
    }

    const newlyMissing = selectNotFound(existing, new Set(numbers), period)
      .filter((record) => record.notFoundSince === null)
      .map((record) => markNotFound(record, now));
    for (const batch of batches(newlyMissing)) {
      await tx
        .update(reservations)
        .set({ notFoundSince: now })
        .where(
          and(
            eq(reservations.hotelCode, hotelCode),
            inArray(
              reservations.reservationNumber,
              batch.map((record) => record.reservationNumber),
            ),
            isNull(reservations.notFoundSince),
          ),
        );
    }

    await tx
      .update(executionHotels)
      .set({
        ...result.progress,
        counts: { ...result.progress.counts },
        status: 'completed',
        failureReason: null,
        finishedAt: now,
      })
      .where(
        and(eq(executionHotels.executionId, executionId), eq(executionHotels.hotelCode, hotelCode)),
      );

    const updated = merged.filter((record) => record.verificationCount > 1).length;
    return {
      inserted: merged.length - updated,
      updated,
      markedNotFound: newlyMissing.length,
    };
  });
}

/**
 * Reservas gravadas do hotel que esta verificação pode alterar: as vistas agora e as com
 * check-in no período (candidatas a "não encontradas"). Ficam bloqueadas até o fim da transação.
 */
async function lockHotelReservations(
  tx: Transaction,
  hotelCode: string,
  numbers: readonly string[],
  period: Period,
): Promise<ReservationRecord[]> {
  const inPeriod = between(reservations.checkIn, period.from, period.to);
  const scope =
    numbers.length > 0
      ? or(inArray(reservations.reservationNumber, [...numbers]), inPeriod)
      : inPeriod;
  const rows = await tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.hotelCode, hotelCode), scope))
    .for('update');
  return rows.map(toReservationRecord);
}

// ---------------------------------------------------------------------------
// Consultas (FR-020)
// ---------------------------------------------------------------------------

export interface ReservationFilters {
  /** Somente reservas observadas nesta execução. */
  executionId?: string | undefined;
  hotelCodes?: readonly string[] | undefined;
  classifications?: readonly Classification[] | undefined;
  reservationStatuses?: readonly ReservationStatus[] | undefined;
  /** `true` = só as "não encontradas na última verificação"; `false` = só as encontradas. */
  notFound?: boolean | undefined;
  checkInFrom?: string | undefined;
  checkInTo?: string | undefined;
  /**
   * Busca livre (specs/002, FR-020a), já sem espaços nas pontas: número da reserva, transação,
   * código de autorização ou referência da operadora iguais ao texto, sem diferenciar
   * maiúsculas; ou o nome do hóspede contendo o texto, sem diferenciar maiúsculas e acentos.
   */
  q?: string | undefined;
  /** Canal exatamente igual (specs/002, FR-020). */
  channel?: string | undefined;
  /** Valor total ou valor cobrado iguais, no formato da API: "1234.56" (specs/002, FR-020b). */
  amount?: string | undefined;
}

export interface ListReservationsOptions extends ReservationFilters {
  limit: number;
  /** Valor de `nextCursor` de uma página anterior. */
  cursor?: string | undefined;
}

export interface ReservationPageResult {
  items: ReservationRow[];
  nextCursor: string | null;
}

function encodeCursor(row: ReservationRow): string {
  return Buffer.from(JSON.stringify([row.hotelCode, row.reservationNumber]), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((part) => typeof part === 'string')
    ) {
      return value as [string, string];
    }
  } catch {
    // Cai no erro abaixo.
  }
  throw new InvalidCursorError();
}

/**
 * Condição da busca livre (specs/002, FR-020a). Os códigos comparam o texto inteiro, sem
 * diferenciar maiúsculas. O nome usa `strpos` em vez de `like`: assim `%` e `_` digitados são
 * texto, não curinga. Nome nulo (anonimizado, FR-026 da 001) nunca coincide.
 */
function freeTextCondition(text: string): SQL {
  return sql`(lower(${reservations.reservationNumber}) = lower(${text})
    or lower(${reservations.transactionId}) = lower(${text})
    or lower(${reservations.authorizationCode}) = lower(${text})
    or lower(${reservations.processorReference}) = lower(${text})
    or (${reservations.anonymizedAt} is null
      and strpos(unaccent(lower(${reservations.guestName})), unaccent(lower(${text}))) > 0))`;
}

/**
 * Reservas com filtros combináveis (FR-020), em ordem de hotel e número, paginadas por cursor.
 * Os filtros de classificação e situação valem para o estado atual da reserva.
 *
 * @throws InvalidCursorError
 */
export async function listReservations(
  db: Database,
  options: ListReservationsOptions,
): Promise<ReservationPageResult> {
  const conditions: SQL[] = [];
  const has = <T>(values: readonly T[] | undefined): values is readonly T[] =>
    values !== undefined && values.length > 0;

  if (options.executionId !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${reservationObservations} o where o.execution_id = ${options.executionId} and o.hotel_code = ${reservations.hotelCode} and o.reservation_number = ${reservations.reservationNumber})`,
    );
  }
  if (has(options.hotelCodes))
    conditions.push(inArray(reservations.hotelCode, [...options.hotelCodes]));
  if (has(options.classifications)) {
    conditions.push(inArray(reservations.classification, [...options.classifications]));
  }
  if (has(options.reservationStatuses)) {
    conditions.push(inArray(reservations.reservationStatus, [...options.reservationStatuses]));
  }
  if (options.notFound === true) conditions.push(isNotNull(reservations.notFoundSince));
  if (options.notFound === false) conditions.push(isNull(reservations.notFoundSince));
  if (options.checkInFrom !== undefined) {
    conditions.push(sql`${reservations.checkIn} >= ${options.checkInFrom}`);
  }
  if (options.checkInTo !== undefined) {
    conditions.push(sql`${reservations.checkIn} <= ${options.checkInTo}`);
  }
  if (options.q !== undefined) conditions.push(freeTextCondition(options.q));
  if (options.channel !== undefined) conditions.push(eq(reservations.channel, options.channel));
  if (options.amount !== undefined) {
    const amountCondition = or(
      eq(reservations.totalAmount, options.amount),
      eq(reservations.chargedAmount, options.amount),
    );
    if (amountCondition) conditions.push(amountCondition);
  }
  if (options.cursor !== undefined) {
    const [hotelCode, reservationNumber] = decodeCursor(options.cursor);
    conditions.push(
      sql`(${reservations.hotelCode}, ${reservations.reservationNumber}) > (${hotelCode}, ${reservationNumber})`,
    );
  }

  // Lê um registro a mais para saber se existe uma próxima página.
  const rows = await db
    .select()
    .from(reservations)
    .where(and(...conditions))
    .orderBy(asc(reservations.hotelCode), asc(reservations.reservationNumber))
    .limit(options.limit + 1);

  const items = rows.slice(0, options.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null,
  };
}

/** Canais presentes nas reservas gravadas, em ordem alfabética (specs/002, filtro da FR-020). */
export async function listChannels(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ channel: reservations.channel })
    .from(reservations)
    .orderBy(asc(reservations.channel));
  return rows.map((row) => row.channel);
}

export async function findReservation(
  db: Database,
  hotelCode: string,
  reservationNumber: string,
): Promise<ReservationRow | null> {
  const [row] = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.hotelCode, hotelCode),
        eq(reservations.reservationNumber, reservationNumber),
      ),
    );
  return row ?? null;
}
