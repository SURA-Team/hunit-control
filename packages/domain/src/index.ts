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
export {
  ACCEPTED_TREATMENT_EXTENSIONS,
  MAX_TREATMENT_FILE_BYTES,
  MAX_TREATMENT_FILE_NAME_LENGTH,
  TREATMENT_MEDIA_TYPES,
  detectTreatmentFile,
  fileNameMatchesMediaType,
  isValidTreatmentFileName,
  type TreatmentFileCheck,
  type TreatmentFileExtension,
  type TreatmentFileRejection,
  type TreatmentMediaType,
} from './document-type.js';
export {
  CLASSIFICATIONS_ACCEPTING_TREATMENT,
  TREATMENT_DOCUMENT_KINDS,
  TREATMENT_DOCUMENT_STATES,
  TREATMENT_REVERT_DAYS,
  TREATMENT_STATUSES,
  acceptsTreatment,
  effectiveChargedAmount,
  isPendingCharge,
  isRevertible,
  revertDeadline,
  treatmentStatus,
  type TreatmentDocumentKind,
  type TreatmentDocumentState,
  type TreatmentStatus,
} from './treatment.js';
export { CLASSIFICATIONS, RESERVATION_STATUSES } from './types.js';
export type {
  Classification,
  IsoDate,
  IsoDateTime,
  Money,
  PaymentForm,
  Period,
  ReservationListing,
  ReservationPayment,
  ReservationSnapshot,
  ReservationStatus,
} from './types.js';
