/**
 * Planilha do Comercial: gateway em memória (T020), chave da conta de serviço (T021) e o
 * adaptador do Google Sheets com `fetch` falso, sem rede (T022) — specs/005, research R-03, R-04.
 */
import { COMMERCIAL_SHEET_HEADERS } from '@hunit/domain';
import { describe, expect, it } from 'vitest';
import { maskServiceAccount, SheetError } from '../../src/commercial-sheet/gateway.js';
import {
  codeForStatus,
  GoogleSheetGateway,
  PROTECTION_DESCRIPTIONS,
} from '../../src/commercial-sheet/google-sheet-gateway.js';
import { parseServiceAccountKey, ServiceAccountKeyError } from '../../src/commercial-sheet/key.js';
import { layoutProblems } from '../../src/commercial-sheet/layout.js';
import { MemorySheetGateway } from '../../src/commercial-sheet/memory-sheet-gateway.js';
import {
  colorStyle,
  COLUMN_COUNT,
  dataCellFormat,
  SHEET_COLORS,
  STRIPE_FORMULA,
} from '../../src/commercial-sheet/sheet-appearance.js';
import { SecretRegistry } from '../../src/secrets.js';

const SECRET = 'CHAVE-DA-PLANILHA-MARCADOR-SECRETO';
const SHEET_ID = `planilha_${SECRET}_0123456789`;
const KEY = {
  clientEmail: 'conta-de-teste@projeto-ficticio.iam.gserviceaccount.com',
  privateKey: `-----BEGIN PRIVATE KEY-----\n${SECRET}\n-----END PRIVATE KEY-----\n`,
};

describe('MemorySheetGateway (T020)', () => {
  it('aplica updates, depois appends e por fim deletes de baixo para cima', async () => {
    const sheet = new MemorySheetGateway();
    sheet.appendRow('toCharge', ['H', '1']);
    sheet.appendRow('toCharge', ['H', '2']);
    sheet.appendRow('toCharge', ['H', '3']);

    await sheet.apply([
      { kind: 'delete', tab: 'toCharge', rowIndex: 1 },
      { kind: 'update', tab: 'toCharge', rowIndex: 3, columnIndex: 1, values: ['3b'] },
      { kind: 'append', tab: 'toCharge', rows: [['H', '4']] },
      { kind: 'delete', tab: 'toCharge', rowIndex: 2 },
    ]);
    expect(sheet.rows('toCharge')).toEqual([
      ['H', '3b'],
      ['H', '4'],
    ]);
  });

  it('falha simulada não muda nada (todas ou nenhuma)', async () => {
    const sheet = new MemorySheetGateway();
    sheet.failNext('sheet_unavailable');
    await expect(
      sheet.apply([{ kind: 'append', tab: 'toCharge', rows: [['H', '1']] }]),
    ).rejects.toMatchObject({ code: 'sheet_unavailable' });
    expect(sheet.rows('toCharge')).toEqual([]);
  });

  it('o Comercial só escreve nas colunas de retorno de "A cobrar"', () => {
    const sheet = new MemorySheetGateway();
    sheet.appendRow('toCharge', ['Hotel Homologação Um', '900001']);
    sheet.fillReturn('Hotel Homologação Um', '900001', ['AUT1', 'Maquininha', 10, 'Fulano']);
    expect(sheet.rows('toCharge')[0]?.slice(10)).toEqual(['AUT1', 'Maquininha', 10, 'Fulano']);
  });

  it('o formato confere abas e cabeçalhos', async () => {
    const sheet = new MemorySheetGateway();
    expect(layoutProblems(await sheet.read())).toEqual([]);
    sheet.setCell('done', 0, 7, 'Status');
    sheet.removeTab('toCharge');
    expect(layoutProblems(await sheet.read())).toEqual([
      'a aba "A cobrar" não existe',
      'o cabeçalho da aba "Concluídas" foi alterado',
    ]);
  });
});

describe('chave da conta de serviço (T021)', () => {
  const content = JSON.stringify({
    type: 'service_account',
    client_email: KEY.clientEmail,
    private_key: KEY.privateKey,
    private_key_id: `id-${SECRET}`,
  });

  it('lê a chave e registra os valores sensíveis e o ID da planilha', () => {
    const secrets = new SecretRegistry();
    expect(parseServiceAccountKey(content, secrets, SHEET_ID)).toEqual(KEY);
    expect(secrets.scrub(`x ${SHEET_ID} ${KEY.clientEmail} id-${SECRET}`)).not.toContain(SECRET);
    expect(secrets.scrub(KEY.clientEmail)).toBe('[REDACTED]');
  });

  it('recusa o que não é chave de conta de serviço, sem citar o conteúdo', () => {
    for (const bad of ['não é json', JSON.stringify({ type: 'authorized_user' })]) {
      const error = (() => {
        try {
          parseServiceAccountKey(bad, new SecretRegistry(), SHEET_ID);
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(ServiceAccountKeyError);
      expect((error as Error).message).not.toContain('json');
    }
  });

  it('o e-mail da conta aparece só mascarado', () => {
    expect(maskServiceAccount(KEY.clientEmail)).toBe('co…@….iam.gserviceaccount.com');
  });
});

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

/** `fetch` falso: responde em ordem e grava os pedidos. */
function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Recorded[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(next.body ?? { error: { message: `planilha ${SHEET_ID}` } }), {
        status: next.status,
      }),
    );
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const META = {
  sheets: [
    { properties: { sheetId: 11, title: 'A cobrar' } },
    { properties: { sheetId: 22, title: 'Concluídas' } },
  ],
};

function gateway(fetch: typeof globalThis.fetch) {
  return new GoogleSheetGateway({
    spreadsheetId: SHEET_ID,
    key: KEY,
    fetch,
    getAccessToken: () => Promise.resolve('token-de-teste'),
  });
}

describe('GoogleSheetGateway (T022)', () => {
  it('lê as duas abas num batchGet, com UNFORMATTED_VALUE', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: META },
      {
        status: 200,
        body: { valueRanges: [{ values: [[...COMMERCIAL_SHEET_HEADERS], ['H', '1']] }, {}] },
      },
    ]);
    const snapshot = await gateway(fetch).read();

    expect(snapshot.toCharge).toEqual({
      sheetId: 11,
      rows: [[...COMMERCIAL_SHEET_HEADERS], ['H', '1']],
    });
    expect(snapshot.done).toEqual({ sheetId: 22, rows: [] });
    const batchGet = decodeURIComponent(calls[1]?.url ?? '');
    expect(batchGet).toContain("ranges='A cobrar'!A1:P");
    expect(batchGet).toContain("ranges='Concluídas'!A1:P");
    expect(batchGet).toContain('valueRenderOption=UNFORMATTED_VALUE');
  });

  it('monta um único batchUpdate: updates, appends e deletes de baixo para cima', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: META },
      { status: 200, body: {} },
    ]);
    await gateway(fetch).apply([
      { kind: 'delete', tab: 'toCharge', rowIndex: 2 },
      { kind: 'append', tab: 'done', rows: [['H', '1', '', 10]] },
      { kind: 'update', tab: 'toCharge', rowIndex: 4, columnIndex: 9, values: ['texto'] },
      { kind: 'delete', tab: 'toCharge', rowIndex: 5 },
    ]);

    const update = calls[1];
    expect(update?.method).toBe('POST');
    expect(update?.url.endsWith(':batchUpdate')).toBe(true);
    const requests = (update?.body as { requests: Array<Record<string, unknown>> }).requests;
    expect(requests.map((request) => Object.keys(request)[0])).toEqual([
      'updateCells',
      'appendCells',
      'deleteDimension',
      'deleteDimension',
    ]);
    // Linha acrescentada: as 14 células, com as bordas e o formato de cada coluna (FR-010a).
    const blank = (column: number) => ({ userEnteredFormat: dataCellFormat(column) });
    expect(requests[1]).toEqual({
      appendCells: {
        sheetId: 22,
        rows: [
          {
            values: [
              { userEnteredValue: { stringValue: 'H' }, userEnteredFormat: dataCellFormat(0) },
              { userEnteredValue: { stringValue: '1' }, userEnteredFormat: dataCellFormat(1) },
              blank(2),
              { userEnteredValue: { numberValue: 10 }, userEnteredFormat: dataCellFormat(3) },
              ...Array.from({ length: COLUMN_COUNT - 4 }, (_unused, offset) => blank(offset + 4)),
            ],
          },
        ],
        fields: 'userEnteredValue,userEnteredFormat',
      },
    });
    // Atualizações escrevem só o valor e mantêm o formato.
    expect(requests[0]).toMatchObject({ updateCells: { fields: 'userEnteredValue' } });
    expect(requests[2]).toMatchObject({
      deleteDimension: { range: { startIndex: 5, endIndex: 6 } },
    });
    expect(requests[3]).toMatchObject({
      deleteDimension: { range: { startIndex: 2, endIndex: 3 } },
    });
  });

  it.each([
    [401, 'sheet_forbidden'],
    [403, 'sheet_forbidden'],
    [404, 'sheet_not_found'],
    [429, 'sheet_rate_limited'],
    [400, 'sheet_layout_invalid'],
    [500, 'sheet_unavailable'],
    [503, 'sheet_unavailable'],
  ])('status %i vira %s, sem nada da resposta nem do endereço', async (status, code) => {
    expect(codeForStatus(status)).toBe(code);
    const { fetch } = fakeFetch([{ status }]);
    const error = await gateway(fetch)
      .read()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SheetError);
    expect(error).toMatchObject({ code, status });
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect(String((error as Error).stack)).not.toContain(SECRET);
  });

  it('falha de rede e tempo esgotado viram sheet_unavailable', async () => {
    const failing = (() =>
      Promise.reject(new Error(`conexão recusada em ${SHEET_ID}`))) as typeof globalThis.fetch;
    const error = await gateway(failing)
      .read()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'sheet_unavailable', status: null });
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect((error as Error).cause).toBeUndefined();
  });

  it('chave recusada pelo Google na troca do token vira sheet_forbidden', async () => {
    const sheet = new GoogleSheetGateway({
      spreadsheetId: SHEET_ID,
      key: KEY,
      fetch: fakeFetch([]).fetch,
      getAccessToken: () =>
        Promise.reject(Object.assign(new Error(SECRET), { response: { status: 400 } })),
    });
    const error = await sheet.read().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'sheet_forbidden' });
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it('a preparação cria as abas que faltam, grava os cabeçalhos e protege uma vez só', async () => {
    const existingMeta = {
      sheets: [
        {
          properties: { sheetId: 11, title: 'A cobrar' },
          protectedRanges: [
            { protectedRangeId: 1, description: PROTECTION_DESCRIPTIONS.systemColumns },
          ],
          conditionalFormats: [{}, {}],
        },
      ],
    };
    const afterAdd = {
      sheets: [
        existingMeta.sheets[0],
        {
          properties: { sheetId: 33, title: 'Aguardando validação do Financeiro' },
          protectedRanges: [],
        },
        { properties: { sheetId: 22, title: 'Concluídas' }, protectedRanges: [] },
      ],
    };
    const { fetch, calls } = fakeFetch([
      { status: 200, body: existingMeta },
      { status: 200, body: {} }, // addSheet
      { status: 200, body: afterAdd },
      { status: 200, body: { valueRanges: [{ values: [[...COMMERCIAL_SHEET_HEADERS]] }, {}, {}] } },
      { status: 200, body: {} }, // formatação e proteções
    ]);
    const report = await gateway(fetch).setupLayout();

    expect(report).toEqual({
      tabsCreated: ['awaitingValidation', 'done'],
      headersWritten: ['awaitingValidation', 'done'],
      protectionsAdded: 3,
      serviceAccountHint: 'co…@….iam.gserviceaccount.com',
    });
    // A aba nova entre "A cobrar" e "Concluídas" (specs/009, research R-06).
    const addSheet = calls[1]?.body as { requests: unknown[] };
    expect(addSheet.requests).toEqual([
      { addSheet: { properties: { title: 'Aguardando validação do Financeiro', index: 1 } } },
      { addSheet: { properties: { title: 'Concluídas', index: 2 } } },
    ]);
    const format = calls[4]?.body as {
      requests: Array<
        Record<
          string,
          {
            protectedRange?: {
              editors: unknown;
              description: string;
              range: Record<string, number>;
            };
          }
        >
      >;
    };
    const protections = format.requests.filter((request) => 'addProtectedRange' in request);
    expect(protections).toHaveLength(3);
    // A aba nova é protegida inteira, como "Concluídas" (FR-012).
    expect(
      protections.find(
        (request) =>
          request['addProtectedRange']?.protectedRange?.description ===
          PROTECTION_DESCRIPTIONS.awaitingValidation,
      )?.['addProtectedRange']?.protectedRange?.range,
    ).toEqual({ sheetId: 33 });
    expect(protections[0]?.['addProtectedRange']?.protectedRange?.editors).toEqual({
      users: [KEY.clientEmail],
    });
    // A leitura inicial traz a formatação condicional, para refazê-la sem duplicar.
    expect(decodeURIComponent(calls[0]?.url ?? '')).toContain('conditionalFormats');
  });

  it('a preparação aplica a aparência: cabeçalho, bordas, cores da coluna J e listras (FR-010a)', async () => {
    const meta = {
      sheets: [
        { properties: { sheetId: 11, title: 'A cobrar' }, conditionalFormats: [{}, {}] },
        { properties: { sheetId: 33, title: 'Aguardando validação do Financeiro' } },
        { properties: { sheetId: 22, title: 'Concluídas' } },
      ],
    };
    const header = [...COMMERCIAL_SHEET_HEADERS];
    const { fetch, calls } = fakeFetch([
      { status: 200, body: meta },
      {
        status: 200,
        body: {
          valueRanges: [
            { values: [header, ['H', '1'], ['H', '2']] },
            { values: [header] },
            { values: [header] },
          ],
        },
      },
      { status: 200, body: {} },
    ]);
    await gateway(fetch).setupLayout();
    expect(decodeURIComponent(calls[1]?.url ?? '')).toContain("'A cobrar'!A1:P&");

    type Request = Record<string, Record<string, unknown>>;
    const requests = (calls[2]?.body as { requests: Request[] }).requests;
    const of = (kind: string, sheetId: number) =>
      requests
        .filter((request) => kind in request)
        .map((request) => request[kind] as Record<string, unknown>)
        .filter((body) => JSON.stringify(body).includes(`"sheetId":${sheetId}`));

    // Cabeçalho: A a J preto com letra lima; K a P lima com letra preta; sem bordas.
    const headers = of('repeatCell', 11).filter(
      (body) => (body['range'] as { endRowIndex?: number }).endRowIndex === 1,
    );
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({
      range: { startColumnIndex: 0, endColumnIndex: 10 },
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: colorStyle(SHEET_COLORS.black),
          textFormat: { bold: true, foregroundColorStyle: colorStyle(SHEET_COLORS.lime) },
        },
      },
    });
    expect(headers[1]).toMatchObject({
      range: { startColumnIndex: 10, endColumnIndex: 16 },
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: colorStyle(SHEET_COLORS.lime),
          textFormat: { foregroundColorStyle: colorStyle(SHEET_COLORS.black) },
        },
      },
    });
    for (const body of headers) {
      expect(body['fields']).toContain('borders');
      expect(JSON.stringify(body['cell'])).not.toContain('borders');
    }

    // Bordas tracejadas só nas linhas de dados existentes: 2 em "A cobrar", nenhuma em "Concluídas".
    const borders = of('updateBorders', 11);
    expect(borders).toHaveLength(1);
    expect(borders[0]).toMatchObject({
      range: {
        sheetId: 11,
        startRowIndex: 1,
        endRowIndex: 3,
        startColumnIndex: 0,
        endColumnIndex: 16,
      },
      top: { style: 'DASHED' },
      innerHorizontal: { style: 'DASHED' },
      innerVertical: { style: 'DASHED' },
    });
    expect(of('updateBorders', 22)).toEqual([]);

    // Formatação condicional: apaga as 2 antigas (de trás para a frente) e grava as do sistema.
    expect(of('deleteConditionalFormatRule', 11)).toEqual([
      { sheetId: 11, index: 1 },
      { sheetId: 11, index: 0 },
    ]);
    expect(of('deleteConditionalFormatRule', 22)).toEqual([]);
    const added = of('addConditionalFormatRule', 11) as Array<{
      index: number;
      rule: {
        ranges: Array<Record<string, number>>;
        booleanRule: {
          condition: { type: string; values: Array<{ userEnteredValue: string }> };
          format: { backgroundColorStyle: unknown };
        };
      };
    }>;
    expect(added.map((body) => body.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const conditions = added.map((body) => [
      body.rule.booleanRule.condition.type,
      body.rule.booleanRule.condition.values[0]?.userEnteredValue,
      body.rule.booleanRule.format.backgroundColorStyle,
    ]);
    expect(conditions).toEqual([
      ['TEXT_EQ', 'Aguardando retorno do Comercial', colorStyle(SHEET_COLORS.lime)],
      ['TEXT_EQ', 'Aguardando validação do Financeiro', colorStyle(SHEET_COLORS.orange)],
      ['TEXT_EQ', 'Aguardando verificação no Hunit', colorStyle(SHEET_COLORS.orange)],
      // A "Cancelada" aguardando a validação, em laranja (homologação, R-19).
      ['TEXT_EQ', 'Cancelada: aguardando validação do Financeiro', colorStyle(SHEET_COLORS.orange)],
      ['TEXT_STARTS_WITH', 'Recusado pelo Financeiro', colorStyle(SHEET_COLORS.red)],
      ['TEXT_STARTS_WITH', 'Retorno incompleto', colorStyle(SHEET_COLORS.red)],
      ['TEXT_STARTS_WITH', 'Retorno não entendido', colorStyle(SHEET_COLORS.red)],
      ['CUSTOM_FORMULA', STRIPE_FORMULA, colorStyle(SHEET_COLORS.stripe)],
    ]);
    // Cores na coluna J, a partir da linha 2; listras de A a P.
    expect(added[0]?.rule.ranges).toEqual([
      { sheetId: 11, startRowIndex: 1, startColumnIndex: 9, endColumnIndex: 10 },
    ]);
    expect(added[7]?.rule.ranges).toEqual([
      { sheetId: 11, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 16 },
    ]);
    expect(of('addConditionalFormatRule', 22)).toHaveLength(8);

    // specs/008: O com a lista sugerida, não estrita; P só com data, estrita (research R-05).
    const validations = of('setDataValidation', 11) as Array<{
      range: Record<string, number>;
      rule: {
        condition: { type: string; values?: Array<{ userEnteredValue: string }> };
        strict: boolean;
        showCustomUi?: boolean;
      };
    }>;
    expect(validations).toHaveLength(2);
    expect(validations[0]).toMatchObject({
      range: { sheetId: 11, startRowIndex: 1, startColumnIndex: 14, endColumnIndex: 15 },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [
            { userEnteredValue: 'Cobrada na maquininha' },
            { userEnteredValue: 'Cobrada no Hunit' },
            { userEnteredValue: 'Cancelada' },
          ],
        },
        strict: false,
        showCustomUi: true,
      },
    });
    expect(validations[1]).toMatchObject({
      range: { sheetId: 11, startRowIndex: 1, startColumnIndex: 15, endColumnIndex: 16 },
      rule: { condition: { type: 'DATE_IS_VALID' }, strict: true },
    });
    expect(of('setDataValidation', 22)).toHaveLength(2);
    // A aba nova recebe a mesma aparência (specs/009, FR-010).
    expect(of('setDataValidation', 33)).toHaveLength(2);
    expect(of('addConditionalFormatRule', 33)).toHaveLength(added.length);
  });

  it('a preparação numa planilha da 005 acrescenta O e P sem mexer nas linhas (specs/008)', async () => {
    const meta = {
      sheets: [
        { properties: { sheetId: 11, title: 'A cobrar' } },
        { properties: { sheetId: 33, title: 'Aguardando validação do Financeiro' } },
        { properties: { sheetId: 22, title: 'Concluídas' } },
      ],
    };
    const header005 = COMMERCIAL_SHEET_HEADERS.slice(0, 14);
    const { fetch, calls } = fakeFetch([
      { status: 200, body: meta },
      {
        status: 200,
        body: {
          valueRanges: [
            { values: [header005, ['H', '1', '', '', '', '', '', '', '', '', 'AUT1']] },
            { values: [header005] },
            { values: [header005] },
          ],
        },
      },
      { status: 200, body: {} },
    ]);
    const report = await gateway(fetch).setupLayout();

    expect(report.headersWritten).toEqual(['toCharge', 'awaitingValidation', 'done']);
    type Request = Record<string, Record<string, unknown>>;
    const requests = (calls[2]?.body as { requests: Request[] }).requests;
    const cellUpdates = requests
      .filter((request) => 'updateCells' in request)
      .map((request) => request['updateCells'] as { start: { rowIndex: number } });
    // Só o cabeçalho (linha 0) é escrito; as linhas de dados ficam como estão.
    expect(cellUpdates.map((update) => update.start.rowIndex)).toEqual([0, 0, 0]);
    expect(requests.some((request) => 'deleteDimension' in request)).toBe(false);
  });
});

describe('aparência das linhas (FR-010a)', () => {
  it('cores em hexadecimal viram ColorStyle da API', () => {
    expect(colorStyle('#D4F25A')).toEqual({
      rgbColor: { red: 212 / 255, green: 242 / 255, blue: 90 / 255 },
    });
  });

  it('toda célula de dados tem bordas tracejadas; formatos por coluna', () => {
    for (let column = 0; column < COLUMN_COUNT; column += 1) {
      const format = dataCellFormat(column) as { borders: Record<string, { style: string }> };
      expect(Object.values(format.borders).map((border) => border.style)).toEqual([
        'DASHED',
        'DASHED',
        'DASHED',
        'DASHED',
      ]);
    }
    expect(dataCellFormat(1)).toMatchObject({ numberFormat: { type: 'TEXT' } });
    expect(dataCellFormat(4)).toMatchObject({ horizontalAlignment: 'RIGHT' });
    expect(dataCellFormat(9)).toMatchObject({ wrapStrategy: 'WRAP' });
    expect(dataCellFormat(12)).toMatchObject({
      horizontalAlignment: 'RIGHT',
      numberFormat: { type: 'CURRENCY' },
    });
    // specs/008: situação como texto e a data em dd/mm/aaaa.
    expect(dataCellFormat(14)).toMatchObject({ numberFormat: { type: 'TEXT' } });
    expect(dataCellFormat(15)).toMatchObject({
      numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' },
    });
    expect(COLUMN_COUNT).toBe(16);
  });

  it('a fórmula das listras não usa separador de argumentos (localidade pt_BR)', () => {
    expect(STRIPE_FORMULA).not.toMatch(/[,;]/);
  });
});
