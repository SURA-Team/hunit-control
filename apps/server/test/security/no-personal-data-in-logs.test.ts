/**
 * Nomes de arquivo e buscas fora dos logs (specs/003, research R-13, T055; constitution,
 * "Observabilidade: logs ... sem dados sensíveis").
 *
 * O nome do arquivo de uma tratativa vai na query do envio (`?name=`) e pode conter o nome do
 * hóspede; a busca livre da feature 002 (`?q=`) leva o nome do hóspede pelo mesmo caminho. O log
 * do servidor registra cada requisição pelo caminho, sem a query.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';

const FILE_NAME_MARKER = 'MARCADOR-HOSPEDE-ARQUIVO';
const SEARCH_MARKER = 'MARCADOR-HOSPEDE-BUSCA';

let test: TestApp;
let operator: TestClient;

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
});

afterAll(async () => {
  await test.close();
});

describe('logs do servidor sem a query das requisições', () => {
  it('o nome do arquivo enviado não aparece no log', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: `/v1/treatment-files?name=${FILE_NAME_MARKER}.pdf`,
      headers: { ...operator.headers, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('%PDF-1.7\nconteudo de teste\n'),
    });
    expect(response.statusCode).toBeLessThan(500);

    expect(test.logs.text()).not.toContain(FILE_NAME_MARKER);
    // A requisição foi registrada, só que pelo caminho.
    expect(test.logs.text()).toContain('/v1/treatment-files');
  });

  it('o texto da busca livre de reservas não aparece no log', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: `/v1/reservations?q=${SEARCH_MARKER}`,
      headers: operator.headers,
    });
    expect(response.statusCode).toBe(200);

    expect(test.logs.text()).not.toContain(SEARCH_MARKER);
    expect(test.logs.text()).toContain('/v1/reservations');
  });

  it('a requisição recusada pela validação também não leva a query para o log', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: `/v1/reservations?q=${SEARCH_MARKER}&limit=0`,
      headers: operator.headers,
    });
    expect(response.statusCode).toBe(400);

    expect(test.logs.text()).not.toContain(SEARCH_MARKER);
  });

  it('o registro da requisição não traz cabeçalhos nem a chave do cliente', () => {
    expect(test.logs.text()).not.toContain(operator.apiKey);
    for (const record of test.logs.records()) {
      const request = record['req'] as Record<string, unknown> | undefined;
      if (request) expect(Object.keys(request).sort()).toEqual(['method', 'url']);
    }
  });
});
