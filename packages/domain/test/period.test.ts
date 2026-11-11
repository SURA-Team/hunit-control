/**
 * Validação e divisão do período de check-in (FR-010a, research R-09) — tasks.md, T038.
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidPeriodError,
  isDateWithinPeriod,
  periodDays,
  splitPeriod,
  validatePeriod,
} from '../src/period.js';
import type { Period } from '../src/types.js';

/** Todas as datas cobertas pelos blocos, na ordem. */
function daysOf(blocks: Period[]): string[] {
  const days: string[] = [];
  for (const block of blocks) {
    for (
      let day = new Date(`${block.from}T00:00:00Z`);
      day <= new Date(`${block.to}T00:00:00Z`);
      day = new Date(day.getTime() + 86_400_000)
    ) {
      days.push(day.toISOString().slice(0, 10));
    }
  }
  return days;
}

describe('validatePeriod', () => {
  it.each([
    ['um dia', { from: '2026-11-03', to: '2026-11-03' }],
    ['uma semana', { from: '2026-11-01', to: '2026-11-07' }],
    ['retroativo e longo (FR-010a)', { from: '2024-01-01', to: '2025-12-31' }],
    ['ano bissexto', { from: '2024-02-29', to: '2024-03-01' }],
  ])('aceita %s', (_, period) => {
    expect(() => validatePeriod(period)).not.toThrow();
  });

  it('recusa início depois do fim', () => {
    expect(() => validatePeriod({ from: '2026-11-08', to: '2026-11-07' })).toThrow(
      InvalidPeriodError,
    );
  });

  it.each(['2026-02-30', '2026-13-01', '26-11-01', '2026-11-1', '01/11/2026', ''])(
    'recusa a data inválida "%s"',
    (date) => {
      expect(() => validatePeriod({ from: date, to: '2026-12-31' })).toThrow(InvalidPeriodError);
      expect(() => validatePeriod({ from: '2026-01-01', to: date })).toThrow(InvalidPeriodError);
    },
  );
});

describe('periodDays e isDateWithinPeriod', () => {
  it('conta as duas pontas', () => {
    expect(periodDays({ from: '2026-11-01', to: '2026-11-07' })).toBe(7);
    expect(periodDays({ from: '2026-11-03', to: '2026-11-03' })).toBe(1);
  });

  it('inclui as duas pontas e exclui o resto', () => {
    const week = { from: '2026-11-01', to: '2026-11-07' };
    expect(isDateWithinPeriod('2026-11-01', week)).toBe(true);
    expect(isDateWithinPeriod('2026-11-07', week)).toBe(true);
    expect(isDateWithinPeriod('2026-10-31', week)).toBe(false);
    expect(isDateWithinPeriod('2026-11-08', week)).toBe(false);
  });
});

describe('splitPeriod', () => {
  it('sem limite → o próprio período', () => {
    const period = { from: '2024-01-01', to: '2025-12-31' };
    expect(splitPeriod(period, null)).toEqual([period]);
  });

  it('período dentro do limite → um bloco só', () => {
    const period = { from: '2026-11-01', to: '2026-11-07' };
    expect(splitPeriod(period, 7)).toEqual([period]);
  });

  it('divide em blocos de até N dias, o último menor', () => {
    expect(splitPeriod({ from: '2026-11-01', to: '2026-11-20' }, 7)).toEqual([
      { from: '2026-11-01', to: '2026-11-07' },
      { from: '2026-11-08', to: '2026-11-14' },
      { from: '2026-11-15', to: '2026-11-20' },
    ]);
  });

  it.each([
    [{ from: '2024-01-15', to: '2025-03-10' }, 31],
    [{ from: '2024-02-20', to: '2024-03-05' }, 3],
    [{ from: '2026-11-01', to: '2026-11-30' }, 1],
    [{ from: '2025-12-25', to: '2026-01-10' }, 4],
  ])('sem lacunas nem sobreposição (%o em blocos de %i)', (period, maxDays) => {
    const blocks = splitPeriod(period, maxDays);

    expect(blocks[0]?.from).toBe(period.from);
    expect(blocks.at(-1)?.to).toBe(period.to);
    for (const block of blocks) expect(periodDays(block)).toBeLessThanOrEqual(maxDays);

    const days = daysOf(blocks);
    expect(new Set(days).size).toBe(days.length);
    expect(days).toEqual(daysOf([period]));
  });

  it('recusa limite menor que 1 dia', () => {
    expect(() => splitPeriod({ from: '2026-11-01', to: '2026-11-07' }, 0)).toThrow(RangeError);
  });
});
