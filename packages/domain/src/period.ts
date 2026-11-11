import type { IsoDate, Period } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Período de check-in inválido (FR-010a). A mensagem é para o operador. */
export class InvalidPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPeriodError';
  }
}

/** Dia (meia-noite UTC, em milissegundos) de uma data `AAAA-MM-DD`; `null` se a data não existe. */
function dayOf(date: IsoDate): number | null {
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const time = Date.UTC(year, month - 1, day);
  // Datas como 2026-02-30 "transbordam" para o mês seguinte: não existem.
  return new Date(time).toISOString().slice(0, 10) === date ? time : null;
}

function toIsoDate(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Confere o período de check-in (FR-010a): datas `AAAA-MM-DD` existentes e início menor ou
 * igual ao fim. Qualquer tamanho é aceito, inclusive retroativo.
 *
 * @throws InvalidPeriodError
 */
export function validatePeriod(period: Period): void {
  const from = dayOf(period.from);
  const to = dayOf(period.to);
  if (from === null)
    throw new InvalidPeriodError('A data inicial do período não é uma data válida.');
  if (to === null) throw new InvalidPeriodError('A data final do período não é uma data válida.');
  if (from > to) {
    throw new InvalidPeriodError('A data inicial do período não pode ser depois da data final.');
  }
}

function daysOf(period: Period): { from: number; to: number } {
  validatePeriod(period);
  return { from: dayOf(period.from) as number, to: dayOf(period.to) as number };
}

/** Quantidade de dias do período, contando as duas pontas. */
export function periodDays(period: Period): number {
  const { from, to } = daysOf(period);
  return (to - from) / DAY_MS + 1;
}

/** A data está no período, contando as duas pontas. Compara as datas `AAAA-MM-DD` como texto. */
export function isDateWithinPeriod(date: IsoDate, period: Period): boolean {
  return date >= period.from && date <= period.to;
}

/**
 * Divide o período em blocos consecutivos de até `maxDays` dias, sem lacunas nem sobreposição
 * (FR-010a, research R-09), para quando o Hunit limita o tamanho de cada consulta.
 *
 * @param maxDays tamanho máximo de cada bloco; `null` = não dividir.
 */
export function splitPeriod(period: Period, maxDays: number | null): Period[] {
  const { from, to } = daysOf(period);
  if (maxDays === null) return [{ from: period.from, to: period.to }];
  if (!Number.isInteger(maxDays) || maxDays < 1) {
    throw new RangeError(
      'O tamanho máximo do bloco deve ser um número inteiro de dias, a partir de 1.',
    );
  }

  const blocks: Period[] = [];
  for (let start = from; start <= to; start += maxDays * DAY_MS) {
    const end = Math.min(start + (maxDays - 1) * DAY_MS, to);
    blocks.push({ from: toIsoDate(start), to: toIsoDate(end) });
  }
  return blocks;
}
