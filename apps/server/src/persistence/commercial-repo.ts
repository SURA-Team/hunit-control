/**
 * A planilha do Comercial no banco (specs/005, FR-008 a FR-020; data-model §1.4 a §1.7): a linha
 * de cada reserva enviada (o estado desejado da projeção, research R-06), os retornos do Comercial,
 * o histórico e o estado da integração.
 *
 * Toda mudança que afeta o que a planilha mostra incrementa `version` da linha; a rodada de
 * sincronização reconcilia a planilha inteira e marca `synced_version`. Linha com
 * `version > synced_version` é uma pendência visível no app (FR-013).
 */
import {
  canRestoreLine,
  lineState,
  type Classification,
  type CommercialLineState,
} from '@hunit/domain';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Transaction } from './account-lock.js';
import type { Database } from './db.js';
import {
  apiClients,
  commercialEvents,
  commercialLines,
  commercialReturns,
  commercialSheetState,
  commercialEventTypeEnum,
  reservations,
  treatmentDocuments,
  type SheetRoundProblem,
} from './schema.js';

type Executor = Database | Transaction;

export type CommercialLineRow = typeof commercialLines.$inferSelect;
export type CommercialReturnRow = typeof commercialReturns.$inferSelect;
export type CommercialReturnState = CommercialReturnRow['state'];
export type CommercialEventType = (typeof commercialEventTypeEnum.enumValues)[number];
export type SheetStateRow = typeof commercialSheetState.$inferSelect;

export interface ReservationKey {
  hotelCode: string;
  reservationNumber: string;
}

function keyOf(key: ReservationKey): string {
  return `${key.hotelCode}\u0000${key.reservationNumber}`;
}

function ofReservation(
  table: typeof commercialLines | typeof commercialReturns | typeof commercialEvents,
  key: ReservationKey,
): SQL {
  return sql`${table.hotelCode} = ${key.hotelCode} and ${table.reservationNumber} = ${key.reservationNumber}`;
}

function inReservations(
  table: typeof commercialLines | typeof commercialReturns,
  keys: readonly ReservationKey[],
): SQL {
  const tuples = keys.map((key) => sql`(${key.hotelCode}, ${key.reservationNumber})`);
  return sql`(${table.hotelCode}, ${table.reservationNumber}) in (${sql.join(tuples, sql`, `)})`;
}

// ---------------------------------------------------------------------------
// Resumo para as consultas de reservas (research R-09, R-10)
// ---------------------------------------------------------------------------

/** O retorno atual: o mais recente que não foi substituído. */
export interface CurrentReturnSummary {
  id: string;
  state: Exclude<CommercialReturnState, 'superseded'>;
  authorizationCode: string;
  chargeHotel: string;
  chargedAmount: string;
  chargedBy: string;
  readAt: Date;
  /** Motivo da recusa, quando recusado (vai para a coluna "Validação do Financeiro"). */
  rejectionReason: string | null;
}

export interface CommercialSummaryRecord {
  lineState: CommercialLineState;
  inSheet: boolean;
  lastSentAt: Date;
  lastDispatchId: string;
  returnProblem: string | null;
  syncPending: boolean;
  currentReturn: CurrentReturnSummary | null;
}

/** Resumo do Comercial de várias reservas, em duas consultas. Sem linha = fora do mapa. */
export async function loadCommercialSummaries(
  executor: Executor,
  keys: readonly ReservationKey[],
): Promise<Map<string, CommercialSummaryRecord>> {
  const summaries = new Map<string, CommercialSummaryRecord>();
  if (keys.length === 0) return summaries;

  const lines = await executor
    .select()
    .from(commercialLines)
    .where(inReservations(commercialLines, keys));
  for (const line of lines) {
    summaries.set(keyOf(line), {
      lineState: line.state,
      inSheet: line.removedFromSheetAt === null,
      lastSentAt: line.lastSentAt,
      lastDispatchId: line.lastDispatchId,
      returnProblem: line.returnProblem,
      syncPending: line.syncedVersion < line.version,
      currentReturn: null,
    });
  }
  if (summaries.size === 0) return summaries;

  const returns = await executor
    .select({
      id: commercialReturns.id,
      hotelCode: commercialReturns.hotelCode,
      reservationNumber: commercialReturns.reservationNumber,
      state: commercialReturns.state,
      authorizationCode: commercialReturns.authorizationCode,
      chargeHotel: commercialReturns.chargeHotel,
      chargedAmount: commercialReturns.chargedAmount,
      chargedBy: commercialReturns.chargedBy,
      readAt: commercialReturns.readAt,
      rejectionReason: commercialReturns.rejectionReason,
    })
    .from(commercialReturns)
    .where(and(inReservations(commercialReturns, keys), ne(commercialReturns.state, 'superseded')))
    .orderBy(desc(commercialReturns.readAt), desc(commercialReturns.id));
  for (const row of returns) {
    const summary = summaries.get(keyOf(row));
    if (!summary || summary.currentReturn !== null || row.state === 'superseded') continue;
    summary.currentReturn = {
      id: row.id,
      state: row.state,
      authorizationCode: row.authorizationCode,
      chargeHotel: row.chargeHotel,
      chargedAmount: row.chargedAmount,
      chargedBy: row.chargedBy,
      readAt: row.readAt,
      rejectionReason: row.rejectionReason,
    };
  }
  return summaries;
}

/** Leitura de um resumo só. */
export async function loadCommercialSummary(
  executor: Executor,
  key: ReservationKey,
): Promise<CommercialSummaryRecord | null> {
  return (await loadCommercialSummaries(executor, [key])).get(keyOf(key)) ?? null;
}

export { keyOf as commercialKeyOf };

// ---------------------------------------------------------------------------
// Histórico (FR-020)
// ---------------------------------------------------------------------------

export interface NewCommercialEvent extends ReservationKey {
  type: CommercialEventType;
  /** `null` = o Comercial, pela planilha, ou o próprio sistema (ver `type`). */
  clientId: string | null;
  dispatchId?: string | null;
  returnId?: string | null;
  classification?: Classification | null;
  reason?: string | null;
  batchId?: string | null;
  at: Date;
}

export async function insertCommercialEvent(
  executor: Executor,
  event: NewCommercialEvent,
): Promise<void> {
  await executor.insert(commercialEvents).values({
    hotelCode: event.hotelCode,
    reservationNumber: event.reservationNumber,
    type: event.type,
    clientId: event.clientId,
    dispatchId: event.dispatchId ?? null,
    returnId: event.returnId ?? null,
    classification: event.classification ?? null,
    reason: event.reason ?? null,
    batchId: event.batchId ?? null,
    at: event.at,
  });
}

// ---------------------------------------------------------------------------
// Linhas (FR-008, FR-009)
// ---------------------------------------------------------------------------

async function lockLine(tx: Transaction, key: ReservationKey): Promise<CommercialLineRow | null> {
  const [row] = await tx
    .select()
    .from(commercialLines)
    .where(ofReservation(commercialLines, key))
    .for('update');
  return row ?? null;
}

/** A linha muda o que a planilha deve mostrar: fica pendente até a próxima rodada (FR-013). */
export async function touchLine(tx: Executor, key: ReservationKey, now: Date): Promise<void> {
  await tx
    .update(commercialLines)
    .set({ version: sql`${commercialLines.version} + 1`, changedAt: now })
    .where(ofReservation(commercialLines, key));
}

/**
 * A reserva foi enviada (FR-006, FR-008): cria a linha aberta, ou reabre e atualiza a existente
 * (reenvio, inclusive de uma linha cancelada ou fora da planilha). O retorno já lido é mantido.
 */
export async function openLineOnSend(
  tx: Transaction,
  input: { key: ReservationKey; dispatchId: string; clientId: string; now: Date },
): Promise<void> {
  const { key, now } = input;
  await tx
    .insert(commercialLines)
    .values({
      hotelCode: key.hotelCode,
      reservationNumber: key.reservationNumber,
      state: 'open',
      firstSentAt: now,
      lastSentAt: now,
      lastDispatchId: input.dispatchId,
      lastSentByClientId: input.clientId,
      changedAt: now,
    })
    .onConflictDoUpdate({
      target: [commercialLines.hotelCode, commercialLines.reservationNumber],
      set: {
        state: 'open',
        lastSentAt: now,
        lastDispatchId: input.dispatchId,
        lastSentByClientId: input.clientId,
        concludedAt: null,
        cancelledAt: null,
        cancelledByClientId: null,
        removedFromSheetAt: null,
        version: sql`${commercialLines.version} + 1`,
        changedAt: now,
      },
    });
}

/** A reserva tem comprovante neste momento? Documento atual (003) ou retorno confirmado. */
async function hasCurrentProof(tx: Executor, key: ReservationKey): Promise<boolean> {
  const [document] = await tx
    .select({ id: treatmentDocuments.id })
    .from(treatmentDocuments)
    .where(
      and(
        eq(treatmentDocuments.hotelCode, key.hotelCode),
        eq(treatmentDocuments.reservationNumber, key.reservationNumber),
        eq(treatmentDocuments.kind, 'proof'),
        isNull(treatmentDocuments.endedAt),
      ),
    )
    .limit(1);
  if (document) return true;
  const [confirmed] = await tx
    .select({ id: commercialReturns.id })
    .from(commercialReturns)
    .where(and(ofReservation(commercialReturns, key), eq(commercialReturns.state, 'confirmed')))
    .limit(1);
  return confirmed !== undefined;
}

async function classificationOf(tx: Executor, key: ReservationKey): Promise<Classification | null> {
  const [row] = await tx
    .select({ classification: reservations.classification })
    .from(reservations)
    .where(
      and(
        eq(reservations.hotelCode, key.hotelCode),
        eq(reservations.reservationNumber, key.reservationNumber),
      ),
    );
  return row?.classification ?? null;
}

/** Motivo do encerramento de um retorno sem validação (spec FR-009, análise "A verificar"). */
export const RETURN_CLOSED_BY_HUNIT = 'o Hunit não exige mais cobrança';
export const RETURN_CLOSED_BY_PROOF = 'comprovante registrado';

/**
 * Recalcula onde a linha deve estar depois de qualquer mudança na reserva (FR-009; research
 * R-06): execução, verificação de um envio, ações da 003, validação do retorno. Sempre marca a
 * linha como pendente (o que a planilha mostra pode ter mudado). Ao sair de "A cobrar", um retorno
 * aguardando validação é encerrado sem validação (`closed`).
 *
 * Deve rodar na mesma transação da mudança, com a reserva já gravada.
 */
export async function refreshCommercialLine(
  tx: Transaction,
  key: ReservationKey,
  now: Date,
): Promise<void> {
  const line = await lockLine(tx, key);
  if (!line) return;
  const classification = await classificationOf(tx, key);
  if (classification === null) return;
  const proof = await hasCurrentProof(tx, key);
  const next = lineState({
    cancelled: line.state === 'cancelled',
    classification,
    hasCurrentProof: proof,
  });

  await tx
    .update(commercialLines)
    .set({
      state: next,
      concludedAt: next === 'open' ? null : (line.concludedAt ?? now),
      // Voltou a "A cobrar" depois de sair da planilha: volta para a planilha.
      ...(next === 'open' ? { removedFromSheetAt: null } : {}),
      version: sql`${commercialLines.version} + 1`,
      changedAt: now,
    })
    .where(ofReservation(commercialLines, key));

  if (next !== line.state && next === 'concluded') {
    await insertCommercialEvent(tx, { ...key, type: 'line_concluded', clientId: null, at: now });
  }
  if (next !== 'open') {
    const closed = await tx
      .update(commercialReturns)
      .set({ state: 'closed', decidedAt: now })
      .where(
        and(
          ofReservation(commercialReturns, key),
          eq(commercialReturns.state, 'awaiting_validation'),
        ),
      )
      .returning({ id: commercialReturns.id });
    for (const row of closed) {
      await insertCommercialEvent(tx, {
        ...key,
        type: 'return_closed',
        clientId: null,
        returnId: row.id,
        reason: proof ? RETURN_CLOSED_BY_PROOF : RETURN_CLOSED_BY_HUNIT,
        at: now,
      });
    }
  }
}

/** `refreshCommercialLine` para as reservas de um hotel que têm linha (gravação de uma execução). */
export async function refreshCommercialLinesOf(
  tx: Transaction,
  hotelCode: string,
  reservationNumbers: readonly string[],
  now: Date,
): Promise<void> {
  if (reservationNumbers.length === 0) return;
  const lines = await tx
    .select({ reservationNumber: commercialLines.reservationNumber })
    .from(commercialLines)
    .where(
      and(
        eq(commercialLines.hotelCode, hotelCode),
        inArray(commercialLines.reservationNumber, [...reservationNumbers]),
      ),
    );
  for (const line of lines) {
    await refreshCommercialLine(tx, { hotelCode, reservationNumber: line.reservationNumber }, now);
  }
}

export async function findLine(
  executor: Executor,
  key: ReservationKey,
): Promise<CommercialLineRow | null> {
  const [row] = await executor
    .select()
    .from(commercialLines)
    .where(ofReservation(commercialLines, key));
  return row ?? null;
}

/** Retorno aguardando validação da reserva, se houver. */
export async function findAwaitingReturn(
  executor: Executor,
  key: ReservationKey,
): Promise<CommercialReturnRow | null> {
  const [row] = await executor
    .select()
    .from(commercialReturns)
    .where(
      and(
        ofReservation(commercialReturns, key),
        eq(commercialReturns.state, 'awaiting_validation'),
      ),
    );
  return row ?? null;
}

export type CancelLineResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'not_open' | 'return_awaiting_validation' };

/** Desfaz o envio (research R-11, clarify Q2): a linha vai para "Concluídas", cancelada. */
export async function cancelLine(
  db: Database,
  input: { key: ReservationKey; clientId: string; now: Date },
): Promise<CancelLineResult> {
  const { key, now } = input;
  return db.transaction(async (tx): Promise<CancelLineResult> => {
    const line = await lockLine(tx, key);
    if (!line) return { ok: false, reason: 'not_found' };
    if (line.state !== 'open') return { ok: false, reason: 'not_open' };
    if (await findAwaitingReturn(tx, key))
      return { ok: false, reason: 'return_awaiting_validation' };

    await tx
      .update(commercialLines)
      .set({
        state: 'cancelled',
        cancelledAt: now,
        cancelledByClientId: input.clientId,
        concludedAt: now,
        version: sql`${commercialLines.version} + 1`,
        changedAt: now,
      })
      .where(ofReservation(commercialLines, key));
    await insertCommercialEvent(tx, {
      ...key,
      type: 'line_cancelled',
      clientId: input.clientId,
      at: now,
    });
    return { ok: true };
  });
}

/** Volta a linha cancelada para "A cobrar" (ou "Concluídas", se a reserva já tem comprovante). */
export async function restoreLine(
  tx: Transaction,
  input: { key: ReservationKey; clientId: string; now: Date },
): Promise<void> {
  const { key, now } = input;
  await tx
    .update(commercialLines)
    .set({
      state: 'open',
      cancelledAt: null,
      cancelledByClientId: null,
      concludedAt: null,
      removedFromSheetAt: null,
      version: sql`${commercialLines.version} + 1`,
      changedAt: now,
    })
    .where(ofReservation(commercialLines, key));
  await insertCommercialEvent(tx, {
    ...key,
    type: 'line_restored',
    clientId: input.clientId,
    at: now,
  });
  await refreshCommercialLine(tx, key, now);
}

export type RestoreLineResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'not_cancelled' | 'expired' | 'not_eligible' };

/** Reverte o envio desfeito, se ainda pode (research R-11; regra `canRestoreLine` do domínio). */
export async function restoreCancelledLine(
  db: Database,
  input: { key: ReservationKey; clientId: string; now: Date },
): Promise<RestoreLineResult> {
  const { key, now } = input;
  return db.transaction(async (tx): Promise<RestoreLineResult> => {
    const line = await lockLine(tx, key);
    const classification = await classificationOf(tx, key);
    if (!line || classification === null) return { ok: false, reason: 'not_found' };
    const check = canRestoreLine(
      { state: line.state, cancelledAt: line.cancelledAt },
      classification,
      now,
    );
    if (check !== 'ok') return { ok: false, reason: check };
    await restoreLine(tx, input);
    return { ok: true };
  });
}

export async function lockLineForUpdate(
  tx: Transaction,
  key: ReservationKey,
): Promise<CommercialLineRow | null> {
  return lockLine(tx, key);
}

// ---------------------------------------------------------------------------
// Detalhe da reserva (GET /reservations/{h}/{n}/commercial)
// ---------------------------------------------------------------------------

const sentByClient = alias(apiClients, 'sent_by_client');
const cancelledByClient = alias(apiClients, 'cancelled_by_client');
const decidedByClient = alias(apiClients, 'decided_by_client');
const eventClient = alias(apiClients, 'event_client');

export interface CommercialLineDetail extends CommercialLineRow {
  lastSentBy: string;
  cancelledBy: string | null;
}

export interface CommercialReturnDetail extends CommercialReturnRow {
  decidedBy: string | null;
}

export interface CommercialEventRecord {
  id: number;
  type: CommercialEventType;
  clientName: string | null;
  dispatchId: string | null;
  returnId: string | null;
  classification: Classification | null;
  reason: string | null;
  batchId: string | null;
  at: Date;
}

export interface CommercialDetail {
  line: CommercialLineDetail | null;
  returns: CommercialReturnDetail[];
  events: CommercialEventRecord[];
}

export async function getCommercialDetail(
  db: Database,
  key: ReservationKey,
): Promise<CommercialDetail> {
  const [lineRow] = await db
    .select({
      line: commercialLines,
      lastSentBy: sentByClient.name,
      cancelledBy: cancelledByClient.name,
    })
    .from(commercialLines)
    .innerJoin(sentByClient, eq(sentByClient.id, commercialLines.lastSentByClientId))
    .leftJoin(cancelledByClient, eq(cancelledByClient.id, commercialLines.cancelledByClientId))
    .where(ofReservation(commercialLines, key));

  const returns = await db
    .select({ row: commercialReturns, decidedBy: decidedByClient.name })
    .from(commercialReturns)
    .leftJoin(decidedByClient, eq(decidedByClient.id, commercialReturns.decidedByClientId))
    .where(ofReservation(commercialReturns, key))
    .orderBy(desc(commercialReturns.readAt), desc(commercialReturns.id));

  const events = await db
    .select({
      id: commercialEvents.id,
      type: commercialEvents.type,
      clientName: eventClient.name,
      dispatchId: commercialEvents.dispatchId,
      returnId: commercialEvents.returnId,
      classification: commercialEvents.classification,
      reason: commercialEvents.reason,
      batchId: commercialEvents.batchId,
      at: commercialEvents.at,
    })
    .from(commercialEvents)
    .leftJoin(eventClient, eq(eventClient.id, commercialEvents.clientId))
    .where(ofReservation(commercialEvents, key))
    .orderBy(desc(commercialEvents.id));

  return {
    line: lineRow
      ? { ...lineRow.line, lastSentBy: lineRow.lastSentBy, cancelledBy: lineRow.cancelledBy }
      : null,
    returns: returns.map(({ row, decidedBy }) => ({ ...row, decidedBy })),
    events,
  };
}

// ---------------------------------------------------------------------------
// Sincronização (research R-06)
// ---------------------------------------------------------------------------

/** O que a rodada precisa de cada linha para montar a planilha. Sem o nome do hóspede (FR-010). */
export interface SheetLineSource {
  hotelCode: string;
  reservationNumber: string;
  state: CommercialLineState;
  version: number;
  /** Última versão escrita na planilha; 0 = a linha ainda não foi escrita. */
  syncedVersion: number;
  lastSentAt: Date;
  concludedAt: Date | null;
  removedFromSheetAt: Date | null;
  returnProblem: string | null;
  lastReadReturn: CommercialLineRow['lastReadReturn'];
  checkIn: string;
  channel: string;
  totalAmount: string | null;
  classification: Classification;
  reservationStatus: (typeof reservations.$inferSelect)['reservationStatus'];
  statusChangedAt: Date | null;
  /** Reserva anonimizada pelo prazo de retenção: a linha sai da planilha (research R-15). */
  anonymized: boolean;
}

/** Todas as linhas que ainda podem estar na planilha (as que saíram ficam de fora). */
export async function listSheetLines(db: Database): Promise<SheetLineSource[]> {
  return db
    .select({
      hotelCode: commercialLines.hotelCode,
      reservationNumber: commercialLines.reservationNumber,
      state: commercialLines.state,
      version: commercialLines.version,
      syncedVersion: commercialLines.syncedVersion,
      lastSentAt: commercialLines.lastSentAt,
      concludedAt: commercialLines.concludedAt,
      removedFromSheetAt: commercialLines.removedFromSheetAt,
      returnProblem: commercialLines.returnProblem,
      lastReadReturn: commercialLines.lastReadReturn,
      checkIn: reservations.checkIn,
      channel: reservations.channel,
      totalAmount: reservations.totalAmount,
      classification: reservations.classification,
      reservationStatus: reservations.reservationStatus,
      statusChangedAt: reservations.statusChangedAt,
      anonymized: sql<boolean>`${reservations.anonymizedAt} is not null`,
    })
    .from(commercialLines)
    .innerJoin(
      reservations,
      and(
        eq(reservations.hotelCode, commercialLines.hotelCode),
        eq(reservations.reservationNumber, commercialLines.reservationNumber),
      ),
    )
    .where(isNull(commercialLines.removedFromSheetAt))
    .orderBy(asc(commercialLines.firstSentAt), asc(commercialLines.hotelCode));
}

/**
 * A rodada escreveu a planilha com as versões lidas: o que mudou depois continua pendente
 * (`synced_version` só avança até a versão que a rodada viu).
 */
export async function markLinesSynced(
  db: Database,
  versions: readonly { key: ReservationKey; version: number }[],
  now: Date,
): Promise<void> {
  for (const { key, version } of versions) {
    await db
      .update(commercialLines)
      .set({
        syncedVersion: sql`greatest(${commercialLines.syncedVersion}, ${version})`,
        syncedAt: now,
      })
      .where(and(ofReservation(commercialLines, key), lt(commercialLines.syncedVersion, version)));
  }
}

/** As linhas saíram da planilha (90 dias depois de concluídas, ou anonimização; R-15). */
export async function markLinesRemovedFromSheet(
  db: Database,
  keys: readonly ReservationKey[],
  now: Date,
): Promise<void> {
  for (const key of keys) {
    await db
      .update(commercialLines)
      .set({ removedFromSheetAt: now })
      .where(and(ofReservation(commercialLines, key), isNull(commercialLines.removedFromSheetAt)));
  }
}

/** Registra um caso relatado na linha (restaurada, alterada; FR-011). */
export async function setSheetIssue(
  db: Database,
  key: ReservationKey,
  issue: string,
  now: Date,
): Promise<void> {
  await db
    .update(commercialLines)
    .set({ sheetIssue: issue, sheetIssueAt: now })
    .where(ofReservation(commercialLines, key));
}

export interface PendingSummary {
  count: number;
  oldestChangeAt: Date | null;
}

/** Linhas com escrita pendente na planilha (FR-013). */
export async function pendingLines(db: Database): Promise<PendingSummary> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${commercialLines.changedAt})`,
    })
    .from(commercialLines)
    .where(sql`${commercialLines.syncedVersion} < ${commercialLines.version}`);
  const oldest = row?.oldest ?? null;
  return { count: row?.count ?? 0, oldestChangeAt: oldest === null ? null : new Date(oldest) };
}

/** Quantos retornos aguardam a validação do Financeiro. */
export async function countAwaitingReturns(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commercialReturns)
    .where(eq(commercialReturns.state, 'awaiting_validation'));
  return row?.count ?? 0;
}

/** Linhas com problema no retorno ou caso relatado, para a lista do app (FR-018). */
export async function listLineProblems(db: Database): Promise<
  Array<{
    hotelCode: string;
    reservationNumber: string;
    returnProblem: string | null;
    returnProblemAt: Date | null;
    sheetIssue: string | null;
    sheetIssueAt: Date | null;
  }>
> {
  return db
    .select({
      hotelCode: commercialLines.hotelCode,
      reservationNumber: commercialLines.reservationNumber,
      returnProblem: commercialLines.returnProblem,
      returnProblemAt: commercialLines.returnProblemAt,
      sheetIssue: commercialLines.sheetIssue,
      sheetIssueAt: commercialLines.sheetIssueAt,
    })
    .from(commercialLines)
    .where(
      sql`(${commercialLines.returnProblem} is not null or ${commercialLines.sheetIssue} is not null) and ${commercialLines.removedFromSheetAt} is null`,
    )
    .orderBy(asc(commercialLines.hotelCode), asc(commercialLines.reservationNumber));
}

/** Estado da integração; cria a linha única na primeira leitura. */
export async function getSheetState(db: Database): Promise<SheetStateRow> {
  const [row] = await db.select().from(commercialSheetState).where(eq(commercialSheetState.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(commercialSheetState)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(commercialSheetState)
    .where(eq(commercialSheetState.id, 1));
  if (!existing) throw new Error('O estado da planilha não pôde ser criado.');
  return existing;
}

export async function updateSheetState(
  db: Database,
  changes: Partial<Omit<SheetStateRow, 'id'>>,
): Promise<void> {
  await getSheetState(db);
  await db.update(commercialSheetState).set(changes).where(eq(commercialSheetState.id, 1));
}

export type { SheetRoundProblem };
