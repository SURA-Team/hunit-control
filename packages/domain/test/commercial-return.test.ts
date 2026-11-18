/**
 * Leitura do retorno preenchido pelo Comercial na planilha (specs/005, FR-015, FR-018, FR-019;
 * research R-08) — tasks.md, T006.
 */
import { describe, expect, it } from 'vitest';
import {
  describeReturnReading,
  MAX_RETURN_TEXT_LENGTH,
  parseChargedAmount,
  readReturn,
  returnChanged,
  type CommercialReturnCells,
} from '../src/commercial-return.js';

const complete: CommercialReturnCells = {
  authorizationCode: 'AUT123',
  chargeHotel: 'Estabelecimento Fictício',
  chargedAmount: 1234.5,
  chargedBy: 'Comercial Fictício 1',
};

describe('readReturn', () => {
  it('as quatro vazias (ou só espaços) não são retorno', () => {
    expect(readReturn({})).toEqual({ kind: 'empty' });
    expect(
      readReturn({
        authorizationCode: '  ',
        chargeHotel: '',
        chargedAmount: null,
        chargedBy: undefined,
      }),
    ).toEqual({ kind: 'empty' });
  });

  it('completo: normaliza textos e o valor', () => {
    expect(
      readReturn({
        ...complete,
        authorizationCode: '  AUT123 ',
        chargedBy: ' Comercial Fictício 1 ',
      }),
    ).toEqual({
      kind: 'complete',
      values: {
        authorizationCode: 'AUT123',
        chargeHotel: 'Estabelecimento Fictício',
        chargedAmount: '1234.50',
        chargedBy: 'Comercial Fictício 1',
      },
    });
  });

  it('código numérico vira texto', () => {
    const reading = readReturn({ ...complete, authorizationCode: 654321 });
    expect(reading.kind === 'complete' && reading.values.authorizationCode).toBe('654321');
  });

  it('incompleto: lista as colunas que faltam, na ordem da planilha', () => {
    expect(readReturn({ ...complete, chargedAmount: '', chargedBy: '  ' })).toEqual({
      kind: 'incomplete',
      missing: ['chargedAmount', 'chargedBy'],
    });
  });

  it('incompleto vale antes de ilegível', () => {
    expect(readReturn({ ...complete, chargedAmount: 'abc', chargedBy: '' })).toEqual({
      kind: 'incomplete',
      missing: ['chargedBy'],
    });
  });

  it('ilegível: valor que não é dinheiro, zero ou negativo', () => {
    for (const chargedAmount of ['abc', 0, -10, '0,00', '-5,00']) {
      expect(readReturn({ ...complete, chargedAmount }).kind).toBe('illegible');
    }
  });

  it(`ilegível: texto com mais de ${MAX_RETURN_TEXT_LENGTH} caracteres`, () => {
    const reading = readReturn({ ...complete, chargedBy: 'x'.repeat(MAX_RETURN_TEXT_LENGTH + 1) });
    expect(reading).toEqual({
      kind: 'illegible',
      problems: [{ field: 'chargedBy', problem: 'too_long' }],
    });
    expect(readReturn({ ...complete, chargedBy: 'x'.repeat(MAX_RETURN_TEXT_LENGTH) }).kind).toBe(
      'complete',
    );
  });

  it('o hotel da cobrança é texto livre, sem conferir catálogo', () => {
    const reading = readReturn({
      ...complete,
      chargeHotel: 'Qualquer Nome Que Apareça Na Maquininha',
    });
    expect(reading.kind).toBe('complete');
  });

  it('célula com verdadeiro/falso não é texto', () => {
    expect(readReturn({ ...complete, chargedBy: true }).kind).toBe('illegible');
  });
});

describe('parseChargedAmount', () => {
  it.each([
    [1234.5, '1234.50'],
    [10, '10.00'],
    [0.01, '0.01'],
    ['1.234,56', '1234.56'],
    ['1234,56', '1234.56'],
    ['1234.56', '1234.56'],
    ['R$ 1.234,56', '1234.56'],
    ['r$1234,5', '1234.50'],
    ['  350 ', '350.00'],
    ['12.345.678,90', '12345678.90'],
  ])('aceita %j → %s', (cell, expected) => {
    expect(parseChargedAmount(cell)).toEqual({ ok: true, amount: expected });
  });

  it.each([
    ['abc', 'not_a_value'],
    ['1,234', 'ambiguous'],
    ['1.234', 'ambiguous'],
    ['12,345', 'ambiguous'],
    [12.345, 'too_many_decimals'],
    ['12,3456', 'not_a_value'],
    [0, 'not_positive'],
    [-1, 'not_positive'],
    ['-1,00', 'not_a_value'],
    ['1.23,45', 'not_a_value'],
    [Number.NaN, 'not_a_value'],
    [1e12, 'too_large'],
  ])('recusa %j (%s)', (cell, problem) => {
    expect(parseChargedAmount(cell)).toEqual({ ok: false, problem });
  });
});

describe('returnChanged', () => {
  const values = {
    authorizationCode: 'AUT123',
    chargeHotel: 'Estabelecimento Fictício',
    chargedAmount: '1234.50',
    chargedBy: 'Comercial Fictício 1',
  };

  it('sem retorno anterior, qualquer retorno completo é novo', () => {
    expect(returnChanged(null, values)).toBe(true);
  });

  it('iguais não mudaram; qualquer coluna diferente mudou', () => {
    expect(returnChanged(values, { ...values })).toBe(false);
    expect(returnChanged(values, { ...values, chargedAmount: '1234.51' })).toBe(true);
    expect(returnChanged(values, { ...values, authorizationCode: 'AUT124' })).toBe(true);
  });
});

describe('describeReturnReading (coluna "Validação do Financeiro")', () => {
  it('incompleto, com uma ou várias colunas', () => {
    expect(describeReturnReading({ kind: 'incomplete', missing: ['chargedAmount'] })).toBe(
      'Retorno incompleto: falta o valor cobrado',
    );
    expect(
      describeReturnReading({ kind: 'incomplete', missing: ['authorizationCode', 'chargedBy'] }),
    ).toBe('Retorno incompleto: faltam o código de autorização e o responsável pela cobrança');
  });

  it('ilegível, dizendo o que não foi entendido', () => {
    expect(
      describeReturnReading({
        kind: 'illegible',
        problems: [{ field: 'chargedAmount', problem: 'ambiguous' }],
      }),
    ).toBe(
      'Retorno não entendido: valor cobrado ambíguo (use vírgula para os centavos, ex.: 1.234,56)',
    );
  });
});
