/**
 * Formato da planilha do Comercial e da cópia para e-mail (specs/005, FR-009, FR-010, FR-027;
 * contracts/sheet-layout.md; research R-06, R-07). Funções puras, sem I/O.
 *
 * As colunas do sistema (A a J) são gravadas como **texto já formatado** em pt-BR: assim a leitura
 * devolve exatamente o que foi escrito, e o sincronizador sabe, comparando texto com texto, quando
 * alguém alterou uma célula do sistema (FR-011). Nenhuma função aqui recebe o nome do hóspede: os
 * tipos de entrada nem têm esse campo (FR-010, FR-027).
 */
import { COMMERCIAL_RETURN_FIELDS, RETURN_PROBLEM_PREFIXES } from './commercial-return.js';
import type { CommercialLineState, ReservationDetailedSituation } from './treatment.js';
import type { Classification, IsoDate, Money, ReservationStatus } from './types.js';

/** Abas da planilha (FR-009). */
export const COMMERCIAL_SHEET_TABS = { toCharge: 'A cobrar', done: 'Concluídas' } as const;
export type CommercialSheetTab = keyof typeof COMMERCIAL_SHEET_TABS;

/** Colunas, na ordem (FR-010; nomes confirmados pelo usuário em 2026-11-17). */
export const COMMERCIAL_SHEET_HEADERS = [
  'Hotel',
  'Reserva',
  'Check-in',
  'Canal',
  'Valor a cobrar',
  'Motivo',
  'Ativa ou cancelada',
  'Situação',
  'Enviada em',
  'Validação do Financeiro',
  'Código de autorização',
  'Hotel da cobrança',
  'Valor cobrado',
  'Responsável pela cobrança',
] as const;

/** Colunas preenchidas pelo sistema (A a J), protegidas contra edição (FR-011). */
export const SYSTEM_COLUMN_COUNT = 10;

/** Colunas de retorno (K a N), na mesma ordem de `COMMERCIAL_RETURN_FIELDS`. */
export const RETURN_COLUMN_FIELDS = COMMERCIAL_RETURN_FIELDS;

/** Nomes das classificações, iguais aos do app (specs/002, data-model §6). */
export const CLASSIFICATION_NAMES: Readonly<Record<Classification, string>> = {
  ignored_hotelbeds_258: 'Ignorada (Hotelbeds 258)',
  invoiced: 'Faturada',
  charge_at_terminal: 'Cobrar na maquininha',
  cancelled_no_charge: 'Cancelada sem cobrança',
  not_virtual_card: 'A revisar (sistema anterior)',
  virtual_card_charge_error: 'Erro na cobrança',
  virtual_card_already_charged: 'Já cobrada',
  virtual_card_validated_only: 'Cartão validado (não cobrado)',
  virtual_card_pending_charge: 'Pendente de cobrança',
  analysis_error: 'Erro de análise',
};

export const RESERVATION_STATUS_NAMES: Readonly<Record<ReservationStatus, string>> = {
  active: 'Ativa',
  cancelled: 'Cancelada',
  unknown: 'Não identificada',
};

/** Nomes da situação da reserva, com "Validar comprovante" (specs/005, research R-09). */
export const DETAILED_SITUATION_NAMES: Readonly<Record<ReservationDetailedSituation, string>> = {
  ...CLASSIFICATION_NAMES,
  return_pending: 'Validar comprovante',
  treatment_sent: 'Tratativa enviada',
  proof_sent: 'Comprovante enviado',
};

/** Situação de uma linha com o envio desfeito (clarify Q2). */
export const CANCELLED_LINE_SITUATION_NAME = 'Pedido cancelado pelo Financeiro';

/**
 * O que a coluna "Validação do Financeiro" mostra (FR-010, FR-015, FR-017, FR-018):
 * `awaiting_return` = linha em "A cobrar" sem retorno (spec, sessão 2026-11-17 "homologação");
 * `none` = linha concluída sem retorno confirmado.
 */
export type FinanceValidation =
  | { kind: 'none' }
  | { kind: 'awaiting_return' }
  | { kind: 'awaiting' }
  | { kind: 'confirmed' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'problem'; text: string };

const AWAITING_RETURN_TEXT = 'Aguardando retorno do Comercial';
const AWAITING_VALIDATION_TEXT = 'Aguardando validação do Financeiro';
const REJECTED_PREFIX = 'Recusado pelo Financeiro';

export function financeValidationText(validation: FinanceValidation): string {
  switch (validation.kind) {
    case 'none':
      return '';
    case 'awaiting_return':
      return AWAITING_RETURN_TEXT;
    case 'awaiting':
      return AWAITING_VALIDATION_TEXT;
    case 'confirmed':
      return 'Confirmado pelo Financeiro';
    case 'rejected':
      return `${REJECTED_PREFIX}: ${validation.reason}`;
    case 'problem':
      return validation.text;
  }
}

/**
 * Cor da célula "Validação do Financeiro" (FR-010a): lima = nova tratativa, aguardando o retorno;
 * laranja = retorno aguardando validação; vermelho = recusa ou retorno com problema.
 */
export type FinanceValidationTone = 'awaiting_return' | 'awaiting_validation' | 'attention';

/**
 * Regras de cor da coluna J, na ordem em que valem: o texto inteiro (`equals`) ou o começo dele
 * (`starts_with`, quando o resto é o motivo ou o problema). O adaptador do Google transforma cada
 * uma numa regra de formatação condicional (research R-18).
 */
export const FINANCE_VALIDATION_TONES: readonly {
  tone: FinanceValidationTone;
  match: 'equals' | 'starts_with';
  text: string;
}[] = [
  { tone: 'awaiting_return', match: 'equals', text: AWAITING_RETURN_TEXT },
  { tone: 'awaiting_validation', match: 'equals', text: AWAITING_VALIDATION_TEXT },
  { tone: 'attention', match: 'starts_with', text: REJECTED_PREFIX },
  { tone: 'attention', match: 'starts_with', text: RETURN_PROBLEM_PREFIXES.incomplete },
  { tone: 'attention', match: 'starts_with', text: RETURN_PROBLEM_PREFIXES.illegible },
];

/** Cor que a célula com este texto recebe na planilha; `null` = sem cor de status. */
export function financeValidationTone(text: string): FinanceValidationTone | null {
  const rule = FINANCE_VALIDATION_TONES.find((candidate) =>
    candidate.match === 'equals' ? text === candidate.text : text.startsWith(candidate.text),
  );
  return rule?.tone ?? null;
}

/** "1234.56" → "R$ 1.234,56"; sem valor → "". */
export function formatBrl(amount: Money | null): string {
  if (amount === null) return '';
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${grouped},${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/** "2026-11-03" → "03/11/2026". */
export function formatBrDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Data e hora de Brasília: "17/11/2026 10:15". */
export function formatBrDateTime(date: Date): string {
  const parts = Object.fromEntries(
    DATE_TIME_FORMAT.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts['day']}/${parts['month']}/${parts['year']} ${parts['hour']}:${parts['minute']}`;
}

/**
 * Nome do hotel na coluna "Hotel" (research R-07): o nome do catálogo; se dois hotéis têm o mesmo
 * nome, os dois ganham o código entre parênteses, para a linha continuar identificável.
 */
export function sheetHotelNames(
  hotels: readonly { code: string; name: string }[],
): Map<string, string> {
  const count = new Map<string, number>();
  for (const hotel of hotels) count.set(hotel.name, (count.get(hotel.name) ?? 0) + 1);
  return new Map(
    hotels.map((hotel) => [
      hotel.code,
      (count.get(hotel.name) ?? 0) > 1 ? `${hotel.name} (${hotel.code})` : hotel.name,
    ]),
  );
}

/** O que o sistema escreve numa linha. Sem campo de hóspede de propósito (FR-010). */
export interface SheetRowSource {
  hotelName: string;
  reservationNumber: string;
  checkIn: IsoDate | null;
  channel: string | null;
  totalAmount: Money | null;
  classification: Classification;
  reservationStatus: ReservationStatus;
  detailedSituation: ReservationDetailedSituation;
  lineState: CommercialLineState;
  lastSentAt: Date;
  validation: FinanceValidation;
}

/** As 10 colunas do sistema (A a J), como texto. */
export function sheetSystemRow(source: SheetRowSource): string[] {
  return [
    source.hotelName,
    source.reservationNumber,
    source.checkIn === null ? '' : formatBrDate(source.checkIn),
    source.channel ?? '',
    formatBrl(source.totalAmount),
    CLASSIFICATION_NAMES[source.classification],
    RESERVATION_STATUS_NAMES[source.reservationStatus],
    source.lineState === 'cancelled'
      ? CANCELLED_LINE_SITUATION_NAME
      : DETAILED_SITUATION_NAMES[source.detailedSituation],
    formatBrDateTime(source.lastSentAt),
    financeValidationText(source.validation),
  ];
}

/** Colunas da cópia para e-mail: as 8 primeiras da planilha (FR-027). */
export const COPY_HEADERS = COMMERCIAL_SHEET_HEADERS.slice(0, 8);

/** Uma reserva copiada para o e-mail. Sem campo de hóspede de propósito (FR-027). */
export interface CopySource {
  hotelName: string;
  reservationNumber: string;
  checkIn: IsoDate | null;
  channel: string | null;
  totalAmount: Money | null;
  classification: Classification;
  reservationStatus: ReservationStatus;
  detailedSituation: ReservationDetailedSituation;
}

export interface CopyTable {
  headers: string[];
  rows: string[][];
  /** Soma dos valores, já formatada ("R$ 1.334,56"). */
  total: string;
}

function toCents(amount: Money): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

function fromCents(cents: bigint): Money {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

/**
 * Tabela da cópia para e-mail (FR-027): as colunas da planilha, na ordem recebida (a da lista),
 * e o total dos valores. Só lê os campos de `CopySource`: um objeto com mais campos (ex.: o nome do
 * hóspede) não vaza para a tabela.
 */
export function copyTable(sources: readonly CopySource[]): CopyTable {
  let total = 0n;
  const rows = sources.map((source) => {
    if (source.totalAmount !== null) total += toCents(source.totalAmount);
    return [
      source.hotelName,
      source.reservationNumber,
      source.checkIn === null ? '' : formatBrDate(source.checkIn),
      source.channel ?? '',
      formatBrl(source.totalAmount),
      CLASSIFICATION_NAMES[source.classification],
      RESERVATION_STATUS_NAMES[source.reservationStatus],
      DETAILED_SITUATION_NAMES[source.detailedSituation],
    ];
  });
  return { headers: [...COPY_HEADERS], rows, total: formatBrl(fromCents(total)) };
}
