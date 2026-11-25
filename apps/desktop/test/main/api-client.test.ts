/**
 * Cliente da API do processo principal (specs/002, T017, SC-007, research R-03 e R-07): só fala
 * com o servidor cujo certificado vem da autoridade guardada na configuração e tem o nome certo.
 * Qualquer outro certificado é recusado antes de a requisição chegar ao servidor.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, fileNameFromDisposition } from '../../src/main/api-client.js';
import {
  reservationCountFiltersSchema,
  reservationFiltersSchema,
  reportOverviewInputSchema,
  reservationListInputSchema,
} from '../../src/shared/ipc-schemas.js';
import type { AppError, ReportOverviewInput, Result } from '../../src/shared/ipc-types.js';
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

describe('ApiClient — origem "Sistema anterior" (specs/004, T033)', () => {
  it('fromLegacy vai na query da lista de reservas; a ponte o aceita', async () => {
    let query = new URLSearchParams();
    server.on('GET', '/v1/reservations', (request, response) => {
      query = request.query;
      sendJson(response, 200, { items: [], nextCursor: null });
    });

    const result = await newClient().listReservations({ fromLegacy: true, pendingCharge: true });

    expect(result.ok).toBe(true);
    expect(query.get('fromLegacy')).toBe('true');
    expect(query.get('pendingCharge')).toBe('true');
    expect(reservationListInputSchema.safeParse({ fromLegacy: false }).success).toBe(true);
    expect(reservationListInputSchema.safeParse({ fromLegacy: 'sim' }).success).toBe(false);
  });
});

describe('ApiClient — filtros rápidos e ordem (specs/006, T032)', () => {
  it('quickFilter e order vão na query da lista', async () => {
    let query = new URLSearchParams();
    server.on('GET', '/v1/reservations', (request, response) => {
      query = request.query;
      sendJson(response, 200, { items: [], nextCursor: null });
    });

    const result = await newClient().listReservations({
      quickFilter: 'to_review',
      order: 'hotel_check_in',
    });

    expect(result.ok).toBe(true);
    expect(query.get('quickFilter')).toBe('to_review');
    expect(query.get('order')).toBe('hotel_check_in');
  });

  it('contagens: a rota nova com os filtros da lista', async () => {
    let query = new URLSearchParams();
    const counts = { all: 12, pendingCharge: 5, toReview: 0, withError: 3, done: 4 };
    server.on('GET', '/v1/reservations/quick-filter-counts', (request, response) => {
      query = request.query;
      sendJson(response, 200, counts);
    });

    const result = await newClient().countReservationQuickFilters({
      hotelCode: ['31', '32'],
      q: 'Ana',
    });

    expect(result).toEqual({ ok: true, data: counts });
    expect(query.getAll('hotelCode')).toEqual(['31', '32']);
    expect(query.get('q')).toBe('Ana');
  });

  it('a ponte aceita só os valores do contrato; as contagens não aceitam filtro rápido nem ordem', () => {
    expect(reservationListInputSchema.safeParse({ quickFilter: 'done' }).success).toBe(true);
    expect(reservationListInputSchema.safeParse({ quickFilter: 'todas' }).success).toBe(false);
    expect(reservationListInputSchema.safeParse({ order: 'hotel_check_in' }).success).toBe(true);
    expect(reservationListInputSchema.safeParse({ order: 'checkin' }).success).toBe(false);
    // "Selecionar todas do filtro" e a cópia seguem o filtro rápido e a ordem da lista.
    expect(
      reservationFiltersSchema.safeParse({ quickFilter: 'done', order: 'hotel_check_in' }).success,
    ).toBe(true);
    expect(reservationCountFiltersSchema.safeParse({ hotelCode: ['31'] }).success).toBe(true);
    for (const extra of [{ quickFilter: 'done' }, { order: 'hotel_check_in' }, { limit: 10 }]) {
      expect(reservationCountFiltersSchema.safeParse(extra).success).toBe(false);
    }
  });
});

describe('ApiClient — módulo de Relatórios (specs/007, T008)', () => {
  it('resumo do período: a rota nova com as duas datas', async () => {
    let query = new URLSearchParams();
    const overview = {
      period: { from: '2026-11-01', to: '2026-11-30' },
      generatedAt: '2026-11-16T13:58:00.000Z',
      lastVerifiedAt: null,
      reservations: 0,
      treatmentsSent: 0,
      withoutAmount: 0,
      hotels: { withData: 0, total: 0 },
      open: { amount: '0.00', count: 0, requested: '0.00', pending: '0.00' },
      charged: { amount: '0.00', previous: '0.00', recovered: '0.00' },
      hotelRows: [],
    };
    server.on('GET', '/v1/reports/overview', (request, response) => {
      query = request.query;
      sendJson(response, 200, overview);
    });

    const result = await newClient().getReportOverview({
      checkInFrom: '2026-11-01',
      checkInTo: '2026-11-30',
    });

    expect(result).toEqual({ ok: true, data: overview });
    expect(query.get('checkInFrom')).toBe('2026-11-01');
    expect(query.get('checkInTo')).toBe('2026-11-30');
  });

  it('o resumo leva os filtros do painel (contrato 1.11.0)', async () => {
    let query = new URLSearchParams();
    server.on('GET', '/v1/reports/overview', (request, response) => {
      query = request.query;
      sendJson(response, 200, {});
    });
    const input: ReportOverviewInput = {
      checkInFrom: '2026-11-01',
      checkInTo: '2026-11-30',
      hotelCode: ['31', '32'],
      detailedSituation: ['treatment_sent', 'return_pending'],
      reservationStatus: ['active'],
      channel: 'Canal Fictício',
      fromLegacy: false,
      notFound: true,
    };
    expect(reportOverviewInputSchema.safeParse(input).success).toBe(true);
    expect(reportOverviewInputSchema.safeParse({ ...input, q: 'texto' }).success).toBe(false);
    await newClient().getReportOverview(input);
    expect(query.getAll('hotelCode')).toEqual(['31', '32']);
    expect(query.getAll('detailedSituation')).toEqual(['treatment_sent', 'return_pending']);
    expect(query.getAll('reservationStatus')).toEqual(['active']);
    expect(query.get('channel')).toBe('Canal Fictício');
    expect(query.get('fromLegacy')).toBe('false');
    expect(query.get('notFound')).toBe('true');
  });

  it('a lista aceita a ordem amount_desc da gaveta do hotel', async () => {
    let query = new URLSearchParams();
    server.on('GET', '/v1/reservations', (request, response) => {
      query = request.query;
      sendJson(response, 200, { items: [], nextCursor: null });
    });
    expect(reservationListInputSchema.safeParse({ order: 'amount_desc' }).success).toBe(true);
    const result = await newClient().listReservations({
      hotelCode: ['31'],
      quickFilter: 'pending_charge',
      order: 'amount_desc',
      limit: 50,
    });
    expect(result.ok).toBe(true);
    expect(query.get('order')).toBe('amount_desc');
  });
});

describe('ApiClient — "Cancelada sem cobrança" (specs/008, T030)', () => {
  const key = { hotelCode: '31', reservationNumber: '7001' };
  const markId = '55555555-5555-4555-8555-555555555555';

  it('marca e desfaz pelas rotas do contrato, com o corpo esperado', async () => {
    const reservation = { ...key, noCharge: { id: markId } };
    server.on('POST', '/v1/reservations/31/7001/no-charge', (_request, response) =>
      sendJson(response, 200, reservation),
    );
    server.on('POST', '/v1/reservations/31/7001/no-charge/undo', (_request, response) =>
      sendJson(response, 200, { ...key, noCharge: null }),
    );
    const client = newClient();

    expect(
      await client.markNoCharge(key, {
        expectedSituation: 'virtual_card_pending_charge',
        note: 'Observação',
      }),
    ).toEqual({ ok: true, data: reservation });
    expect(await client.undoNoCharge(key, markId)).toEqual({
      ok: true,
      data: { ...key, noCharge: null },
    });

    const [mark, undo] = server.requests;
    expect(JSON.parse(mark?.body ?? '{}')).toEqual({
      expectedSituation: 'virtual_card_pending_charge',
      note: 'Observação',
    });
    expect(JSON.parse(undo?.body ?? '{}')).toEqual({ markId });
  });

  it('recusas do servidor viram o código do contrato', async () => {
    server.on('POST', '/v1/reservations/31/7001/no-charge', (_request, response) =>
      sendProblem(response, 409, 'reservation_changed', 'A situação mudou.'),
    );
    server.on('POST', '/v1/reservations/31/7001/no-charge/undo', (_request, response) =>
      sendProblem(response, 409, 'no_charge_not_active'),
    );
    const client = newClient();

    expect(
      errorOf(await client.markNoCharge(key, { expectedSituation: 'virtual_card_pending_charge' })),
    ).toMatchObject({ code: 'reservation_changed', status: 409 });
    expect(errorOf(await client.undoNoCharge(key, markId))).toMatchObject({
      code: 'no_charge_not_active',
      status: 409,
    });
  });
});

describe('ApiClient — "Cancelada" do Comercial (homologação da 008, R-19)', () => {
  const key = { hotelCode: '31', reservationNumber: '7020' };

  it('confirma e recusa pelas rotas do contrato, com o motivo no corpo', async () => {
    server.on(
      'POST',
      '/v1/reservations/31/7020/commercial/cancellation/confirm',
      (_request, response) => sendJson(response, 200, { ...key, noCharge: { id: 'm' } }),
    );
    server.on(
      'POST',
      '/v1/reservations/31/7020/commercial/cancellation/reject',
      (_request, response) => sendJson(response, 200, key),
    );
    const client = newClient();

    expect(await client.confirmCommercialCancellation(key)).toEqual({
      ok: true,
      data: { ...key, noCharge: { id: 'm' } },
    });
    expect(await client.rejectCommercialCancellation(key, 'Hóspede fez check-in')).toEqual({
      ok: true,
      data: key,
    });
    const [, reject] = server.requests;
    expect(JSON.parse(reject?.body ?? '{}')).toEqual({ reason: 'Hóspede fez check-in' });
  });

  it('o lote só manda includeCancellations quando pede as "Cancelada"', async () => {
    const result = { batchId: 'b', items: [], countsByClassification: {} };
    server.on('POST', '/v1/commercial-returns/confirm', (_request, response) =>
      sendJson(response, 200, result),
    );
    const client = newClient();

    await client.confirmCommercialReturns([key]);
    await client.confirmCommercialReturns([key], true);
    const [plain, withCancellations] = server.requests;
    expect(JSON.parse(plain?.body ?? '{}')).toEqual({ reservations: [key] });
    expect(JSON.parse(withCancellations?.body ?? '{}')).toEqual({
      reservations: [key],
      includeCancellations: true,
    });
  });

  it('sem "Cancelada" aguardando validação: o código do contrato', async () => {
    server.on(
      'POST',
      '/v1/reservations/31/7020/commercial/cancellation/confirm',
      (_request, response) => sendProblem(response, 409, 'no_cancellation_awaiting_validation'),
    );
    const client = newClient();
    expect(errorOf(await client.confirmCommercialCancellation(key))).toMatchObject({
      code: 'no_cancellation_awaiting_validation',
      status: 409,
    });
  });
});
