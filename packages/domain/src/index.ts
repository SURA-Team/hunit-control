/**
 * @hunit/domain — regras de negócio puras do HUNIT Control.
 *
 * Este pacote não pode depender de navegador, banco de dados, HTTP nem de qualquer
 * detalhe do Hunit (constitution, princípio II). O ESLint bloqueia essas importações.
 */
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
