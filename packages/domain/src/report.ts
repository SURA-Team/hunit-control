/**
 * Relatórios do período (specs/007, research R-03, data-model §1): quais reservas entram, em que
 * faixa de valor cada uma cai, qual valor conta, os percentuais da distribuição e os atalhos do
 * período. Funções puras, sem I/O; o servidor monta o SQL com as mesmas listas, e um teste de
 * paridade confere que os dois dizem o mesmo.
 */
import type { ReservationDetailedSituation } from './treatment.js';
import type { IsoDate, Money, Period } from './types.js';

/**
 * Situações que ficam fora do relatório (FR-008a): não importam para a cobrança. Vale a situação
 * detalhada, a da coluna da lista (com a marcação "Cancelada sem cobrança" e o comprovante).
 */
export const REPORT_EXCLUDED_SITUATIONS: readonly ReservationDetailedSituation[] = [
  'ignored_hotelbeds_258',
  'not_virtual_card',
  'invoiced',
];

/** Situações de reserva já cobrada (FR-014): cobrado anteriormente ou recuperado. */
export const REPORT_CHARGED_SITUATIONS: readonly ReservationDetailedSituation[] = [
  'proof_sent',
  'virtual_card_already_charged',
];

/** As quatro faixas de valor, na ordem da distribuição do design (8.1). */
export const REPORT_VALUE_BUCKETS = [
  'previous_charged',
  'recovered',
  'pending',
  'requested',
] as const;
export type ReportValueBucket = (typeof REPORT_VALUE_BUCKETS)[number];

/** Faixa da reserva: uma das quatro, `none` (conta em "Reservas", sem valor) ou `excluded`. */
export type ReportBucket = ReportValueBucket | 'none' | 'excluded';

/**
 * Faixa de uma reserva (data-model §1.2):
 * - situação excluída (FR-008a) → `excluded`;
 * - "Falta cobrar" com tratativa → `requested`; sem tratativa → `pending` (FR-012);
 * - "Comprovante enviado" ou "Já cobrada" → `recovered` com tratativa, senão `previous_charged`
 *   (FR-014: tratativa = documento de tratativa vigente ou linha enviada ao Comercial);
 * - o resto ("Cancelada sem cobrança") → `none`.
 */
export function reportBucket(input: {
  detailedSituation: ReservationDetailedSituation;
  /** "Falta cobrar" (`isPendingCharge`, com a classificação efetiva). */
  pendingCharge: boolean;
  /** A reserva tem tratativa (documento vigente ou linha do Comercial não cancelada). */
  hasRequest: boolean;
}): ReportBucket {
  if (REPORT_EXCLUDED_SITUATIONS.includes(input.detailedSituation)) return 'excluded';
  if (input.pendingCharge) return input.hasRequest ? 'requested' : 'pending';
  if (REPORT_CHARGED_SITUATIONS.includes(input.detailedSituation)) {
    return input.hasRequest ? 'recovered' : 'previous_charged';
  }
  return 'none';
}

/**
 * Valor que a reserva soma na faixa (data-model §1.3): em aberto, o valor a cobrar; cobrada, o
 * valor cobrado exibido (`chargedAmountWithOrigin`) ou, sem ele, o total (como o sistema
 * anterior). `null` = faixa sem valor (`none`, `excluded`) ou reserva sem valor nenhum.
 */
export function reportAmount(
  bucket: ReportBucket,
  amounts: { amountToCharge: Money | null; chargedAmount: Money | null; totalAmount: Money | null },
): Money | null {
  if (bucket === 'pending' || bucket === 'requested') return amounts.amountToCharge;
  if (bucket === 'previous_charged' || bucket === 'recovered') {
    return amounts.chargedAmount ?? amounts.totalAmount;
  }
  return null;
}

/** A reserva está numa faixa de valor, mas sem valor nenhum? (Edge Cases: "N reservas sem valor".) */
export function reportMissingAmount(bucket: ReportBucket, amount: Money | null): boolean {
  return (REPORT_VALUE_BUCKETS as readonly string[]).includes(bucket) && amount === null;
}

export interface DistributionShare {
  /** Percentual com uma casa (ex.: 96.6); os da lista somam 100 quando a base não é zero. */
  percent: number;
  /** Valor maior que zero e menor que 0,1 % da base: exibido como "<0,1%" (FR-016). */
  belowMinimum: boolean;
}

/**
 * Percentuais da distribuição (FR-016, data-model §1.4): uma casa decimal, ajustada pelo maior
 * resto para somar 100,0; empate no resto pela ordem da lista. Base zero → todos 0.
 */
export function distributionPercentages(values: readonly number[]): DistributionShare[] {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) return values.map(() => ({ percent: 0, belowMinimum: false }));
  const exact = values.map((value) => (Math.max(value, 0) / total) * 1000);
  const tenths = exact.map((value) => Math.floor(value));
  let missing = 1000 - tenths.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    tenths[index] = (tenths[index] ?? 0) + 1;
    missing -= 1;
  }
  return values.map((value, index) => ({
    percent: (tenths[index] ?? 0) / 10,
    belowMinimum: value > 0 && (exact[index] ?? 0) < 1,
  }));
}

/** Atalhos do período (FR-005). */
export const REPORT_PERIOD_SHORTCUTS = ['last_7_days', 'last_30_days', 'this_month'] as const;
export type ReportPeriodShortcut = (typeof REPORT_PERIOD_SHORTCUTS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcDay(date: IsoDate): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Data inválida: ${date}`);
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  return Date.UTC(year, month - 1, day);
}

function isoOf(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Período de um atalho a partir de hoje (data local da máquina, `AAAA-MM-DD`; data-model §1.5):
 * "Últimos 7 dias" = hoje − 6 a hoje; "Últimos 30 dias" = hoje − 29 a hoje; "Este mês" = dia 1 ao
 * último dia do mês.
 */
export function reportPeriod(shortcut: ReportPeriodShortcut, today: IsoDate): Period {
  const day = utcDay(today);
  if (shortcut === 'last_7_days') return { from: isoOf(day - 6 * DAY_MS), to: today };
  if (shortcut === 'last_30_days') return { from: isoOf(day - 29 * DAY_MS), to: today };
  const date = new Date(day);
  const first = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const last = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
  return { from: isoOf(first), to: isoOf(last) };
}

/** O atalho igual ao período, ou `custom` (o "Personalizado" fica ativo). */
export function reportShortcutOf(period: Period, today: IsoDate): ReportPeriodShortcut | 'custom' {
  for (const shortcut of REPORT_PERIOD_SHORTCUTS) {
    const candidate = reportPeriod(shortcut, today);
    if (candidate.from === period.from && candidate.to === period.to) return shortcut;
  }
  return 'custom';
}
