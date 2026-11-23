/**
 * Retornos do Comercial (specs/005, US2; FR-014 a FR-019; research R-08; data-model §1.5 e §4):
 * gravar o que a planilha trouxe e a validação do Financeiro — confirmar, recusar, desfazer a
 * confirmação e confirmar em lote. Nada aqui acessa o Hunit.
 *
 * O retorno lido nunca muda a reserva sozinho (constitution VI): ele fica aguardando validação, e
 * só a confirmação de um operador vale como comprovante (SC-006).
 */
import {
  describeReturnReading,
  returnChanged,
  returnSnapshot,
  type CommercialReturnReading,
} from '@hunit/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Transaction } from './account-lock.js';
import {
  insertCommercialEvent,
  lockLineForUpdate,
  refreshCommercialLine,
  touchLine,
  type ReservationKey,
} from './commercial-repo.js';
import { clearReport, confirmCancellationTx, recordReport } from './commercial-reports-repo.js';
import type { Database } from './db.js';
import { commercialLines, commercialReturns, reservations, treatmentDocuments } from './schema.js';

export type ReturnRow = typeof commercialReturns.$inferSelect;

function ofReservation(
  table: typeof commercialReturns | typeof commercialLines,
  key: ReservationKey,
) {
  return and(
    eq(table.hotelCode, key.hotelCode),
    eq(table.reservationNumber, key.reservationNumber),
  );
}

/** O que aconteceu com o retorno de uma linha numa rodada. */
export type ReturnReadOutcome = 'none' | 'received' | 'changed' | 'problem' | 'ignored';

async function hasProofDocument(tx: Transaction, key: ReservationKey): Promise<boolean> {
  const [row] = await tx
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
  return row !== undefined;
}

/**
 * Grava o que o Comercial preencheu numa linha de "A cobrar" (research R-08), numa transação:
 * - vazio: nada (um problema anterior é limpo);
 * - incompleto ou não entendido: só o problema na linha (coluna J e lista do app); a reserva não
 *   muda (FR-018);
 * - completo e diferente do último lido: retorno novo aguardando validação, substituindo o anterior
 *   aguardando ou recusado (FR-015, FR-017, FR-019). Se a reserva já tem comprovante, o retorno só
 *   vai para o histórico (`return_ignored`);
 * - relato ("Cobrada no Hunit" ou "Cancelada", specs/008): grava em `commercial_reports`, sem
 *   retorno a validar; o retorno anterior aguardando ou recusado deixa de valer (`superseded`).
 * O relato sai quando a leitura fica vazia ou vira um retorno completo (FR-012); com problema, fica.
 */
export async function recordReturnReading(
  db: Database,
  input: { key: ReservationKey; reading: CommercialReturnReading; now: Date },
): Promise<ReturnReadOutcome> {
  const { key, reading, now } = input;
  return db.transaction(async (tx): Promise<ReturnReadOutcome> => {
    const line = await lockLineForUpdate(tx, key);
    // Só linhas abertas aceitam retorno: as concluídas e canceladas saem de "A cobrar" nesta rodada.
    if (!line || line.state !== 'open') return 'none';

    const problem = describeReturnReading(reading);
    if (problem !== line.returnProblem) {
      await tx
        .update(commercialLines)
        .set({
          returnProblem: problem,
          returnProblemAt: problem === null ? null : now,
          version: sql`${commercialLines.version} + 1`,
          changedAt: now,
        })
        .where(ofReservation(commercialLines, key));
    }
    if (problem !== null) return 'problem';

    if (reading.kind === 'report') {
      const outcome = await recordReport(tx, key, reading.report, now);
      if (outcome === 'none') return 'none';
      // O que estava na linha deixou de valer: o retorno a validar ou recusado e o último lido.
      await tx
        .update(commercialReturns)
        .set({ state: 'superseded' })
        .where(
          and(
            ofReservation(commercialReturns, key),
            inArray(commercialReturns.state, ['awaiting_validation', 'rejected']),
          ),
        );
      await tx
        .update(commercialLines)
        .set({
          lastReadReturn: null,
          version: sql`${commercialLines.version} + 1`,
          changedAt: now,
        })
        .where(ofReservation(commercialLines, key));
      return outcome;
    }

    const reportCleared =
      (reading.kind === 'empty' || reading.kind === 'complete') &&
      (await clearReport(tx, key, now));
    if (reportCleared) {
      await tx
        .update(commercialLines)
        .set({ version: sql`${commercialLines.version} + 1`, changedAt: now })
        .where(ofReservation(commercialLines, key));
    }
    if (reading.kind !== 'complete') return 'none';

    const snapshot = returnSnapshot(reading);
    if (!reportCleared && !returnChanged(line.lastReadReturn ?? null, snapshot)) return 'none';

    await tx
      .update(commercialLines)
      .set({
        lastReadReturn: snapshot,
        version: sql`${commercialLines.version} + 1`,
        changedAt: now,
      })
      .where(ofReservation(commercialLines, key));

    const [confirmed] = await tx
      .select({ id: commercialReturns.id })
      .from(commercialReturns)
      .where(and(ofReservation(commercialReturns, key), eq(commercialReturns.state, 'confirmed')))
      .limit(1);
    if (confirmed || (await hasProofDocument(tx, key))) {
      await insertCommercialEvent(tx, {
        ...key,
        type: 'return_ignored',
        clientId: null,
        reason: 'a reserva já tem comprovante',
        at: now,
      });
      return 'ignored';
    }

    const previous = await tx
      .update(commercialReturns)
      .set({ state: 'superseded' })
      .where(
        and(
          ofReservation(commercialReturns, key),
          inArray(commercialReturns.state, ['awaiting_validation', 'rejected']),
        ),
      )
      .returning({ id: commercialReturns.id });
    const [created] = await tx
      .insert(commercialReturns)
      .values({
        ...key,
        ...reading.values,
        chargeSituationText: reading.chargeSituation?.text ?? null,
        chargeSituationKind: reading.chargeSituation?.kind ?? null,
        chargeDate: reading.chargeDate,
        readAt: now,
        state: 'awaiting_validation',
      })
      .returning({ id: commercialReturns.id });
    if (!created) throw new Error('O banco não devolveu o retorno criado.');
    const changed = previous.length > 0;
    await insertCommercialEvent(tx, {
      ...key,
      type: changed ? 'return_changed' : 'return_received',
      clientId: null,
      returnId: created.id,
      at: now,
    });
    return changed ? 'changed' : 'received';
  });
}

export type DecisionResult =
  | { ok: true; key: ReservationKey }
  | { ok: false; reason: 'not_found' | 'not_awaiting_validation' | 'not_confirmed' };

async function lockReturn(tx: Transaction, returnId: string): Promise<ReturnRow | null> {
  const [row] = await tx
    .select()
    .from(commercialReturns)
    .where(eq(commercialReturns.id, returnId))
    .for('update');
  return row ?? null;
}

async function confirmLocked(
  tx: Transaction,
  row: ReturnRow,
  input: { clientId: string; now: Date; batchId?: string | null },
): Promise<void> {
  const key = { hotelCode: row.hotelCode, reservationNumber: row.reservationNumber };
  await tx
    .update(commercialReturns)
    .set({
      state: 'confirmed',
      decidedAt: input.now,
      decidedByClientId: input.clientId,
      batchId: input.batchId ?? null,
    })
    .where(eq(commercialReturns.id, row.id));
  await insertCommercialEvent(tx, {
    ...key,
    type: 'return_confirmed',
    clientId: input.clientId,
    returnId: row.id,
    batchId: input.batchId ?? null,
    at: input.now,
  });
  // Com o comprovante, a linha vai para "Concluídas" (FR-009, FR-016).
  await refreshCommercialLine(tx, key, input.now);
}

/** Confirma o retorno (FR-016): a reserva passa a "Comprovante enviado". */
export async function confirmReturn(
  db: Database,
  input: { returnId: string; clientId: string; now: Date },
): Promise<DecisionResult> {
  return db.transaction(async (tx): Promise<DecisionResult> => {
    const row = await lockReturn(tx, input.returnId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.state !== 'awaiting_validation')
      return { ok: false, reason: 'not_awaiting_validation' };
    await confirmLocked(tx, row, input);
    return { ok: true, key: row };
  });
}

/** Recusa o retorno com o motivo (FR-017): a reserva volta a "Tratativa enviada". */
export async function rejectReturn(
  db: Database,
  input: { returnId: string; reason: string; clientId: string; now: Date },
): Promise<DecisionResult> {
  return db.transaction(async (tx): Promise<DecisionResult> => {
    const row = await lockReturn(tx, input.returnId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.state !== 'awaiting_validation')
      return { ok: false, reason: 'not_awaiting_validation' };
    const key = { hotelCode: row.hotelCode, reservationNumber: row.reservationNumber };
    await tx
      .update(commercialReturns)
      .set({
        state: 'rejected',
        decidedAt: input.now,
        decidedByClientId: input.clientId,
        rejectionReason: input.reason,
      })
      .where(eq(commercialReturns.id, row.id));
    await insertCommercialEvent(tx, {
      ...key,
      type: 'return_rejected',
      clientId: input.clientId,
      returnId: row.id,
      reason: input.reason,
      at: input.now,
    });
    // A coluna "Validação do Financeiro" passa a mostrar a recusa e o motivo.
    await touchLine(tx, key, input.now);
    return { ok: true, key };
  });
}

/** Desfaz a confirmação: o retorno volta a aguardar validação e a linha a "A cobrar". */
export async function undoReturnConfirmation(
  db: Database,
  input: { returnId: string; clientId: string; now: Date },
): Promise<DecisionResult> {
  return db.transaction(async (tx): Promise<DecisionResult> => {
    const row = await lockReturn(tx, input.returnId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.state !== 'confirmed') return { ok: false, reason: 'not_confirmed' };
    const key = { hotelCode: row.hotelCode, reservationNumber: row.reservationNumber };
    await tx
      .update(commercialReturns)
      .set({
        state: 'awaiting_validation',
        decidedAt: null,
        decidedByClientId: null,
        batchId: null,
      })
      .where(eq(commercialReturns.id, row.id));
    await insertCommercialEvent(tx, {
      ...key,
      type: 'return_confirmation_undone',
      clientId: input.clientId,
      returnId: row.id,
      at: input.now,
    });
    await refreshCommercialLine(tx, key, input.now);
    return { ok: true, key };
  });
}

export interface BatchItemResult extends ReservationKey {
  outcome: 'confirmed' | 'ignored' | 'failed';
  reason:
    | 'not_found'
    | 'no_return_awaiting_validation'
    | 'no_review_alert'
    | 'cancellation_not_accepted'
    | null;
  classification: (typeof reservations.$inferSelect)['classification'] | null;
  /** Erro inesperado que causou o `failed`, para o log; nunca vai para o cliente. */
  error?: unknown;
}

/**
 * Confirma o retorno aguardando validação de cada reserva (FR-016a): uma transação por reserva;
 * as que não têm retorno aguardando ficam de fora, com o motivo. Com `includeCancellations`
 * (homologação da 008, R-19), a reserva sem retorno, mas com a "Cancelada" do Comercial aguardando,
 * é confirmada como cancelada sem cobrança; a que não aceita a marcação fica de fora com
 * `cancellation_not_accepted`.
 */
export async function confirmReturnsBatch(
  db: Database,
  input: {
    keys: readonly ReservationKey[];
    clientId: string;
    batchId: string;
    now: Date;
    includeCancellations?: boolean;
  },
): Promise<BatchItemResult[]> {
  const results: BatchItemResult[] = [];
  for (const key of input.keys) {
    try {
      results.push(
        await db.transaction(async (tx): Promise<BatchItemResult> => {
          const [reservation] = await tx
            .select({ classification: reservations.classification })
            .from(reservations)
            .where(
              and(
                eq(reservations.hotelCode, key.hotelCode),
                eq(reservations.reservationNumber, key.reservationNumber),
              ),
            );
          if (!reservation) {
            return { ...key, outcome: 'ignored', reason: 'not_found', classification: null };
          }
          const [awaiting] = await tx
            .select()
            .from(commercialReturns)
            .where(
              and(
                ofReservation(commercialReturns, key),
                eq(commercialReturns.state, 'awaiting_validation'),
              ),
            )
            .for('update');
          if (!awaiting && input.includeCancellations) {
            const cancellation = await confirmCancellationTx(tx, {
              key,
              clientId: input.clientId,
              now: input.now,
            });
            if (cancellation.ok) {
              return {
                ...key,
                outcome: 'confirmed',
                reason: null,
                classification: reservation.classification,
              };
            }
            if (cancellation.reason === 'not_accepted') {
              return {
                ...key,
                outcome: 'ignored',
                reason: 'cancellation_not_accepted',
                classification: reservation.classification,
              };
            }
          }
          if (!awaiting) {
            return {
              ...key,
              outcome: 'ignored',
              reason: 'no_return_awaiting_validation',
              classification: reservation.classification,
            };
          }
          await confirmLocked(tx, awaiting, input);
          return {
            ...key,
            outcome: 'confirmed',
            reason: null,
            classification: reservation.classification,
          };
        }),
      );
    } catch (error) {
      results.push({ ...key, outcome: 'failed', reason: null, classification: null, error });
    }
  }
  return results;
}
