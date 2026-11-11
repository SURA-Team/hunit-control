import { z } from 'zod';
import type { IsoDate, IsoDateTime, Money } from '@hunit/domain';

/**
 * Conversões dos valores da API do Hunit para os formatos neutros do domínio (research R-17).
 * Só a camada do Hunit conhece o formato de origem.
 */

/** Fuso das datas e horas que o Hunit devolve sem fuso (o Brasil não tem horário de verão desde 2019). */
const HUNIT_UTC_OFFSET = '-03:00';

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Data `AAAA-MM-DD` a partir de "2026-11-03" ou "2026-11-03T00:00:00"; `null` se não reconhecer. */
export function toIsoDate(value: string): IsoDate | null {
  const date = DATE_PREFIX.exec(value.trim())?.[1];
  if (!date) return null;
  // Confere que a data existe (ex.: recusa 2026-02-30).
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

/** Instante ISO 8601 em UTC; sem fuso, vale o horário de Brasília. `null` se não reconhecer. */
export function toIsoDateTime(value: string): IsoDateTime | null {
  const text = value.trim();
  if (!DATE_PREFIX.test(text) || !text.includes('T')) return null;
  const parsed = new Date(HAS_ZONE.test(text) ? text : `${text}${HUNIT_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Valor em reais como string decimal com duas casas (ex.: 1234.5 → "1234.50"). */
export function toMoney(value: number): Money {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Data `DD/MM/AAAA`, como o Hunit exibe. */
export function toDisplayDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

/** Texto opcional: aceita número (códigos) e transforma vazio em `null`. */
export const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
  });

/** Identificador do Hunit: número ou texto não vazio, devolvido como texto. */
export const hunitId = z
  .union([z.number().int(), z.string().trim().min(1)])
  .transform((value) => String(value));
