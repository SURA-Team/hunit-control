/**
 * Leitura do retorno preenchido pelo Comercial na planilha (specs/005, FR-015, FR-018, FR-019;
 * research R-08) — tasks.md, T006. Desde a homologação da 008 (R-19), a situação é obrigatória e
 * "Não cobrada" virou "Cancelada". Desde a 009 (research R-02; tasks.md, T005), toda situação exige o
 * responsável, só a maquininha exige código, hotel, valor e data, e outro texto é a situação livre.
 */
import { describe, expect, it } from 'vitest';
import {
  CHARGE_SITUATIONS,
  COMMERCIAL_RETURN_COLUMNS,
  describeReturnReading,
  MAX_RETURN_TEXT_LENGTH,
  parseChargeDate,
  parseChargedAmount,
  readReturn,
  recognizeChargeSituation,
  reportChanged,
  returnChanged,
  returnSnapshot,
  isSituationReturn,
  type CommercialReportValues,
  type CommercialReturnCells,
} from '../src/commercial-return.js';

/** Número de série do Google para 19/11/2026 (dias desde 30/12/1899). */
const SERIAL_2026_11_19 = 46345;

const complete: CommercialReturnCells = {
  authorizationCode: 'AUT123',
  chargeHotel: 'Estabelecimento Fictício',
  chargedAmount: 1234.5,
  chargedBy: 'Comercial Fictício 1',
  chargeSituation: 'Cobrada na maquininha',
  chargeDate: SERIAL_2026_11_19,
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
      chargeSituation: { kind: 'charged_at_terminal', text: 'Cobrada na maquininha' },
      chargeDate: '2026-11-19',
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

describe('situação e data da cobrança (specs/008, research R-06 e R-19)', () => {
  it('as seis colunas, na ordem da planilha (K a P)', () => {
    expect(COMMERCIAL_RETURN_COLUMNS).toEqual([
      'authorizationCode',
      'chargeHotel',
      'chargedAmount',
      'chargedBy',
      'chargeSituation',
      'chargeDate',
    ]);
    expect(CHARGE_SITUATIONS.map((situation) => situation.text)).toEqual([
      'Cobrada na maquininha',
      'Cobrada no Hunit',
      'Cancelada',
    ]);
  });

  it.each([
    ['Cobrada na maquininha', 'charged_at_terminal'],
    ['cobrada na MAQUININHA ', 'charged_at_terminal'],
    ['Cobrada no Hunit', 'charged_in_hunit'],
    ['cobrado   no hunit', 'charged_in_hunit'],
    ['Cancelada', 'cancelled'],
    ['cancelado', 'cancelled'],
    ['CANCELADA na Expedia', 'cancelled'],
    ['Cancelada no Hunit', 'cancelled'],
    // "Não cobrada" deixou de ser uma situação (homologação, R-19): outro texto.
    ['Não cobrada', 'other'],
    ['Paga em dinheiro', 'other'],
    ['Cobrança pendente', 'other'],
  ] as const)('reconhece "%s" como %s', (text, kind) => {
    expect(recognizeChargeSituation(text)).toBe(kind);
  });

  it('data: número de série do Google ou dd/mm/aaaa; o resto não é data', () => {
    expect(parseChargeDate(SERIAL_2026_11_19)).toEqual({ ok: true, date: '2026-11-19' });
    expect(parseChargeDate(SERIAL_2026_11_19 + 0.75)).toEqual({ ok: true, date: '2026-11-19' });
    expect(parseChargeDate('19/11/2026')).toEqual({ ok: true, date: '2026-11-19' });
    expect(parseChargeDate(' 1/2/2026 ')).toEqual({ ok: true, date: '2026-02-01' });
    for (const cell of ['31/02/2026', '2026-11-19', 'ontem', 0, -3, true, '19/11/26']) {
      expect(parseChargeDate(cell)).toEqual({ ok: false });
    }
  });

  it('as seis vazias não são retorno', () => {
    expect(readReturn({ chargeSituation: ' ', chargeDate: null })).toEqual({ kind: 'empty' });
  });

  it('sem situação: incompleto, pedindo a situação (e o responsável, se faltar)', () => {
    const reading = readReturn({ ...complete, chargeSituation: '', chargeDate: null });
    expect(reading).toEqual({ kind: 'incomplete', missing: ['chargeSituation'] });
    expect(describeReturnReading(reading)).toBe('Retorno incompleto: falta a situação da cobrança');
    const both = readReturn({ authorizationCode: 'AUT1' });
    expect(both).toEqual({ kind: 'incomplete', missing: ['chargedBy', 'chargeSituation'] });
    expect(describeReturnReading(both)).toBe(
      'Retorno incompleto: faltam o responsável pela cobrança e a situação da cobrança',
    );
  });

  it('"Cobrada na maquininha" sem a data: incompleto', () => {
    const reading = readReturn({ ...complete, chargeDate: '' });
    expect(reading).toEqual({ kind: 'incomplete', missing: ['chargeDate'] });
    expect(describeReturnReading(reading)).toBe('Retorno incompleto: falta a data da cobrança');
  });

  it('completo com "Cobrada na maquininha" e a data', () => {
    expect(
      readReturn({
        ...complete,
        chargeSituation: 'Cobrada na maquininha',
        chargeDate: SERIAL_2026_11_19,
      }),
    ).toMatchObject({
      kind: 'complete',
      chargeSituation: { kind: 'charged_at_terminal', text: 'Cobrada na maquininha' },
      chargeDate: '2026-11-19',
    });
  });

  it('situação livre: basta o responsável; o resto, se preenchido, é lido (specs/009)', () => {
    expect(readReturn({ chargeSituation: ' Cobrada pela OTA ', chargedBy: 'Comercial' })).toEqual({
      kind: 'situation',
      values: {
        chargedBy: 'Comercial',
        authorizationCode: null,
        chargeHotel: null,
        chargedAmount: null,
      },
      chargeSituation: { kind: 'other', text: 'Cobrada pela OTA' },
      chargeDate: null,
    });
    expect(readReturn({ ...complete, chargeSituation: 'Paga em dinheiro' })).toEqual({
      kind: 'situation',
      values: {
        chargedBy: 'Comercial Fictício 1',
        authorizationCode: 'AUT123',
        chargeHotel: 'Estabelecimento Fictício',
        chargedAmount: '1234.50',
      },
      chargeSituation: { kind: 'other', text: 'Paga em dinheiro' },
      chargeDate: '2026-11-19',
    });
  });

  it('situação livre sem o responsável: pede só o responsável', () => {
    const reading = readReturn({ chargeSituation: 'Cobrada pela OTA', chargedAmount: 100 });
    expect(reading).toEqual({ kind: 'incomplete', missing: ['chargedBy'] });
    expect(describeReturnReading(reading)).toBe(
      'Retorno incompleto: falta o responsável pela cobrança',
    );
  });

  it('situação livre com valor ou data não entendidos: não entendido', () => {
    expect(
      readReturn({
        chargeSituation: 'Paga em dinheiro',
        chargedBy: 'Comercial',
        chargedAmount: 'abc',
        chargeDate: 'ontem',
      }),
    ).toEqual({
      kind: 'illegible',
      problems: [
        { field: 'chargedAmount', problem: 'not_a_value' },
        { field: 'chargeDate', problem: 'not_a_date' },
      ],
    });
    expect(
      readReturn({
        chargeSituation: 'Paga em dinheiro',
        chargedBy: 'Comercial',
        authorizationCode: 'x'.repeat(MAX_RETURN_TEXT_LENGTH + 1),
      }),
    ).toEqual({
      kind: 'illegible',
      problems: [{ field: 'authorizationCode', problem: 'too_long' }],
    });
  });

  it('"maquininha" no meio do texto segue a regra da maquininha', () => {
    const reading = readReturn({
      chargeSituation: 'Cobrada na maquininha do hotel',
      chargedBy: 'Comercial',
    });
    expect(reading).toEqual({
      kind: 'incomplete',
      missing: ['authorizationCode', 'chargeHotel', 'chargedAmount', 'chargeDate'],
    });
    expect(describeReturnReading(reading)).toBe(
      'Retorno incompleto: faltam o código de autorização, o hotel da cobrança, o valor cobrado e a data da cobrança',
    );
  });

  it('isSituationReturn: só o tipo "other"', () => {
    expect(isSituationReturn('other')).toBe(true);
    for (const kind of ['charged_at_terminal', 'charged_in_hunit', 'cancelled', null, undefined]) {
      expect(isSituationReturn(kind as never)).toBe(false);
    }
  });

  it('"Cobrada no Hunit" com o responsável é relato, mesmo com os quatro campos preenchidos', () => {
    expect(
      readReturn({
        ...complete,
        chargeSituation: 'Cobrada no Hunit',
        chargeDate: '18/11/2026',
      }),
    ).toEqual({
      kind: 'report',
      report: {
        kind: 'charged_in_hunit',
        situationText: 'Cobrada no Hunit',
        chargedBy: 'Comercial Fictício 1',
        chargeDate: '2026-11-18',
      },
    });
  });

  it('"Cancelada": exige o responsável (specs/009); a data, se houver, é guardada', () => {
    const missing = readReturn({ chargeSituation: 'Cancelada' });
    expect(missing).toEqual({ kind: 'incomplete', missing: ['chargedBy'] });
    expect(describeReturnReading(missing)).toBe(
      'Retorno incompleto: falta o responsável pela cobrança',
    );
    expect(readReturn({ chargeSituation: 'Cancelada', chargedBy: 'Comercial' })).toEqual({
      kind: 'report',
      report: {
        kind: 'cancelled',
        situationText: 'Cancelada',
        chargedBy: 'Comercial',
        chargeDate: null,
      },
    });
    expect(
      readReturn({
        chargeSituation: ' Cancelada na Expedia ',
        chargedBy: 'Comercial Fictício 2',
        chargeDate: '18/11/2026',
        // Os campos do retorno de cobrança são ignorados: a situação manda.
        chargedAmount: 'abc',
      }),
    ).toEqual({
      kind: 'report',
      report: {
        kind: 'cancelled',
        situationText: 'Cancelada na Expedia',
        chargedBy: 'Comercial Fictício 2',
        chargeDate: '2026-11-18',
      },
    });
  });

  it('"Não cobrada" é outro texto: situação livre (specs/009)', () => {
    expect(readReturn({ chargeSituation: 'Não cobrada', chargedBy: 'Comercial' })).toMatchObject({
      kind: 'situation',
      chargeSituation: { kind: 'other', text: 'Não cobrada' },
    });
  });

  it('"Cobrada no Hunit" sem a data: relato, a data é opcional (specs/009)', () => {
    expect(readReturn({ chargeSituation: 'Cobrada no Hunit', chargedBy: 'Comercial' })).toEqual({
      kind: 'report',
      report: {
        kind: 'charged_in_hunit',
        situationText: 'Cobrada no Hunit',
        chargedBy: 'Comercial',
        chargeDate: null,
      },
    });
  });

  it('relato sem responsável é incompleto: "falta o responsável pela cobrança"', () => {
    const reading = readReturn({ chargeSituation: 'Cobrada no Hunit', chargeDate: '18/11/2026' });
    expect(reading).toEqual({ kind: 'incomplete', missing: ['chargedBy'] });
    expect(describeReturnReading(reading)).toBe(
      'Retorno incompleto: falta o responsável pela cobrança',
    );
  });

  it('data que não é data deixa o retorno não entendido, no relato e no retorno comum', () => {
    const report = readReturn({
      chargeSituation: 'Cobrada no Hunit',
      chargedBy: 'Comercial',
      chargeDate: 'ontem',
    });
    expect(report).toEqual({
      kind: 'illegible',
      problems: [{ field: 'chargeDate', problem: 'not_a_date' }],
    });
    expect(describeReturnReading(report)).toBe(
      'Retorno não entendido: data da cobrança não entendida',
    );
    const regular = readReturn({ ...complete, chargedAmount: 'abc', chargeDate: 'ontem' });
    expect(regular).toEqual({
      kind: 'illegible',
      problems: [
        { field: 'chargedAmount', problem: 'not_a_value' },
        { field: 'chargeDate', problem: 'not_a_date' },
      ],
    });
  });

  it('incompleto vale antes da data não entendida', () => {
    expect(readReturn({ ...complete, chargedBy: '', chargeDate: 'ontem' })).toEqual({
      kind: 'incomplete',
      missing: ['chargedBy'],
    });
  });

  it(`situação com mais de ${MAX_RETURN_TEXT_LENGTH} caracteres não é entendida`, () => {
    const reading = readReturn({ ...complete, chargeSituation: 'x'.repeat(101) });
    expect(reading).toEqual({
      kind: 'illegible',
      problems: [{ field: 'chargeSituation', problem: 'too_long' }],
    });
    expect(describeReturnReading(reading)).toBe(
      `Retorno não entendido: situação da cobrança com mais de ${MAX_RETURN_TEXT_LENGTH} caracteres`,
    );
  });

  it('a data não é comparada com hoje: data futura ou antiga é aceita (FR-011)', () => {
    expect(readReturn({ ...complete, chargeDate: '01/01/2030' })).toMatchObject({
      kind: 'complete',
      chargeDate: '2030-01-01',
    });
    expect(readReturn({ ...complete, chargeDate: '01/01/2001' })).toMatchObject({
      kind: 'complete',
      chargeDate: '2001-01-01',
    });
  });
});

describe('returnChanged e returnSnapshot com situação e data (specs/008)', () => {
  const values = {
    authorizationCode: 'AUT123',
    chargeHotel: 'Estabelecimento Fictício',
    chargedAmount: '1234.50',
    chargedBy: 'Comercial Fictício 1',
  };

  it('a leitura completa guarda a situação e a data; a da 005 (sem elas) conta como mudança', () => {
    const reading = readReturn(complete);
    if (reading.kind !== 'complete') throw new Error('esperava completo');
    expect(returnSnapshot(reading)).toEqual({
      ...values,
      chargeSituation: 'Cobrada na maquininha',
      chargeDate: '2026-11-19',
    });
    expect(returnChanged(values, returnSnapshot(reading))).toBe(true);
  });

  it('mudar a situação ou a data é mudança do retorno', () => {
    const withSituation = { ...values, chargeSituation: 'Cobrada na maquininha' };
    expect(returnChanged(values, withSituation)).toBe(true);
    expect(returnChanged(withSituation, { ...withSituation })).toBe(false);
    expect(returnChanged(withSituation, { ...withSituation, chargeDate: '2026-11-19' })).toBe(true);
  });
});

describe('returnSnapshot e returnChanged com situação livre (specs/009)', () => {
  it('guarda só os campos preenchidos; preencher um depois é mudança', () => {
    const reading = readReturn({ chargeSituation: 'Cobrada pela OTA', chargedBy: 'Comercial' });
    if (reading.kind !== 'situation') throw new Error('esperava situação livre');
    const snapshot = returnSnapshot(reading);
    expect(snapshot).toEqual({ chargedBy: 'Comercial', chargeSituation: 'Cobrada pela OTA' });
    expect(returnChanged(snapshot, { ...snapshot })).toBe(false);
    expect(returnChanged(snapshot, { ...snapshot, chargedAmount: '10.00' })).toBe(true);
    expect(returnChanged({ ...snapshot, chargedAmount: '10.00' }, snapshot)).toBe(true);
  });
});

describe('reportChanged (specs/008, FR-012)', () => {
  const report: CommercialReportValues = {
    kind: 'charged_in_hunit',
    situationText: 'Cobrada no Hunit',
    chargedBy: 'Comercial Fictício 1',
    chargeDate: '2026-11-18',
  };

  it('igual não mudou; responsável, data, texto ou tipo diferente mudou', () => {
    expect(reportChanged(null, report)).toBe(true);
    expect(reportChanged(report, { ...report })).toBe(false);
    expect(reportChanged(report, { ...report, chargedBy: 'Outro' })).toBe(true);
    expect(reportChanged(report, { ...report, chargeDate: null })).toBe(true);
    expect(reportChanged(report, { ...report, situationText: 'cobrada no hunit' })).toBe(true);
    expect(reportChanged(report, { ...report, kind: 'cancelled' })).toBe(true);
  });
});
