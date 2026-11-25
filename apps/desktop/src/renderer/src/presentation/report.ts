/**
 * Textos e formatos do módulo de Relatórios (specs/007, T011, T023; research R-09): rótulos das
 * faixas, percentuais, frases do topo e a ordem e a busca dos hotéis. Só apresentação: os números e as
 * faixas vêm do servidor (`GET /reports/overview`), e os percentuais seguem a regra do domínio.
 */
import {
  distributionPercentages,
  type DistributionShare,
  type ReportPeriodShortcut,
} from '@hunit/domain';
import type { HotelReportRow, ReportOverview } from '../../../shared/ipc-types';
import { formatDate, formatDateTime, formatInteger, formatMoney, formatTime } from './format';

export type ReportTone = 'previous' | 'recovered' | 'pending' | 'requested';

/** Nome e detalhe de cada faixa (design, 8.1; FR-014, FR-017). */
export const REPORT_BUCKET_LABELS: Record<ReportTone, { name: string; detail: string }> = {
  previous: { name: 'Cobrado anteriormente', detail: 'sem precisar de tratativa' },
  recovered: { name: 'Recuperado', detail: 'cobrado depois da tratativa' },
  pending: { name: 'Pendente', detail: 'sem tratativa' },
  requested: { name: 'Solicitado', detail: 'com tratativa enviada' },
};

/** Rótulos dos atalhos do período (FR-005). */
export const REPORT_SHORTCUT_LABELS: Record<ReportPeriodShortcut | 'custom', string> = {
  last_7_days: 'Últimos 7 dias',
  last_30_days: 'Últimos 30 dias',
  this_month: 'Este mês',
  custom: 'Personalizado',
};

const two = (value: number) => String(value).padStart(2, '0');

/** Hoje na máquina, `AAAA-MM-DD` (os atalhos contam o dia local, data-model §1.5). */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** Valor da API em número, só para as barras. */
export function amountValue(amount: string | null | undefined): number {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

const oneDecimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "96,6%", "1,0%" e "<0,1%" (FR-016). */
export function formatShare(share: DistributionShare): string {
  return share.belowMinimum ? '<0,1%' : `${oneDecimal.format(share.percent)}%`;
}

/** Percentual inteiro do card de valor em aberto ("35%"), com "<1%" para as partes muito pequenas. */
export function formatWholeShare(value: number, total: number): string {
  if (total <= 0) return '0%';
  const percent = (value / total) * 100;
  if (value > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}

/** As quatro faixas da distribuição, na ordem do design, com valor e percentual. */
export function valueDistribution(report: ReportOverview): {
  tone: ReportTone;
  amount: string;
  share: DistributionShare;
}[] {
  const items: { tone: ReportTone; amount: string }[] = [
    { tone: 'previous', amount: report.charged.previous },
    { tone: 'recovered', amount: report.charged.recovered },
    { tone: 'pending', amount: report.open.pending },
    { tone: 'requested', amount: report.open.requested },
  ];
  const shares = distributionPercentages(items.map((item) => amountValue(item.amount)));
  return items.map((item, index) => ({
    ...item,
    share: shares[index] ?? { percent: 0, belowMinimum: false },
  }));
}

/** Total da distribuição: "Do total de R$ … em cartão virtual". */
export function distributionTotal(report: ReportOverview): string {
  const cents = [report.charged.amount, report.open.amount].reduce(
    (sum, value) => sum + Math.round(amountValue(value) * 100),
    0,
  );
  return formatMoney((cents / 100).toFixed(2));
}

/** "34.526 reservas no recorte" / "1 reserva no recorte" (FR-008). */
export function reservationsInRange(count: number): string {
  return `${formatInteger(count)} ${count === 1 ? 'reserva' : 'reservas'} no recorte`;
}

/** "79 de 83" (FR-011). */
export function hotelsWithData(report: ReportOverview): string {
  return `${formatInteger(report.hotels.withData)} de ${formatInteger(report.hotels.total)}`;
}

/** "16/11/2026 às 10:58". */
export function dateAtTime(value: string): string {
  const [date = '', time = ''] = formatDateTime(value).split(' ');
  return `${date} às ${time}`;
}

/** Subtítulo da página com os dados em dia (8.1). */
export function reportSubtitle(generatedAt: string): string {
  return `Reservas com cartão virtual · dados do servidor atualizados em ${dateAtTime(generatedAt)}`;
}

/** Subtítulo com o servidor indisponível (8.5): "dados obtidos às 10:58 de 16/11/2026". */
export function offlineSubtitle(generatedAt: string): string {
  const [date = ''] = formatDateTime(generatedAt).split(' ');
  return `Reservas com cartão virtual · dados obtidos às ${formatTime(generatedAt)} de ${date}`;
}

/** "Última verificação das reservas: 10/11/2026 às 10:23"; `null` sem reservas. */
export function lastVerificationText(lastVerifiedAt: string | null): string | null {
  return lastVerifiedAt ? `Última verificação das reservas: ${dateAtTime(lastVerifiedAt)}` : null;
}

/** "01/11 a 30/11/2026" (o primeiro ano só quando muda). */
export function periodRange(from: string, to: string): string {
  const start = formatDate(from);
  const end = formatDate(to);
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${start.slice(0, 5)} a ${end}`
    : `${start} a ${end}`;
}

/** "01/12 e 07/12/2026" (o estado vazio: "entre … e …"). */
export function periodBetween(from: string, to: string): string {
  return periodRange(from, to).replace(' a ', ' e ');
}

/** Ordenações da gaveta "Todos os hotéis" (FR-020). */
export const HOTEL_ORDERS = ['open', 'pending', 'name'] as const;
export type HotelOrder = (typeof HOTEL_ORDERS)[number];

export const HOTEL_ORDER_LABELS: Record<HotelOrder, string> = {
  open: 'Maior valor',
  pending: 'Mais pendente',
  name: 'Nome A-Z',
};

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

function byName(a: HotelReportRow, b: HotelReportRow): number {
  return collator.compare(a.hotelName, b.hotelName) || a.hotelCode.localeCompare(b.hotelCode);
}

/**
 * Hotéis na ordem pedida (FR-020): "Maior valor" pelo valor em aberto e "Mais pendente" pelo valor
 * pendente, do maior para o menor, empate pelo nome (os de R$ 0,00 ficam no fim); "Nome A-Z".
 */
export function sortHotels(rows: readonly HotelReportRow[], order: HotelOrder): HotelReportRow[] {
  const key = (row: HotelReportRow) =>
    order === 'pending' ? amountValue(row.pending) : amountValue(row.openAmount);
  return [...rows].sort((a, b) =>
    order === 'name' ? byName(a, b) : key(b) - key(a) || byName(a, b),
  );
}

/** Ranking da tela principal (FR-018): só os hotéis com valor em aberto, do maior para o menor. */
export function rankingHotels(rows: readonly HotelReportRow[]): HotelReportRow[] {
  return sortHotels(
    rows.filter((row) => amountValue(row.openAmount) > 0),
    'open',
  );
}

/** Texto sem acento e sem maiúsculas, para a busca pelo nome. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim();
}

/** Hotéis cujo nome contém o texto, sem diferenciar maiúsculas e acentos (FR-020). */
export function searchHotels(rows: readonly HotelReportRow[], text: string): HotelReportRow[] {
  const wanted = normalizeSearch(text);
  if (wanted === '') return [...rows];
  return rows.filter((row) => normalizeSearch(row.hotelName).includes(wanted));
}

/** Maior valor em aberto entre os hotéis: a escala comum das barras (FR-018). */
export function rankingScale(rows: readonly HotelReportRow[]): number {
  return rows.reduce((max, row) => Math.max(max, amountValue(row.openAmount)), 0);
}

/** Posição do hotel no ranking (1º com mais valor em aberto), ou `null` sem valor em aberto. */
export function rankingPosition(rows: readonly HotelReportRow[], hotelCode: string): number | null {
  const index = rankingHotels(rows).findIndex((row) => row.hotelCode === hotelCode);
  return index < 0 ? null : index + 1;
}
