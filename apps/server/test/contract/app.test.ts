import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/http/app.js';
import { PROBLEM_CONTENT_TYPE } from '../../src/http/problem.js';
import {
  createTestApp,
  startExecutionBody,
  type TestApp,
  type TestClient,
} from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { createTestDatabase } from '../helpers/db.js';
import { captureLogs } from '../helpers/log-capture.js';

let test: TestApp;
let operator: TestClient;

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
});

afterAll(async () => {
  await test.close();
});

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
}

function problem(response: { body: string }): ProblemBody {
  return JSON.parse(response.body) as ProblemBody;
}

describe('GET /v1/health (T016)', () => {
  it('responde 200 sem exigir chave quando o banco está disponível', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expectMatchesContract('getHealth', response);
  });

  it('responde 503 quando o banco não responde, sem expor detalhes internos', async () => {
    const database = await createTestDatabase();
    const logs = captureLogs();
    const app = await buildApp({ db: database.db, logger: logs.logger });
    await database.close(); // derruba a conexão com o banco

    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(problem(response)).toMatchObject({
      code: 'internal_error',
      title: 'Serviço indisponível',
      detail: 'O banco de dados não respondeu.',
    });
    expectMatchesContract('getHealth', response);
    // O motivo técnico fica no log, não na resposta.
    expect(logs.records().some((record) => record['level'] === 50)).toBe(true);
  });
});

describe('erros no formato RFC 9457 (T015)', () => {
  it('responde 404 para rota fora do contrato', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/v1/nao-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(problem(response)).toEqual({
      type: 'urn:hunit-control:problem:not_found',
      title: 'Recurso não encontrado',
      status: 404,
      code: 'not_found',
      detail: 'Rota não encontrada.',
    });
  });

  it('responde 404 para rota do contrato fora do prefixo /v1', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(404);
  });

  it('responde 404 para método que o contrato não prevê', async () => {
    const response = await test.app.inject({
      method: 'DELETE',
      url: '/v1/hotels',
      headers: operator.headers,
    });

    expect(response.statusCode).toBe(404);
    expect(problem(response).code).toBe('not_found');
  });

  it('responde 501 para operação do contrato ainda sem implementação', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/reservations',
      headers: operator.headers,
    });

    expect(response.statusCode).toBe(501);
    expect(problem(response)).toMatchObject({
      code: 'internal_error',
      title: 'Operação não implementada',
    });
  });
});

describe('validação das requisições contra o contrato (T016)', () => {
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: { ...operator.headers, ...headers },
      ...(payload !== undefined && { payload: payload as object }),
    });

  it('aceita um corpo válido (a validação passa e a requisição chega ao handler)', async () => {
    const response = await post(startExecutionBody({ hotelCodes: ['H1', 'H2'] }));

    expect(response.statusCode).not.toBe(400);
  });

  it.each([
    ['sem credenciais', { period: { from: '2026-11-01', to: '2026-11-07' } }, 'credentials'],
    ['sem período', { credentials: { username: 'u', password: 'p' } }, 'period'],
    ['sem senha', startExecutionBody({ credentials: { username: 'u' } }), 'password'],
    ['com senha vazia', startExecutionBody({ credentials: { username: 'u', password: '' } }), ''],
    ['com data inválida', startExecutionBody({ period: { from: '01/11/2026', to: 'x' } }), 'date'],
    ['com lista de hotéis vazia', startExecutionBody({ hotelCodes: [] }), 'hotelCodes'],
    ['com campo desconhecido', startExecutionBody({ hotelCode: 'H1' }), 'additional'],
    [
      'com campo desconhecido nas credenciais',
      startExecutionBody({ credentials: { username: 'u', password: 'p', otp: '123456' } }),
      'additional',
    ],
  ])('recusa com 400 corpo %s', async (_caso, payload, mentioned) => {
    const response = await post(payload);

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(problem(response).code).toBe('validation_error');
    expect(problem(response).detail).toContain(mentioned);
    expectMatchesContract('createExecution', response);
  });

  it('recusa com 400 requisição sem corpo', async () => {
    const response = await post(undefined);

    expect(response.statusCode).toBe(400);
    expect(problem(response).code).toBe('validation_error');
  });

  it('recusa com 400 corpo que não é JSON válido', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: { ...operator.headers, 'content-type': 'application/json' },
      payload: '{"credentials": {"username": ',
    });

    expect(response.statusCode).toBe(400);
    expect(problem(response).code).toBe('validation_error');
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/problem+json'])(
    'recusa com 400 corpo enviado como %s',
    async (contentType) => {
      const response = await test.app.inject({
        method: 'POST',
        url: '/v1/executions',
        headers: { ...operator.headers, 'content-type': contentType },
        payload: JSON.stringify(startExecutionBody()),
      });

      expect(response.statusCode).toBe(400);
      expect(problem(response).code).toBe('validation_error');
      expectMatchesContract('createExecution', response);
    },
  );

  it('recusa com 400 token 2FA fora do formato, sem repetir o valor na resposta', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/executions/7f3c2a54-9d6e-4b1a-8c0f-2e5d7a9b1c3d/two-factor',
      headers: operator.headers,
      payload: { token: 'TOKEN-INVALIDO-XYZ' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('TOKEN-INVALIDO-XYZ');
    expectMatchesContract('sendTwoFactor', response);
  });

  it('recusa com 400 identificador de execução que não é UUID', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/executions/nao-e-uuid',
      headers: operator.headers,
    });

    expect(response.statusCode).toBe(400);
    expectMatchesContract('getExecution', response);
  });

  it.each([
    '/v1/reservations?classification=classificacao_inexistente',
    '/v1/reservations?reservationStatus=talvez',
    '/v1/reservations?limit=0',
    '/v1/reservations?limit=501',
    '/v1/reservations?checkInFrom=2026-13-45',
    '/v1/reservations?notFound=talvez',
    '/v1/executions?status=dormindo',
  ])('recusa com 400 parâmetro de consulta inválido em %s', async (url) => {
    const response = await test.app.inject({ method: 'GET', url, headers: operator.headers });

    expect(response.statusCode).toBe(400);
    expect(problem(response).code).toBe('validation_error');
  });

  it('aceita filtros de consulta válidos, repetidos ou não', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url:
        '/v1/reservations?classification=virtual_card_pending_charge&classification=analysis_error' +
        '&reservationStatus=cancelled&hotelCode=H1&notFound=true&limit=10&checkInFrom=2026-11-01',
      headers: operator.headers,
    });

    expect(response.statusCode).not.toBe(400);
  });
});

describe('credenciais fora dos logs (FR-005, SC-004)', () => {
  it('não registra o corpo das requisições, nem quando a validação falha', async () => {
    test.logs.lines.length = 0;

    await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: operator.headers,
      payload: startExecutionBody(),
    });
    await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: operator.headers,
      payload: startExecutionBody({ campoDesconhecido: 'VALOR-DESCONHECIDO-456' }),
    });
    await test.app.inject({
      method: 'POST',
      url: '/v1/executions/7f3c2a54-9d6e-4b1a-8c0f-2e5d7a9b1c3d/two-factor',
      headers: operator.headers,
      payload: { token: '918273' },
    });

    const text = test.logs.text();
    expect(test.logs.lines.length).toBeGreaterThan(0);
    for (const secret of [
      'SENHA-NO-CORPO-123',
      'operador@hotel.test',
      'VALOR-DESCONHECIDO-456',
      '918273',
      operator.apiKey,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
