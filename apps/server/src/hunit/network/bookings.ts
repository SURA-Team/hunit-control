import { isDateWithinPeriod, type Period, type ReservationStatus } from '@hunit/domain';
import { z } from 'zod';
import { ScreenNotRecognizedError } from '../errors.js';
import type { ReservationListItem, ReservationPage } from '../gateway.js';
import { HUNIT_API_ROUTES, type HunitApiClient } from './api-client.js';
import { hunitId, toDisplayDate, toIsoDate, toMoney } from './values.js';

/**
 * Filtros fixos da consulta de reservas (FR-010), nos códigos do parâmetro de `GetBookings`
 * (research R-13a). Único lugar com esses códigos.
 *
 * `DateTypeId=2` (Check-in) e `CollectTypeId=2` (Canal Collect) foram confirmados no Hunit real
 * em 2026-11-11 (research R-13a, T022).
 */
export const BOOKING_FILTERS = {
  /** Filtrar período por: Check-in. */
  DateTypeId: 2,
  /** Status da reserva: Todas (no filtro, 0 = Todas, 1 = Ativas, 2 = Canceladas). */
  StatusId: 0,
  /** Tipo coleta pagamento: Canal ("Canal Collect"). */
  CollectTypeId: 2,
  /** Status da cobrança: Todos. */
  PrePaymentStatus: 0,
  /** Status da integração (PMS): Todas. */
  IntegrationStatusId: 0,
} as const;

/** `collectTypeId` de uma reserva Canal Collect, na resposta (research R-13a). */
export const CHANNEL_COLLECT_TYPE_ID = 2;

/** `statusId` de uma reserva cancelada, na resposta (1 = nova, 2 = alterada). */
const CANCELLED_STATUS_ID = 3;
const ACTIVE_STATUS_IDS: ReadonlySet<number> = new Set([1, 2]);

/**
 * Reservas pedidas por página (aceito pelo Hunit real em 2026-11-11; o máximo não foi medido).
 * Se o Hunit devolver menos, a paginação usa o tamanho que vier na resposta e não perde reservas.
 */
export const BOOKINGS_PAGE_SIZE = 50;

const isoDateText = z.string().refine((value) => toIsoDate(value) !== null, 'data inválida');

const bookingSchema = z.object({
  id: hunitId,
  channelIdentifier: z.string().trim().min(1),
  guestFullName: z.string().nullish(),
  channelName: z.string(),
  arrivalDate: isoDateText,
  departureDate: isoDateText,
  statusId: z.number().int(),
  collectTypeId: z.number().int(),
  total: z.number(),
});

const bookingsResponseSchema = z.object({
  items: z.object({
    items: z.array(bookingSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  }),
});

type Booking = z.infer<typeof bookingSchema>;

/** Situação da reserva pelo `statusId` (FR-014a). */
export function reservationStatusOf(statusId: number): ReservationStatus {
  if (statusId === CANCELLED_STATUS_ID) return 'cancelled';
  return ACTIVE_STATUS_IDS.has(statusId) ? 'active' : 'unknown';
}

function toListItem(booking: Booking): ReservationListItem {
  const checkIn = toIsoDate(booking.arrivalDate) as string;
  const checkOut = toIsoDate(booking.departureDate) as string;
  const guestName = booking.guestFullName?.trim();
  return {
    bookingId: booking.id,
    reservationNumber: booking.channelIdentifier,
    reservationStatus: reservationStatusOf(booking.statusId),
    listing: {
      guestName: guestName ? guestName : null,
      channel: booking.channelName,
      checkIn,
      checkOut,
      stayPeriod: `${toDisplayDate(checkIn)} a ${toDisplayDate(checkOut)}`,
      totalAmount: toMoney(booking.total),
    },
  };
}

/**
 * Uma página da listagem de reservas de um hotel (FR-010, FR-011), via `GetBookings`.
 *
 * Antes de devolver, confere que o Hunit respeitou os filtros: toda reserva tem de ser Canal
 * Collect e ter check-in dentro do período. Se não, o filtro deixou de funcionar e o hotel não
 * pode ser gravado (FR-010, edge case "o Hunit ignora um filtro").
 *
 * @param page começa em 1.
 * @throws ScreenNotRecognizedError com a resposta como evidência; SessionExpiredError,
 *   HunitUnavailableError (do `HunitApiClient`).
 */
export async function searchBookings(
  api: HunitApiClient,
  hotelCode: string,
  period: Period,
  page: number,
): Promise<ReservationPage> {
  const body = await api.get(HUNIT_API_ROUTES.bookings, {
    companyId: hotelCode,
    query: {
      ...BOOKING_FILTERS,
      StartDate: period.from,
      EndDate: period.to,
      Page: page,
      PageSize: BOOKINGS_PAGE_SIZE,
    },
  });
  const unrecognized = (detail: string) =>
    new ScreenNotRecognizedError(detail, { evidence: { response: JSON.stringify(body) } });

  const parsed = bookingsResponseSchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw unrecognized(
      `a resposta de GetBookings não tem o formato esperado (campos: ${fields.join(', ')})`,
    );
  }

  const result = parsed.data.items;
  if (result.page !== page) {
    throw unrecognized(`GetBookings devolveu a página ${result.page} no lugar da ${page}`);
  }
  if (result.items.length > result.pageSize) {
    throw unrecognized('GetBookings devolveu mais reservas do que o tamanho da página');
  }

  const items = result.items.map(toListItem);
  for (const [index, booking] of result.items.entries()) {
    const item = items[index] as ReservationListItem;
    if (booking.collectTypeId !== CHANNEL_COLLECT_TYPE_ID) {
      throw unrecognized(
        `a reserva ${item.reservationNumber} não é Canal Collect: o filtro "Tipo coleta pagamento" não foi aplicado`,
      );
    }
    if (!isDateWithinPeriod(item.listing.checkIn, period)) {
      throw unrecognized(
        `a reserva ${item.reservationNumber} tem check-in fora do período ${period.from} a ${period.to}: o filtro de período não foi aplicado`,
      );
    }
  }

  return {
    page: result.page,
    totalPages: Math.ceil(result.total / result.pageSize),
    totalItems: result.total,
    items,
  };
}
