/**
 * Cliente da API do processo principal (specs/002, T017, SC-007, research R-03 e R-07): só fala
 * com o servidor cujo certificado vem da autoridade guardada na configuração e tem o nome certo.
 * Qualquer outro certificado é recusado antes de a requisição chegar ao servidor.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, fileNameFromDisposition } from '../../src/main/api-client.js';
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

describe('ApiClient — tratativas (specs/003, T019)', () => {
  const FILE_ID = 'a'.repeat(64);
  const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';

  it('envia o arquivo como corpo binário, com o nome na query e a chave', async () => {
    server.on('POST', '/v1/treatment-files', (_request, response) =>
      sendJson(response, 201, { fileId: FILE_ID, sizeBytes: 21, mediaType: 'application/pdf' }),
    );
    const content = Buffer.from('%PDF-1.7 corpo de teste');

    const result = await newClient().uploadTreatmentFile('Comprovante nº 1.pdf', content);

    expect(result).toEqual({
      ok: true,
      data: { fileId: FILE_ID, sizeBytes: 21, mediaType: 'application/pdf' },
    });
    const [request] = server.requests;
    expect(request?.query.get('name')).toBe('Comprovante nº 1.pdf');
    expect(request?.headers['content-type']).toBe('application/octet-stream');
    expect(request?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request?.body).toBe('%PDF-1.7 corpo de teste');
  });

  it('arquivo recusado pelo servidor vira o código do contrato', async () => {
    server.on('POST', '/v1/treatment-files', (_request, response) =>
      sendProblem(response, 415, 'unsupported_file_type', 'conteúdo diferente da extensão'),
    );

    const result = await newClient().uploadTreatmentFile('boleto.pdf', Buffer.from('MZ'));

    expect(errorOf(result)).toMatchObject({ code: 'unsupported_file_type', status: 415 });
  });

  it('registra, confere, desfaz, reverte e lê a tratativa pelas rotas do contrato', async () => {
    const key = { hotelCode: '31', reservationNumber: '7001' };
    const treatment = {
      status: 'charged',
      request: null,
      proof: null,
      manualChargedAmount: null,
      effectiveChargedAmount: null,
      acceptsDocuments: true,
    };
    server.on('POST', '/v1/treatment-documents/check', (_request, response) =>
      sendJson(response, 200, {
        items: [],
        acceptedCount: 1,
        replacingCount: 0,
        ignoredCount: 0,
        acceptedTotalAmount: '10.00',
      }),
    );
    server.on('POST', '/v1/treatment-documents', (_request, response) =>
      sendJson(response, 200, { batchId: DOCUMENT_ID, items: [] }),
    );
    server.on('DELETE', `/v1/treatment-documents/${DOCUMENT_ID}`, (_request, response) => {
      response.writeHead(204).end();
    });
    server.on('POST', `/v1/treatment-documents/${DOCUMENT_ID}/revert`, (_request, response) =>
      sendJson(response, 200, treatment),
    );
    server.on('GET', '/v1/reservations/31/7001/treatment', (_request, response) =>
      sendJson(response, 200, { treatment, documents: [], events: [] }),
    );
    server.on('PUT', '/v1/reservations/31/7001/manual-amount', (_request, response) =>
      sendJson(response, 200, { ...treatment, manualChargedAmount: '500.00' }),
    );
    server.on('DELETE', '/v1/reservations/31/7001/manual-amount', (_request, response) =>
      sendJson(response, 200, treatment),
    );
    const client = newClient();

    expect(
      await client.checkTreatmentDocuments({ kind: 'proof', reservations: [key] }),
    ).toMatchObject({ ok: true, data: { acceptedCount: 1, acceptedTotalAmount: '10.00' } });
    expect(
      await client.registerTreatmentDocuments({
        kind: 'proof',
        fileId: FILE_ID,
        fileName: 'c.pdf',
        reservations: [key],
      }),
    ).toEqual({ ok: true, data: { batchId: DOCUMENT_ID, items: [] } });
    expect(await client.removeTreatmentDocument(DOCUMENT_ID)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await client.revertTreatmentDocument(DOCUMENT_ID)).toMatchObject({
      ok: true,
      data: { status: 'charged' },
    });
    expect(await client.getReservationTreatment(key)).toMatchObject({
      ok: true,
      data: { documents: [], events: [] },
    });
    expect(await client.setManualChargedAmount(key, '500.00')).toMatchObject({
      ok: true,
      data: { manualChargedAmount: '500.00' },
    });
    expect(await client.clearManualChargedAmount(key)).toMatchObject({ ok: true });

    const register = server.requests.find(
      (request) => request.method === 'POST' && request.path === '/v1/treatment-documents',
    );
    expect(JSON.parse(register?.body ?? '{}')).toEqual({
      kind: 'proof',
      fileId: FILE_ID,
      fileName: 'c.pdf',
      reservations: [key],
    });
    const amount = server.requests.find((request) => request.method === 'PUT');
    expect(JSON.parse(amount?.body ?? '{}')).toEqual({ amount: '500.00' });
  });

  it('baixa o documento com o nome original do content-disposition', async () => {
    server.on('GET', `/v1/treatment-documents/${DOCUMENT_ID}/file`, (_request, response) => {
      response
        .writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition':
            'attachment; filename="Comprovante n_ 1.pdf"; filename*=UTF-8\'\'Comprovante%20n%C2%BA%201.pdf',
        })
        .end(Buffer.from('%PDF conteudo'));
    });

    const result = await newClient().downloadTreatmentDocument(DOCUMENT_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fileName).toBe('Comprovante nº 1.pdf');
      expect(result.data.content.toString()).toBe('%PDF conteudo');
    }
  });

  it('documento com o arquivo já apagado vira document_purged', async () => {
    server.on('GET', `/v1/treatment-documents/${DOCUMENT_ID}/file`, (_request, response) =>
      sendProblem(response, 410, 'document_purged'),
    );

    expect(errorOf(await newClient().downloadTreatmentDocument(DOCUMENT_ID))).toMatchObject({
      code: 'document_purged',
      status: 410,
    });
  });
});

describe('fileNameFromDisposition', () => {
  it.each([
    ['attachment; filename="a.pdf"; filename*=UTF-8\'\'Cobran%C3%A7a.pdf', 'Cobrança.pdf'],
    ['attachment; filename="simples.pdf"', 'simples.pdf'],
    ["attachment; filename*=UTF-8''%E0%A4%A", 'documento'],
    [null, 'documento'],
  ])('%s → %s', (header, expected) => {
    expect(fileNameFromDisposition(header)).toBe(expected);
  });
});
