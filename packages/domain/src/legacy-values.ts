/**
 * Interpretação das células da planilha do sistema anterior (specs/004, research R-03). Funções
 * puras, sem I/O.
 *
 * O sistema anterior gravava no Google Sheets datas como número de série (dias desde 1899-12-30,
 * com a fração do dia) e o resto como texto ou número; numa cópia .xlsx, uma célula com formato de
 * data chega como `Date`. As datas e horas são a hora "de parede" de Brasília, convertida para o
 * instante UTC somando 3 horas (o Brasil não tem horário de verão desde 2019).
 *
 * Um valor ilegível devolve só o código do motivo, nunca o valor (FR-018).
 */
import type { IsoDate, Money } from './types.js';

/** Valor de uma célula, como a leitura do .xlsx o entrega. */
export type LegacyCellValue = Date | number | string | boolean | null | undefined;

export type LegacyValueError = 'unreadable_date' | 'unreadable_amount' | 'unreadable_number';

export type LegacyParse<T> = { ok: true; value: T | null } | { ok: false; code: LegacyValueError };

/** Diferença entre a hora de Brasília e UTC. */
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Dia zero do número de série do Sheets e do Excel, em UTC. */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const BR_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const SERIAL_PATTERN = /^\d+(?:\.\d+)?$/;

function isBlank(value: LegacyCellValue): value is null | undefined | '' {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

/** Componentes da data e hora de parede; `null` se a data não existe no calendário. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockToUtc(parts: WallClock): Date | null {
  const { year, month, day, hour, minute, second } = parts;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return check;
}

function serialToWallClock(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  // Arredonda ao segundo para não criar diferenças artificiais da fração do dia.
  const seconds = Math.round(serial * 86_400);
  return new Date(SERIAL_EPOCH_MS + seconds * 1000);
}

/**
 * Lê a célula como data e hora "de parede" (componentes UTC = hora de Brasília), sem converter
 * para o instante. `absolute` = o texto trazia o fuso e já é o instante.
 */
function readWallClock(
  value: Exclude<LegacyCellValue, null | undefined>,
): { date: Date; absolute: boolean } | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : { date: value, absolute: false };
  }
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    const date = serialToWallClock(value);
    return date ? { date, absolute: false } : null;
  }
  const text = value.trim();
  if (SERIAL_PATTERN.test(text)) {
    const date = serialToWallClock(Number(text));
    return date ? { date, absolute: false } : null;
  }
  const iso = ISO_PATTERN.exec(text);
  if (iso) {
    const date = wallClockToUtc({
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      hour: Number(iso[4] ?? 0),
      minute: Number(iso[5] ?? 0),
      second: Number(iso[6] ?? 0),
    });
    if (!date) return null;
    const zone = iso[7];
    if (!zone) return { date, absolute: false };
    if (zone === 'Z') return { date, absolute: true };
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offsetMs = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
    return { date: new Date(date.getTime() - offsetMs), absolute: true };
  }
  const br = BR_PATTERN.exec(text);
  if (br) {
    const date = wallClockToUtc({
      year: Number(br[3]),
      month: Number(br[2]),
      day: Number(br[1]),
      hour: Number(br[4] ?? 0),
      minute: Number(br[5] ?? 0),
      second: Number(br[6] ?? 0),
    });
    return date ? { date, absolute: false } : null;
  }
  return null;
}

/** Data e hora (FR-008): devolve o instante em UTC. */
export function parseLegacyDateTime(value: LegacyCellValue): LegacyParse<Date> {
  if (isBlank(value)) return { ok: true, value: null };
  const read = readWallClock(value);
  if (!read) return { ok: false, code: 'unreadable_date' };
  if (read.absolute) return { ok: true, value: read.date };
  return { ok: true, value: new Date(read.date.getTime() + BRASILIA_OFFSET_MS) };
}

/** Data sem hora (Entrada, Saida): `AAAA-MM-DD`. */
export function parseLegacyDate(value: LegacyCellValue): LegacyParse<IsoDate> {
  if (isBlank(value)) return { ok: true, value: null };
  const read = readWallClock(value);
  if (!read) return { ok: false, code: 'unreadable_date' };
  const date = read.absolute
    ? new Date(read.date.getTime() - BRASILIA_OFFSET_MS)
    : new Date(Math.floor(read.date.getTime() / DAY_MS) * DAY_MS);
  return { ok: true, value: date.toISOString().slice(0, 10) };
}

const DOT_DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;
const BR_THOUSANDS = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;
const BR_DECIMAL = /^(\d+)(?:,(\d{1,2}))?$/;

function money(integer: string, decimals: string | undefined): Money {
  const whole = integer.replace(/^0+(?=\d)/, '');
  return `${whole}.${(decimals ?? '').padEnd(2, '0')}`;
}

/** Valores cabem em `numeric(12,2)`: até 10 dígitos antes da vírgula (specs/001, R-17). */
const MAX_MONEY_DIGITS = 10;
/** Inteiros cabem em `integer` do PostgreSQL. */
const MAX_INTEGER = 2_147_483_647;

function withinMoneyLimit(value: Money): LegacyParse<Money> {
  return (value.split('.')[0] ?? '').length <= MAX_MONEY_DIGITS
    ? { ok: true, value }
    : { ok: false, code: 'unreadable_amount' };
}

/** Valor em BRL: `"1234.56"` (specs/001, R-17). */
export function parseLegacyMoney(value: LegacyCellValue): LegacyParse<Money> {
  if (isBlank(value)) return { ok: true, value: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return { ok: false, code: 'unreadable_amount' };
    const cents = Math.round(value * 100);
    return withinMoneyLimit(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);
  }
  if (typeof value !== 'string') return { ok: false, code: 'unreadable_amount' };
  const text = value.replace(/^R\$\s*/i, '').replace(/\s/g, '');
  const dot = DOT_DECIMAL.exec(text);
  if (dot?.[1] !== undefined) return withinMoneyLimit(money(dot[1], dot[2]));
  const thousands = BR_THOUSANDS.exec(text);
  if (thousands?.[1] !== undefined) {
    return withinMoneyLimit(money(thousands[1].replaceAll('.', ''), thousands[2]));
  }
  const br = BR_DECIMAL.exec(text);
  if (br?.[1] !== undefined) return withinMoneyLimit(money(br[1], br[2]));
  return { ok: false, code: 'unreadable_amount' };
}

/**
 * Inteiro em texto, com casas decimais zeradas opcionais: a cópia .xlsx exportada pelo Google Sheets
 * grava os números inteiros como `3.0` (descoberto na importação real, T045).
 */
const INTEGER_TEXT = /^(\d+)(?:[.,]0+)?$/;

/** Inteiro maior ou igual a zero. */
export function parseLegacyInteger(value: LegacyCellValue): LegacyParse<number> {
  if (isBlank(value)) return { ok: true, value: null };
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= MAX_INTEGER
      ? { ok: true, value }
      : { ok: false, code: 'unreadable_number' };
  }
  const integer = typeof value === 'string' ? INTEGER_TEXT.exec(value.trim()) : null;
  if (integer?.[1] !== undefined && Number(integer[1]) <= MAX_INTEGER) {
    return { ok: true, value: Number(integer[1]) };
  }
  return { ok: false, code: 'unreadable_number' };
}

const TRUE_TEXTS = new Set(['true', 'sim', 's', 'yes', '1', 'verdadeiro']);
const FALSE_TEXTS = new Set(['false', 'nao', 'não', 'n', 'no', '0', 'falso']);

/** Sim/não; vazio ou desconhecido = `null` (o sistema anterior gravava booleanos). */
export function parseLegacyBoolean(value: LegacyCellValue): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (TRUE_TEXTS.has(text)) return true;
  if (FALSE_TEXTS.has(text)) return false;
  return null;
}

/** Texto aparado; vazio = `null`. Números viram texto (ex.: número da reserva). */
export function parseLegacyText(value: LegacyCellValue): string | null {
  if (isBlank(value)) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text || null;
}
