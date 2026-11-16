/**
 * Gravação da importação do histórico (specs/004, research R-06, R-07, R-09): o estado gravado de
 * cada reserva e a gravação do plano dela, numa transação por reserva — tudo ou nada (FR-021).
 */
import type { ExistingReservation, TreatmentDocumentKind } from '@hunit/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../persistence/db.js';
import { toReservationRecord } from '../persistence/reservations-repo.js';
import {
  legacyReservations,
  reservationManualAmounts,
  reservations,
  treatmentDocuments,
  treatmentEvents,
  treatmentFiles,
} from '../persistence/schema.js';
import type { LegacyAttachments } from './attachments.js';
import type { EntryPlan, PreparedReservation, ReservationState } from './planner.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

/** Lê o que já está gravado da reserva; `forUpdate` trava a linha (só dentro de transação). */
export async function loadReservationState(
  db: Executor,
  hotelCode: string,
  reservationNumber: string,
  forUpdate = false,
): Promise<ReservationState> {
  const key = and(
    eq(reservations.hotelCode, hotelCode),
    eq(reservations.reservationNumber, reservationNumber),
  );
  const query = db.select().from(reservations).where(key);
  const [row] = forUpdate ? await query.for('update') : await query;

  const existing: ExistingReservation | null = row
    ? { ...toReservationRecord(row), verifiedByHunitControl: row.lastExecutionId !== null }
    : null;

  const [origin] = await db
    .select({ rowHash: legacyReservations.rowHash, appliedCount: legacyReservations.appliedCount })
    .from(legacyReservations)
    .where(
      and(
        eq(legacyReservations.hotelCode, hotelCode),
        eq(legacyReservations.reservationNumber, reservationNumber),
      ),
    );

  const documents: ReservationState['documents'] = {};
  const current = await db
    .select({
      id: treatmentDocuments.id,
      kind: treatmentDocuments.kind,
      sha256: treatmentDocuments.fileSha256,
      legacyImportId: treatmentDocuments.legacyImportId,
    })
    .from(treatmentDocuments)
    .where(
      and(
        eq(treatmentDocuments.hotelCode, hotelCode),
        eq(treatmentDocuments.reservationNumber, reservationNumber),
        isNull(treatmentDocuments.endedAt),
      ),
    );
  for (const document of current) {
    documents[document.kind] = {
      id: document.id,
      sha256: document.sha256,
      fromLegacy: document.legacyImportId !== null,
    };
  }

  const [manual] = await db
    .select({
      amount: reservationManualAmounts.amount,
      legacyImportId: reservationManualAmounts.legacyImportId,
    })
    .from(reservationManualAmounts)
    .where(
      and(
        eq(reservationManualAmounts.hotelCode, hotelCode),
        eq(reservationManualAmounts.reservationNumber, reservationNumber),
      ),
    );

  return {
    existing,
    origin: origin ?? null,
    documents,
    manual: manual ? { amount: manual.amount, fromLegacy: manual.legacyImportId !== null } : null,
  };
}

/** O arquivo mudou entre a conferência e a gravação (a impressão digital deveria ter barrado). */
export class AttachmentChangedError extends Error {
  constructor() {
    super('Um anexo mudou durante a importação; simule de novo.');
    this.name = 'AttachmentChangedError';
  }
}

export interface ApplyContext {
  importId: string;
  authorId: string;
  attachments: LegacyAttachments;
  now: Date;
}

/** Grava o plano de uma reserva. Chamado dentro da transação que travou a reserva. */
export async function applyEntry(
  tx: Transaction,
  plan: EntryPlan,
  prepared: PreparedReservation | undefined,
  context: ApplyContext,
): Promise<void> {
  const { importId, authorId, now } = context;
  const key = { hotelCode: plan.hotelCode, reservationNumber: plan.reservationNumber };
  const decision = plan.reservation;

  if (decision && prepared) {
    if (decision.action === 'create' || decision.action === 'update') {
      const { record } = decision;
      const values = {
        ...record,
        chargedAt: record.chargedAt ? new Date(record.chargedAt) : null,
        lastExecutionId: null,
      };
      if (decision.action === 'create') {
        await tx.insert(reservations).values(values);
      } else {
        await tx
          .update(reservations)
          .set({ ...values, hotelCode: key.hotelCode, reservationNumber: key.reservationNumber })
          .where(
            and(
              eq(reservations.hotelCode, key.hotelCode),
              eq(reservations.reservationNumber, key.reservationNumber),
            ),
          );
      }
    } else if (decision.action === 'merge') {
      await tx
        .update(reservations)
        .set({
          firstVerifiedAt: decision.firstVerifiedAt,
          verificationCount: decision.verificationCount,
        })
        .where(
          and(
            eq(reservations.hotelCode, key.hotelCode),
            eq(reservations.reservationNumber, key.reservationNumber),
          ),
        );
    }

    if (decision.action !== 'unchanged') {
      const { origin } = prepared.parsed;
      const values = {
        ...key,
        legacyHotelKey: origin.legacyHotelKey,
        originalClassification: origin.originalClassification,
        originalPreviousClassification: origin.originalPreviousClassification,
        firstVerifiedAt: origin.firstVerifiedAt,
        lastVerifiedAt: origin.lastVerifiedAt,
        verificationCount: origin.verificationCount,
        merged: decision.merged,
        appliedCount: decision.appliedCount,
        rowHash: prepared.rowHash,
        lastImportId: importId,
      };
      await tx
        .insert(legacyReservations)
        .values({ ...values, firstImportId: importId })
        .onConflictDoUpdate({
          target: [legacyReservations.hotelCode, legacyReservations.reservationNumber],
          // `merged` continua o da primeira importação: diz se o HUNIT Control já conhecia a reserva.
          set: { ...values, merged: sql`${legacyReservations.merged}` },
        });
    }
  }

  for (const action of plan.documents) {
    const kind: TreatmentDocumentKind = action.plan.kind;
    if (action.replaceId) {
      await tx
        .update(treatmentDocuments)
        .set({ state: 'replaced', endedAt: now, endedByClientId: authorId })
        .where(eq(treatmentDocuments.id, action.replaceId));
    }

    let fileSha256: string | null = null;
    let originalName: string | null = null;
    if (!action.purged) {
      const reread = await context.attachments.inspect(
        action.plan.storedPath,
        action.plan.originalName,
      );
      if (!reread.ok || reread.attachment.sha256 !== action.file.sha256) {
        throw new AttachmentChangedError();
      }
      await tx
        .insert(treatmentFiles)
        .values({
          sha256: reread.attachment.sha256,
          content: reread.attachment.content,
          sizeBytes: reread.attachment.sizeBytes,
          mediaType: reread.attachment.mediaType,
          createdAt: now,
          uploadedByClientId: authorId,
        })
        .onConflictDoNothing({ target: treatmentFiles.sha256 });
      fileSha256 = reread.attachment.sha256;
      originalName = reread.attachment.fileName;
    }

    const [document] = await tx
      .insert(treatmentDocuments)
      .values({
        ...key,
        kind,
        state: action.purged ? 'purged' : 'current',
        fileSha256,
        originalName,
        sizeBytes: action.file.sizeBytes,
        mediaType: action.file.mediaType,
        attachedAt: action.plan.attachedAt,
        attachedByClientId: authorId,
        purgedAt: action.purged ? now : null,
        legacyImportId: importId,
      })
      .returning({ id: treatmentDocuments.id });
    if (!document) throw new Error('O banco não devolveu o documento criado.');

    await tx.insert(treatmentEvents).values({
      ...key,
      type: action.replaceId ? 'replaced' : 'attached',
      kind,
      documentId: document.id,
      previousDocumentId: action.replaceId,
      clientId: authorId,
      at: action.plan.attachedAt,
      legacyImportId: importId,
    });
  }

  if (plan.manual) {
    await tx
      .insert(reservationManualAmounts)
      .values({
        ...key,
        amount: plan.manual.amount,
        setAt: plan.manual.setAt,
        setByClientId: authorId,
        legacyImportId: importId,
      })
      .onConflictDoUpdate({
        target: [reservationManualAmounts.hotelCode, reservationManualAmounts.reservationNumber],
        set: {
          amount: plan.manual.amount,
          setAt: plan.manual.setAt,
          setByClientId: authorId,
          legacyImportId: importId,
        },
      });
    await tx.insert(treatmentEvents).values({
      ...key,
      type: 'amount_set',
      amount: plan.manual.amount,
      clientId: authorId,
      at: plan.manual.setAt,
      legacyImportId: importId,
    });
  }
}
