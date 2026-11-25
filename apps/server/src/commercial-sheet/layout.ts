/**
 * Formato esperado da planilha do Comercial (specs/005, FR-008a, FR-009, FR-010;
 * contracts/sheet-layout.md). A rodada de sincronização confere o formato antes de escrever: se
 * alguém renomeou uma aba ou mexeu no cabeçalho, nada é escrito até o comando de preparação ser
 * rodado de novo (research R-05).
 */
import {
  COMMERCIAL_SHEET_HEADERS,
  COMMERCIAL_SHEET_TABS,
  type SheetCellValue,
} from '@hunit/domain';
import { SHEET_TABS, type SheetSnapshot, type SheetTab } from './gateway.js';

/** O cabeçalho da aba é exatamente o esperado? (Colunas a mais depois da P são toleradas.) */
export function headerMatches(header: readonly SheetCellValue[] | undefined): boolean {
  return COMMERCIAL_SHEET_HEADERS.every((name, index) => header?.[index] === name);
}

const isBlankHeader = (cell: SheetCellValue | undefined) =>
  cell === undefined || cell === null || cell === '';

const columnLetter = (index: number) => String.fromCharCode('A'.charCodeAt(0) + index);

/**
 * Colunas que faltam no fim do cabeçalho (uma planilha da 005, sem O e P): `null` quando o
 * cabeçalho foi alterado de outro jeito.
 */
export function missingHeaderColumns(header: readonly SheetCellValue[]): string[] | null {
  const firstMissing = COMMERCIAL_SHEET_HEADERS.findIndex((name, index) => header[index] !== name);
  if (firstMissing < 0) return [];
  const missing = COMMERCIAL_SHEET_HEADERS.slice(firstMissing);
  if (!missing.every((_name, offset) => isBlankHeader(header[firstMissing + offset]))) return null;
  return missing.map((name, offset) => `${columnLetter(firstMissing + offset)} ("${name}")`);
}

/** Problemas de formato da aba, em português; vazio = formato certo. */
export function tabLayoutProblems(
  tab: SheetTab,
  header: readonly SheetCellValue[] | null,
): string[] {
  const title = COMMERCIAL_SHEET_TABS[tab];
  if (header === null) return [`a aba "${title}" não existe`];
  if (headerMatches(header)) return [];
  const missing = missingHeaderColumns(header);
  if (missing !== null && missing.length > 0) {
    const list =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} e ${missing.at(-1) ?? ''}`;
    return [`faltam na aba "${title}" as colunas ${list}`];
  }
  return [`o cabeçalho da aba "${title}" foi alterado`];
}

/** Problemas de formato da planilha lida; vazio = pode escrever. */
export function layoutProblems(snapshot: SheetSnapshot): string[] {
  return SHEET_TABS.flatMap((tab) =>
    tabLayoutProblems(tab, snapshot[tab] ? (snapshot[tab].rows[0] ?? []) : null),
  );
}
