/**
 * Conversão dos registros do banco para o formato do contrato da API. Datas saem em ISO 8601 e
 * nenhum campo fora do contrato é devolvido.
 */
import type { components } from '@hunit/contracts';
import {
  acceptsTreatment,
  effectiveChargedAmount,
  isRevertible,
  revertDeadline,
  treatmentStatus,
  type Classification,
} from '@hunit/domain';
import type { ExecutionEvent } from '../executions/events.js';
import type { ExecutionTiming } from '../executions/timing.js';
import type {
  ExecutionHotelRow,
  ExecutionRow,
  ExecutionWithClient,
} from '../persistence/executions-repo.js';
import type { HotelRow } from '../persistence/hotels-repo.js';
import type { ReservationRow } from '../persistence/reservations-repo.js';
import type { ClassificationCounts } from '../persistence/schema.js';
import {
  EMPTY_TREATMENT,
  type ReservationOutcome,
  type TreatmentDocumentRecord,
  type TreatmentEventRecord,
  type TreatmentSummary,
} from '../persistence/treatments-repo.js';

type Schemas = components['schemas'];
export type ReservationView = Schemas['Reservation'];
export type ExecutionView = Schemas['Execution'];
export type ExecutionSummaryView = Schemas['ExecutionSummary'];
export type ExecutionEventView = Schemas['ExecutionEvent'];
export type HotelView = Schemas['Hotel'];
export type ReservationTreatmentView = Schemas['ReservationTreatment'];
export type TreatmentDocumentView = Schemas['TreatmentDocument'];
export type TreatmentEventView = Schemas['TreatmentEvent'];
export type ReservationOutcomeView = Schemas['ReservationOutcome'];

function iso(date: Date): string;
function iso(date: Date | null): string | null;
function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** Resumo da execução; `clientName` é quem a iniciou ou retomou (`requestedClient`). */
export function toExecutionSummary(row: ExecutionRow, clientName: string): ExecutionSummaryView {
  return {
    id: row.id,
    requestedClient: clientName,
    parentExecutionId: row.parentExecutionId,
    status: row.status,
    endReason: row.endReason,
    period: { from: row.periodFrom, to: row.periodTo },
    createdAt: iso(row.createdAt),
    finishedAt: iso(row.finishedAt),
  };
}

export function toEventView(event: ExecutionEvent): ExecutionEventView {
  return {
    id: String(event.id),
    at: iso(event.at),
    type: event.type,
    ...(event.status && { status: event.status }),
    hotelCode: event.hotelCode,
    reservationNumber: event.reservationNumber,
    message: event.message,
  };
}

function durationSeconds(run: ExecutionHotelRow): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  return Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000);
}

function sumCounts(all: readonly ClassificationCounts[]): ClassificationCounts {
  const total: ClassificationCounts = {};
  for (const counts of all) {
    for (const [classification, count] of Object.entries(counts) as Array<
      [keyof ClassificationCounts, number]
    >) {
      total[classification] = (total[classification] ?? 0) + count;
    }
  }
  return total;
}

export interface ExecutionViewParts {
  found: ExecutionWithClient;
  hotels: readonly ExecutionHotelRow[];
  recentEvents: readonly ExecutionEvent[];
  /** Avisos mais recentes, dos mais novos para os mais antigos (specs/002, FR-016a). */
  warnings: readonly ExecutionEvent[];
  /** Médias e estimativa (FR-021a), calculadas por `executionTiming`. */
  timing: ExecutionTiming;
}

/**
 * Posição atual da execução (FR-021): o hotel em andamento com a atividade mais recente, a página
 * em leitura e a última reserva analisada nele. Com hotéis em paralelo (HOTEL_CONCURRENCY), os
 * demais em andamento aparecem em `hotels`.
 */
export function currentPosition(
  execution: ExecutionRow,
  hotels: readonly ExecutionHotelRow[],
  recentEvents: readonly ExecutionEvent[],
): ExecutionView['current'] {
  if (execution.status !== 'running') return null;
  const running = hotels.filter((hotel) => hotel.status === 'running');
  if (running.length === 0) return null;

  const latest = [...recentEvents].reverse();
  const busiest = latest.find((event) =>
    running.some((hotel) => hotel.hotelCode === event.hotelCode),
  );
  const hotel =
    running.find((candidate) => candidate.hotelCode === busiest?.hotelCode) ?? running[0];
  if (!hotel) return null;

  const pagesDone = hotel.pagesDone ?? 0;
  // `pages_total` só é conhecido depois que a primeira página responde.
  const pagesTotal = hotel.pagesTotal && hotel.pagesTotal > 0 ? hotel.pagesTotal : null;
  const lastReservation = latest.find(
    (event) => event.hotelCode === hotel.hotelCode && event.reservationNumber !== null,
  );
  return {
    hotelCode: hotel.hotelCode,
    page: pagesTotal === null ? pagesDone + 1 : Math.min(pagesDone + 1, pagesTotal),
    pagesTotal,
    reservationNumber: lastReservation?.reservationNumber ?? null,
  };
}

/** Estado completo da execução, com andamento e tempos (FR-021, FR-021a). */
export function toExecutionView({
  found,
  hotels,
  recentEvents,
  warnings,
  timing,
}: ExecutionViewParts): ExecutionView {
  const { execution, clientName } = found;
  return {
    ...toExecutionSummary(execution, clientName),
    twoFactorDeadline: iso(execution.twoFactorDeadline),
    current: currentPosition(execution, hotels, recentEvents),
    hotels: hotels.map((run) => ({
      hotelCode: run.hotelCode,
      hotelName: run.hotelName,
      status: run.status,
      pagesDone: run.pagesDone,
      pagesTotal: run.pagesTotal,
      reservationsSeen: run.reservationsSeen,
      durationSeconds: durationSeconds(run),
      counts: run.counts,
      failureReason: run.failureReason,
    })),
    counts: sumCounts(hotels.map((run) => run.counts)),
    timing,
    recentEvents: recentEvents.map(toEventView),
    warnings: warnings.map(toEventView),
  };
}

/**
 * Documento de uma tratativa no formato do contrato (specs/003). `revertibleUntil` só é
 * preenchido enquanto o documento substituído ou desfeito ainda pode ser revertido (FR-013a).
 */
export function toTreatmentDocumentView(
  document: TreatmentDocumentRecord,
  now: Date,
): TreatmentDocumentView {
  return {
    id: document.id,
    kind: document.kind,
    state: document.state,
    fileName: document.originalName,
    sizeBytes: document.sizeBytes,
    mediaType: document.mediaType,
    attachedAt: iso(document.attachedAt),
    attachedBy: document.attachedBy,
    endedAt: iso(document.endedAt),
    endedBy: document.endedBy,
    revertibleUntil:
      document.endedAt && isRevertible(document, now)
        ? iso(revertDeadline(document.endedAt))
        : null,
  };
}

/**
 * Resumo da tratativa de uma reserva (specs/003, FR-002, FR-005): a situação, os documentos
 * vigentes e os valores são calculados aqui, com as regras do domínio — os clientes só exibem.
 */
export function toReservationTreatmentView(
  reservation: { classification: Classification; chargedAmount: string | null },
  summary: TreatmentSummary,
  now: Date,
): ReservationTreatmentView {
  const hasCurrentProof = summary.proof !== null;
  return {
    status: treatmentStatus({ hasCurrentRequest: summary.request !== null, hasCurrentProof }),
    request: summary.request ? toTreatmentDocumentView(summary.request, now) : null,
    proof: summary.proof ? toTreatmentDocumentView(summary.proof, now) : null,
    manualChargedAmount: summary.manualAmount,
    effectiveChargedAmount: effectiveChargedAmount(
      reservation.chargedAmount,
      summary.manualAmount,
      hasCurrentProof,
    ),
    acceptsDocuments: acceptsTreatment(reservation.classification),
  };
}

export function toTreatmentEventView(event: TreatmentEventRecord): TreatmentEventView {
  return {
    id: event.id,
    type: event.type,
    kind: event.kind,
    documentId: event.documentId,
    previousDocumentId: event.previousDocumentId,
    amount: event.amount,
    batchId: event.batchId,
    client: event.client,
    at: iso(event.at),
  };
}

/** Desfecho de uma reserva num registro ou numa conferência; o erro interno não é devolvido. */
export function toReservationOutcomeView(outcome: ReservationOutcome): ReservationOutcomeView {
  return {
    hotelCode: outcome.hotelCode,
    reservationNumber: outcome.reservationNumber,
    outcome: outcome.outcome,
    reason: outcome.reason,
    classification: outcome.classification,
    totalAmount: outcome.totalAmount,
    documentId: outcome.documentId,
  };
}

/**
 * Reserva no formato do contrato (FR-016 a FR-018a). Valores monetários saem como string decimal
 * (research R-17); o nome do hóspede sai `null` depois da anonimização (FR-026). `treatment` é
 * a camada manual ao lado da reserva (specs/003).
 */
export function toReservationView(
  row: ReservationRow,
  treatment: TreatmentSummary = EMPTY_TREATMENT,
  now: Date = new Date(),
): ReservationView {
  return {
    hotelCode: row.hotelCode,
    reservationNumber: row.reservationNumber,
    guestName: row.anonymizedAt ? null : row.guestName,
    channel: row.channel,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    stayPeriod: row.stayPeriod,
    totalAmount: row.totalAmount,
    reservationStatus: row.reservationStatus,
    classification: row.classification,
    reason: row.reason,
    paymentForm: row.paymentForm,
    payment: {
      prePaymentFound: row.prePaymentFound,
      chargedAt: iso(row.chargedAt),
      chargedBy: row.chargedBy,
      chargedAmount: row.chargedAmount,
      transactionId: row.transactionId,
      authorizationCode: row.authorizationCode,
      processorReference: row.processorReference,
      isInstallment: row.isInstallment,
      installmentCount: row.installmentCount,
      installmentAmount: row.installmentAmount,
      prePaymentState: row.prePaymentState,
      prePaymentMessage: row.prePaymentMessage,
      chargeActionVisible: row.chargeActionVisible,
    },
    tracking: {
      changedFields: row.changedFields,
      statusChanged: row.statusChanged,
      previousClassification: row.previousClassification,
      previousReservationStatus: row.previousReservationStatus,
      statusChangedAt: iso(row.statusChangedAt),
      notFoundSince: iso(row.notFoundSince),
    },
    firstVerifiedAt: iso(row.firstVerifiedAt),
    lastVerifiedAt: iso(row.lastVerifiedAt),
    verificationCount: row.verificationCount,
    lastExecutionId: row.lastExecutionId,
    anonymized: row.anonymizedAt !== null,
    treatment: toReservationTreatmentView(row, treatment, now),
  };
}

export function toHotelView(row: HotelRow): HotelView {
  return {
    code: row.code,
    name: row.name,
    available: row.available,
    lastSeenAt: iso(row.lastSeenAt),
  };
}
