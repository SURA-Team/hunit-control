/**
 * Textos e selos da lista de reservas (specs/006, FR-014, FR-015, FR-016; research R-08 a R-10). A
 * linha e os chips de `ui/` recebem os textos prontos daqui: a regra de apresentação fica num lugar
 * só e é testada sem a tela.
 */
import type {
  Reservation,
  ReservationQuickFilter,
  ReservationTreatment,
} from '../../../shared/ipc-types';
import type { BadgeTone, SituationBadgeItem } from '../ui/StatusBadge';
import { formatMoney, parseAmountInput } from './format';
import {
  CHARGED_AMOUNT_ORIGIN_NAMES,
  DETAILED_SITUATION_LABELS,
  LEGACY_ORIGIN_NAME,
  RESERVATION_STATUS_LABELS,
  REVIEW_LABEL,
  type Label,
  type Tone,
} from './labels';

/**
 * Tom do selo de cada tom de rótulo (FR-005): verde concluído, âmbar atenção, vermelho erro, lima em
 * andamento ("Em andamento", "A cobrar") e cinza neutro. "Tratativa enviada" (`info`) fica cinza,
 * como o "enviado" do design.
 */
export const BADGE_TONES: Readonly<Record<Tone, BadgeTone>> = {
  success: 'green',
  warning: 'amber',
  error: 'red',
  progress: 'lime',
  info: 'gray',
  neutral: 'gray',
};

export function badgeOf(label: Label, title?: string): SituationBadgeItem {
  return { label: label.name, tone: BADGE_TONES[label.tone], ...(title && { title }) };
}

/** Explicação do selo "Verificar" ao passar o mouse. */
export const REVIEW_TITLE =
  'O Hunit mudou a situação depois da tratativa. Confira e confirme no detalhe da reserva.';

/**
 * Selos da coluna "Situação da reserva" (FR-015; telas 4.1, 4.4 e 4.10): a situação, o "Verificar"
 * em âmbar cheio quando houver e "Não identificada" quando o Hunit não disse se está ativa ou
 * cancelada. "Sistema anterior" vai ao lado do nome (`LEGACY_BADGE`).
 */
export function situationBadges(
  reservation: Pick<Reservation, 'reservationStatus'> & {
    treatment: Pick<ReservationTreatment, 'detailedSituation' | 'needsReview'>;
  },
): SituationBadgeItem[] {
  const items = [badgeOf(DETAILED_SITUATION_LABELS[reservation.treatment.detailedSituation])];
  if (reservation.treatment.needsReview) {
    items.push({ label: REVIEW_LABEL.name, tone: 'alert', title: REVIEW_TITLE });
  }
  if (reservation.reservationStatus === 'unknown') {
    items.push(badgeOf(RESERVATION_STATUS_LABELS.unknown));
  }
  return items;
}

/** Selo ao lado do nome da reserva importada (specs/004, FR-024; tela 4.10). */
export const LEGACY_BADGE: SituationBadgeItem = {
  label: LEGACY_ORIGIN_NAME,
  tone: 'gray',
  title: 'Reserva importada do sistema anterior',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dateParts(value: string): { day: string; month: string; year: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? { year: match[1] ?? '', month: match[2] ?? '', day: match[3] ?? '' } : null;
}

/**
 * Período da reserva (R-08): "17/11 → 19/11/2026"; com anos diferentes, os dois completos; sem
 * check-out, só o check-in.
 */
export function formatStay(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): string {
  const start = checkIn ? dateParts(checkIn) : null;
  if (!start) return '—';
  const end = checkOut ? dateParts(checkOut) : null;
  if (!end) return `${start.day}/${start.month}/${start.year}`;
  const from =
    start.year === end.year
      ? `${start.day}/${start.month}`
      : `${start.day}/${start.month}/${start.year}`;
  return `${from} → ${end.day}/${end.month}/${end.year}`;
}

/** Noites entre o check-in e o check-out: "1 noite", "2 noites"; sem check-out, nada. */
export function formatNights(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): string {
  if (!checkIn || !checkOut) return '';
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS);
  if (!Number.isFinite(nights) || nights < 0) return '';
  return nights === 1 ? '1 noite' : `${nights} noites`;
}

/**
 * Segunda linha da coluna Valor (FR-014): "cobrado R$ 1.280,00 · Hunit" ou "· manual"; sem valor
 * cobrado (ou zero), nada.
 */
export function formatChargedLine(
  treatment: Pick<ReservationTreatment, 'effectiveChargedAmount' | 'chargedAmountOrigin'>,
): string | null {
  const amount = treatment.effectiveChargedAmount;
  if (!amount || !/[1-9]/.test(amount)) return null;
  const origin = treatment.chargedAmountOrigin;
  const suffix = origin ? ` · ${CHARGED_AMOUNT_ORIGIN_NAMES[origin]}` : '';
  return `cobrado ${formatMoney(amount)}${suffix}`;
}

/** Os textos de uma linha da lista (`ReservationRow`). */
export function reservationRowText(reservation: Reservation, hotelName: string) {
  return {
    // Reserva antiga anonimizada (specs/001, FR-026): o nome não existe mais.
    guestName:
      reservation.anonymized || !reservation.guestName ? 'nome anonimizado' : reservation.guestName,
    detail: [reservation.reservationNumber, reservation.channel].filter(Boolean).join(' · '),
    hotelName,
    period: formatStay(reservation.checkIn, reservation.checkOut),
    nights: formatNights(reservation.checkIn, reservation.checkOut),
    // Marcada como cancelada sem cobrança (specs/008, FR-020): "R$ 0,00" e "antes R$ …".
    amount: formatMoney(
      reservation.noCharge ? reservation.amountToCharge : reservation.totalAmount,
    ),
    chargedAmount: reservation.noCharge
      ? [
          `antes ${formatMoney(reservation.noCharge.previousAmount)}`,
          formatChargedLine(reservation.treatment),
        ]
          .filter(Boolean)
          .join(' · ')
      : formatChargedLine(reservation.treatment),
  };
}

/** Filtros rápidos na ordem do design (FR-016): "Todas" é a ausência de filtro. */
export const QUICK_FILTER_LABELS: Readonly<Record<ReservationQuickFilter, string>> = {
  pending_charge: 'Falta cobrar',
  to_review: 'A verificar',
  with_error: 'Com erro',
  done: 'Concluídas',
};

export const QUICK_FILTER_ORDER: readonly ReservationQuickFilter[] = [
  'pending_charge',
  'to_review',
  'with_error',
  'done',
];

/** Campo da resposta das contagens de cada filtro rápido. */
export const QUICK_FILTER_COUNT_FIELD = {
  pending_charge: 'pendingCharge',
  to_review: 'toReview',
  with_error: 'withError',
  done: 'done',
} as const satisfies Record<ReservationQuickFilter, string>;

/** Mínimo da busca por texto (o mesmo da API, `q`). */
export const MIN_SEARCH_LENGTH = 2;

export type SearchInput = { q?: string; amount?: string; error?: string };

/**
 * Busca única (research R-10): dinheiro brasileiro com centavos ou com "R$" (`380,00`, `1.234,56`,
 * `R$ 380`) vira `amount`; o resto vira `q`, com pelo menos 2 caracteres. Só dígitos e hífens
 * (`101-1000`, `1000`) é número de reserva, então vai como texto.
 */
export function parseSearch(text: string): SearchInput {
  const trimmed = text.trim();
  if (trimmed === '') return {};
  const looksLikeMoney = /R\$/i.test(trimmed) || /^[\d.]*\d,\d{1,2}$/.test(trimmed);
  if (looksLikeMoney) {
    const amount = parseAmountInput(trimmed);
    return amount ? { amount } : { error: 'Valor inválido. Use, por exemplo, 1.234,56.' };
  }
  if (trimmed.length < MIN_SEARCH_LENGTH) {
    return { error: 'Digite ao menos 2 caracteres na busca.' };
  }
  return { q: trimmed };
}
