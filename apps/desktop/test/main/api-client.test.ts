/**
 * Cliente da API do processo principal (specs/002, T017, SC-007, research R-03 e R-07): só fala
 * com o servidor cujo certificado vem da autoridade guardada na configuração e tem o nome certo.
 * Qualquer outro certificado é recusado antes de a requisição chegar ao servidor.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '../../src/main/api-client.js';
import type { AppError, Result } from '../../src/shared/ipc-types.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import {
  sendJson,
  sendProblem,
  startHttpsServer,
  type TestHttpsServer,
} from '../helpers/https-server.js';

const API_KEY = 'hunit_CHAVE-MARCADOR-API-CLIENT-0042';

let certificates: TestCertificates;
let server: TestHttpsServer;
const clients: ApiClient[] = [];

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startHttpsServer(certificates.server);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  server.reset();
  server.useCertificate(certificates.server);
});

afterAll(async () => {
  await server.close();
});

function newClient(options: { serverUrl?: string; timeoutMs?: number } = {}) {
  const client = new ApiClient({
    serverUrl: options.serverUrl ?? server.url,
    caCertificatePem: certificates.authority.certificatePem,
    apiKey: API_KEY,
    timeoutMs: options.timeoutMs ?? 5_000,
  });
  clients.push(client);
  return client;
}

function errorOf<T>(result: Result<T>): AppError {
  if (result.ok) throw new Error('esperava erro');
  return result.error;
}

describe('ApiClient — confiança no servidor (SC-007)', () => {
  it('raiz e nome certos: a requisição vai com a chave e a resposta volta', async () => {
    server.on('GET', '/v1/me', (_request, response) =>
      sendJson(response, 200, { name: 'desktop-financeiro', role: 'operator' }),
    );

    const result = await newClient().getMe();

    expect(result).toEqual({ ok: true, data: { name: 'desktop-financeiro', role: 'operator' } });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it.each([
    ['de outra autoridade', 'strange'],
    ['para outro nome', 'otherName'],
    ['vencido', 'expired'],
  ] as const)('certificado %s → untrusted_server, sem chegar ao servidor', async (_caso, which) => {
    server.on('GET', '/v1/me', (_request, response) =>
      sendJson(response, 200, { name: 'x', role: 'operator' }),
    );
    server.useCertificate(certificates[which]);

    const result = await newClient().getMe();

    expect(errorOf(result).code).toBe('untrusted_server');
    expect(server.requests).toEqual([]);
  });
});

describe('ApiClient — respostas de erro', () => {
  it('401 → unauthorized', async () => {
    server.on('GET', '/v1/me', (_request, response) =>
      sendProblem(response, 401, 'unauthorized', 'Chave recusada.'),
    );

    expect(errorOf(await newClient().getMe())).toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
  });

  it('problem+json → código e detalhe do servidor', async () => {
    server.on('POST', '/v1/executions', (_request, response) =>
      sendProblem(response, 409, 'execution_already_active', 'Aguarde a execução da conta.'),
    );

    const result = await newClient().startExecution({
      credentials: { username: 'op@hotel.test', password: 'SENHA-MARCADOR-1' },
      period: { from: '2026-11-01', to: '2026-11-07' },
      hotelCodes: null,
    });

    expect(errorOf(result)).toEqual({
      code: 'execution_already_active',
      detail: 'Aguarde a execução da conta.',
      status: 409,
    });
  });

  it('resposta de erro sem problem+json → internal_error com o status', async () => {
    server.on('GET', '/v1/hotels', (_request, response) => {
      response.writeHead(502, { 'content-type': 'text/html' });
      response.end('<h1>Bad gateway</h1>');
    });

    expect(errorOf(await newClient().listHotels())).toMatchObject({
      code: 'internal_error',
      status: 502,
    });
  });

  it('servidor que não responde no prazo → offline', async () => {
    server.on('GET', '/v1/health', () => {
      // Nunca responde.
    });

    expect(errorOf(await newClient({ timeoutMs: 300 }).getHealth()).code).toBe('offline');
  });

  it('ninguém escutando na porta → offline', async () => {
    const closed = await startHttpsServer(certificates.server);
    const url = closed.url;
    await closed.close();

    expect(errorOf(await newClient({ serverUrl: url }).getHealth()).code).toBe('offline');
  });

  it('nenhum erro contém a chave nem a senha', async () => {
    const results: unknown[] = [];
    server.on('GET', '/v1/me', (_request, response) => sendProblem(response, 401, 'unauthorized'));
    results.push(await newClient().getMe());
    server.on('POST', '/v1/executions', (_request, response) =>
      sendProblem(response, 400, 'validation_error', 'campo inválido'),
    );
    results.push(
      await newClient().startExecution({
        credentials: { username: 'op@hotel.test', password: 'SENHA-MARCADOR-2' },
        period: { from: '2026-11-01', to: '2026-11-07' },
        hotelCodes: null,
      }),
    );
    server.useCertificate(certificates.strange);
    results.push(await newClient().getMe());

    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('SENHA-MARCADOR-2');
  });
});

describe('ApiClient — relógio do servidor (R-07)', () => {
  it('mede a diferença de relógio pelo cabeçalho Date', async () => {
    const tenMinutes = 10 * 60 * 1000;
    server.on('GET', '/v1/health', (_request, response) =>
      sendJson(
        response,
        200,
        { status: 'ok' },
        {
          date: new Date(Date.now() + tenMinutes).toUTCString(),
        },
      ),
    );
    const client = newClient();

    expect(client.clockOffsetMs()).toBe(0);
    await client.getHealth();

    expect(Math.abs(client.clockOffsetMs() - tenMinutes)).toBeLessThan(2_000);
  });
});
