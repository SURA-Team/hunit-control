/**
 * Planilha do Comercial no Google Sheets (specs/005, research R-03, R-04, R-05): API REST v4 por
 * `fetch`, com o token da conta de serviço obtido pela `google-auth-library`.
 *
 * Segurança (FR-022, SC-009): toda falha vira um `SheetError` com o código e o status HTTP. Este
 * arquivo **nunca** repassa nem registra a resposta, o endereço chamado, o objeto de erro da
 * biblioteca ou o token — eles podem conter o identificador da planilha e credenciais.
 */
import {
  COMMERCIAL_SHEET_HEADERS,
  COMMERCIAL_SHEET_TABS,
  SYSTEM_COLUMN_COUNT,
  type SheetCellValue,
} from '@hunit/domain';
import { JWT } from 'google-auth-library';
import {
  maskServiceAccount,
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
import type { ServiceAccountKey } from './key.js';
import {
  appearanceRequests,
  COLUMN_COUNT,
  dataCellFormat,
  LAST_COLUMN_LETTER,
} from './sheet-appearance.js';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const DEFAULT_TIMEOUT_MS = 30_000;
/** Última coluna da planilha (P = 16 colunas, specs/008). */
const LAST_COLUMN = LAST_COLUMN_LETTER;

/** O que o comando de preparação lê da planilha: abas, proteções e formatação condicional. */
const SETUP_FIELDS =
  'sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description),conditionalFormats)';

/** Descrições das proteções criadas pelo comando, para não duplicar ao rodar de novo. */
export const PROTECTION_DESCRIPTIONS = {
  systemColumns: 'HUNIT Control: colunas do sistema',
  header: 'HUNIT Control: cabeçalho',
  done: 'HUNIT Control: aba Concluídas',
  // specs/009: a aba "Aguardando validação do Financeiro" é só para consulta, como "Concluídas".
  awaitingValidation: 'HUNIT Control: aba Aguardando validação do Financeiro',
} as const;

/** Proteção que marca cada aba como preparada (a da aba inteira, menos em "A cobrar"). */
const TAB_PROTECTION: Readonly<Record<SheetTab, string>> = {
  toCharge: PROTECTION_DESCRIPTIONS.systemColumns,
  awaitingValidation: PROTECTION_DESCRIPTIONS.awaitingValidation,
  done: PROTECTION_DESCRIPTIONS.done,
};

const EMPTY_SNAPSHOT = (): SheetSnapshot => ({
  toCharge: null,
  awaitingValidation: null,
  done: null,
});

export interface GoogleSheetGatewayOptions {
  spreadsheetId: string;
  key: ServiceAccountKey;
  /** Só para os testes: `fetch` falso, sem rede. */
  fetch?: typeof fetch;
  /** Só para os testes: token sem passar pela `google-auth-library`. */
  getAccessToken?: () => Promise<string>;
  timeoutMs?: number;
  baseUrl?: string;
}

interface SheetProperties {
  sheetId: number;
  title: string;
}

interface SpreadsheetMeta {
  sheets?: Array<{
    properties?: SheetProperties;
    protectedRanges?: Array<{ protectedRangeId?: number; description?: string }>;
    conditionalFormats?: unknown[];
  }>;
}

/** Status HTTP → código (research R-04). */
export function codeForStatus(status: number): SheetErrorCode {
  if (status === 401 || status === 403) return 'sheet_forbidden';
  if (status === 404) return 'sheet_not_found';
  if (status === 429) return 'sheet_rate_limited';
  // 400 numa planilha que estava certa = alguém mudou abas ou linhas no meio da rodada.
  if (status === 400) return 'sheet_layout_invalid';
  return 'sheet_unavailable';
}

/** Célula no formato da API (`CellData`). Vazia = sem valor (limpa a célula). */
function cellData(value: SheetCellValue): Record<string, unknown> {
  if (typeof value === 'string') {
    return value === '' ? {} : { userEnteredValue: { stringValue: value } };
  }
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return {};
}

function rowData(values: readonly SheetCellValue[]) {
  return { values: values.map(cellData) };
}

/**
 * Linha acrescentada: as 16 células, cada uma com as bordas e o formato da coluna (FR-010a). As
 * bordas não podem ser condicionais, então a linha nova já sai com elas (research R-18).
 */
function appendedRowData(values: readonly SheetCellValue[]) {
  return {
    values: Array.from({ length: COLUMN_COUNT }, (_unused, column) => ({
      ...cellData(values[column] ?? ''),
      userEnteredFormat: dataCellFormat(column),
    })),
  };
}

const quoteTitle = (title: string) => `'${title.replaceAll("'", "''")}'`;

export class GoogleSheetGateway implements CommercialSheetGateway {
  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private jwt: JWT | null = null;
  private sheetIds = new Map<SheetTab, number>();

  constructor(private readonly options: GoogleSheetGatewayOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = `${options.baseUrl ?? DEFAULT_BASE_URL}/${encodeURIComponent(options.spreadsheetId)}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async read(): Promise<SheetSnapshot> {
    const tabs = await this.loadTabs('sheets.properties(sheetId,title)');
    const existing = SHEET_TABS.filter((tab) => tabs.has(tab));
    if (existing.length === 0) return EMPTY_SNAPSHOT();

    const rows = await this.batchGet(
      existing.map((tab) => `${quoteTitle(COMMERCIAL_SHEET_TABS[tab])}!A1:${LAST_COLUMN}`),
    );
    const snapshot = EMPTY_SNAPSHOT();
    existing.forEach((tab, index) => {
      const sheetId = tabs.get(tab)?.sheetId;
      if (sheetId === undefined) return;
      snapshot[tab] = { sheetId, rows: rows[index] ?? [] };
    });
    return snapshot;
  }

  async apply(changes: readonly SheetChange[]): Promise<void> {
    if (changes.length === 0) return;
    if (this.sheetIds.size === 0) await this.loadTabs('sheets.properties(sheetId,title)');
    const sheetIdOf = (tab: SheetTab) => {
      const id = this.sheetIds.get(tab);
      if (id === undefined) throw new SheetError('sheet_layout_invalid', null);
      return id;
    };

    const requests: unknown[] = [];
    for (const change of changes) {
      if (change.kind !== 'update') continue;
      requests.push({
        updateCells: {
          start: {
            sheetId: sheetIdOf(change.tab),
            rowIndex: change.rowIndex,
            columnIndex: change.columnIndex,
          },
          rows: [rowData(change.values)],
          fields: 'userEnteredValue',
        },
      });
    }
    for (const change of changes) {
      if (change.kind !== 'append') continue;
      requests.push({
        appendCells: {
          sheetId: sheetIdOf(change.tab),
          rows: change.rows.map(appendedRowData),
          fields: 'userEnteredValue,userEnteredFormat',
        },
      });
    }
    const deletes = changes
      .filter(
        (change): change is Extract<SheetChange, { kind: 'delete' }> => change.kind === 'delete',
      )
      .sort((a, b) => b.rowIndex - a.rowIndex);
    for (const change of deletes) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId: sheetIdOf(change.tab),
            dimension: 'ROWS',
            startIndex: change.rowIndex,
            endIndex: change.rowIndex + 1,
          },
        },
      });
    }
    await this.batchUpdate(requests);
  }

  async setupLayout(): Promise<LayoutSetupReport> {
    let meta = await this.loadMeta(SETUP_FIELDS);
    const tabsCreated = SHEET_TABS.filter((tab) => !this.sheetIds.has(tab));
    if (tabsCreated.length > 0) {
      await this.batchUpdate(
        // Na posição da aba na ordem (a nova fica entre "A cobrar" e "Concluídas", specs/009).
        tabsCreated.map((tab) => ({
          addSheet: {
            properties: { title: COMMERCIAL_SHEET_TABS[tab], index: SHEET_TABS.indexOf(tab) },
          },
        })),
      );
      meta = await this.loadMeta(SETUP_FIELDS);
    }

    // A aba inteira: o cabeçalho e quantas linhas de dados recebem as bordas.
    const contents = await this.batchGet(
      SHEET_TABS.map((tab) => `${quoteTitle(COMMERCIAL_SHEET_TABS[tab])}!A1:${LAST_COLUMN}`),
    );
    const existingProtections = new Set(
      (meta.sheets ?? []).flatMap((sheet) =>
        (sheet.protectedRanges ?? []).map(
          (range) => `${sheet.properties?.sheetId}:${range.description ?? ''}`,
        ),
      ),
    );
    const editors = { users: [this.options.key.clientEmail] };
    const requests: unknown[] = [
      {
        updateSpreadsheetProperties: {
          properties: { locale: 'pt_BR', timeZone: 'America/Sao_Paulo' },
          fields: 'locale,timeZone',
        },
      },
    ];
    const headersWritten: SheetTab[] = [];
    let protectionsAdded = 0;

    SHEET_TABS.forEach((tab, index) => {
      const sheetId = this.sheetIds.get(tab);
      if (sheetId === undefined) return;
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
      const rows = contents[index] ?? [];
      const header = rows[0] ?? [];
      if (COMMERCIAL_SHEET_HEADERS.some((name, column) => header[column] !== name)) {
        headersWritten.push(tab);
        requests.push({
          updateCells: {
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
            rows: [rowData(COMMERCIAL_SHEET_HEADERS)],
            fields: 'userEnteredValue',
          },
        });
      }
      // Formatos das colunas, cabeçalho, bordas e cores (FR-010a; research R-18).
      const sheet = meta.sheets?.find((candidate) => candidate.properties?.sheetId === sheetId);
      requests.push(
        ...appearanceRequests({
          sheetId,
          dataRows: Math.max(rows.length - 1, 0),
          conditionalRuleCount: sheet?.conditionalFormats?.length ?? 0,
        }),
      );

      const protect = (description: string, range: Record<string, number>) => {
        if (existingProtections.has(`${sheetId}:${description}`)) return;
        protectionsAdded += 1;
        requests.push({
          addProtectedRange: {
            protectedRange: {
              range: { sheetId, ...range },
              description,
              warningOnly: false,
              editors,
            },
          },
        });
      };
      if (tab === 'toCharge') {
        protect(PROTECTION_DESCRIPTIONS.systemColumns, {
          startColumnIndex: 0,
          endColumnIndex: SYSTEM_COLUMN_COUNT,
        });
        protect(PROTECTION_DESCRIPTIONS.header, { startRowIndex: 0, endRowIndex: 1 });
      } else {
        // "Concluídas" e "Aguardando validação do Financeiro": a aba inteira (specs/009, FR-012).
        protect(TAB_PROTECTION[tab], {});
      }
    });
    await this.batchUpdate(requests);

    return {
      tabsCreated,
      headersWritten,
      protectionsAdded,
      serviceAccountHint: maskServiceAccount(this.options.key.clientEmail),
    };
  }

  async inspect(): Promise<LayoutInspection> {
    const meta = await this.loadMeta(
      'sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description))',
    );
    const existing = SHEET_TABS.filter((tab) => this.sheetIds.has(tab));
    const rows = existing.length
      ? await this.batchGet(
          existing.map((tab) => `${quoteTitle(COMMERCIAL_SHEET_TABS[tab])}!A1:${LAST_COLUMN}`),
        )
      : [];
    const describe = (tab: SheetTab) => {
      const index = existing.indexOf(tab);
      const tabRows = index >= 0 ? (rows[index] ?? []) : [];
      return {
        exists: index >= 0,
        headers: tabRows[0] ?? [],
        dataRows: Math.max(tabRows.length - 1, 0),
      };
    };
    const protectedTabs = SHEET_TABS.filter((tab) => {
      const sheetId = this.sheetIds.get(tab);
      const sheet = meta.sheets?.find((candidate) => candidate.properties?.sheetId === sheetId);
      return (sheet?.protectedRanges ?? []).some(
        (range) => range.description === TAB_PROTECTION[tab],
      );
    });
    return {
      tabs: {
        toCharge: describe('toCharge'),
        awaitingValidation: describe('awaitingValidation'),
        done: describe('done'),
      },
      protectedTabs,
      serviceAccountHint: maskServiceAccount(this.options.key.clientEmail),
    };
  }

  // --- HTTP -------------------------------------------------------------------------------

  private async loadMeta(fields: string): Promise<SpreadsheetMeta> {
    const meta = await this.request<SpreadsheetMeta>(
      'GET',
      `?fields=${encodeURIComponent(fields)}`,
    );
    this.sheetIds = new Map();
    for (const sheet of meta.sheets ?? []) {
      const properties = sheet.properties;
      if (!properties) continue;
      const tab = SHEET_TABS.find(
        (candidate) => COMMERCIAL_SHEET_TABS[candidate] === properties.title,
      );
      if (tab) this.sheetIds.set(tab, properties.sheetId);
    }
    return meta;
  }

  private async loadTabs(fields: string): Promise<Map<SheetTab, SheetProperties>> {
    await this.loadMeta(fields);
    return new Map(
      [...this.sheetIds].map(([tab, sheetId]) => [
        tab,
        { sheetId, title: COMMERCIAL_SHEET_TABS[tab] },
      ]),
    );
  }

  private async batchGet(ranges: readonly string[]): Promise<SheetCellValue[][][]> {
    const query = [
      ...ranges.map((range) => `ranges=${encodeURIComponent(range)}`),
      'valueRenderOption=UNFORMATTED_VALUE',
      'majorDimension=ROWS',
    ].join('&');
    const body = await this.request<{ valueRanges?: Array<{ values?: SheetCellValue[][] }> }>(
      'GET',
      `/values:batchGet?${query}`,
    );
    return ranges.map((_range, index) => body.valueRanges?.[index]?.values ?? []);
  }

  private async batchUpdate(requests: readonly unknown[]): Promise<void> {
    if (requests.length === 0) return;
    await this.request('POST', ':batchUpdate', { requests });
  }

  private async accessToken(): Promise<string> {
    if (this.options.getAccessToken) return this.options.getAccessToken();
    this.jwt ??= new JWT({
      email: this.options.key.clientEmail,
      key: this.options.key.privateKey,
      scopes: [SHEETS_SCOPE],
    });
    const { token } = await this.jwt.getAccessToken();
    if (!token) throw new SheetError('sheet_forbidden', null);
    return token;
  }

  /**
   * Um pedido à API. Qualquer falha vira `SheetError` — sem a resposta, sem o endereço e sem o
   * erro original (research R-04).
   */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let token: string;
    try {
      token = await this.accessToken();
    } catch (error) {
      if (error instanceof SheetError) throw error;
      // Chave recusada pelo Google (400/401 na troca do token) ou falha de rede.
      const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
      throw new SheetError(
        status === 400 || status === 401 ? 'sheet_forbidden' : 'sheet_unavailable',
        typeof status === 'number' ? status : null,
      );
    }

    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new SheetError('sheet_unavailable', null);
    }
    if (!response.ok) {
      // O corpo do erro pode trazer o identificador da planilha: é descartado sem ler.
      await response.body?.cancel().catch(() => undefined);
      throw new SheetError(codeForStatus(response.status), response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new SheetError('sheet_unavailable', response.status);
    }
  }
}
