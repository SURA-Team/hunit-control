import type { ClassificationResult } from './classification.js';
import { isDateWithinPeriod } from './period.js';
import type {
  Classification,
  IsoDate,
  IsoDateTime,
  Money,
  Period,
  ReservationListing,
  ReservationSnapshot,
  ReservationStatus,
} from './types.js';

/** O que uma verificação observa de uma reserva (FR-016). Identificada por hotel + número (FR-017). */
export interface ReservationData {
  hotelCode: string;
  reservationNumber: string;
  guestName: string | null;
  channel: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  stayPeriod: string;
  totalAmount: Money;
  reservationStatus: ReservationStatus;
  classification: Classification;
  reason: string;
  prePaymentFound: boolean;
  chargedAt: IsoDateTime | null;
  chargedBy: string | null;
  chargedAmount: Money | null;
  transactionId: string | null;
  authorizationCode: string | null;
  processorReference: string | null;
  isInstallment: boolean | null;
  installmentCount: number | null;
  installmentAmount: Money | null;
  prePaymentState: string | null;
  prePaymentMessage: string | null;
  /** Apenas um sinal; a ação de cobrar nunca é acionada (FR-012). */
  chargeActionVisible: boolean;
  /** Forma de pagamento como o Hunit informa; `null` = não informada (FR-016, R-22). */
  paymentForm: string | null;
}

/** Histórico de verificação de uma reserva (FR-018, FR-018a, FR-026). */
export interface VerificationHistory {
  firstVerifiedAt: Date;
  lastVerifiedAt: Date;
  verificationCount: number;
  /** Campos (nomes de `ReservationData`) alterados na última verificação. */
  changedFields: string[];
  /** A classificação ou a situação da reserva mudou na última verificação. */
  statusChanged: boolean;
  /** Valores antes da última mudança de status. */
  previousClassification: Classification | null;
  previousReservationStatus: ReservationStatus | null;
  /** Momento da última mudança de status. */
  statusChangedAt: Date | null;
  /** Preenchido = "não encontrada na última verificação" (FR-018a). */
  notFoundSince: Date | null;
  /** Preenchido = nome do hóspede anonimizado (FR-026); não volta a ser gravado. */
  anonymizedAt: Date | null;
}

export type ReservationRecord = ReservationData & VerificationHistory;

/** Campos comparados entre verificações, na ordem em que aparecem em `changedFields`. */
const TRACKED_FIELDS = [
  'guestName',
  'channel',
  'checkIn',
  'checkOut',
  'stayPeriod',
  'totalAmount',
  'reservationStatus',
  'classification',
  'reason',
  'prePaymentFound',
  'chargedAt',
  'chargedBy',
  'chargedAmount',
  'transactionId',
  'authorizationCode',
  'processorReference',
  'isInstallment',
  'installmentCount',
  'installmentAmount',
  'prePaymentState',
  'prePaymentMessage',
  'chargeActionVisible',
  'paymentForm',
] as const satisfies ReadonlyArray<keyof ReservationData>;

export interface ReservationObservation {
  hotelCode: string;
  reservationNumber: string;
  /** Dados da listagem do Hunit. */
  listing: ReservationListing;
  /** Detalhe lido; `null` quando a reserva não foi aberta. */
  snapshot: ReservationSnapshot | null;
  result: ClassificationResult;
}

/** Junta listagem, detalhe e classificação no registro de uma reserva (FR-016). */
export function buildReservationData(observation: ReservationObservation): ReservationData {
  const { snapshot, result, listing } = observation;
  return {
    hotelCode: observation.hotelCode,
    reservationNumber: observation.reservationNumber,
    guestName: listing.guestName,
    channel: listing.channel,
    checkIn: listing.checkIn,
    checkOut: listing.checkOut,
    stayPeriod: listing.stayPeriod,
    totalAmount: listing.totalAmount,
    reservationStatus: result.reservationStatus,
    classification: result.classification,
    reason: result.reason,
    prePaymentFound: snapshot?.prePaymentPresent === true,
    chargedAt: snapshot?.payment.chargedAt ?? null,
    chargedBy: snapshot?.payment.chargedBy ?? null,
    chargedAmount: snapshot?.payment.chargedAmount ?? null,
    transactionId: snapshot?.payment.transactionId ?? null,
    authorizationCode: snapshot?.payment.authorizationCode ?? null,
    processorReference: snapshot?.payment.processorReference ?? null,
    isInstallment: snapshot?.payment.isInstallment ?? null,
    installmentCount: snapshot?.payment.installmentCount ?? null,
    installmentAmount: snapshot?.payment.installmentAmount ?? null,
    prePaymentState: snapshot?.payment.prePaymentState ?? null,
    prePaymentMessage: snapshot?.payment.prePaymentMessage ?? null,
    chargeActionVisible: snapshot?.chargeActionVisible === true,
    paymentForm: snapshot?.paymentForm?.label ?? null,
  };
}

/**
 * Aplica uma verificação ao registro da reserva (FR-017, FR-018; data-model, "Regras de
 * atualização"):
 * 1. reserva nova → primeira e última verificação = agora, contagem 1;
 * 2. reserva conhecida → campos alterados, mudança de status (classificação ou situação, com os
 *    valores anteriores e o momento), contagem + 1, última verificação = agora, e deixa de estar
 *    "não encontrada".
 *
 * Reserva anonimizada (FR-026) continua sem o nome do hóspede.
 */
export function mergeVerification(
  existing: ReservationRecord | null,
  observed: ReservationData,
  now: Date,
): ReservationRecord {
  if (!existing) {
    return {
      ...observed,
      firstVerifiedAt: now,
      lastVerifiedAt: now,
      verificationCount: 1,
      changedFields: [],
      statusChanged: false,
      previousClassification: null,
      previousReservationStatus: null,
      statusChangedAt: null,
      notFoundSince: null,
      anonymizedAt: null,
    };
  }

  const next: ReservationData = existing.anonymizedAt ? { ...observed, guestName: null } : observed;
  const changedFields = TRACKED_FIELDS.filter((field) => existing[field] !== next[field]);
  const statusChanged =
    existing.classification !== next.classification ||
    existing.reservationStatus !== next.reservationStatus;

  return {
    ...next,
    firstVerifiedAt: existing.firstVerifiedAt,
    lastVerifiedAt: now,
    verificationCount: existing.verificationCount + 1,
    changedFields,
    statusChanged,
    previousClassification: statusChanged
      ? existing.classification
      : existing.previousClassification,
    previousReservationStatus: statusChanged
      ? existing.reservationStatus
      : existing.previousReservationStatus,
    statusChangedAt: statusChanged ? now : existing.statusChangedAt,
    notFoundSince: null,
    anonymizedAt: existing.anonymizedAt,
  };
}

/**
 * Reservas gravadas de um hotel concluído que devem ser marcadas como "não encontradas"
 * (FR-018a): check-in dentro do período consultado e ausentes do resultado.
 *
 * @param records reservas gravadas do hotel.
 * @param seen números das reservas vistas nesta verificação.
 */
export function selectNotFound(
  records: readonly ReservationRecord[],
  seen: ReadonlySet<string>,
  period: Period,
): ReservationRecord[] {
  return records.filter(
    (record) => !seen.has(record.reservationNumber) && isDateWithinPeriod(record.checkIn, period),
  );
}

/**
 * Marca a reserva como "não encontrada na última verificação" (FR-018a), guardando o momento da
 * primeira marcação. Classificação, situação e histórico ficam como estão.
 */
export function markNotFound(record: ReservationRecord, now: Date): ReservationRecord {
  return { ...record, notFoundSince: record.notFoundSince ?? now };
}
