/**
 * Formato da planilha do Comercial e da cópia para e-mail (specs/005, FR-009, FR-010, FR-027;
 * contracts/sheet-layout.md) — tasks.md, T009.
 */
import { describe, expect, it } from 'vitest';
import {
  CANCELLED_LINE_SITUATION_NAME,
  CLASSIFICATION_NAMES,
  COMMERCIAL_SHEET_HEADERS,
  COMMERCIAL_SHEET_TABS,
  COPY_HEADERS,
  copyTable,
  DETAILED_SITUATION_NAMES,
  FINANCE_VALIDATION_TONES,
  financeValidationText,
  financeValidationTone,
  formatBrDate,
  formatBrDateTime,
  formatBrl,
  sheetHotelNames,
  sheetSystemRow,
  SYSTEM_COLUMN_COUNT,
  type SheetRowSource,
} from '../src/commercial-sheet.js';
import { describeReturnReading } from '../src/commercial-return.js';
import { CLASSIFICATIONS } from '../src/types.js';

const source: SheetRowSource = {
  hotelName: 'Hotel Homologação Um',
  reservationNumber: '900001',
  checkIn: '2026-11-03',
  channel: 'Booking.com',
  totalAmount: '1234.56',
  classification: 'virtual_card_pending_charge',
  reservationStatus: 'active',
  detailedSituation: 'treatment_sent',
  lineState: 'open',
  lastSentAt: new Date('2026-11-17T13:15:00Z'),
  validation: { kind: 'awaiting_return' },
};

describe('abas e colunas (FR-009, FR-010)', () => {
  it('duas abas com os nomes da spec', () => {
    expect(COMMERCIAL_SHEET_TABS).toEqual({ toCharge: 'A cobrar', done: 'Concluídas' });
  });

  it('14 colunas, na ordem e com os nomes confirmados', () => {
    expect(COMMERCIAL_SHEET_HEADERS).toEqual([
      'Hotel',
      'Reserva',
      'Check-in',
      'Canal',
      'Valor a cobrar',
      'Motivo',
      'Ativa ou cancelada',
      'Situação',
      'Enviada em',
      'Validação do Financeiro',
      'Código de autorização',
      'Hotel da cobrança',
      'Valor cobrado',
      'Responsável pela cobrança',
    ]);
    expect(SYSTEM_COLUMN_COUNT).toBe(10);
  });

  it('todas as classificações e situações têm nome', () => {
    for (const classification of CLASSIFICATIONS) {
      expect(CLASSIFICATION_NAMES[classification]).toBeTruthy();
      expect(DETAILED_SITUATION_NAMES[classification]).toBe(CLASSIFICATION_NAMES[classification]);
    }
    expect(DETAILED_SITUATION_NAMES.return_pending).toBe('Validar comprovante');
    expect(DETAILED_SITUATION_NAMES.treatment_sent).toBe('Tratativa enviada');
    expect(DETAILED_SITUATION_NAMES.proof_sent).toBe('Comprovante enviado');
  });
});

describe('formatos em pt-BR', () => {
  it('reais, data e data e hora de Brasília', () => {
    expect(formatBrl('1234.56')).toBe('R$ 1.234,56');
    expect(formatBrl('0.50')).toBe('R$ 0,50');
    expect(formatBrl('1234567.00')).toBe('R$ 1.234.567,00');
    expect(formatBrl(null)).toBe('');
    expect(formatBrDate('2026-11-03')).toBe('03/11/2026');
    expect(formatBrDateTime(new Date('2026-11-17T13:15:00Z'))).toBe('17/11/2026 10:15');
  });
});

describe('sheetSystemRow (colunas A a J)', () => {
  it('monta as 10 colunas do sistema como texto', () => {
    expect(sheetSystemRow(source)).toEqual([
      'Hotel Homologação Um',
      '900001',
      '03/11/2026',
      'Booking.com',
      'R$ 1.234,56',
      'Pendente de cobrança',
      'Ativa',
      'Tratativa enviada',
      '17/11/2026 10:15',
      'Aguardando retorno do Comercial',
    ]);
  });

  it('linha cancelada mostra "Pedido cancelado pelo Financeiro" na situação', () => {
    const row = sheetSystemRow({ ...source, lineState: 'cancelled' });
    expect(row[7]).toBe(CANCELLED_LINE_SITUATION_NAME);
    expect(CANCELLED_LINE_SITUATION_NAME).toBe('Pedido cancelado pelo Financeiro');
  });

  it('sem total, o valor a cobrar fica vazio', () => {
    expect(sheetSystemRow({ ...source, totalAmount: null })[4]).toBe('');
  });

  it('nunca leva o nome do hóspede, mesmo se vier junto', () => {
    const withGuest = { ...source, guestName: 'Hóspede Fictício 1' } as SheetRowSource;
    expect(sheetSystemRow(withGuest).join('|')).not.toContain('Hóspede Fictício 1');
  });
});

describe('financeValidationText (coluna J)', () => {
  it.each([
    [{ kind: 'none' } as const, ''],
    [{ kind: 'awaiting_return' } as const, 'Aguardando retorno do Comercial'],
    [{ kind: 'awaiting' } as const, 'Aguardando validação do Financeiro'],
    [{ kind: 'confirmed' } as const, 'Confirmado pelo Financeiro'],
    [
      { kind: 'rejected', reason: 'valor diferente' } as const,
      'Recusado pelo Financeiro: valor diferente',
    ],
    [
      { kind: 'problem', text: 'Retorno incompleto: falta o valor cobrado' } as const,
      'Retorno incompleto: falta o valor cobrado',
    ],
  ])('%j', (validation, expected) => {
    expect(financeValidationText(validation)).toBe(expected);
  });
});

describe('financeValidationTone (cores da coluna J, FR-010a)', () => {
  const incomplete =
    describeReturnReading({ kind: 'incomplete', missing: ['chargedAmount'] }) ?? '';
  const illegible =
    describeReturnReading({
      kind: 'illegible',
      problems: [{ field: 'chargedAmount', problem: 'not_a_value' }],
    }) ?? '';

  it.each([
    [{ kind: 'none' } as const, null],
    [{ kind: 'awaiting_return' } as const, 'awaiting_return'],
    [{ kind: 'awaiting' } as const, 'awaiting_validation'],
    [{ kind: 'confirmed' } as const, null],
    [{ kind: 'rejected', reason: 'Valor diferente' } as const, 'attention'],
    [{ kind: 'problem', text: incomplete } as const, 'attention'],
    [{ kind: 'problem', text: illegible } as const, 'attention'],
  ])('%j', (validation, tone) => {
    expect(financeValidationTone(financeValidationText(validation))).toBe(tone);
  });

  it('o motivo da recusa não muda a cor, mesmo quando repete outro status', () => {
    expect(
      financeValidationTone(
        financeValidationText({ kind: 'rejected', reason: 'Aguardando validação do Financeiro' }),
      ),
    ).toBe('attention');
  });

  it('cada regra tem um texto que não começa com o de outra regra (a ordem não muda a cor)', () => {
    for (const rule of FINANCE_VALIDATION_TONES) {
      const others = FINANCE_VALIDATION_TONES.filter((other) => other !== rule);
      expect(others.some((other) => rule.text.startsWith(other.text))).toBe(false);
    }
  });
});

describe('sheetHotelNames (research R-07)', () => {
  it('usa o nome; com nomes repetidos, acrescenta o código', () => {
    const names = sheetHotelNames([
      { code: 'hml_um', name: 'Hotel Homologação Um' },
      { code: 'hml_dois', name: 'Hotel Repetido' },
      { code: 'hml_tres', name: 'Hotel Repetido' },
    ]);
    expect(names.get('hml_um')).toBe('Hotel Homologação Um');
    expect(names.get('hml_dois')).toBe('Hotel Repetido (hml_dois)');
    expect(names.get('hml_tres')).toBe('Hotel Repetido (hml_tres)');
  });
});

describe('copyTable — cópia para e-mail (FR-027)', () => {
  const rows = [
    { ...source, guestName: 'Hóspede Fictício 1' },
    {
      ...source,
      reservationNumber: '900002',
      totalAmount: '100.00',
      reservationStatus: 'cancelled' as const,
      detailedSituation: 'return_pending' as const,
      guestName: 'Hóspede Fictício 2',
    },
    { ...source, reservationNumber: '900003', totalAmount: null, checkIn: null, channel: null },
  ];

  it('as 8 colunas da planilha, na ordem da lista, e o total', () => {
    const table = copyTable(rows);
    expect(COPY_HEADERS).toEqual(COMMERCIAL_SHEET_HEADERS.slice(0, 8));
    expect(table.headers).toEqual(COPY_HEADERS);
    expect(table.rows).toEqual([
      [
        'Hotel Homologação Um',
        '900001',
        '03/11/2026',
        'Booking.com',
        'R$ 1.234,56',
        'Pendente de cobrança',
        'Ativa',
        'Tratativa enviada',
      ],
      [
        'Hotel Homologação Um',
        '900002',
        '03/11/2026',
        'Booking.com',
        'R$ 100,00',
        'Pendente de cobrança',
        'Cancelada',
        'Validar comprovante',
      ],
      [
        'Hotel Homologação Um',
        '900003',
        '',
        '',
        '',
        'Pendente de cobrança',
        'Ativa',
        'Tratativa enviada',
      ],
    ]);
    expect(table.total).toBe('R$ 1.334,56');
  });

  it('nunca leva o nome do hóspede', () => {
    const text = JSON.stringify(copyTable(rows));
    expect(text).not.toContain('Hóspede Fictício');
  });
});
