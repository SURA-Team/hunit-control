import type { ReservationPayment, ReservationSnapshot } from '@hunit/domain';
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
});

type BookingDetail = z.infer<typeof bookingDetailSchema>;

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
 *
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
