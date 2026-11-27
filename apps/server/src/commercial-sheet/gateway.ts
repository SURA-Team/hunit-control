/**
 * Porta de entrada da planilha do Comercial (specs/005, research R-03). O resto do servidor só
 * conhece esta interface, com objetos neutros: linhas de células, mudanças e códigos de falha.
 * Duas implementações: a real (API REST do Google Sheets, `google-sheet-gateway.ts`) e a em
 * memória (`memory-sheet-gateway.ts`), usada nos testes e no app de ponta a ponta.
 *
 * Linhas e colunas começam em 0, como na API do Google: a linha 0 é o cabeçalho.
 */
import type { SheetCellValue } from '@hunit/domain';

/**
 * Aba da planilha (FR-009): "A cobrar", "Aguardando validação do Financeiro" (specs/009, research
 * R-06) e "Concluídas", na ordem em que aparecem.
 */
export type SheetTab = 'toCharge' | 'awaitingValidation' | 'done';
export const SHEET_TABS: readonly SheetTab[] = ['toCharge', 'awaitingValidation', 'done'];

export interface SheetTabSnapshot {
  /** Identificador numérico da aba (usado nas escritas). */
  sheetId: number;
  /** Linhas a partir do cabeçalho. Linhas e células vazias no fim podem faltar. */
  rows: SheetCellValue[][];
}

/** A planilha lida de uma vez. `null` = a aba não existe. */
export type SheetSnapshot = Record<SheetTab, SheetTabSnapshot | null>;

/**
 * Uma mudança, com as posições da leitura. O gateway aplica tudo num pedido só e nesta ordem:
 * todas as `update`, depois as `append` (no fim da aba) e por fim as `delete`, da linha de baixo
 * para a de cima — assim as posições da leitura continuam valendo (research R-06).
 */
export type SheetChange =
  | {
      kind: 'update';
      tab: SheetTab;
      rowIndex: number;
      columnIndex: number;
      values: readonly SheetCellValue[];
    }
  | { kind: 'append'; tab: SheetTab; rows: readonly (readonly SheetCellValue[])[] }
  | { kind: 'delete'; tab: SheetTab; rowIndex: number };

/** O que o comando de preparação fez (FR-008a; contracts/cli.md). */
export interface LayoutSetupReport {
  tabsCreated: SheetTab[];
  headersWritten: SheetTab[];
  protectionsAdded: number;
  /** E-mail da conta de serviço com o meio escondido, para a saída do comando. */
  serviceAccountHint: string;
}

/** Formato encontrado na planilha, sem mudar nada (`commercial-sheet check`). */
export interface LayoutInspection {
  tabs: Record<SheetTab, { exists: boolean; headers: SheetCellValue[]; dataRows: number }>;
  protectedTabs: SheetTab[];
  serviceAccountHint: string;
}

export interface CommercialSheetGateway {
  /** Lê as abas inteiras, num pedido só. */
  read(): Promise<SheetSnapshot>;
  /** Aplica as mudanças num pedido só: todas ou nenhuma (ordem: ver `SheetChange`). */
  apply(changes: readonly SheetChange[]): Promise<void>;
  /** Prepara o formato, de forma repetível (FR-008a). */
  setupLayout(): Promise<LayoutSetupReport>;
  /** Confere acesso e formato, sem mudar nada. */
  inspect(): Promise<LayoutInspection>;
}

/** Falhas da planilha, sempre por código (research R-04): nunca a resposta nem o endereço. */
export const SHEET_ERROR_CODES = [
  'sheet_unavailable',
  'sheet_forbidden',
  'sheet_not_found',
  'sheet_layout_invalid',
  'sheet_rate_limited',
] as const;
export type SheetErrorCode = (typeof SHEET_ERROR_CODES)[number];

/** Mensagens genéricas, em português, mostradas no app e na saída do comando (FR-022). */
export const SHEET_ERROR_MESSAGES: Readonly<Record<SheetErrorCode, string>> = {
  sheet_unavailable: 'Planilha do Comercial indisponível. As atualizações ficam pendentes.',
  sheet_forbidden:
    'Sem permissão na planilha do Comercial. Confira se ela está compartilhada com a conta do servidor como editor.',
  sheet_not_found: 'Planilha do Comercial não encontrada. Confira o identificador configurado.',
  sheet_layout_invalid:
    'O formato da planilha do Comercial foi alterado (aba ou cabeçalho). Rode o comando de preparação de novo.',
  sheet_rate_limited:
    'O Google limitou temporariamente os acessos à planilha. Uma nova tentativa é feita sozinha.',
};

export class SheetError extends Error {
  constructor(
    readonly code: SheetErrorCode,
    /** Status HTTP da resposta, quando houve resposta. */
    readonly status: number | null = null,
  ) {
    super(SHEET_ERROR_MESSAGES[code]);
    this.name = 'SheetError';
  }
}

/** "contaservico@projeto.iam.gserviceaccount.com" → "co…@….iam.gserviceaccount.com". */
export function maskServiceAccount(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  const domainParts = domain.split('.');
  const suffix = domainParts.slice(1).join('.');
  return `${user.slice(0, 2)}…@…${suffix ? `.${suffix}` : ''}`;
}
