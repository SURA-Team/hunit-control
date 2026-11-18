/**
 * Leitura do retorno que o Comercial preenche na planilha (specs/005, FR-015, FR-018, FR-019;
 * research R-08). Funções puras, sem I/O.
 *
 * As quatro colunas de retorno chegam como a API do Google Sheets devolve as células
 * (`UNFORMATTED_VALUE`): texto, número (a coluna "Valor cobrado" numa planilha em pt_BR), booleano
 * ou vazio. O retorno só vale com as quatro preenchidas e entendidas; um retorno com problema
 * nunca muda a reserva — só é relatado.
 */
import type { Money } from './types.js';

/** Colunas de retorno, na ordem da planilha (FR-010). */
export const COMMERCIAL_RETURN_FIELDS = [
  'authorizationCode',
  'chargeHotel',
  'chargedAmount',
  'chargedBy',
] as const;
export type CommercialReturnField = (typeof COMMERCIAL_RETURN_FIELDS)[number];

/** Nome de cada coluna como aparece nas mensagens ao Comercial e ao Financeiro. */
export const COMMERCIAL_RETURN_FIELD_NAMES: Readonly<Record<CommercialReturnField, string>> = {
  authorizationCode: 'código de autorização',
  chargeHotel: 'hotel da cobrança',
  chargedAmount: 'valor cobrado',
  chargedBy: 'responsável pela cobrança',
};

/** Tamanho máximo dos textos do retorno (FR-018). */
export const MAX_RETURN_TEXT_LENGTH = 100;

/** Maior valor que cabe na coluna de dinheiro do banco (`numeric(12,2)`). */
const MAX_AMOUNT_CENTS = 999_999_999_999;

/** Uma célula como a API do Google Sheets a devolve. */
export type SheetCellValue = string | number | boolean | null | undefined;

export type CommercialReturnCells = Partial<Record<CommercialReturnField, SheetCellValue>>;

/** O retorno entendido e normalizado. */
export interface CommercialReturnValues {
  authorizationCode: string;
  /** Estabelecimento que aparece na maquininha, como o Comercial escreveu (texto livre). */
  chargeHotel: string;
  chargedAmount: Money;
  chargedBy: string;
}

export type AmountProblem =
  'not_a_value' | 'not_positive' | 'too_many_decimals' | 'ambiguous' | 'too_large';

export type ReturnProblem =
  | { field: Exclude<CommercialReturnField, 'chargedAmount'>; problem: 'too_long' | 'not_text' }
  | { field: 'chargedAmount'; problem: AmountProblem };

export type CommercialReturnReading =
  | { kind: 'empty' }
  | { kind: 'incomplete'; missing: CommercialReturnField[] }
  | { kind: 'illegible'; problems: ReturnProblem[] }
  | { kind: 'complete'; values: CommercialReturnValues };

/** Célula vazia: nula, ausente ou só com espaços. */
function isBlank(cell: SheetCellValue): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
}

/** Centavos inteiros → "1234.56". */
function centsToMoney(cents: number): Money {
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}

function digitsToCents(integerDigits: string, fractionDigits: string): number {
  return Number(integerDigits) * 100 + Number(fractionDigits.padEnd(2, '0'));
}

export type AmountParse = { ok: true; amount: Money } | { ok: false; problem: AmountProblem };

/**
 * "Valor cobrado" (FR-018): valor em reais maior que zero, com até 2 casas decimais.
 *
 * Aceita número (o normal numa planilha em pt_BR) e texto em reais: `1.234,56`, `1234,56`,
 * `1234.56`, com ou sem `R$`. Texto que pode ser lido de dois jeitos (`1,234` = mil duzentos e
 * trinta e quatro ou um real e vinte e três centavos e meio?) é recusado como ambíguo, nunca
 * adivinhado.
 */
export function parseChargedAmount(cell: SheetCellValue): AmountParse {
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return { ok: false, problem: 'not_a_value' };
    if (cell <= 0) return { ok: false, problem: 'not_positive' };
    const cents = Math.round(cell * 100);
    if (Math.abs(cell * 100 - cents) > 1e-6) return { ok: false, problem: 'too_many_decimals' };
    if (cents > MAX_AMOUNT_CENTS) return { ok: false, problem: 'too_large' };
    return { ok: true, amount: centsToMoney(cents) };
  }
  if (typeof cell !== 'string') return { ok: false, problem: 'not_a_value' };

  const text = cell
    .trim()
    .replace(/^r\$\s*/i, '')
    .trim();
  let cents: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(text))) {
    // 1.234,56 — ponto separa milhares e vírgula separa os centavos.
    cents = digitsToCents((match[1] ?? '').replaceAll('.', ''), match[2] ?? '');
  } else if ((match = /^(\d+),(\d{1,2})$/.exec(text))) {
    cents = digitsToCents(match[1] ?? '', match[2] ?? '');
  } else if ((match = /^(\d+)\.(\d{1,2})$/.exec(text))) {
    cents = digitsToCents(match[1] ?? '', match[2] ?? '');
  } else if (/^\d+$/.test(text)) {
    cents = digitsToCents(text, '');
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) {
    // 1,234 ou 1.234: milhares ou três casas decimais? Não dá para saber.
    return { ok: false, problem: 'ambiguous' };
  } else {
    return { ok: false, problem: 'not_a_value' };
  }

  if (cents <= 0) return { ok: false, problem: 'not_positive' };
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, problem: 'too_large' };
  return { ok: true, amount: centsToMoney(cents) };
}

type TextField = Exclude<CommercialReturnField, 'chargedAmount'>;

function readText(
  field: TextField,
  cell: SheetCellValue,
): { ok: true; text: string } | { ok: false; problem: ReturnProblem } {
  let text: string;
  if (typeof cell === 'string') text = cell.trim();
  else if (typeof cell === 'number' && Number.isFinite(cell)) text = String(cell);
  else return { ok: false, problem: { field, problem: 'not_text' } };
  if (text.length > MAX_RETURN_TEXT_LENGTH) {
    return { ok: false, problem: { field, problem: 'too_long' } };
  }
  return { ok: true, text };
}

/**
 * Interpreta as quatro colunas de retorno de uma linha (FR-015, FR-018):
 * - `empty` — as quatro vazias: não há retorno;
 * - `incomplete` — alguma vazia (vale antes de qualquer problema de leitura);
 * - `illegible` — preenchidas, mas algum valor não foi entendido;
 * - `complete` — os quatro valores normalizados.
 */
export function readReturn(cells: CommercialReturnCells): CommercialReturnReading {
  const blank = COMMERCIAL_RETURN_FIELDS.filter((field) => isBlank(cells[field]));
  if (blank.length === COMMERCIAL_RETURN_FIELDS.length) return { kind: 'empty' };
  if (blank.length > 0) return { kind: 'incomplete', missing: blank };

  const problems: ReturnProblem[] = [];
  const texts: Partial<Record<TextField, string>> = {};
  for (const field of ['authorizationCode', 'chargeHotel', 'chargedBy'] as const) {
    const result = readText(field, cells[field]);
    if (result.ok) texts[field] = result.text;
    else problems.push(result.problem);
  }
  const amount = parseChargedAmount(cells.chargedAmount);
  if (!amount.ok) problems.push({ field: 'chargedAmount', problem: amount.problem });

  // Mantém a ordem das colunas da planilha nas mensagens.
  problems.sort(
    (a, b) => COMMERCIAL_RETURN_FIELDS.indexOf(a.field) - COMMERCIAL_RETURN_FIELDS.indexOf(b.field),
  );
  if (problems.length > 0 || !amount.ok) return { kind: 'illegible', problems };

  return {
    kind: 'complete',
    values: {
      authorizationCode: texts.authorizationCode ?? '',
      chargeHotel: texts.chargeHotel ?? '',
      chargedAmount: amount.amount,
      chargedBy: texts.chargedBy ?? '',
    },
  };
}

/** O retorno lido agora é diferente do último lido? (FR-017, FR-019.) */
export function returnChanged(
  previous: CommercialReturnValues | null,
  current: CommercialReturnValues,
): boolean {
  if (previous === null) return true;
  return COMMERCIAL_RETURN_FIELDS.some((field) => previous[field] !== current[field]);
}

const AMOUNT_PROBLEM_TEXT: Readonly<Record<AmountProblem, string>> = {
  not_a_value: 'valor cobrado não é um valor em reais',
  not_positive: 'valor cobrado precisa ser maior que zero',
  too_many_decimals: 'valor cobrado com mais de 2 casas decimais',
  ambiguous: 'valor cobrado ambíguo (use vírgula para os centavos, ex.: 1.234,56)',
  too_large: 'valor cobrado grande demais',
};

function problemText(problem: ReturnProblem): string {
  if (problem.field === 'chargedAmount') return AMOUNT_PROBLEM_TEXT[problem.problem];
  const name = COMMERCIAL_RETURN_FIELD_NAMES[problem.field];
  return problem.problem === 'too_long'
    ? `${name} com mais de ${MAX_RETURN_TEXT_LENGTH} caracteres`
    : `${name} não é um texto`;
}

/** "o a", "o a e o b", "o a, o b e o c". */
function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1) ?? ''}`;
}

/**
 * Começo do texto de cada tipo de problema do retorno: identifica o tipo na lista de retornos com
 * problema e dá a cor da coluna "Validação do Financeiro" (FR-010a).
 */
export const RETURN_PROBLEM_PREFIXES = {
  incomplete: 'Retorno incompleto',
  illegible: 'Retorno não entendido',
} as const;

/**
 * Texto do problema do retorno, para a coluna "Validação do Financeiro" e a lista de retornos com
 * problema do app (FR-018). `null` quando não há problema (vazio ou completo).
 */
export function describeReturnReading(reading: CommercialReturnReading): string | null {
  if (reading.kind === 'incomplete') {
    const names = reading.missing.map((field) => `o ${COMMERCIAL_RETURN_FIELD_NAMES[field]}`);
    return `${RETURN_PROBLEM_PREFIXES.incomplete}: ${names.length === 1 ? 'falta' : 'faltam'} ${joinWithAnd(names)}`;
  }
  if (reading.kind === 'illegible') {
    return `${RETURN_PROBLEM_PREFIXES.illegible}: ${joinWithAnd(reading.problems.map(problemText))}`;
  }
  return null;
}
