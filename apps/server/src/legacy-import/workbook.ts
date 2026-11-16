/**
 * Leitura da cópia .xlsx da planilha do sistema anterior (specs/004, research R-02, FR-003).
 *
 * As abas são achadas pelo nome e as colunas pelo cabeçalho, em qualquer ordem. Os números chegam
 * como texto exato (sem arredondamento de ponto flutuante) e as células com formato de data como
 * `Date`; a interpretação fica no domínio (research R-03).
 *
 * Nenhum erro daqui carrega o conteúdo de uma célula ou a mensagem da biblioteca (FR-018).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  LEGACY_REQUIRED_RESERVATION_COLUMNS,
  LEGACY_REQUIRED_TREATMENT_COLUMNS,
  LEGACY_RESERVATIONS_SHEET,
  LEGACY_TREATMENTS_SHEET,
  missingColumns,
  type LegacyCellValue,
  type LegacyRow,
} from '@hunit/domain';
import readXlsxFile from 'read-excel-file/node';

export type LegacyWorkbookErrorCode =
  'workbook_not_found' | 'unreadable_workbook' | 'missing_sheet' | 'missing_column';

/** Planilha que não pode ser importada. `detail` é o nome da aba ou da coluna (nunca um valor). */
export class LegacyWorkbookError extends Error {
  constructor(
    readonly code: LegacyWorkbookErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'LegacyWorkbookError';
  }
}

/** Linha de uma aba: o número da linha na planilha (o cabeçalho é a 1) e as células por coluna. */
export interface LegacySheetRow {
  row: number;
  cells: LegacyRow;
}

export interface LegacyWorkbook {
  /** SHA-256 do arquivo, para a impressão digital (research R-08). */
  sha256: string;
  reservations: LegacySheetRow[];
  treatments: LegacySheetRow[];
}

type Cell = string | number | boolean | Date | null;

function isEmpty(cell: Cell): boolean {
  return cell === null || (typeof cell === 'string' && !cell.trim());
}

function toRows(data: readonly (readonly Cell[])[], sheet: string, required: readonly string[]) {
  const [header = [], ...body] = data;
  const missing = missingColumns(header, required);
  if (missing.length > 0) {
    throw new LegacyWorkbookError('missing_column', `${sheet}: ${missing.join(', ')}`);
  }

  const names = header.map((cell) => (typeof cell === 'string' ? cell.trim() : ''));
  const rows: LegacySheetRow[] = [];
  body.forEach((cells, index) => {
    if (cells.every(isEmpty)) return;
    const record: Record<string, LegacyCellValue> = {};
    names.forEach((name, column) => {
      // Primeira ocorrência de um cabeçalho repetido vale; colunas sem nome são ignoradas.
      if (name && !(name in record)) record[name] = cells[column] ?? null;
    });
    rows.push({ row: index + 2, cells: record });
  });
  return rows;
}

/** Lê e confere a planilha. Aba ou coluna obrigatória faltando → `LegacyWorkbookError`. */
export async function readLegacyWorkbook(filePath: string): Promise<LegacyWorkbook> {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new LegacyWorkbookError('workbook_not_found');
  }

  let sheets: { sheet: string; data: Cell[][] }[];
  try {
    sheets = (await readXlsxFile(bytes, { parseNumber: (value: string) => value })) as {
      sheet: string;
      data: Cell[][];
    }[];
  } catch {
    // A mensagem da biblioteca pode trazer conteúdo do arquivo: não é repassada (FR-018).
    throw new LegacyWorkbookError('unreadable_workbook');
  }

  const find = (name: string) => {
    const sheet = sheets.find((item) => item.sheet.trim() === name);
    if (!sheet) throw new LegacyWorkbookError('missing_sheet', name);
    return sheet.data;
  };

  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    reservations: toRows(
      find(LEGACY_RESERVATIONS_SHEET),
      LEGACY_RESERVATIONS_SHEET,
      LEGACY_REQUIRED_RESERVATION_COLUMNS,
    ),
    treatments: toRows(
      find(LEGACY_TREATMENTS_SHEET),
      LEGACY_TREATMENTS_SHEET,
      LEGACY_REQUIRED_TREATMENT_COLUMNS,
    ),
  };
}
