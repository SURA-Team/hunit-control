import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE } from '../../src/http/problem.js';
import { revokeClient } from '../../src/persistence/clients-repo.js';
import { apiClients } from '../../src/persistence/schema.js';
import {
  createTestApp,
  startExecutionBody,
  type TestApp,
  type TestClient,
} from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
});

afterAll(async () => {
  await test.close();
});

function problemCode(response: { body: string }): unknown {
  return (JSON.parse(response.body) as { code?: unknown }).code;
}

describe('autenticação por chave de API (FR-007, T017/T018)', () => {
  it('recusa requisição sem chave com 401', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/v1/hotels' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="hunit-control"');
    expect(problemCode(response)).toBe('unauthorized');
    expectMatchesContract('listHotels', response);
  });

  it.each([
    ['chave desconhecida', 'Bearer hunit_chave-que-nao-existe'],
    ['esquema diferente de Bearer', 'Basic dXN1YXJpbzpzZW5oYQ=='],
    ['cabeçalho sem a chave', 'Bearer'],
    ['cabeçalho com texto a mais', 'Bearer abc def'],
  ])('recusa %s com 401', async (_caso, authorization) => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/hotels',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(401);
    expect(problemCode(response)).toBe('unauthorized');
  });

  it('recusa chave de cliente revogado com 401', async () => {
    const revoked = await test.createClient('operator');
    const before = await test.app.inject({
      method: 'GET',
      url: '/v1/hotels',
      headers: revoked.headers,
    });
    expect(before.statusCode).not.toBe(401);

    expect(await revokeClient(test.database.db, revoked.name)).toBe('revoked');

    const after = await test.app.inject({
      method: 'GET',
      url: '/v1/hotels',
      headers: revoked.headers,
    });
    expect(after.statusCode).toBe(401);
    expect(problemCode(after)).toBe('unauthorized');
  });

  it('aceita a chave com "bearer" em minúsculas', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/hotels',
      headers: { authorization: `bearer ${reader.apiKey}` },
    });

    expect(response.statusCode).not.toBe(401);
  });

  it('guarda no banco só o hash da chave, nunca a chave', async () => {
    const [stored] = await test.database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.id, operator.id));

    expect(stored?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(operator.apiKey);
  });

  it('responde 401 antes de ler ou validar o corpo', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      payload: { campo: 'totalmente fora do contrato' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('níveis de acesso (FR-007)', () => {
  it('recusa com 403 o nível "reader" em POST /v1/executions', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: reader.headers,
      payload: startExecutionBody(),
    });

    expect(response.statusCode).toBe(403);
    expect(problemCode(response)).toBe('forbidden_for_role');
    expectMatchesContract('createExecution', response);
  });

  it.each([
    ['sendTwoFactor', '/v1/executions/7f3c2a54-9d6e-4b1a-8c0f-2e5d7a9b1c3d/two-factor'],
    ['cancelExecution', '/v1/executions/7f3c2a54-9d6e-4b1a-8c0f-2e5d7a9b1c3d/cancel'],
    ['resumeExecution', '/v1/executions/7f3c2a54-9d6e-4b1a-8c0f-2e5d7a9b1c3d/resume'],
  ])('recusa com 403 o nível "reader" em %s', async (operationId, url) => {
    const response = await test.app.inject({ method: 'POST', url, headers: reader.headers });

    expect(response.statusCode).toBe(403);
    expect(problemCode(response)).toBe('forbidden_for_role');
    expectMatchesContract(operationId, response);
  });

  it('deixa o nível "operator" passar pela autenticação nas ações de operador', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: operator.headers,
      payload: startExecutionBody(),
    });

    expect([401, 403]).not.toContain(response.statusCode);
  });

  it.each([
    '/v1/hotels',
    '/v1/executions',
    '/v1/executions/7f3c2a54-9d6e-4b1a-8c0f-2e5d7a9b1c3d',
    '/v1/reservations',
    '/v1/reservations/H1/1001',
  ])('deixa o nível "reader" consultar %s', async (url) => {
    const response = await test.app.inject({ method: 'GET', url, headers: reader.headers });

    expect([401, 403]).not.toContain(response.statusCode);
  });

  it('registra no log qual cliente fez a requisição, sem registrar a chave', async () => {
    test.logs.lines.length = 0;

    await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: operator.headers,
      payload: startExecutionBody(),
    });

    const completed = test.logs.records().find((record) => record['msg'] === 'request completed');
    expect(completed?.['client']).toBe(operator.name);
    expect(test.logs.text()).not.toContain(operator.apiKey);
  });
});
