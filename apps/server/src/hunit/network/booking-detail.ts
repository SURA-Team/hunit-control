import type { PaymentForm, ReservationPayment, ReservationSnapshot } from '@hunit/domain';
import { z } from 'zod';
import { ScreenNotRecognizedError } from '../errors.js';
import type { ReservationDetail, ReservationListItem } from '../gateway.js';
import { HUNIT_API_ROUTES, type HunitApiClient } from './api-client.js';
import { reservationStatusOf } from './bookings.js';
import { optionalText, toIsoDateTime, toMoney } from './values.js';

/**
 * Situação do pré-pagamento (`prePaymentStatus`), como a tela do Hunit a interpreta
 * (research R-13a): `Success` = cobrado ou validado, `Fail` = falha na cobrança, `Unprocessed` =
 * não cobrado. Com cartão virtual, qualquer outro valor é desconhecido → erro de análise.
 */
const PRE_PAYMENT_STATUSES = ['Success', 'Fail', 'Unprocessed'] as const;
type PrePaymentStatus = (typeof PRE_PAYMENT_STATUSES)[number];

/** Estados em que a tela mostra a ação de cobrar (se `canCharge`). */
const CHARGEABLE_STATUSES: ReadonlySet<PrePaymentStatus> = new Set(['Unprocessed', 'Fail']);

const dateTimeText = z
  .string()
  .nullish()
  .refine((value) => value === null || value === undefined || toIsoDateTime(value) !== null, {
    message: 'data e hora inválida',
  });

const lastPaymentEventSchema = z.object({
  user: optionalText,
  dateTime: dateTimeText,
  valueCharged: z.number().nullish(),
  justValidate: z.boolean(),
  authorizationCode: optionalText,
  transactionId: optionalText,
  processorReferenceNumber: optionalText,
  isParceled: z.boolean().nullish(),
  numberOfInstallments: z.number().int().nullish(),
  installmentValue: z.number().nullish(),
  description: optionalText,
});

const bookingDetailSchema = z.object({
  statusId: z.number().int(),
  hasCreditCardInfo: z.boolean(),
  prePaymentStatus: z.string().nullish(),
  canCharge: z.boolean(),
  lastPaymentEvent: lastPaymentEventSchema.nullable(),
  // Forma de pagamento (research R-22). Opcionais: a ausência não recusa a resposta.
  paymentTypeId: z.number().int().nullish(),
  totals: z.object({ paymentTypeLabel: z.string().nullish() }).nullish(),
});

type BookingDetail = z.infer<typeof bookingDetailSchema>;

/** Códigos de `paymentTypeId` vistos nas respostas reais (research R-22). */
const PAYMENT_TYPE_IDS: ReadonlyMap<number, PaymentForm['kind']> = new Map([
  [1, 'credit_card'], // "cartão de crédito"
  [6, 'invoiced'], // "faturado" (captura de 2026-11-12)
]);

/** Rótulo sem acentos, em minúsculas e com espaços colapsados, para comparar. */
function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // acentos separados pelo NFD
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function kindOfLabel(label: string): PaymentForm['kind'] {
  const normalized = normalizeLabel(label);
  if (normalized === 'cartao de credito') return 'credit_card';
  if (normalized.startsWith('faturad')) return 'invoiced';
  return 'unrecognized';
}

/**
 * Forma de pagamento da reserva (research R-22):
 * - o rótulo decide quando vem preenchido: "cartão de crédito" → `credit_card`;
 *   "faturado"/"faturada" → `invoiced`; outro → `unrecognized`;
 * - sem rótulo, só o código conhecido decide: 1 → `credit_card`; 6 → `invoiced`; outro código →
 *   `unrecognized`;
 * - código conhecido que discorda do rótulo → `unrecognized` (contraditório);
 * - os dois vazios → `null` (não informada).
 */
export function paymentFormOf(
  detail: Pick<BookingDetail, 'paymentTypeId' | 'totals'>,
): PaymentForm | null {
  const label = detail.totals?.paymentTypeLabel?.trim() || null;
  const id = detail.paymentTypeId ?? null;
  if (label === null && id === null) return null;

  // Código desconhecido não contradiz o rótulo: só não confirma nada.
  const fromKnownId = id === null ? null : (PAYMENT_TYPE_IDS.get(id) ?? null);
  const fromLabel = label === null ? null : kindOfLabel(label);
  const contradictory = fromKnownId !== null && fromLabel !== null && fromLabel !== fromKnownId;
  const kind = contradictory ? 'unrecognized' : (fromLabel ?? fromKnownId ?? 'unrecognized');

  return { kind, label: label ?? String(id) };
}

function isKnownStatus(value: string | null | undefined): value is PrePaymentStatus {
  return (PRE_PAYMENT_STATUSES as readonly string[]).includes(value ?? '');
}

function paymentOf(detail: BookingDetail): ReservationPayment {
  const event = detail.lastPaymentEvent;
  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? null : toMoney(value);
  return {
    chargedAt: event?.dateTime ? toIsoDateTime(event.dateTime) : null,
    chargedBy: event?.user ?? null,
    chargedAmount: money(event?.valueCharged),
    transactionId: event?.transactionId ?? null,
    authorizationCode: event?.authorizationCode ?? null,
    processorReference: event?.processorReferenceNumber ?? null,
    isInstallment: event?.isParceled ?? null,
    installmentCount: event?.numberOfInstallments ?? null,
    installmentAmount: money(event?.installmentValue),
    prePaymentState: detail.prePaymentStatus?.trim() || null,
    prePaymentMessage: event?.description ?? null,
  };
}

/**
 * Converte o detalhe do Hunit no retrato neutro da reserva, pela tabela de mapeamento do
 * research R-13a:
 *
 * | Sinal                 | Condição na resposta                                         |
 * |-----------------------|--------------------------------------------------------------|
 * | pré-pagamento         | `hasCreditCardInfo`                                          |
 * | falha na cobrança     | `prePaymentStatus = Fail`                                    |
 * | registro de cobrança  | `Success` e `lastPaymentEvent.justValidate = false`          |
 * | só validação          | `Success` e `lastPaymentEvent.justValidate = true`           |
 * | ação de cobrar        | `prePaymentStatus ∈ {Unprocessed, Fail}` e `canCharge`       |
 * | forma de pagamento    | `paymentTypeId` e `totals.paymentTypeLabel` (`paymentFormOf`) |
 *
 * Sem pré-pagamento, a forma de pagamento decide a situação no domínio (FR-013, regra 2).
 * Situação indeterminada (estado desconhecido, `Success` sem evento) fica `null` → erro de
 * análise no domínio (FR-015). A situação da reserva vem de `statusId` (FR-014a).
 */
export function toReservationSnapshot(
  detail: BookingDetail,
  item: ReservationListItem,
): ReservationSnapshot {
  const status = detail.prePaymentStatus?.trim();
  const known = isKnownStatus(status);
  const event = detail.lastPaymentEvent;

  const successSignal = (whenEvent: (justValidate: boolean) => boolean): boolean | null => {
    if (!known) return null;
    if (status !== 'Success') return false;
    return event ? whenEvent(event.justValidate) : null;
  };

  return {
    reservationNumber: item.reservationNumber,
    structureRecognized: true,
    prePaymentPresent: detail.hasCreditCardInfo,
    chargeFailed: known ? status === 'Fail' : null,
    chargeRecordPresent: successSignal((justValidate) => !justValidate),
    validationOnly: successSignal((justValidate) => justValidate),
    chargeActionVisible: known ? CHARGEABLE_STATUSES.has(status) && detail.canCharge : null,
    reservationStatus: reservationStatusOf(detail.statusId),
    paymentForm: paymentFormOf(detail),
    payment: paymentOf(detail),
    listing: item.listing,
  };
}

/**
 * Detalhe de uma reserva (`BookingDetail`), somente leitura (FR-012).
 *
 * @throws ScreenNotRecognizedError (resposta fora do formato, com a resposta como evidência);
 *   SessionExpiredError, HunitUnavailableError (do `HunitApiClient`).
 */
export async function readBookingDetail(
  api: HunitApiClient,
  hotelCode: string,
  item: ReservationListItem,
): Promise<ReservationDetail> {
  const body = await api.get(HUNIT_API_ROUTES.bookingDetail, {
    companyId: hotelCode,
    query: { id: item.bookingId },
  });
  return { snapshot: snapshotOf(body, item), evidence: { response: JSON.stringify(body) } };
}

/**
 * Retrato da reserva a partir de uma resposta de `BookingDetail` já lida.
 *
 * @throws ScreenNotRecognizedError (resposta fora do formato, com a resposta como evidência).
 */
export function snapshotOf(body: unknown, item: ReservationListItem): ReservationSnapshot {
  const parsed = bookingDetailSchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new ScreenNotRecognizedError(
      `o detalhe da reserva ${item.reservationNumber} (BookingDetail) não tem o formato esperado (campos: ${fields.join(', ')})`,
      { evidence: { response: JSON.stringify(body) } },
    );
  }
  return toReservationSnapshot(parsed.data, item);
}
