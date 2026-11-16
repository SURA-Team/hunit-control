/**
 * Tratativas manuais das reservas (specs/003, data-model.md): documentos (tratativa e
 * comprovante), valor cobrado informado à mão e histórico.
 *
 * É uma camada ao lado da reserva: nada aqui altera `reservations`, e o coletor do Hunit não toca
 * nestas tabelas (FR-007). As regras (quem aceita, prazo de reversão) vêm de `@hunit/domain`.
 *
 * "Vigente" = documento com `ended_at` nulo: é o que define a situação exibida. No máximo um por
 * reserva e tipo.
 */
import {
  acceptsTreatment,
  isRevertible,
  needsReview,
  treatmentStatus,
  type Classification,
  type TreatmentDocumentKind,
  type TreatmentDocumentState,
} from '@hunit/domain';
import { and, desc, eq, isNull, max, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from './db.js';
import {
  apiClients,
  reservationManualAmounts,
  reservations,
  treatmentDocuments,
  treatmentEvents,
  type treatmentEventTypeEnum,
} from './schema.js';
import type { TreatmentFileMeta } from './treatment-files-repo.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export type TreatmentEventType = (typeof treatmentEventTypeEnum.enumValues)[number];

export interface ReservationKey {
  hotelCode: string;
  reservationNumber: string;
}

/** Documento com os nomes dos clientes que anexaram e encerraram. */
export interface TreatmentDocumentRecord extends ReservationKey {
  id: string;
  kind: TreatmentDocumentKind;
  state: TreatmentDocumentState;
  /** `null` depois da purga. */
  fileSha256: string | null;
  /** `null` depois da purga. */
  originalName: string | null;
  sizeBytes: number;
  mediaType: string;
  attachedAt: Date;
  attachedBy: string;
  endedAt: Date | null;
  endedBy: string | null;
  /** Importado do sistema anterior (specs/004, FR-016). */
  fromLegacy: boolean;
}

export interface TreatmentEventRecord {
  id: number;
  type: TreatmentEventType;
  kind: TreatmentDocumentKind | null;
  documentId: string | null;
  previousDocumentId: string | null;
  amount: string | null;
  /** Só em `review_confirmed`: o status do Hunit confirmado (research R-14). */
  classification: Classification | null;
  batchId: string | null;
  client: string;
  at: Date;
  /** Criado pela importação do sistema anterior (specs/004, FR-016). */
  fromLegacy: boolean;
}

/** O que a reserva tem de tratativa neste momento. */
export interface TreatmentSummary {
  /** Tratativa vigente. */
  request: TreatmentDocumentRecord | null;
  /** Comprovante vigente. */
  proof: TreatmentDocumentRecord | null;
  manualAmount: string | null;
  /** Última confirmação do alerta "Verificar" (FR-002a, research R-14). */
  lastReviewAt: Date | null;
}

export const EMPTY_TREATMENT: TreatmentSummary = {
  request: null,
  proof: null,
  manualAmount: null,
  lastReviewAt: null,
};

export type OutcomeReason = 'not_found' | 'not_eligible' | 'same_file';

/** Desfecho de uma reserva num registro (individual ou em lote) ou na conferência. */
export interface ReservationOutcome extends ReservationKey {
  outcome: 'registered' | 'replaced' | 'ignored' | 'failed';
  reason: OutcomeReason | null;
  classification: Classification | null;
  totalAmount: string | null;
  documentId: string | null;
  /** Erro inesperado que causou o `failed`, para o log; nunca vai para o cliente. */
  error?: unknown;
}

/** Chave de uma reserva num `Map` (o separador não aparece em códigos nem em números). */
export function reservationKeyOf(key: ReservationKey): string {
  return `${key.hotelCode}\u0000${key.reservationNumber}`;
}

const attachedByClient = alias(apiClients, 'attached_by_client');
const endedByClient = alias(apiClients, 'ended_by_client');

const DOCUMENT_COLUMNS = {
  id: treatmentDocuments.id,
  hotelCode: treatmentDocuments.hotelCode,
  reservationNumber: treatmentDocuments.reservationNumber,
  kind: treatmentDocuments.kind,
  state: treatmentDocuments.state,
  fileSha256: treatmentDocuments.fileSha256,
  originalName: treatmentDocuments.originalName,
  sizeBytes: treatmentDocuments.sizeBytes,
  mediaType: treatmentDocuments.mediaType,
  attachedAt: treatmentDocuments.attachedAt,
  attachedBy: attachedByClient.name,
  endedAt: treatmentDocuments.endedAt,
  endedBy: endedByClient.name,
  fromLegacy: sql<boolean>`${treatmentDocuments.legacyImportId} is not null`,
};

function selectDocuments(executor: Executor) {
  return executor
    .select(DOCUMENT_COLUMNS)
    .from(treatmentDocuments)
    .innerJoin(attachedByClient, eq(attachedByClient.id, treatmentDocuments.attachedByClientId))
    .leftJoin(endedByClient, eq(endedByClient.id, treatmentDocuments.endedByClientId));
}

function ofReservation(
  table: typeof treatmentDocuments | typeof reservationManualAmounts | typeof treatmentEvents,
  key: ReservationKey,
): SQL {
  return sql`${table.hotelCode} = ${key.hotelCode} and ${table.reservationNumber} = ${key.reservationNumber}`;
}

/** `(hotel, número) in (...)`, para ler os dados de várias reservas numa consulta só. */
function inReservations(
  table: typeof treatmentDocuments | typeof reservationManualAmounts | typeof treatmentEvents,
  keys: readonly ReservationKey[],
): SQL {
  const tuples = keys.map((key) => sql`(${key.hotelCode}, ${key.reservationNumber})`);
  return sql`(${table.hotelCode}, ${table.reservationNumber}) in (${sql.join(tuples, sql`, `)})`;
}

/**
 * Resumo da tratativa de várias reservas, em três consultas (sem consulta por reserva). Reservas
 * sem nada registrado ficam fora do mapa.
 */
export async function loadTreatmentSummaries(
  executor: Executor,
  keys: readonly ReservationKey[],
): Promise<Map<string, TreatmentSummary>> {
  const summaries = new Map<string, TreatmentSummary>();
  if (keys.length === 0) return summaries;

  const summaryOf = (key: ReservationKey): TreatmentSummary => {
    const mapKey = reservationKeyOf(key);
    let summary = summaries.get(mapKey);
    if (!summary) {
      summary = { ...EMPTY_TREATMENT };
      summaries.set(mapKey, summary);
    }
    return summary;
  };

  const documents = await selectDocuments(executor).where(
    and(inReservations(treatmentDocuments, keys), isNull(treatmentDocuments.endedAt)),
  );
  for (const document of documents) summaryOf(document)[document.kind] = document;

  const amounts = await executor
    .select()
    .from(reservationManualAmounts)
    .where(inReservations(reservationManualAmounts, keys));
  for (const amount of amounts) summaryOf(amount).manualAmount = amount.amount;

  const reviews = await executor
    .select({
      hotelCode: treatmentEvents.hotelCode,
      reservationNumber: treatmentEvents.reservationNumber,
      at: max(treatmentEvents.at),
    })
    .from(treatmentEvents)
    .where(and(inReservations(treatmentEvents, keys), eq(treatmentEvents.type, 'review_confirmed')))
    .groupBy(treatmentEvents.hotelCode, treatmentEvents.reservationNumber);
  for (const review of reviews) summaryOf(review).lastReviewAt = review.at;

  return summaries;
}

export async function loadTreatmentSummary(
  executor: Executor,
  key: ReservationKey,
): Promise<TreatmentSummary> {
  const summaries = await loadTreatmentSummaries(executor, [key]);
  return summaries.get(reservationKeyOf(key)) ?? { ...EMPTY_TREATMENT };
}

/** Trava a reserva até o fim da transação e devolve o que as regras precisam dela. */
async function lockReservation(
  tx: Transaction,
  key: ReservationKey,
): Promise<{
  classification: Classification;
  totalAmount: string;
  statusChangedAt: Date | null;
} | null> {
  const [row] = await tx
    .select({
      classification: reservations.classification,
      totalAmount: reservations.totalAmount,
      statusChangedAt: reservations.statusChangedAt,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.hotelCode, key.hotelCode),
        eq(reservations.reservationNumber, key.reservationNumber),
      ),
    )
    .for('update');
  return row ?? null;
}

type DocumentRow = typeof treatmentDocuments.$inferSelect;

async function findVigente(
  tx: Transaction,
  key: ReservationKey,
  kind: TreatmentDocumentKind,
): Promise<DocumentRow | null> {
  const [row] = await tx
    .select()
    .from(treatmentDocuments)
    .where(
      and(
        ofReservation(treatmentDocuments, key),
        eq(treatmentDocuments.kind, kind),
        isNull(treatmentDocuments.endedAt),
      ),
    );
  return row ?? null;
}

/** O documento deixa de ser o vigente. Um já purgado continua purgado. */
async function endDocument(
  tx: Transaction,
  document: DocumentRow,
  state: 'replaced' | 'removed',
  clientId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(treatmentDocuments)
    .set({
      state: document.state === 'purged' ? 'purged' : state,
      endedAt: now,
      endedByClientId: clientId,
    })
    .where(eq(treatmentDocuments.id, document.id));
}

export interface RegisterDocumentsInput {
  kind: TreatmentDocumentKind;
  file: TreatmentFileMeta;
  fileName: string;
  keys: readonly ReservationKey[];
  clientId: string;
  /** Mesmo valor em todos os eventos deste pedido (research R-05). */
  batchId: string;
  now: Date;
}

/**
 * Registra o documento em cada reserva, **uma transação por reserva** (FR-011): a reserva é
 * travada, a elegibilidade é conferida naquele momento (FR-006a), o documento vigente do mesmo
 * tipo (se houver) vira substituído, o novo entra como atual e o evento vai para o histórico.
 *
 * Uma reserva que falha por erro inesperado fica como estava (`failed`) e as demais seguem.
 */
export async function registerDocuments(
  db: Database,
  input: RegisterDocumentsInput,
): Promise<ReservationOutcome[]> {
  const outcomes: ReservationOutcome[] = [];
  for (const key of input.keys) {
    try {
      outcomes.push(await db.transaction((tx) => registerDocument(tx, key, input)));
    } catch (error) {
      outcomes.push({
        ...key,
        outcome: 'failed',
        reason: null,
        classification: null,
        totalAmount: null,
        documentId: null,
        error,
      });
    }
  }
  return outcomes;
}

async function registerDocument(
  tx: Transaction,
  key: ReservationKey,
  input: RegisterDocumentsInput,
): Promise<ReservationOutcome> {
  const base = {
    hotelCode: key.hotelCode,
    reservationNumber: key.reservationNumber,
    documentId: null,
  };
  const reservation = await lockReservation(tx, key);
  if (!reservation) {
    return {
      ...base,
      outcome: 'ignored',
      reason: 'not_found',
      classification: null,
      totalAmount: null,
    };
  }
  if (!acceptsTreatment(reservation.classification)) {
    return { ...base, ...reservation, outcome: 'ignored', reason: 'not_eligible' };
  }

  const vigente = await findVigente(tx, key, input.kind);
  if (vigente?.fileSha256 === input.file.sha256) {
    return { ...base, ...reservation, outcome: 'ignored', reason: 'same_file' };
  }
  if (vigente) await endDocument(tx, vigente, 'replaced', input.clientId, input.now);

  const [created] = await tx
    .insert(treatmentDocuments)
    .values({
      hotelCode: key.hotelCode,
      reservationNumber: key.reservationNumber,
      kind: input.kind,
      fileSha256: input.file.sha256,
      originalName: input.fileName,
      sizeBytes: input.file.sizeBytes,
      mediaType: input.file.mediaType,
      attachedAt: input.now,
      attachedByClientId: input.clientId,
    })
    .returning({ id: treatmentDocuments.id });
  if (!created) throw new Error('O banco não devolveu o documento criado.');

  await tx.insert(treatmentEvents).values({
    hotelCode: key.hotelCode,
    reservationNumber: key.reservationNumber,
    type: vigente ? 'replaced' : 'attached',
    kind: input.kind,
    documentId: created.id,
    previousDocumentId: vigente?.id ?? null,
    batchId: input.batchId,
    clientId: input.clientId,
    at: input.now,
  });

  return {
    ...base,
    ...reservation,
    outcome: vigente ? 'replaced' : 'registered',
    reason: null,
    documentId: created.id,
  };
}

/**
 * Diz o que aconteceria com cada reserva num registro desse tipo, **sem gravar nada** (FR-006):
 * `registered` (documento novo), `replaced` (substituiria o vigente) ou `ignored`.
 */
export async function checkDocuments(
  db: Database,
  input: { kind: TreatmentDocumentKind; keys: readonly ReservationKey[] },
): Promise<ReservationOutcome[]> {
  if (input.keys.length === 0) return [];

  const tuples = input.keys.map((key) => sql`(${key.hotelCode}, ${key.reservationNumber})`);
  const rows = await db
    .select({
      hotelCode: reservations.hotelCode,
      reservationNumber: reservations.reservationNumber,
      classification: reservations.classification,
      totalAmount: reservations.totalAmount,
    })
    .from(reservations)
    .where(
      sql`(${reservations.hotelCode}, ${reservations.reservationNumber}) in (${sql.join(tuples, sql`, `)})`,
    );
  const found = new Map(rows.map((row) => [reservationKeyOf(row), row]));
  const summaries = await loadTreatmentSummaries(db, input.keys);

  return input.keys.map((key): ReservationOutcome => {
    const base = {
      hotelCode: key.hotelCode,
      reservationNumber: key.reservationNumber,
      documentId: null,
    };
    const reservation = found.get(reservationKeyOf(key));
    if (!reservation) {
      return {
        ...base,
        outcome: 'ignored',
        reason: 'not_found',
        classification: null,
        totalAmount: null,
      };
    }
    const { classification, totalAmount } = reservation;
    if (!acceptsTreatment(classification)) {
      return { ...base, classification, totalAmount, outcome: 'ignored', reason: 'not_eligible' };
    }
    const vigente = summaries.get(reservationKeyOf(key))?.[input.kind] ?? null;
    return {
      ...base,
      classification,
      totalAmount,
      outcome: vigente ? 'replaced' : 'registered',
      reason: null,
    };
  });
}

export async function findDocument(
  executor: Executor,
  documentId: string,
): Promise<TreatmentDocumentRecord | null> {
  const [row] = await selectDocuments(executor).where(eq(treatmentDocuments.id, documentId));
  return row ?? null;
}

async function findDocumentRow(tx: Transaction, documentId: string): Promise<DocumentRow | null> {
  const [row] = await tx
    .select()
    .from(treatmentDocuments)
    .where(eq(treatmentDocuments.id, documentId));
  return row ?? null;
}

export type RemoveDocumentResult =
  { ok: true; key: ReservationKey } | { ok: false; reason: 'not_found' | 'not_current' };

/**
 * Desfaz o documento vigente (FR-004): ele deixa de valer, fica guardado por 30 dias e pode ser
 * revertido nesse prazo. O valor informado à mão não é apagado (data-model §1.3).
 */
export async function removeDocument(
  db: Database,
  input: { documentId: string; clientId: string; now: Date },
): Promise<RemoveDocumentResult> {
  return db.transaction(async (tx): Promise<RemoveDocumentResult> => {
    const found = await findDocumentRow(tx, input.documentId);
    if (!found) return { ok: false, reason: 'not_found' };
    await lockReservation(tx, found);
    // Lido de novo depois da trava: outro operador pode ter acabado de substituir ou desfazer.
    const document = await findDocumentRow(tx, input.documentId);
    if (!document) return { ok: false, reason: 'not_found' };
    if (document.endedAt !== null) return { ok: false, reason: 'not_current' };

    await endDocument(tx, document, 'removed', input.clientId, input.now);
    await tx.insert(treatmentEvents).values({
      hotelCode: document.hotelCode,
      reservationNumber: document.reservationNumber,
      type: 'removed',
      kind: document.kind,
      documentId: document.id,
      clientId: input.clientId,
      at: input.now,
    });
    return { ok: true, key: document };
  });
}

export type RevertDocumentResult =
  | { ok: true; key: ReservationKey }
  | { ok: false; reason: 'not_found' | 'not_revertible' | 'not_eligible' };

/**
 * Reverte um documento substituído ou desfeito, dentro do prazo (FR-013a): ele volta a ser o
 * atual, e o vigente do mesmo tipo, se houver, passa a substituído (com prazo novo).
 */
export async function revertDocument(
  db: Database,
  input: { documentId: string; clientId: string; now: Date },
): Promise<RevertDocumentResult> {
  return db.transaction(async (tx): Promise<RevertDocumentResult> => {
    const found = await findDocumentRow(tx, input.documentId);
    if (!found) return { ok: false, reason: 'not_found' };
    const reservation = await lockReservation(tx, found);
    const document = await findDocumentRow(tx, input.documentId);
    if (!document || !reservation) return { ok: false, reason: 'not_found' };

    if (!isRevertible(document, input.now)) return { ok: false, reason: 'not_revertible' };
    if (!acceptsTreatment(reservation.classification)) return { ok: false, reason: 'not_eligible' };

    const vigente = await findVigente(tx, document, document.kind);
    if (vigente) await endDocument(tx, vigente, 'replaced', input.clientId, input.now);
    await tx
      .update(treatmentDocuments)
      .set({ state: 'current', endedAt: null, endedByClientId: null })
      .where(eq(treatmentDocuments.id, document.id));
    await tx.insert(treatmentEvents).values({
      hotelCode: document.hotelCode,
      reservationNumber: document.reservationNumber,
      type: 'reverted',
      kind: document.kind,
      documentId: document.id,
      previousDocumentId: vigente?.id ?? null,
      clientId: input.clientId,
      at: input.now,
    });
    return { ok: true, key: document };
  });
}

export type ManualAmountResult = 'ok' | 'not_found' | 'proof_required';

/** Informa à mão o valor cobrado; exige comprovante vigente na reserva (FR-005). */
export async function setManualAmount(
  db: Database,
  input: { key: ReservationKey; amount: string; clientId: string; now: Date },
): Promise<ManualAmountResult> {
  const { key } = input;
  return db.transaction(async (tx): Promise<ManualAmountResult> => {
    if (!(await lockReservation(tx, key))) return 'not_found';
    if (!(await findVigente(tx, key, 'proof'))) return 'proof_required';

    await tx
      .insert(reservationManualAmounts)
      .values({
        hotelCode: key.hotelCode,
        reservationNumber: key.reservationNumber,
        amount: input.amount,
        setAt: input.now,
        setByClientId: input.clientId,
      })
      .onConflictDoUpdate({
        target: [reservationManualAmounts.hotelCode, reservationManualAmounts.reservationNumber],
        set: { amount: input.amount, setAt: input.now, setByClientId: input.clientId },
      });
    await tx.insert(treatmentEvents).values({
      hotelCode: key.hotelCode,
      reservationNumber: key.reservationNumber,
      type: 'amount_set',
      amount: input.amount,
      clientId: input.clientId,
      at: input.now,
    });
    return 'ok';
  });
}

/** Remove o valor informado à mão; sem valor gravado, não muda nada. */
export async function clearManualAmount(
  db: Database,
  input: { key: ReservationKey; clientId: string; now: Date },
): Promise<Exclude<ManualAmountResult, 'proof_required'>> {
  const { key } = input;
  return db.transaction(async (tx) => {
    if (!(await lockReservation(tx, key))) return 'not_found';

    const removed = await tx
      .delete(reservationManualAmounts)
      .where(ofReservation(reservationManualAmounts, key))
      .returning({ amount: reservationManualAmounts.amount });
    if (removed.length > 0) {
      await tx.insert(treatmentEvents).values({
        hotelCode: key.hotelCode,
        reservationNumber: key.reservationNumber,
        type: 'amount_cleared',
        clientId: input.clientId,
        at: input.now,
      });
    }
    return 'ok';
  });
}

/**
 * Confirma o alerta "Verificar" (FR-002a, research R-14): só grava o evento `review_confirmed`,
 * com a classificação confirmada, se a reserva tem o alerta neste momento. Não passa pela FR-003
 * (a reserva com alerta é justamente a que não aceita registros) e não muda nenhum documento.
 */
export async function confirmReview(
  db: Database,
  input: { key: ReservationKey; clientId: string; now: Date },
): Promise<'ok' | 'not_found'> {
  const { key } = input;
  return db.transaction(async (tx) => {
    const reservation = await lockReservation(tx, key);
    if (!reservation) return 'not_found';

    const summary = await loadTreatmentSummary(tx, key);
    const status = treatmentStatus({
      hasCurrentRequest: summary.request !== null,
      hasCurrentProof: summary.proof !== null,
    });
    const pending = needsReview({
      classification: reservation.classification,
      status,
      statusChangedAt: reservation.statusChangedAt,
      lastReviewAt: summary.lastReviewAt,
    });
    if (pending) {
      await tx.insert(treatmentEvents).values({
        hotelCode: key.hotelCode,
        reservationNumber: key.reservationNumber,
        type: 'review_confirmed',
        classification: reservation.classification,
        clientId: input.clientId,
        at: input.now,
      });
    }
    return 'ok';
  });
}

export interface TreatmentDetail {
  summary: TreatmentSummary;
  /** Todos os documentos da reserva, do mais recente para o mais antigo. */
  documents: TreatmentDocumentRecord[];
  /** Histórico completo, do mais recente para o mais antigo. */
  events: TreatmentEventRecord[];
}

/** Documentos (vigentes e anteriores) e histórico de uma reserva (FR-012, FR-015). */
export async function getTreatmentDetail(
  db: Database,
  key: ReservationKey,
): Promise<TreatmentDetail> {
  const documents = await selectDocuments(db)
    .where(ofReservation(treatmentDocuments, key))
    // Anexados no mesmo instante: o vigente vem antes, depois o encerrado mais recentemente.
    .orderBy(
      desc(treatmentDocuments.attachedAt),
      sql`${treatmentDocuments.endedAt} desc nulls first`,
      desc(treatmentDocuments.id),
    );

  const events = await db
    .select({
      id: treatmentEvents.id,
      type: treatmentEvents.type,
      kind: treatmentEvents.kind,
      documentId: treatmentEvents.documentId,
      previousDocumentId: treatmentEvents.previousDocumentId,
      amount: treatmentEvents.amount,
      classification: treatmentEvents.classification,
      batchId: treatmentEvents.batchId,
      client: apiClients.name,
      at: treatmentEvents.at,
      fromLegacy: sql<boolean>`${treatmentEvents.legacyImportId} is not null`,
    })
    .from(treatmentEvents)
    .innerJoin(apiClients, eq(apiClients.id, treatmentEvents.clientId))
    .where(ofReservation(treatmentEvents, key))
    .orderBy(desc(treatmentEvents.id));

  return { summary: await loadTreatmentSummary(db, key), documents, events };
}
