/**
 * Formatos da interface (specs/002, T030, FR-009, FR-020b, FR-023): valores em reais, datas em
 * DD/MM/AAAA e a conversão do campo de valor da busca para o formato da API ("1234.56").
 */
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatRemaining,
  formatTime,
  parseAmountInput,
} from '../../src/renderer/src/presentation/format.js';

/** O Intl separa "R$" do número com um espaço que não quebra a linha. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

describe('formatMoney', () => {
  it.each([
    ['1234.50', 'R$ 1.234,50'],
    ['0.99', 'R$ 0,99'],
    ['-10.00', '-R$ 10,00'],
  ])('%s → %s', (value, expected) => {
    expect(plain(formatMoney(value))).toBe(expected);
  });

  it('sem valor → travessão', () => {
    expect(formatMoney(null)).toBe('—');
  });
});

describe('datas em DD/MM/AAAA', () => {
  it('formatDate não muda o dia com o fuso horário', () => {
    expect(formatDate('2026-11-03')).toBe('03/11/2026');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
    expect(formatDate(null)).toBe('—');
  });

  it('formatDateTime e formatTime usam o horário local', () => {
    const local = new Date(2026, 10, 12, 9, 5);

    expect(formatDateTime(local.toISOString())).toBe('12/11/2026 09:05');
    expect(formatTime(local.toISOString())).toBe('09:05');
  });
});

describe('formatRemaining (contagem do token)', () => {
  it.each([
    [125_000, '2:05'],
    [59_400, '0:59'],
    [0, '0:00'],
    [-5_000, '0:00'],
  ])('%s ms → %s', (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [45, '45 s'],
    [750, '12 min 30 s'],
    [3_660, '1 h 1 min'],
  ])('%s s → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('sem valor → travessão', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('parseAmountInput (campo de valor da busca)', () => {
  it.each([
    ['1.234,56', '1234.56'],
    ['1234,5', '1234.50'],
    ['R$ 10', '10.00'],
    ['  R$ 1.234.567,89 ', '1234567.89'],
    ['10.50', '10.50'],
    ['1.234', '1234.00'],
    ['0,99', '0.99'],
  ])('%s → %s', (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '12,345', '-5', '1.23.4'])('texto inválido (%s) → null', (input) => {
    expect(parseAmountInput(input)).toBeNull();
  });
});
