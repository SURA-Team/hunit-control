/**
 * Relatos do Comercial (specs/008, US2 e US3; research R-06, R-07, R-19; data-model §1.2): "Cobrada
 * no Hunit" e "Cancelada" (era "Não cobrada"), lidos da planilha sem retorno de cobrança. Uma linha
 * por reserva, o relato atual da linha de "A cobrar"; trocar a situação ou apagar remove o relato
 * (FR-012). A "Cancelada" é validada pelo Financeiro: confirmar marca a reserva como "Cancelada sem
 * cobrança" (na mesma transação); recusar guarda o motivo, que vai para a coluna J.
 *
 * A fila "Cobradas no Hunit" não tem estado próprio: a situação de cada relato é derivada da última
 * leitura da reserva no Hunit depois do relato, aqui em SQL, com a mesma regra de
 * `hunitChargeStatus` e `inHunitQueue` do domínio (teste de paridade). Nada aqui acessa o Hunit.
 */
import {
  CLASSIFICATIONS_REQUIRING_CHARGE,
  HUNIT_QUEUE_CONFIRMED_DAYS,
  reportChanged,
  type Classification,
  type CommercialReportValues,
  type HunitChargeStatus,
} from '@hunit/domain';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Transaction } from './account-lock.js';
import {
  insertCommercialEvent,
  noChargeMarkedCondition,
  qualified,
  type ReservationKey,
} from './commercial-repo.js';
import type { Database } from './db.js';
import { findDatabaseError, PG_UNIQUE_VIOLATION } from './errors.js';
import { markNoChargeTx, type MarkNoChargeResult } from './no-charge-repo.js';
import {
  commercialLines,
  commercialReports,
  commercialReturns,
  hotels,
  reservations,
  treatmentDocuments,
} from './schema.js';

type Executor = Database | Transaction;

export type ReportRow = typeof commercialReports.$inferSelect;

function ofReservation(key: ReservationKey): SQL | undefined {
  return and(
    eq(commercialReports.hotelCode, key.hotelCode),
    eq(commercialReports.reservationNumber, key.reservationNumber),
  );
}

/** O relato guardado, no formato do domínio (para `reportChanged`). */
export function reportValuesOf(row: ReportRow): CommercialReportValues {
  return {
    kind: row.kind,
    situationText: row.situationText,
    chargedBy: row.chargedBy,
    chargeDate: row.chargeDate,
  };
}

export async function findReport(
  executor: Executor,
  key: ReservationKey,
): Promise<ReportRow | null> {
  const [row] = await executor.select().from(commercialReports).where(ofReservation(key));
  return row ?? null;
}

/** Os relatos de várias reservas, numa consulta (rodada da planilha). */
export async function reportsByKeys(
  db: Database,
  keys: readonly ReservationKey[],
): Promise<ReportRow[]> {
  if (keys.length === 0) return [];
  const tuples = keys.map((key) => sql`(${key.hotelCode}, ${key.reservationNumber})`);
  return db
    .select()
    .from(commercialReports)
    .where(
      sql`(${commercialReports.hotelCode}, ${commercialReports.reservationNumber}) in (${sql.join(tuples, sql`, `)})`,
    );
}

/**
 * Grava o relato lido (dentro da transação da linha). Novo: `report_received`. Mesmo tipo com
 * responsável, data ou texto diferente: atualiza e renova `read_at` (a reserva volta a "Aguardando
 * verificação"), `report_changed`. Outro tipo: o anterior sai (`report_cleared`) e o novo entra.
 */
export async function recordReport(
  tx: Transaction,
  key: ReservationKey,
  report: CommercialReportValues,
  now: Date,
): Promise<'none' | 'received' | 'changed'> {
  const existing = await findReport(tx, key);
  if (existing && !reportChanged(reportValuesOf(existing), report)) return 'none';

  // Versão nova do relato: aguarda de novo a verificação no Hunit (R-07) ou, a "Cancelada", a
  // validação do Financeiro (R-19).
  const values = {
    kind: report.kind,
    situationText: report.situationText,
    chargedBy: report.chargedBy,
    chargeDate: report.chargeDate,
    readAt: now,
    settledResult: null,
    settledAt: null,
    validationState: report.kind === 'cancelled' ? ('awaiting_validation' as const) : null,
    decidedAt: null,
    decidedByClientId: null,
    rejectionReason: null,
    noChargeMarkId: null,
  };
  if (existing && existing.kind === report.kind) {
    await tx.update(commercialReports).set(values).where(ofReservation(key));
    await insertCommercialEvent(tx, {
      ...key,
      type: 'report_changed',
      clientId: null,
      reason: report.situationText,
      at: now,
    });
    return 'changed';
  }
  if (existing) await clearReport(tx, key, now);
  await tx.insert(commercialReports).values({ ...key, ...values });
  await insertCommercialEvent(tx, {
    ...key,
    type: 'report_received',
    clientId: null,
    reason: report.situationText,
    at: now,
  });
  return existing ? 'changed' : 'received';
}

/** O Comercial trocou a situação ou apagou o relato: a reserva sai da fila (FR-012). */
export async function clearReport(
  tx: Transaction,
  key: ReservationKey,
  now: Date,
): Promise<boolean> {
  const removed = await tx
    .delete(commercialReports)
    .where(ofReservation(key))
    .returning({ situationText: commercialReports.situationText });
  const [row] = removed;
  if (!row) return false;
  await insertCommercialEvent(tx, {
    ...key,
    type: 'report_cleared',
    clientId: null,
    reason: row.situationText,
    at: now,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Situação derivada (research R-07) — mesma regra de `hunitChargeStatus`
// ---------------------------------------------------------------------------

const REQUIRING = sql.join(
  CLASSIFICATIONS_REQUIRING_CHARGE.map((classification) => sql`${classification}`),
  sql`, `,
);

/** Situação derivada do relato (R-07), sempre pela classificação do Hunit. */
export function hunitStatusExpression(): SQL<HunitChargeStatus> {
  return sql<HunitChargeStatus>`(case
    when ${reservations.lastVerifiedAt} <= ${commercialReports.readAt} then 'awaiting'
    when ${reservations.classification} = 'virtual_card_already_charged' then 'confirmed'
    else 'not_found' end)`;
}

/**
 * A reserva ainda exige cobrança agora? Classificação efetiva (sem a marcação "Cancelada sem
 * cobrança") que exige cobrança e sem comprovante (documento ou retorno confirmado).
 */
export function requiresChargeNowExpression(): SQL<boolean> {
  return sql<boolean>`(${reservations.classification} in (${REQUIRING})
    and not ${noChargeMarkedCondition()}
    and not exists (select 1 from ${treatmentDocuments} td where td.hotel_code = ${qualified(reservations.hotelCode)} and td.reservation_number = ${qualified(reservations.reservationNumber)} and td.kind = 'proof' and td.ended_at is null)
    and not exists (select 1 from ${commercialReturns} cr where cr.hotel_code = ${qualified(reservations.hotelCode)} and cr.reservation_number = ${qualified(reservations.reservationNumber)} and cr.state = 'confirmed'))`;
}

/** Uma reserva da fila "Cobradas no Hunit" (tela 7.15). */
export interface HunitQueueRow {
  hotelCode: string;
  hotelName: string;
  reservationNumber: string;
  guestName: string | null;
  channel: string;
  totalAmount: string | null;
  noChargeMarked: boolean;
  situationText: string;
  chargedBy: string;
  chargeDate: string | null;
  readAt: Date;
  status: HunitChargeStatus;
  lastVerifiedAt: Date;
  /** Leitura que definiu a situação (confirmada ou não encontrada); nula enquanto aguarda. */
  settledAt: Date | null;
  classification: Classification;
  requiresChargeNow: boolean;
}

const STATUS_ORDER = sql`(case ${hunitStatusExpression()} when 'awaiting' then 0 when 'not_found' then 1 else 2 end)`;

/**
 * A fila (FR-013, data-model §3.4; mesma regra de `inHunitQueue`): aguardando sempre; não encontradas
 * que ainda exigem cobrança sempre; as demais até 7 dias depois da leitura que as definiu
 * (`settled_at`, gravado por `settleCommercialReport`). Ordem:
 * aguardando → não encontrada → confirmada; leitura mais antiga primeiro.
 */
export async function listHunitQueue(db: Database, now: Date): Promise<HunitQueueRow[]> {
  const status = hunitStatusExpression();
  const requiresChargeNow = requiresChargeNowExpression();
  const cutoff = new Date(now.getTime() - HUNIT_QUEUE_CONFIRMED_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      hotelCode: commercialReports.hotelCode,
      hotelName: hotels.name,
      reservationNumber: commercialReports.reservationNumber,
      guestName: reservations.guestName,
      channel: reservations.channel,
      totalAmount: reservations.totalAmount,
      noChargeMarked: noChargeMarkedCondition(),
      situationText: commercialReports.situationText,
      chargedBy: commercialReports.chargedBy,
      chargeDate: commercialReports.chargeDate,
      readAt: commercialReports.readAt,
      status,
      lastVerifiedAt: reservations.lastVerifiedAt,
      settledAt: commercialReports.settledAt,
      classification: reservations.classification,
      requiresChargeNow,
    })
    .from(commercialReports)
    .innerJoin(
      reservations,
      and(
        eq(reservations.hotelCode, commercialReports.hotelCode),
        eq(reservations.reservationNumber, commercialReports.reservationNumber),
      ),
    )
    .innerJoin(hotels, eq(hotels.code, commercialReports.hotelCode))
    .where(
      and(
        eq(commercialReports.kind, 'charged_in_hunit'),
        sql`(${status} = 'awaiting'
          or (${status} = 'not_found' and ${requiresChargeNow})
          or coalesce(${commercialReports.settledAt}, ${reservations.lastVerifiedAt}) >= ${cutoff})`,
      ),
    )
    .orderBy(STATUS_ORDER, commercialReports.readAt, commercialReports.hotelCode);
  // O responsável é obrigatório em "Cobrada no Hunit" (`commercial_reports_kind_check`).
  return rows.map((row) => ({ ...row, chargedBy: row.chargedBy ?? '' }));
}

/** Quantas reservas a fila mostra (contagem da aba, `CommercialSheetStatus.hunitQueueCount`). */
export async function countHunitQueue(db: Database, now: Date): Promise<number> {
  return (await listHunitQueue(db, now)).length;
}

/** "Cancelada" do Comercial aguardando a validação do Financeiro (homologação, R-19). */
export interface CancellationAwaitingRow {
  hotelCode: string;
  reservationNumber: string;
  situationText: string;
  chargedBy: string | null;
  chargeDate: string | null;
  readAt: Date;
  totalAmount: string | null;
}

/** "Cancelada" aguardando validação, com a linha em "A cobrar" e a reserva sem marcação ativa. */
function cancellationAwaitingCondition(): SQL | undefined {
  return and(
    eq(commercialReports.kind, 'cancelled'),
    eq(commercialReports.validationState, 'awaiting_validation'),
    eq(commercialLines.state, 'open'),
    sql`not ${noChargeMarkedCondition(commercialReports.hotelCode, commercialReports.reservationNumber)}`,
  );
}

/**
 * As "Cancelada" que aparecem em "Retornos a validar" (spec FR-007c): só com a linha em "A cobrar"
 * e a reserva sem a marcação "Cancelada sem cobrança". As decididas continuam no histórico.
 */
export async function listCancellationsAwaiting(db: Database): Promise<CancellationAwaitingRow[]> {
  return db
    .select({
      hotelCode: commercialReports.hotelCode,
      reservationNumber: commercialReports.reservationNumber,
      situationText: commercialReports.situationText,
      chargedBy: commercialReports.chargedBy,
      chargeDate: commercialReports.chargeDate,
      readAt: commercialReports.readAt,
      totalAmount: reservations.totalAmount,
    })
    .from(commercialReports)
    .innerJoin(
      commercialLines,
      and(
        eq(commercialLines.hotelCode, commercialReports.hotelCode),
        eq(commercialLines.reservationNumber, commercialReports.reservationNumber),
      ),
    )
    .innerJoin(
      reservations,
      and(
        eq(reservations.hotelCode, commercialReports.hotelCode),
        eq(reservations.reservationNumber, commercialReports.reservationNumber),
      ),
    )
    .where(cancellationAwaitingCondition())
    .orderBy(commercialReports.readAt, commercialReports.hotelCode);
}

export type CancellationDecisionResult = MarkNoChargeResult | { ok: false; reason: 'not_awaiting' };

/** A "Cancelada" da reserva, travada, se estiver aguardando validação com a linha em "A cobrar". */
async function lockCancellationAwaiting(
  tx: Transaction,
  key: ReservationKey,
): Promise<ReportRow | null> {
  const [row] = await tx
    .select({ report: commercialReports })
    .from(commercialReports)
    .innerJoin(
      commercialLines,
      and(
        eq(commercialLines.hotelCode, commercialReports.hotelCode),
        eq(commercialLines.reservationNumber, commercialReports.reservationNumber),
      ),
    )
    .where(and(ofReservation(key), cancellationAwaitingCondition()))
    .for('update', { of: commercialReports });
  return row?.report ?? null;
}

/**
 * Confirma a "Cancelada" (spec FR-007c): marca a reserva como "Cancelada sem cobrança" (as regras e
 * recusas da marcação, FR-022) e guarda a decisão com a marcação criada, tudo na mesma transação.
 */
export async function confirmCancellationTx(
  tx: Transaction,
  input: { key: ReservationKey; clientId: string; now: Date },
): Promise<CancellationDecisionResult> {
  const { key, now } = input;
  const report = await lockCancellationAwaiting(tx, key);
  if (!report) return { ok: false, reason: 'not_awaiting' };
  const marked = await markNoChargeTx(tx, {
    key,
    note: `Situação informada pelo Comercial: ${report.situationText}`,
    clientId: input.clientId,
    now,
  });
  if (!marked.ok) return marked;
  await tx
    .update(commercialReports)
    .set({
      validationState: 'confirmed',
      decidedAt: now,
      decidedByClientId: input.clientId,
      rejectionReason: null,
      noChargeMarkId: marked.markId,
    })
    .where(ofReservation(key));
  await insertCommercialEvent(tx, {
    ...key,
    type: 'cancellation_confirmed',
    clientId: input.clientId,
    reason: null,
    at: now,
  });
  return marked;
}

export async function confirmCancellation(
  db: Database,
  input: { key: ReservationKey; clientId: string; now: Date },
): Promise<CancellationDecisionResult> {
  try {
    return await db.transaction((tx) => confirmCancellationTx(tx, input));
  } catch (error) {
    // Outra marcação entrou ao mesmo tempo (índice único da marcação ativa).
    if (findDatabaseError(error)?.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, reason: 'not_accepted', detail: 'already_marked' };
    }
    throw error;
  }
}

/**
 * Recusa a "Cancelada" com o motivo (spec FR-007c), que vai para a coluna J; a reserva não muda. A
 * linha da planilha é reescrita na próxima rodada (a versão avança).
 */
export async function rejectCancellation(
  db: Database,
  input: { key: ReservationKey; clientId: string; reason: string; now: Date },
): Promise<{ ok: true } | { ok: false; reason: 'not_awaiting' }> {
  const { key, now } = input;
  return db.transaction(async (tx) => {
    const report = await lockCancellationAwaiting(tx, key);
    if (!report) return { ok: false, reason: 'not_awaiting' } as const;
    await tx
      .update(commercialReports)
      .set({
        validationState: 'rejected',
        decidedAt: now,
        decidedByClientId: input.clientId,
        rejectionReason: input.reason,
      })
      .where(ofReservation(key));
    await insertCommercialEvent(tx, {
      ...key,
      type: 'cancellation_rejected',
      clientId: input.clientId,
      reason: input.reason,
      at: now,
    });
    await tx
      .update(commercialLines)
      .set({ version: sql`${commercialLines.version} + 1`, changedAt: now })
      .where(
        and(
          eq(commercialLines.hotelCode, key.hotelCode),
          eq(commercialLines.reservationNumber, key.reservationNumber),
        ),
      );
    return { ok: true } as const;
  });
}
