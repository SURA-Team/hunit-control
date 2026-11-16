/**
 * Interpretação das células da planilha do sistema anterior (specs/004, research R-03) — tasks.md,
 * T004. Os valores são a hora "de parede" de Brasília (UTC−3, sem horário de verão).
 */
import { describe, expect, it } from 'vitest';
import {
  parseLegacyBoolean,
  parseLegacyDate,
  parseLegacyDateTime,
  parseLegacyInteger,
  parseLegacyMoney,
  parseLegacyText,
} from '../src/index.js';

const instant = (value: ReturnType<typeof parseLegacyDateTime>) =>
  value.ok ? value.value?.toISOString() : value.code;

describe('parseLegacyDateTime', () => {
  it('Date de célula formatada: componentes UTC são a hora de Brasília', () => {
    expect(instant(parseLegacyDateTime(new Date('2026-05-01T10:15:00Z')))).toBe(
      '2026-05-01T13:15:00.000Z',
    );
  });

  it('número de série do Sheets (número ou texto)', () => {
    // 45778 = 2025-05-01; ,5 = meio-dia em Brasília = 15:00 UTC.
    expect(instant(parseLegacyDateTime(45778.5))).toBe('2025-05-01T15:00:00.000Z');
    expect(instant(parseLegacyDateTime('45778.5'))).toBe('2025-05-01T15:00:00.000Z');
  });

  it('texto ISO, com ou sem hora, e com fuso explícito', () => {
    expect(instant(parseLegacyDateTime('2026-05-01T10:15:00'))).toBe('2026-05-01T13:15:00.000Z');
    expect(instant(parseLegacyDateTime('2026-05-01 10:15'))).toBe('2026-05-01T13:15:00.000Z');
    expect(instant(parseLegacyDateTime('2026-05-01'))).toBe('2026-05-01T03:00:00.000Z');
    expect(instant(parseLegacyDateTime('2026-05-01T10:15:00Z'))).toBe('2026-05-01T10:15:00.000Z');
  });

  it('texto DD/MM/AAAA, com ou sem hora', () => {
    expect(instant(parseLegacyDateTime('01/05/2026 10:15'))).toBe('2026-05-01T13:15:00.000Z');
    expect(instant(parseLegacyDateTime('01/05/2026 10:15:30'))).toBe('2026-05-01T13:15:30.000Z');
    expect(instant(parseLegacyDateTime('01/05/2026'))).toBe('2026-05-01T03:00:00.000Z');
  });

  it('vazio é null', () => {
    expect(parseLegacyDateTime(null)).toEqual({ ok: true, value: null });
    expect(parseLegacyDateTime('  ')).toEqual({ ok: true, value: null });
  });

  it('ilegível devolve só o código, nunca o valor', () => {
    for (const value of ['ontem', '31/02/2026', '2026-13-01', true, -5]) {
      expect(parseLegacyDateTime(value)).toEqual({ ok: false, code: 'unreadable_date' });
    }
  });
});

describe('parseLegacyDate', () => {
  it('aceita os mesmos formatos e devolve AAAA-MM-DD', () => {
    expect(parseLegacyDate(new Date('2026-05-10T00:00:00Z'))).toEqual({
      ok: true,
      value: '2026-05-10',
    });
    expect(parseLegacyDate(45778)).toEqual({ ok: true, value: '2025-05-01' });
    expect(parseLegacyDate('10/05/2026')).toEqual({ ok: true, value: '2026-05-10' });
    expect(parseLegacyDate('2026-05-10')).toEqual({ ok: true, value: '2026-05-10' });
    expect(parseLegacyDate(null)).toEqual({ ok: true, value: null });
    expect(parseLegacyDate('x')).toEqual({ ok: false, code: 'unreadable_date' });
  });
});

describe('parseLegacyMoney', () => {
  it('número e texto com ponto ou vírgula decimal', () => {
    expect(parseLegacyMoney(1234.5)).toEqual({ ok: true, value: '1234.50' });
    expect(parseLegacyMoney('1234.56')).toEqual({ ok: true, value: '1234.56' });
    expect(parseLegacyMoney('1.234,56')).toEqual({ ok: true, value: '1234.56' });
    expect(parseLegacyMoney('R$ 1.234,56')).toEqual({ ok: true, value: '1234.56' });
    expect(parseLegacyMoney('85,3')).toEqual({ ok: true, value: '85.30' });
    expect(parseLegacyMoney('0')).toEqual({ ok: true, value: '0.00' });
    expect(parseLegacyMoney(0.1 + 0.2)).toEqual({ ok: true, value: '0.30' });
  });

  it('negativo, texto e formato ambíguo são ilegíveis', () => {
    for (const value of [-1, '-10.00', 'abc', '1,2,3', '1234.567']) {
      expect(parseLegacyMoney(value)).toEqual({ ok: false, code: 'unreadable_amount' });
    }
  });

  it('vazio é null', () => {
    expect(parseLegacyMoney('')).toEqual({ ok: true, value: null });
  });
});

describe('parseLegacyInteger', () => {
  it('inteiro maior ou igual a zero', () => {
    expect(parseLegacyInteger(3)).toEqual({ ok: true, value: 3 });
    expect(parseLegacyInteger('3')).toEqual({ ok: true, value: 3 });
    expect(parseLegacyInteger(null)).toEqual({ ok: true, value: null });
  });

  it('fração, negativo e texto são ilegíveis', () => {
    for (const value of [2.5, -1, 'x', '2.5']) {
      expect(parseLegacyInteger(value)).toEqual({ ok: false, code: 'unreadable_number' });
    }
  });
});

describe('parseLegacyBoolean', () => {
  it('booleano e textos de sim e não', () => {
    expect(parseLegacyBoolean(true)).toBe(true);
    expect(parseLegacyBoolean('TRUE')).toBe(true);
    expect(parseLegacyBoolean('Sim')).toBe(true);
    expect(parseLegacyBoolean('não')).toBe(false);
    expect(parseLegacyBoolean('false')).toBe(false);
  });

  it('vazio ou desconhecido é null (desconhecido)', () => {
    expect(parseLegacyBoolean(null)).toBeNull();
    expect(parseLegacyBoolean('talvez')).toBeNull();
  });
});

describe('parseLegacyText', () => {
  it('apara espaços; vazio é null; número vira texto', () => {
    expect(parseLegacyText('  abc ')).toBe('abc');
    expect(parseLegacyText('')).toBeNull();
    expect(parseLegacyText(900001)).toBe('900001');
    expect(parseLegacyText(null)).toBeNull();
  });
});
