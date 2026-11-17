/**
 * Planilha do Comercial em memória (specs/005, research R-16): mesma semântica de leitura e de
 * escrita da real (`SheetChange`), para os testes do servidor e o app de ponta a ponta. Permite
 * editar como o Comercial (só as colunas de retorno), mexer como o dono do arquivo (qualquer
 * célula), simular falhas e simular uma edição entre a leitura e a escrita de uma rodada.
 */
import { COMMERCIAL_SHEET_HEADERS, SYSTEM_COLUMN_COUNT, type SheetCellValue } from '@hunit/domain';
import {
  SHEET_TABS,
  SheetError,
  type CommercialSheetGateway,
  type LayoutInspection,
  type LayoutSetupReport,
  type SheetChange,
  type SheetErrorCode,
  type SheetSnapshot,
  type SheetTab,
} from './gateway.js';

interface MemoryTab {
  sheetId: number;
  rows: SheetCellValue[][];
  protectedSystemColumns: boolean;
}

const SERVICE_ACCOUNT = 'conta-de-teste@projeto-ficticio.iam.gserviceaccount.com';

/** Como a planilha real, a falha chega como promessa rejeitada (nunca como exceção na hora). */
function settle<T>(run: () => T): Promise<T> {
  return Promise.resolve().then(run);
}

function clone(rows: readonly (readonly SheetCellValue[])[]): SheetCellValue[][] {
  return rows.map((row) => [...row]);
}

export class MemorySheetGateway implements CommercialSheetGateway {
  private tabs = new Map<SheetTab, MemoryTab>();
  private nextSheetId = 100;
  private failures: SheetErrorCode[] = [];
  private failing: SheetErrorCode | null = null;
  private rawFailure: Error | undefined = undefined;
  /** Chamado entre a leitura e a escrita de uma rodada (edição simultânea do Comercial). */
  beforeApply: (() => void) | null = null;
  reads = 0;
  applies = 0;

  /** Planilha já preparada pelo comando (`setupLayout`)? Padrão: sim. */
  constructor(options: { prepared?: boolean } = {}) {
    if (options.prepared !== false) {
      for (const tab of SHEET_TABS) this.createTab(tab);
    }
  }

  // --- CommercialSheetGateway -----------------------------------------------------------

  read(): Promise<SheetSnapshot> {
    return settle(() => this.readNow());
  }

  apply(changes: readonly SheetChange[]): Promise<void> {
    return settle(() => this.applyNow(changes));
  }

  setupLayout(): Promise<LayoutSetupReport> {
    return settle(() => this.setupLayoutNow());
  }

  inspect(): Promise<LayoutInspection> {
    return settle(() => this.inspectNow());
  }

  private readNow(): SheetSnapshot {
    this.throwIfFailing();
    this.reads += 1;
    const snapshot = (tab: SheetTab) => {
      const found = this.tabs.get(tab);
      return found ? { sheetId: found.sheetId, rows: clone(found.rows) } : null;
    };
    return { toCharge: snapshot('toCharge'), done: snapshot('done') };
  }

  private applyNow(changes: readonly SheetChange[]): void {
    this.beforeApply?.();
    this.throwIfFailing();
    this.applies += 1;
    // Todas ou nenhuma: aplica numa cópia e só então troca.
    const working = new Map(
      [...this.tabs].map(([tab, value]) => [tab, { ...value, rows: clone(value.rows) }]),
    );
    const tabOf = (tab: SheetTab) => {
      const found = working.get(tab);
      if (!found) throw new SheetError('sheet_layout_invalid', 400);
      return found;
    };

    for (const change of changes) {
      if (change.kind !== 'update') continue;
      const rows = tabOf(change.tab).rows;
      const row = rows[change.rowIndex];
      if (!row) throw new SheetError('sheet_unavailable', 400);
      change.values.forEach((value, offset) => {
        row[change.columnIndex + offset] = value;
      });
    }
    for (const change of changes) {
      if (change.kind === 'append') tabOf(change.tab).rows.push(...clone(change.rows));
    }
    const deletes = changes
      .filter(
        (change): change is Extract<SheetChange, { kind: 'delete' }> => change.kind === 'delete',
      )
      .sort((a, b) => b.rowIndex - a.rowIndex);
    for (const change of deletes) {
      const rows = tabOf(change.tab).rows;
      if (change.rowIndex < 1 || change.rowIndex >= rows.length) {
        throw new SheetError('sheet_unavailable', 400);
      }
      rows.splice(change.rowIndex, 1);
    }

    this.tabs = working;
  }

  private setupLayoutNow(): LayoutSetupReport {
    this.throwIfFailing();
    const tabsCreated: SheetTab[] = [];
    const headersWritten: SheetTab[] = [];
    let protectionsAdded = 0;
    for (const tab of SHEET_TABS) {
      if (!this.tabs.has(tab)) {
        this.createTab(tab);
        tabsCreated.push(tab);
      }
      const found = this.tabs.get(tab);
      if (!found) continue;
      const header = found.rows[0] ?? [];
      if (COMMERCIAL_SHEET_HEADERS.some((name, index) => header[index] !== name)) {
        found.rows[0] = [...COMMERCIAL_SHEET_HEADERS];
        headersWritten.push(tab);
      }
      if (!found.protectedSystemColumns) {
        found.protectedSystemColumns = true;
        protectionsAdded += 1;
      }
    }
    return {
      tabsCreated,
      headersWritten,
      protectionsAdded,
      serviceAccountHint: 'co…@….iam.gserviceaccount.com',
    };
  }

  private inspectNow(): LayoutInspection {
    this.throwIfFailing();
    const describe = (tab: SheetTab) => {
      const found = this.tabs.get(tab);
      return {
        exists: found !== undefined,
        headers: found?.rows[0] ? [...found.rows[0]] : [],
        dataRows: Math.max((found?.rows.length ?? 1) - 1, 0),
      };
    };
    return {
      tabs: { toCharge: describe('toCharge'), done: describe('done') },
      protectedTabs: SHEET_TABS.filter((tab) => this.tabs.get(tab)?.protectedSystemColumns),
      serviceAccountHint: 'co…@….iam.gserviceaccount.com',
    };
  }

  // --- Ferramentas dos testes ------------------------------------------------------------

  /** E-mail da conta de serviço fictícia. */
  get serviceAccount(): string {
    return SERVICE_ACCOUNT;
  }

  /** As próximas chamadas falham com estes códigos, uma por chamada. */
  failNext(...codes: SheetErrorCode[]): void {
    this.failures.push(...codes);
  }

  /** Todas as chamadas falham com o código (`null` = volta a funcionar). */
  setFailing(code: SheetErrorCode | null): void {
    this.failing = code;
  }

  /**
   * A próxima chamada lança este erro como veio (ex.: um erro cru da biblioteca do Google, com o
   * ID da planilha na mensagem), para os testes de que nada sensível sai do servidor (SC-009).
   */
  failNextWith(error: Error): void {
    this.rawFailure = error;
  }

  /** Linhas de dados da aba (sem o cabeçalho). */
  rows(tab: SheetTab): SheetCellValue[][] {
    return clone(this.tabs.get(tab)?.rows.slice(1) ?? []);
  }

  /** Cabeçalho da aba. */
  header(tab: SheetTab): SheetCellValue[] {
    return [...(this.tabs.get(tab)?.rows[0] ?? [])];
  }

  /** Índice (na aba, com o cabeçalho na linha 0) da linha da reserva, ou -1. */
  rowIndexOf(tab: SheetTab, hotelName: string, reservationNumber: string): number {
    const rows = this.tabs.get(tab)?.rows ?? [];
    return rows.findIndex(
      (row, index) => index > 0 && row[0] === hotelName && row[1] === reservationNumber,
    );
  }

  /**
   * O Comercial preenche as colunas de retorno (K a N) de uma linha. Recusa escrever nas colunas
   * do sistema e na aba "Concluídas", como as proteções da planilha real (FR-011).
   */
  fillReturn(hotelName: string, reservationNumber: string, cells: readonly SheetCellValue[]): void {
    const index = this.rowIndexOf('toCharge', hotelName, reservationNumber);
    if (index < 0)
      throw new Error(`Linha ${hotelName} ${reservationNumber} não está em "A cobrar".`);
    const row = this.tabs.get('toCharge')?.rows[index];
    if (!row) return;
    while (row.length < SYSTEM_COLUMN_COUNT) row.push('');
    cells.forEach((value, offset) => {
      row[SYSTEM_COLUMN_COUNT + offset] = value;
    });
  }

  /** O dono do arquivo (ou alguém sem as proteções) muda qualquer célula. */
  setCell(tab: SheetTab, rowIndex: number, columnIndex: number, value: SheetCellValue): void {
    const row = this.tabs.get(tab)?.rows[rowIndex];
    if (!row) throw new Error(`Linha ${rowIndex} não existe.`);
    row[columnIndex] = value;
  }

  /** Apaga uma linha (índice com o cabeçalho na linha 0). */
  deleteRow(tab: SheetTab, rowIndex: number): void {
    this.tabs.get(tab)?.rows.splice(rowIndex, 1);
  }

  /** Acrescenta uma linha no fim, como se alguém a digitasse ou colasse. */
  appendRow(tab: SheetTab, row: readonly SheetCellValue[]): void {
    this.tabs.get(tab)?.rows.push([...row]);
  }

  /** Renomeia a aba (o formato deixa de valer). */
  removeTab(tab: SheetTab): void {
    this.tabs.delete(tab);
  }

  private createTab(tab: SheetTab): void {
    this.tabs.set(tab, {
      sheetId: (this.nextSheetId += 1),
      rows: [[...COMMERCIAL_SHEET_HEADERS]],
      protectedSystemColumns: true,
    });
  }

  private throwIfFailing(): void {
    if (this.rawFailure !== undefined) {
      const raw = this.rawFailure;
      this.rawFailure = undefined;
      throw raw;
    }
    const next = this.failures.shift();
    if (next) throw new SheetError(next, null);
    if (this.failing) throw new SheetError(this.failing, null);
  }
}
