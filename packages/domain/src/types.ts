/**
 * Tipos do domínio (specs/001, data-model.md).
 *
 * As listas `as const` são a fonte dos valores permitidos no código. O banco (enums do
 * PostgreSQL) e o contrato da API (OpenAPI) repetem esses valores; testes conferem que os três
 * continuam iguais.
 */

/**
 * Situação de cobrança de uma reserva (FR-013), na ordem em que as regras são aplicadas.
 *
 * - `ignored_hotelbeds_258`: número começa com "258-"; a reserva não é aberta.
 * - `not_virtual_card`: sem indicação de pré-pagamento.
 * - `virtual_card_charge_error`: o estado atual do pré-pagamento indica falha de cobrança.
 * - `virtual_card_already_charged`: há registro de cobrança ("Cobrado em").
 * - `virtual_card_validated_only`: o cartão foi apenas validado ("Validado em"), sem cobrança.
 * - `virtual_card_pending_charge`: sem registro de cobrança e com a ação de cobrar disponível.
 * - `analysis_error`: estrutura não reconhecida, contraditória ou indeterminada (FR-015).
 */
export const CLASSIFICATIONS = [
  'ignored_hotelbeds_258',
  'not_virtual_card',
  'virtual_card_charge_error',
  'virtual_card_already_charged',
  'virtual_card_validated_only',
  'virtual_card_pending_charge',
  'analysis_error',
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * Situação da reserva no Hunit (FR-014a), registrada de forma independente da classificação
 * de cobrança. `unknown` = não foi possível identificar.
 */
export const RESERVATION_STATUSES = ['active', 'cancelled', 'unknown'] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Data no formato ISO `AAAA-MM-DD` (research R-17). */
export type IsoDate = string;

/** Instante no formato ISO 8601 em UTC, como em `Date.prototype.toISOString()`. */
export type IsoDateTime = string;

/** Valor em BRL como string decimal com duas casas, ex.: `"1234.56"` (research R-17). */
export type Money = string;

/** Período de check-in consultado, com as duas datas incluídas (`from <= to`, FR-010a). */
export interface Period {
  from: IsoDate;
  to: IsoDate;
}

/** Dados do pré-pagamento e do último evento de pagamento de uma reserva (FR-016). */
export interface ReservationPayment {
  /** Data/hora do último evento: "Cobrado em" ou, numa validação, "Validado em". */
  chargedAt: IsoDateTime | null;
  /** Quem realizou o último evento de pagamento. */
  chargedBy: string | null;
  /** Valor do último evento de pagamento (pode ser zero numa validação). */
  chargedAmount: Money | null;
  transactionId: string | null;
  authorizationCode: string | null;
  processorReference: string | null;
  isInstallment: boolean | null;
  installmentCount: number | null;
  installmentAmount: Money | null;
  /** Estado do pré-pagamento como informado pelo Hunit. */
  prePaymentState: string | null;
  /** Mensagem do pré-pagamento como informada pelo Hunit (ex.: motivo de uma falha). */
  prePaymentMessage: string | null;
}

/** Dados de uma reserva como aparecem na listagem do Hunit (FR-016). */
export interface ReservationListing {
  guestName: string | null;
  channel: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  /** Período da hospedagem como exibido no Hunit. */
  stayPeriod: string;
  totalAmount: Money;
}

/**
 * Retrato neutro do detalhe de uma reserva, produzido pela camada do Hunit e consumido pelas
 * regras de classificação. Não contém nada específico de telas ou respostas do Hunit
 * (constitution, princípio II).
 *
 * Nos campos que decidem a classificação, `null` significa "não foi possível determinar" e
 * leva a `analysis_error` (FR-015): nunca presumir cobrança.
 */
export interface ReservationSnapshot {
  reservationNumber: string;
  /** O detalhe da reserva foi reconhecido (tela ou resposta no formato esperado). */
  structureRecognized: boolean;
  /** Há indicação de pré-pagamento (cartão virtual). */
  prePaymentPresent: boolean | null;
  /** Há registro de cobrança ("Cobrado em"). */
  chargeRecordPresent: boolean | null;
  /** A ação de cobrar está disponível. É só um sinal: nunca é acionada (FR-012). */
  chargeActionVisible: boolean | null;
  /** O estado atual do pré-pagamento indica falha de cobrança. */
  chargeFailed: boolean | null;
  /** O último evento foi só a validação do cartão ("Validado em"), sem cobrança. */
  validationOnly: boolean | null;
  reservationStatus: ReservationStatus;
  payment: ReservationPayment;
  listing: ReservationListing;
}
