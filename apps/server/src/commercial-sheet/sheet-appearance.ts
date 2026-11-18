/**
 * Aparência da planilha do Comercial no Google Sheets (specs/005, FR-010a; research R-18;
 * contracts/sheet-layout.md, "Aparência"): os pedidos da API que o comando de preparação manda e o
 * formato de cada célula das linhas que o sincronizador acrescenta.
 *
 * - Cabeçalho das colunas do sistema (A a J) preto com letra lima; o das colunas de retorno (K a N)
 *   lima com letra preta; sem bordas.
 * - Linhas de dados com bordas tracejadas e listras alternadas.
 * - Coluna "Validação do Financeiro" com a cor do status (`FINANCE_VALIDATION_TONES`, do domínio).
 *
 * As cores da coluna J e as listras são formatação condicional, que vale para qualquer linha. As
 * bordas não podem ser condicionais: o comando as aplica nas linhas existentes e cada linha
 * acrescentada já sai com elas (`dataCellFormat`).
 */
import {
  COMMERCIAL_SHEET_HEADERS,
  FINANCE_VALIDATION_TONES,
  SYSTEM_COLUMN_COUNT,
  type FinanceValidationTone,
} from '@hunit/domain';

/** Cores da planilha (contracts/sheet-layout.md, "Aparência"). */
export const SHEET_COLORS = {
  black: '#000000',
  lime: '#D4F25A',
  orange: '#FFA94D',
  red: '#FF6B6B',
  stripe: '#F1F3F5',
  border: '#ADB5BD',
} as const;

const TONE_COLORS: Readonly<Record<FinanceValidationTone, string>> = {
  awaiting_return: SHEET_COLORS.lime,
  awaiting_validation: SHEET_COLORS.orange,
  attention: SHEET_COLORS.red,
};

/** 14 colunas, de A a N. */
export const COLUMN_COUNT = COMMERCIAL_SHEET_HEADERS.length;
/** Coluna J, "Validação do Financeiro". */
export const VALIDATION_COLUMN = SYSTEM_COLUMN_COUNT - 1;

/** Larguras das colunas, em pixels, de A a N: o cabeçalho cabe sem cortar. */
export const COLUMN_WIDTHS: readonly number[] = [
  220, 110, 100, 150, 120, 200, 140, 190, 135, 280, 180, 200, 120, 210,
];
const HEADER_HEIGHT = 40;

/** Reserva, Código de autorização, Hotel da cobrança e Responsável: texto (zeros à esquerda). */
const TEXT_COLUMNS: readonly number[] = [1, 10, 11, 13];
/** Valor cobrado (M), em reais. */
const AMOUNT_COLUMN = 12;
/** Valor a cobrar (E) e Valor cobrado (M), alinhados à direita. */
const RIGHT_ALIGNED: readonly number[] = [4, 12];

const CURRENCY_FORMAT = { type: 'CURRENCY', pattern: '"R$" #,##0.00' };
/** Listras: linhas pares que têm o número da reserva. Sem separador de argumentos (R-18). */
export const STRIPE_FORMULA = '=ISEVEN(ROW())*($B2<>"")=1';

/** "#D4F25A" → `ColorStyle` da API. */
export function colorStyle(hex: string): {
  rgbColor: { red: number; green: number; blue: number };
} {
  const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return { rgbColor: { red: channel(1), green: channel(3), blue: channel(5) } };
}

const DASHED = { style: 'DASHED', colorStyle: colorStyle(SHEET_COLORS.border) };

/**
 * Formato de uma célula de dados na coluna (índice a partir de 0), com as bordas tracejadas: vai
 * em cada célula das linhas que o sincronizador acrescenta.
 */
export function dataCellFormat(column: number): Record<string, unknown> {
  return {
    borders: { top: DASHED, bottom: DASHED, left: DASHED, right: DASHED },
    verticalAlignment: 'MIDDLE',
    ...(column === VALIDATION_COLUMN ? { wrapStrategy: 'WRAP' } : {}),
    ...(RIGHT_ALIGNED.includes(column) ? { horizontalAlignment: 'RIGHT' } : {}),
    ...(TEXT_COLUMNS.includes(column) ? { numberFormat: { type: 'TEXT' } } : {}),
    ...(column === AMOUNT_COLUMN ? { numberFormat: CURRENCY_FORMAT } : {}),
  };
}

export interface AppearanceInput {
  sheetId: number;
  /** Linhas de dados que a aba já tem (sem o cabeçalho): recebem as bordas. */
  dataRows: number;
  /** Regras de formatação condicional que a aba já tem: são apagadas e refeitas. */
  conditionalRuleCount: number;
}

/** Pedidos (`batchUpdate`) que aplicam a aparência a uma aba, de forma repetível. */
export function appearanceRequests({
  sheetId,
  dataRows,
  conditionalRuleCount,
}: AppearanceInput): unknown[] {
  const requests: unknown[] = [];
  const dataColumn = (column: number) => ({
    sheetId,
    startRowIndex: 1,
    startColumnIndex: column,
    endColumnIndex: column + 1,
  });

  // Cabeçalho: dois blocos de cor, sem bordas.
  const header = (start: number, end: number, background: string, text: string) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: start,
        endColumnIndex: end,
      },
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: colorStyle(background),
          textFormat: { bold: true, foregroundColorStyle: colorStyle(text) },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      },
      fields:
        'userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment,wrapStrategy,borders)',
    },
  });
  requests.push(
    header(0, SYSTEM_COLUMN_COUNT, SHEET_COLORS.black, SHEET_COLORS.lime),
    header(SYSTEM_COLUMN_COUNT, COLUMN_COUNT, SHEET_COLORS.lime, SHEET_COLORS.black),
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: HEADER_HEIGHT },
        fields: 'pixelSize',
      },
    },
  );
  COLUMN_WIDTHS.forEach((pixelSize, column) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: column, endIndex: column + 1 },
        properties: { pixelSize },
        fields: 'pixelSize',
      },
    });
  });

  // Formatos das colunas, para as linhas que a aba já tem e as que vierem.
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: COLUMN_COUNT },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat.verticalAlignment',
    },
  });
  for (const column of TEXT_COLUMNS) {
    requests.push({
      repeatCell: {
        range: dataColumn(column),
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }
  requests.push({
    repeatCell: {
      range: dataColumn(AMOUNT_COLUMN),
      cell: { userEnteredFormat: { numberFormat: CURRENCY_FORMAT } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });
  for (const column of RIGHT_ALIGNED) {
    requests.push({
      repeatCell: {
        range: dataColumn(column),
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    });
  }
  requests.push({
    repeatCell: {
      range: dataColumn(VALIDATION_COLUMN),
      cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat.wrapStrategy',
    },
  });

  // Bordas tracejadas nas linhas de dados que já existem (as novas já chegam com elas).
  if (dataRows > 0) {
    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 1 + dataRows,
          startColumnIndex: 0,
          endColumnIndex: COLUMN_COUNT,
        },
        top: DASHED,
        bottom: DASHED,
        left: DASHED,
        right: DASHED,
        innerHorizontal: DASHED,
        innerVertical: DASHED,
      },
    });
  }

  // Formatação condicional: as regras da aba são do sistema. Apaga de trás para a frente.
  for (let index = conditionalRuleCount - 1; index >= 0; index -= 1) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index } });
  }
  const rules = [
    // Cores da coluna J primeiro: numa célula, vale a primeira regra que se aplica.
    ...FINANCE_VALIDATION_TONES.map((rule) => ({
      ranges: [dataColumn(VALIDATION_COLUMN)],
      booleanRule: {
        condition: {
          type: rule.match === 'equals' ? 'TEXT_EQ' : 'TEXT_STARTS_WITH',
          values: [{ userEnteredValue: rule.text }],
        },
        format: {
          backgroundColorStyle: colorStyle(TONE_COLORS[rule.tone]),
          textFormat: { bold: true, foregroundColorStyle: colorStyle(SHEET_COLORS.black) },
        },
      },
    })),
    {
      ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: COLUMN_COUNT }],
      booleanRule: {
        condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: STRIPE_FORMULA }] },
        format: { backgroundColorStyle: colorStyle(SHEET_COLORS.stripe) },
      },
    },
  ];
  rules.forEach((rule, index) => {
    requests.push({ addConditionalFormatRule: { rule, index } });
  });

  return requests;
}
