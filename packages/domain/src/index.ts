/**
 * @hunit/domain — regras de negócio puras do HUNIT Control.
 *
 * Este pacote não pode depender de navegador, banco de dados, HTTP nem de qualquer
 * detalhe do Hunit (constitution, princípio II). O ESLint bloqueia essas importações.
 */
export {
  classifyReservation,
  CLASSIFICATION_REASONS,
  isHotelbeds258,
  type ClassificationResult,
} from './classification.js';
export {
  InvalidPeriodError,
  isDateWithinPeriod,
  periodDays,
  splitPeriod,
  validatePeriod,
} from './period.js';
export {
  buildReservationData,
  markNotFound,
  mergeVerification,
  selectNotFound,
  type ReservationData,
  type ReservationObservation,
  type ReservationRecord,
  type VerificationHistory,
} from './verification.js';
export { CLASSIFICATIONS, RESERVATION_STATUSES } from './types.js';
export type {
  Classification,
  IsoDate,
  IsoDateTime,
  Money,
  Period,
  ReservationListing,
  ReservationPayment,
  ReservationSnapshot,
  ReservationStatus,
} from './types.js';
