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

/** O cabeçalho da aba é exatamente o esperado? (Colunas a mais depois da N são toleradas.) */
export function headerMatches(header: readonly SheetCellValue[] | undefined): boolean {
  return COMMERCIAL_SHEET_HEADERS.every((name, index) => header?.[index] === name);
}

/** Problemas de formato da aba, em português; vazio = formato certo. */
export function tabLayoutProblems(
  tab: SheetTab,
  header: readonly SheetCellValue[] | null,
): string[] {
  const title = COMMERCIAL_SHEET_TABS[tab];
  if (header === null) return [`a aba "${title}" não existe`];
  return headerMatches(header) ? [] : [`o cabeçalho da aba "${title}" foi alterado`];
}

/** Problemas de formato da planilha lida; vazio = pode escrever. */
export function layoutProblems(snapshot: SheetSnapshot): string[] {
  return SHEET_TABS.flatMap((tab) =>
    tabLayoutProblems(tab, snapshot[tab] ? (snapshot[tab].rows[0] ?? []) : null),
  );
}
