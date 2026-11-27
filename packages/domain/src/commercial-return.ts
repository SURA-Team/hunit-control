/**
 * Leitura do retorno que o Comercial preenche na planilha (specs/005, FR-015, FR-018, FR-019;
 * research R-08). Funções puras, sem I/O.
 *
 * As colunas de retorno chegam como a API do Google Sheets devolve as células
 * (`UNFORMATTED_VALUE`): texto, número (a coluna "Valor cobrado" numa planilha em pt_BR, e a "Data
 * da cobrança" como número de série), booleano ou vazio. O retorno só vale com as quatro colunas da
 * 005 preenchidas e entendidas; um retorno com problema nunca muda a reserva — só é relatado.
 *
 * Desde a 008 (research R-06 e R-19), mais duas colunas: "Situação da cobrança" (obrigatória) e
 * "Data da cobrança". A situação manda. A data não é comparada com hoje em lugar nenhum (FR-011).
 *
 * Desde a 009 (research R-02): toda situação exige o responsável; só "Cobrada na maquininha" exige
 * também código, hotel, valor e data. "Cobrada no Hunit" e "Cancelada" são **relatos** (a data fica
 * opcional); outro texto é a **situação livre**, que o Financeiro valida (código, hotel, valor e
 * data opcionais).
 */
import type { IsoDate, Money } from './types.js';

/** Colunas de retorno, na ordem da planilha (FR-010). */
export const COMMERCIAL_RETURN_FIELDS = [
  'authorizationCode',
  'chargeHotel',
  'chargedAmount',
  'chargedBy',
] as const;
export type CommercialReturnField = (typeof COMMERCIAL_RETURN_FIELDS)[number];

/** As seis colunas de retorno (K a P), na ordem da planilha (specs/008, research R-05). */
export const COMMERCIAL_RETURN_COLUMNS = [
  ...COMMERCIAL_RETURN_FIELDS,
  'chargeSituation',
  'chargeDate',
] as const;
export type CommercialReturnColumn = (typeof COMMERCIAL_RETURN_COLUMNS)[number];

/** Nome de cada coluna como aparece nas mensagens ao Comercial e ao Financeiro. */
export const COMMERCIAL_RETURN_FIELD_NAMES: Readonly<Record<CommercialReturnColumn, string>> = {
  authorizationCode: 'código de autorização',
  chargeHotel: 'hotel da cobrança',
  chargedAmount: 'valor cobrado',
  chargedBy: 'responsável pela cobrança',
  chargeSituation: 'situação da cobrança',
  chargeDate: 'data da cobrança',
};

/** Artigo de cada nome nas mensagens ("falta o código…", "falta a data…"). */
const FIELD_ARTICLES: Readonly<Record<CommercialReturnColumn, 'o' | 'a'>> = {
  authorizationCode: 'o',
  chargeHotel: 'o',
  chargedAmount: 'o',
  chargedBy: 'o',
  chargeSituation: 'a',
  chargeDate: 'a',
};

/**
 * Situação da cobrança reconhecida (specs/008, FR-008). `cancelled` ("Cancelada") era `not_charged`
 * ("Não cobrada") antes da homologação (research R-19).
 */
export const CHARGE_SITUATION_KINDS = [
  'charged_at_terminal',
  'charged_in_hunit',
  'cancelled',
  'other',
] as const;
export type ChargeSituationKind = (typeof CHARGE_SITUATION_KINDS)[number];

/** As situações sugeridas na lista da planilha (coluna O), na ordem da lista. */
export const CHARGE_SITUATIONS = [
  { kind: 'charged_at_terminal', text: 'Cobrada na maquininha' },
  { kind: 'charged_in_hunit', text: 'Cobrada no Hunit' },
  { kind: 'cancelled', text: 'Cancelada' },
] as const satisfies readonly { kind: ChargeSituationKind; text: string }[];

/** Situação da cobrança como o Comercial escreveu e o tipo reconhecido. */
export interface ChargeSituation {
  kind: ChargeSituationKind;
  text: string;
}

/**
 * O retorno é de uma situação livre do Comercial ("retorno de situação", specs/009, research R-03)?
 * Código, hotel e valor são opcionais, e o Financeiro decide o que ele significa.
 */
export function isSituationReturn(kind: ChargeSituationKind | null | undefined): boolean {
  return kind === 'other';
}

/**
 * Relatos: situações sem retorno de cobrança (research R-06): "Cobrada no Hunit", conferida no
 * Hunit, e "Cancelada", validada pelo Financeiro (R-19).
 */
export type CommercialReportKind = 'charged_in_hunit' | 'cancelled';

/** "Não  Cobrada" → "nao cobrada": sem acento, sem maiúsculas e sem espaços extras. */
function normalizeSituation(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reconhece a situação escrita (FR-008): começa com "cancelad…" → `cancelled` (ex.: "Cancelada na
 * Expedia", R-19); contém "hunit" → `charged_in_hunit`; contém "maquininha" → `charged_at_terminal`;
 * outro texto → `other` (guardado e mostrado como veio).
 */
export function recognizeChargeSituation(text: string): ChargeSituationKind {
  const normalized = normalizeSituation(text);
  if (normalized.startsWith('cancelad')) return 'cancelled';
  if (normalized.includes('hunit')) return 'charged_in_hunit';
  if (normalized.includes('maquininha')) return 'charged_at_terminal';
  return 'other';
}

/** Dia zero das datas do Google Sheets e do Excel (número de série). */
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function isoFromParts(year: number, month: number, day: number): IsoDate | null {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export type ChargeDateParse = { ok: true; date: IsoDate } | { ok: false };

/**
 * "Data da cobrança" (research R-06): o número de série que a API do Google devolve
 * (`UNFORMATTED_VALUE`; dias desde 30/12/1899, a parte da hora é ignorada) ou o texto `dd/mm/aaaa`.
 */
export function parseChargeDate(cell: SheetCellValue): ChargeDateParse {
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell) || cell < 1) return { ok: false };
    const date = new Date(SHEETS_EPOCH_MS + Math.floor(cell) * DAY_MS);
    const iso = isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    return iso === null ? { ok: false } : { ok: true, date: iso };
  }
  if (typeof cell !== 'string') return { ok: false };
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cell.trim());
  if (!match) return { ok: false };
  const iso = isoFromParts(Number(match[3]), Number(match[2]), Number(match[1]));
  return iso === null ? { ok: false } : { ok: true, date: iso };
}

/** Tamanho máximo dos textos do retorno (FR-018). */
export const MAX_RETURN_TEXT_LENGTH = 100;

/** Maior valor que cabe na coluna de dinheiro do banco (`numeric(12,2)`). */
const MAX_AMOUNT_CENTS = 999_999_999_999;

/** Uma célula como a API do Google Sheets a devolve. */
export type SheetCellValue = string | number | boolean | null | undefined;

export type CommercialReturnCells = Partial<Record<CommercialReturnColumn, SheetCellValue>>;

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
  | {
      field: Exclude<CommercialReturnField, 'chargedAmount'> | 'chargeSituation';
      problem: 'too_long' | 'not_text';
    }
  | { field: 'chargedAmount'; problem: AmountProblem }
  | { field: 'chargeDate'; problem: 'not_a_date' };

/** Relato do Comercial ("Cobrada no Hunit" ou "Cancelada"), sem retorno de cobrança (R-06, R-19). */
export interface CommercialReportValues {
  kind: CommercialReportKind;
  /** A situação como o Comercial escreveu. */
  situationText: string;
  /**
   * Obrigatório nos relatos lidos desde a 009 (research R-02); nulo só numa "Cancelada" lida antes
   * (na 008 bastava a situação).
   */
  chargedBy: string | null;
  /** Opcional desde a 009 (era obrigatória em "Cobrada no Hunit"). */
  chargeDate: IsoDate | null;
}

/** Retorno de situação livre entendido (specs/009, research R-02): só o responsável é obrigatório. */
export interface SituationReturnValues {
  chargedBy: string;
  authorizationCode: string | null;
  chargeHotel: string | null;
  chargedAmount: Money | null;
}

export type CommercialReturnReading =
  | { kind: 'empty' }
  | { kind: 'report'; report: CommercialReportValues }
  | { kind: 'incomplete'; missing: CommercialReturnColumn[] }
  | { kind: 'illegible'; problems: ReturnProblem[] }
  | {
      kind: 'complete';
      values: CommercialReturnValues;
      /** "Cobrada na maquininha" (desde a 009, outro texto é a leitura `situation`). */
      chargeSituation: ChargeSituation;
      chargeDate: IsoDate;
    }
  | {
      kind: 'situation';
      values: SituationReturnValues;
      /** Situação livre (`other`), como o Comercial escreveu. */
      chargeSituation: ChargeSituation;
      chargeDate: IsoDate | null;
    };

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

type TextField = Exclude<CommercialReturnField, 'chargedAmount'> | 'chargeSituation';

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

/** Mantém a ordem das colunas da planilha nas mensagens. */
function sortProblems(problems: ReturnProblem[]): ReturnProblem[] {
  return problems.sort(
    (a, b) =>
      COMMERCIAL_RETURN_COLUMNS.indexOf(a.field) - COMMERCIAL_RETURN_COLUMNS.indexOf(b.field),
  );
}

/** Ordena as colunas como na planilha (K a P). */
function inColumnOrder(columns: CommercialReturnColumn[]): CommercialReturnColumn[] {
  return columns.sort(
    (a, b) => COMMERCIAL_RETURN_COLUMNS.indexOf(a) - COMMERCIAL_RETURN_COLUMNS.indexOf(b),
  );
}

/**
 * Interpreta as seis colunas de retorno de uma linha (FR-015, FR-018; specs/008, research R-06 e
 * R-19; specs/009, research R-02):
 * - `empty` — as seis vazias: não há retorno;
 * - `incomplete` — falta a situação ou o responsável (exigidos sempre), ou, em "Cobrada na
 *   maquininha", o código, o hotel, o valor ou a data; lista só o que a situação exige (vale antes
 *   de qualquer problema de leitura);
 * - `illegible` — preenchidas, mas algum valor lido não foi entendido;
 * - `report` — "Cobrada no Hunit" ou "Cancelada", com o responsável (a data é opcional; na
 *   "Cancelada", os campos de cobrança são ignorados, como na 008);
 * - `complete` — "Cobrada na maquininha" com os quatro valores e a data;
 * - `situation` — outro texto (situação livre) com o responsável; código, hotel, valor e data,
 *   se preenchidos, lidos com as mesmas regras.
 */
export function readReturn(cells: CommercialReturnCells): CommercialReturnReading {
  if (COMMERCIAL_RETURN_COLUMNS.every((column) => isBlank(cells[column]))) return { kind: 'empty' };

  let chargeSituation: ChargeSituation | null = null;
  let situationProblem: ReturnProblem | null = null;
  if (!isBlank(cells.chargeSituation)) {
    const result = readText('chargeSituation', cells.chargeSituation);
    if (result.ok) {
      chargeSituation = { kind: recognizeChargeSituation(result.text), text: result.text };
    } else situationProblem = result.problem;
  }
  const chargedByBlank = isBlank(cells.chargedBy);

  // Situação e responsável: exigidos em toda situação.
  if (chargeSituation === null) {
    const missing: CommercialReturnColumn[] = [];
    if (chargedByBlank) missing.push('chargedBy');
    if (situationProblem === null) missing.push('chargeSituation');
    if (missing.length > 0) return { kind: 'incomplete', missing: inColumnOrder(missing) };
    return { kind: 'illegible', problems: situationProblem ? [situationProblem] : [] };
  }

  const dateCell = cells.chargeDate;
  const date = isBlank(dateCell) ? null : parseChargeDate(dateCell);

  if (chargeSituation.kind === 'charged_at_terminal') {
    const missing = COMMERCIAL_RETURN_COLUMNS.filter((column) => isBlank(cells[column]));
    if (missing.length > 0) return { kind: 'incomplete', missing };
  } else if (chargedByBlank) {
    return { kind: 'incomplete', missing: ['chargedBy'] };
  }

  const problems: ReturnProblem[] = [];
  const chargedBy = readText('chargedBy', cells.chargedBy);
  if (!chargedBy.ok) problems.push(chargedBy.problem);

  // "Cancelada": basta a situação e o responsável; o resto, como na 008, não é conferido.
  if (chargeSituation.kind === 'cancelled') {
    if (!chargedBy.ok) return { kind: 'illegible', problems };
    return {
      kind: 'report',
      report: {
        kind: 'cancelled',
        situationText: chargeSituation.text,
        chargedBy: chargedBy.text,
        chargeDate: date?.ok ? date.date : null,
      },
    };
  }

  if (date && !date.ok) problems.push({ field: 'chargeDate', problem: 'not_a_date' });
  const chargeDate = date?.ok ? date.date : null;

  if (chargeSituation.kind === 'charged_in_hunit') {
    if (!chargedBy.ok || problems.length > 0) {
      return { kind: 'illegible', problems: sortProblems(problems) };
    }
    return {
      kind: 'report',
      report: {
        kind: 'charged_in_hunit',
        situationText: chargeSituation.text,
        chargedBy: chargedBy.text,
        chargeDate,
      },
    };
  }

  // Maquininha (todos presentes) e situação livre (os presentes): as mesmas regras de leitura.
  const texts: Partial<Record<'authorizationCode' | 'chargeHotel', string>> = {};
  for (const field of ['authorizationCode', 'chargeHotel'] as const) {
    if (isBlank(cells[field])) continue;
    const result = readText(field, cells[field]);
    if (result.ok) texts[field] = result.text;
    else problems.push(result.problem);
  }
  let chargedAmount: Money | null = null;
  if (!isBlank(cells.chargedAmount)) {
    const amount = parseChargedAmount(cells.chargedAmount);
    if (amount.ok) chargedAmount = amount.amount;
    else problems.push({ field: 'chargedAmount', problem: amount.problem });
  }
  if (!chargedBy.ok || problems.length > 0) {
    return { kind: 'illegible', problems: sortProblems(problems) };
  }

  if (chargeSituation.kind === 'charged_at_terminal') {
    return {
      kind: 'complete',
      values: {
        authorizationCode: texts.authorizationCode ?? '',
        chargeHotel: texts.chargeHotel ?? '',
        chargedAmount: chargedAmount ?? '',
        chargedBy: chargedBy.text,
      },
      chargeSituation,
      chargeDate: chargeDate ?? '',
    };
  }
  return {
    kind: 'situation',
    values: {
      chargedBy: chargedBy.text,
      authorizationCode: texts.authorizationCode ?? null,
      chargeHotel: texts.chargeHotel ?? null,
      chargedAmount,
    },
    chargeSituation,
    chargeDate,
  };
}

/**
 * O último retorno lido (completo ou de situação livre), como o servidor guarda para detectar
 * mudança: os valores mais a situação e a data (specs/008). Leituras da 005 não têm os dois campos
 * novos; as de situação livre (specs/009) não têm o código, o hotel ou o valor não preenchidos.
 */
export interface ReturnSnapshot {
  authorizationCode?: string | undefined;
  chargeHotel?: string | undefined;
  chargedAmount?: Money | undefined;
  chargedBy: string;
  chargeSituation?: string | undefined;
  chargeDate?: IsoDate | undefined;
}

/** O retorno lido, no formato guardado (sem os campos não informados). */
export function returnSnapshot(
  reading: Extract<CommercialReturnReading, { kind: 'complete' | 'situation' }>,
): ReturnSnapshot {
  const values: {
    authorizationCode: string | null;
    chargeHotel: string | null;
    chargedAmount: Money | null;
    chargedBy: string;
  } = reading.values;
  return {
    ...(values.authorizationCode !== null && { authorizationCode: values.authorizationCode }),
    ...(values.chargeHotel !== null && { chargeHotel: values.chargeHotel }),
    ...(values.chargedAmount !== null && { chargedAmount: values.chargedAmount }),
    chargedBy: values.chargedBy,
    chargeSituation: reading.chargeSituation.text,
    ...(reading.chargeDate !== null && { chargeDate: reading.chargeDate }),
  };
}

/** O retorno lido agora é diferente do último lido? Compara também situação e data (FR-017, FR-019). */
export function returnChanged(previous: ReturnSnapshot | null, current: ReturnSnapshot): boolean {
  if (previous === null) return true;
  return (
    COMMERCIAL_RETURN_FIELDS.some(
      (field) => (previous[field] ?? null) !== (current[field] ?? null),
    ) ||
    (previous.chargeSituation ?? null) !== (current.chargeSituation ?? null) ||
    (previous.chargeDate ?? null) !== (current.chargeDate ?? null)
  );
}

/**
 * O relato lido agora é diferente do guardado? Mudar o responsável, a data ou o texto renova a
 * leitura (a reserva volta a "Aguardando verificação"); mudar o tipo troca o relato (FR-012).
 */
export function reportChanged(
  previous: CommercialReportValues | null,
  current: CommercialReportValues,
): boolean {
  if (previous === null) return true;
  return (
    previous.kind !== current.kind ||
    previous.situationText !== current.situationText ||
    previous.chargedBy !== current.chargedBy ||
    previous.chargeDate !== current.chargeDate
  );
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
  if (problem.field === 'chargeDate') return 'data da cobrança não entendida';
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
    const names = reading.missing.map(
      (field) => `${FIELD_ARTICLES[field]} ${COMMERCIAL_RETURN_FIELD_NAMES[field]}`,
    );
    return `${RETURN_PROBLEM_PREFIXES.incomplete}: ${names.length === 1 ? 'falta' : 'faltam'} ${joinWithAnd(names)}`;
  }
  if (reading.kind === 'illegible') {
    return `${RETURN_PROBLEM_PREFIXES.illegible}: ${joinWithAnd(reading.problems.map(problemText))}`;
  }
  return null;
}
