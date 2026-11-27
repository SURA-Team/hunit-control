/**
 * Marcação "Cancelada sem cobrança" do Financeiro (specs/008, US4; FR-018 a FR-023; research R-08;
 * data-model §1.1): marcar e desfazer. A marcação é uma camada ao lado da reserva, como a tratativa:
 * a classificação do Hunit não muda, e a reserva passa a valer pela classificação efetiva
 * `cancelled_no_charge` (situação, filtros, envio e linha da planilha). Nada aqui acessa o Hunit.
 */
import {
  detailedSituation,
  effectiveClassification,
  noChargeEligibility,
  treatmentStatus,
  type NoChargeIneligibility,
  type ReservationDetailedSituation,
} from '@hunit/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { refreshCommercialLine, type ReservationKey } from './commercial-repo.js';
import type { Transaction } from './account-lock.js';
import type { Database } from './db.js';
import { findDatabaseError, PG_UNIQUE_VIOLATION } from './errors.js';
import { commercialReports, commercialReturns, noChargeMarks, reservations } from './schema.js';
import { loadTreatmentSummary, treatmentFlags } from './treatments-repo.js';

export type MarkNoChargeResult =
  | { ok: true; markId: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'reservation_changed' }
  | { ok: false; reason: 'not_accepted'; detail: NoChargeIneligibility };

export type UndoNoChargeResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_active' };

function ofReservation(key: ReservationKey) {
  return and(
    eq(reservations.hotelCode, key.hotelCode),
    eq(reservations.reservationNumber, key.reservationNumber),
  );
}

export interface MarkNoChargeInput {
  key: ReservationKey;
  /** A situação que a pessoa viu; sem ela (confirmação da "Cancelada" do Comercial), não confere. */
  expectedSituation?: ReservationDetailedSituation | undefined;
  note: string | null;
  clientId: string;
  now: Date;
}

/**
 * Marca a reserva (FR-018 a FR-022), numa transação com a reserva travada: confere que a situação é
 * a que a pessoa viu (`expectedSituation`; senão, `reservation_changed`, sem gravar), a regra do
 * domínio (`noChargeEligibility`) e grava o valor a cobrar de antes e a observação. A linha da
 * planilha vai para "Concluídas" na mesma transação.
 */
export async function markNoCharge(
  db: Database,
  input: MarkNoChargeInput,
): Promise<MarkNoChargeResult> {
  try {
    return await db.transaction((tx) => markNoChargeTx(tx, input));
  } catch (error) {
    // Outra marcação entrou ao mesmo tempo (índice único da marcação ativa).
    if (findDatabaseError(error)?.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, reason: 'not_accepted', detail: 'already_marked' };
    }
    throw error;
  }
}

/**
 * A marcação dentro de uma transação já aberta (também usada pela confirmação da "Cancelada" do
 * Comercial, homologação da 008, R-19). A violação do índice único sobe para quem chamou.
 */
export async function markNoChargeTx(
  tx: Transaction,
  input: MarkNoChargeInput,
): Promise<MarkNoChargeResult> {
  const { key, now } = input;
  {
    {
      const [reservation] = await tx
        .select({
          classification: reservations.classification,
          totalAmount: reservations.totalAmount,
        })
        .from(reservations)
        .where(ofReservation(key))
        .for('update');
      if (!reservation) return { ok: false, reason: 'not_found' };

      const flags = treatmentFlags(await loadTreatmentSummary(tx, key));
      const current = detailedSituation(
        effectiveClassification(reservation.classification, flags.noChargeMarked),
        treatmentStatus(flags),
        flags.hasReturnAwaiting,
      );
      if (input.expectedSituation !== undefined && current !== input.expectedSituation) {
        return { ok: false, reason: 'reservation_changed' };
      }

      const eligibility = noChargeEligibility({
        classification: reservation.classification,
        noChargeMarked: flags.noChargeMarked,
        hasCurrentProof: flags.hasCurrentProof,
        hasReturnAwaiting: flags.hasReturnAwaiting,
      });
      if (!eligibility.eligible) {
        return { ok: false, reason: 'not_accepted', detail: eligibility.reason };
      }

      const [mark] = await tx
        .insert(noChargeMarks)
        .values({
          ...key,
          previousAmount: reservation.totalAmount,
          note: input.note,
          markedByClientId: input.clientId,
          markedAt: now,
        })
        .returning({ id: noChargeMarks.id });
      if (!mark) throw new Error('a marcação não foi gravada');
      await refreshCommercialLine(tx, key, now);
      return { ok: true, markId: mark.id };
    }
  }
}

/**
 * Desfaz a marcação ativa informada (FR-021): tudo volta a ser derivado da classificação do Hunit,
 * inclusive a linha da planilha. Já desfeita, ou outra marcação: `not_active`.
 */
export async function undoNoCharge(
  db: Database,
  input: { key: ReservationKey; markId: string; clientId: string; now: Date },
): Promise<UndoNoChargeResult> {
  const { key, now } = input;
  return db.transaction(async (tx): Promise<UndoNoChargeResult> => {
    const [reservation] = await tx
      .select({ hotelCode: reservations.hotelCode })
      .from(reservations)
      .where(ofReservation(key))
      .for('update');
    if (!reservation) return { ok: false, reason: 'not_found' };

    const undone = await tx
      .update(noChargeMarks)
      .set({ undoneAt: now, undoneByClientId: input.clientId })
      .where(
        and(
          eq(noChargeMarks.id, input.markId),
          eq(noChargeMarks.hotelCode, key.hotelCode),
          eq(noChargeMarks.reservationNumber, key.reservationNumber),
          isNull(noChargeMarks.undoneAt),
        ),
      )
      .returning({ id: noChargeMarks.id });
    if (undone.length === 0) return { ok: false, reason: 'not_active' };
    // Marcação feita pela confirmação da "Cancelada" do Comercial: ela volta para validar (R-19).
    await tx
      .update(commercialReports)
      .set({
        validationState: 'awaiting_validation',
        decidedAt: null,
        decidedByClientId: null,
        noChargeMarkId: null,
      })
      .where(eq(commercialReports.noChargeMarkId, input.markId));
    await restoreSituationReturn(tx, key, input.markId);
    await refreshCommercialLine(tx, key, now);
    return { ok: true };
  });
}

/**
 * Marcação feita pela confirmação de um retorno de situação livre (specs/009, FR-008; research
 * R-04): ele volta a aguardar validação se ainda é o retorno mais recente da reserva e nenhum
 * outro está aguardando ou confirmado (o Comercial não mudou a linha depois). O vínculo com a
 * marcação é limpo na mesma transação (`commercial_returns_no_charge_check`).
 */
async function restoreSituationReturn(
  tx: Transaction,
  key: ReservationKey,
  markId: string,
): Promise<void> {
  const [latest] = await tx
    .select({ id: commercialReturns.id, state: commercialReturns.state })
    .from(commercialReturns)
    .where(
      and(
        eq(commercialReturns.hotelCode, key.hotelCode),
        eq(commercialReturns.reservationNumber, key.reservationNumber),
      ),
    )
    .orderBy(desc(commercialReturns.readAt))
    .limit(1)
    .for('update');
  const [linked] = await tx
    .select({ id: commercialReturns.id })
    .from(commercialReturns)
    .where(eq(commercialReturns.noChargeMarkId, markId));
  if (!linked || latest?.id !== linked.id) return;
  await tx
    .update(commercialReturns)
    .set({
      state: 'awaiting_validation',
      decidedAt: null,
      decidedByClientId: null,
      noChargeMarkId: null,
    })
    .where(eq(commercialReturns.id, linked.id));
}
