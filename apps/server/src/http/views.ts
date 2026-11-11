/**
 * Conversão dos registros do banco para o formato do contrato da API. Datas saem em ISO 8601 e
 * nenhum campo fora do contrato é devolvido.
 */
import type { components } from '@hunit/contracts';
import type { ExecutionEvent } from '../executions/events.js';
import type {
  ExecutionHotelRow,
  ExecutionRow,
  ExecutionWithClient,
} from '../persistence/executions-repo.js';
import type { HotelRow } from '../persistence/hotels-repo.js';
import type { ReservationRow } from '../persistence/reservations-repo.js';
import type { ClassificationCounts } from '../persistence/schema.js';

type Schemas = components['schemas'];
export type ReservationView = Schemas['Reservation'];
export type ExecutionView = Schemas['Execution'];
export type ExecutionSummaryView = Schemas['ExecutionSummary'];
export type ExecutionEventView = Schemas['ExecutionEvent'];
export type HotelView = Schemas['Hotel'];

function iso(date: Date): string;
function iso(date: Date | null): string | null;
function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function toExecutionSummary(row: ExecutionRow): ExecutionSummaryView {
  return {
    id: row.id,
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
}

/**
 * Estado completo da execução (FR-021). O andamento detalhado (`current`) e as estimativas de
 * tempo (`timing`) chegam com a US3 (tasks T054, T057).
 */
export function toExecutionView({
  found,
  hotels,
  recentEvents,
}: ExecutionViewParts): ExecutionView {
  const { execution, clientName } = found;
  return {
    ...toExecutionSummary(execution),
    requestedClient: clientName,
    twoFactorDeadline: iso(execution.twoFactorDeadline),
    current: null,
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
    timing: {
      avgSecondsPerReservation: null,
      avgSecondsPerHotel: null,
      estimatedRemainingSeconds: null,
    },
    recentEvents: recentEvents.map(toEventView),
  };
}

/**
 * Reserva no formato do contrato (FR-016 a FR-018a). Valores monetários saem como string decimal
 * (research R-17); o nome do hóspede sai `null` depois da anonimização (FR-026).
 */
export function toReservationView(row: ReservationRow): ReservationView {
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
