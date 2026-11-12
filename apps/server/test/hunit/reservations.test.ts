/**
 * Leitores da listagem (`GetBookings`) e do detalhe (`BookingDetail`) das reservas — tasks.md,
 * T041. As respostas ainda são sintéticas, no formato do research R-13a (T020/T021 trazem as
 * reais anonimizadas).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { classifyReservation } from '@hunit/domain';
import { request, type APIRequestContext } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScreenNotRecognizedError, SessionExpiredError } from '../../src/hunit/errors.js';
import type { ReservationListItem } from '../../src/hunit/gateway.js';
import { HunitApiClient } from '../../src/hunit/network/api-client.js';
import { readBookingDetail } from '../../src/hunit/network/booking-detail.js';
import { BOOKINGS_PAGE_SIZE, searchBookings } from '../../src/hunit/network/bookings.js';
import { readJsonFixture } from '../helpers/fake-hunit-server.js';

type Json = Record<string, unknown>;

let next: { status: number; body: string };
let received: Array<{ method: string; url: URL; companyId: string | undefined }> = [];
let server: Server;
let requestContext: APIRequestContext;
let api: HunitApiClient;

const week = { from: '2026-11-01', to: '2026-11-07' };

function respondWith(body: unknown, status = 200) {
  next = { status, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

function bookingsPage(): Json {
  return structuredClone(readJsonFixture('bookings-page-1.json')) as Json;
}

/** A página da fixture com a primeira reserva alterada. */
function bookingsWithFirst(changes: Json): Json {
  const page = bookingsPage();
  const items = (page.items as { items: Json[] }).items;
  items[0] = { ...items[0], ...changes };
  return page;
}

function detailFixture(name: string, changes: Json = {}): Json {
  return { ...(readJsonFixture(`booking-detail-${name}.json`) as Json), ...changes };
}

const item: ReservationListItem = {
  bookingId: '900001',
  reservationNumber: 'BK-1001',
  reservationStatus: 'active',
  listing: {
    guestName: 'Hóspede Exemplo Um',
    channel: 'Canal Exemplo',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    stayPeriod: '03/11/2026 a 05/11/2026',
    totalAmount: '500.00',
  },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({
      method: req.method ?? '',
      url: new URL(req.url ?? '/', 'http://hunit.test'),
      companyId: req.headers['x-company-id'] as string | undefined,
    });
    res.writeHead(next.status, { 'content-type': 'application/json' });
    res.end(next.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  requestContext = await request.newContext();
  api = new HunitApiClient(requestContext, {
    apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    webUrl: 'https://hunit.test',
    timeoutMs: 5_000,
  });
});

afterAll(async () => {
  await requestContext.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
});

describe('searchBookings (GetBookings)', () => {
  it('consulta com os filtros fixos da FR-010, o hotel e a página', async () => {
    respondWith(bookingsPage());

    await searchBookings(api, '101', week, 1);

    expect(received).toHaveLength(1);
    const [call] = received;
    expect(call?.method).toBe('GET');
    expect(call?.url.pathname).toBe('/api/Entity/GetBookings');
    expect(call?.companyId).toBe('101');
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      DateTypeId: '2', // Check-in (a confirmar na T022)
      StatusId: '0', // Todas
      CollectTypeId: '2', // Canal Collect (a confirmar na T022)
      PrePaymentStatus: '0', // Todos
      IntegrationStatusId: '0', // Todas
      StartDate: '2026-11-01',
      EndDate: '2026-11-07',
      Page: '1',
      PageSize: String(BOOKINGS_PAGE_SIZE),
    });
  });

  it('converte as reservas e calcula o total de páginas = ceil(total / pageSize)', async () => {
    respondWith(bookingsPage());

    const page = await searchBookings(api, '101', week, 1);

    expect(page).toEqual({
      page: 1,
      totalPages: 2,
      totalItems: 3,
      items: [
        {
          bookingId: '900001',
          reservationNumber: 'BK-1001',
          reservationStatus: 'active',
          listing: {
            guestName: 'Hóspede Exemplo Um',
            channel: 'Canal Exemplo',
            checkIn: '2026-11-03',
            checkOut: '2026-11-05',
            stayPeriod: '03/11/2026 a 05/11/2026',
            totalAmount: '500.00',
          },
        },
        {
          bookingId: '900002',
          reservationNumber: '258-2002',
          reservationStatus: 'cancelled',
          listing: {
            guestName: 'Hóspede Exemplo Dois',
            channel: 'Canal Exemplo',
            checkIn: '2026-11-07',
            checkOut: '2026-11-10',
            stayPeriod: '07/11/2026 a 10/11/2026',
            totalAmount: '1234.50',
          },
        },
      ],
    });
  });

  it('sem reservas → zero páginas', async () => {
    respondWith({ items: { items: [], page: 1, pageSize: 50, total: 0 } });
    expect(await searchBookings(api, '101', week, 1)).toEqual({
      page: 1,
      totalPages: 0,
      totalItems: 0,
      items: [],
    });
  });

  it.each([
    [1, 'active'],
    [2, 'active'],
    [3, 'cancelled'],
    [9, 'unknown'],
  ])('statusId %i → %s', async (statusId, expected) => {
    respondWith(bookingsWithFirst({ statusId }));
    const page = await searchBookings(api, '101', week, 1);
    expect(page.items[0]?.reservationStatus).toBe(expected);
  });

  it.each([
    ['sem a lista', { items: { page: 1, pageSize: 2, total: 0 } }],
    ['sem o total', { items: { items: [], page: 1, pageSize: 2 } }],
    ['reserva sem número', bookingsWithFirst({ channelIdentifier: undefined })],
    ['check-in que não é data', bookingsWithFirst({ arrivalDate: '03/11/2026' })],
    ['total como texto', bookingsWithFirst({ total: '500,00' })],
    ['página diferente da pedida', { items: { items: [], page: 2, pageSize: 2, total: 0 } }],
  ])('formato inesperado (%s) → ScreenNotRecognizedError com a resposta', async (_, body) => {
    respondWith(body);

    const error = await searchBookings(api, '101', week, 1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ScreenNotRecognizedError);
    expect((error as ScreenNotRecognizedError).evidence?.response).toBe(JSON.stringify(body));
  });

  it('reserva que não é Canal Collect → filtro ignorado, ScreenNotRecognizedError (FR-010)', async () => {
    respondWith(bookingsWithFirst({ collectTypeId: 1 }));

    const error = await searchBookings(api, '101', week, 1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ScreenNotRecognizedError);
    expect((error as Error).message).toContain('Canal Collect');
  });

  it.each(['2026-10-31T00:00:00', '2026-11-08T00:00:00'])(
    'check-in %s fora do período → ScreenNotRecognizedError (FR-010)',
    async (arrivalDate) => {
      respondWith(bookingsWithFirst({ arrivalDate }));

      const error = await searchBookings(api, '101', week, 1).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ScreenNotRecognizedError);
      expect((error as Error).message).toContain('fora do período');
    },
  );

  it('sessão expirada → SessionExpiredError', async () => {
    respondWith('', 401);
    await expect(searchBookings(api, '101', week, 1)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

describe('readBookingDetail (BookingDetail → ReservationSnapshot)', () => {
  it('consulta o detalhe pelo id interno, com o hotel', async () => {
    respondWith(detailFixture('pending'));

    await readBookingDetail(api, '101', item);

    expect(received).toHaveLength(1);
    expect(received[0]?.url.pathname).toBe('/api/Company/BookingDetail');
    expect(Object.fromEntries(received[0]?.url.searchParams ?? [])).toEqual({ id: '900001' });
    expect(received[0]?.companyId).toBe('101');
  });

  it('devolve a resposta como evidência e a listagem recebida', async () => {
    const body = detailFixture('pending');
    respondWith(body);

    const { snapshot, evidence } = await readBookingDetail(api, '101', item);

    expect(evidence).toEqual({ response: JSON.stringify(body) });
    expect(snapshot.reservationNumber).toBe('BK-1001');
    expect(snapshot.listing).toEqual(item.listing);
  });

  // Uma linha por linha da tabela de mapeamento do research R-13a.
  it.each([
    ['invoiced', {}, 'invoiced', 'active'],
    ['charge-at-terminal', {}, 'charge_at_terminal', 'active'],
    ['no-card-no-form', {}, 'analysis_error', 'active'],
    ['charge-error', {}, 'virtual_card_charge_error', 'active'],
    ['charged', {}, 'virtual_card_already_charged', 'active'],
    ['validated', {}, 'virtual_card_validated_only', 'active'],
    ['pending', {}, 'virtual_card_pending_charge', 'active'],
    ['cancelled-charged', {}, 'virtual_card_already_charged', 'cancelled'],
    ['charged', { lastPaymentEvent: null }, 'analysis_error', 'active'],
    ['pending', { canCharge: false }, 'analysis_error', 'active'],
    ['pending', { prePaymentStatus: 'Desconhecido' }, 'analysis_error', 'active'],
    ['pending', { prePaymentStatus: null }, 'analysis_error', 'active'],
    ['charge-at-terminal', { prePaymentStatus: 'Desconhecido' }, 'charge_at_terminal', 'active'],
    ['pending', { statusId: 7 }, 'virtual_card_pending_charge', 'unknown'],
  ] as const)('%s %o → %s / %s', async (fixture, changes, classification, reservationStatus) => {
    respondWith(detailFixture(fixture, changes));

    const { snapshot } = await readBookingDetail(api, '101', item);

    expect(classifyReservation(item.reservationNumber, snapshot)).toMatchObject({
      classification,
      reservationStatus,
    });
  });

  // Forma de pagamento (research R-22): código e rótulo do Hunit → valor neutro do domínio.
  it.each([
    ['código 1', { paymentTypeId: 1 }, { kind: 'credit_card', label: '1' }],
    [
      'código 1 e rótulo',
      { paymentTypeId: 1, totals: { paymentTypeLabel: 'cartão de crédito' } },
      { kind: 'credit_card', label: 'cartão de crédito' },
    ],
    [
      'rótulo "Cartão de Crédito" sem código',
      { totals: { paymentTypeLabel: 'Cartão de Crédito' } },
      { kind: 'credit_card', label: 'Cartão de Crédito' },
    ],
    [
      'rótulo "Faturado"',
      { totals: { paymentTypeLabel: 'Faturado' } },
      { kind: 'invoiced', label: 'Faturado' },
    ],
    [
      'rótulo "FATURADA " (maiúsculas e espaço)',
      { totals: { paymentTypeLabel: 'FATURADA ' } },
      { kind: 'invoiced', label: 'FATURADA' },
    ],
    [
      'código 1 com rótulo "faturado" (contraditório)',
      { paymentTypeId: 1, totals: { paymentTypeLabel: 'faturado' } },
      { kind: 'unrecognized', label: 'faturado' },
    ],
    ['código 6 sem rótulo', { paymentTypeId: 6 }, { kind: 'invoiced', label: '6' }],
    [
      'formato real de "faturado": código 6 e rótulo "faturado"',
      { paymentTypeId: 6, totals: { paymentTypeLabel: 'faturado' } },
      { kind: 'invoiced', label: 'faturado' },
    ],
    [
      'código 6 com rótulo "cartão de crédito" (contraditório)',
      { paymentTypeId: 6, totals: { paymentTypeLabel: 'cartão de crédito' } },
      { kind: 'unrecognized', label: 'cartão de crédito' },
    ],
    [
      'rótulo "Faturado" com código ainda desconhecido (o rótulo decide)',
      { paymentTypeId: 3, totals: { paymentTypeLabel: 'Faturado' } },
      { kind: 'invoiced', label: 'Faturado' },
    ],
    [
      'código 1 com rótulo de outra forma (contraditório)',
      { paymentTypeId: 1, totals: { paymentTypeLabel: 'Pix' } },
      { kind: 'unrecognized', label: 'Pix' },
    ],
    ['código desconhecido sem rótulo', { paymentTypeId: 7 }, { kind: 'unrecognized', label: '7' }],
    [
      'rótulo desconhecido',
      { totals: { paymentTypeLabel: 'Pix' } },
      { kind: 'unrecognized', label: 'Pix' },
    ],
    ['código e rótulo vazios', { paymentTypeId: null, totals: { paymentTypeLabel: '  ' } }, null],
    ['sem os campos', { paymentTypeId: undefined, totals: undefined }, null],
  ] as const)('forma de pagamento: %s → %o', async (_, changes, expected) => {
    respondWith(detailFixture('no-card-no-form', changes));

    const { snapshot } = await readBookingDetail(api, '101', item);

    expect(snapshot.paymentForm).toEqual(expected);
  });

  it('forma de pagamento com tipo errado → resposta não reconhecida', async () => {
    respondWith(detailFixture('no-card-no-form', { paymentTypeId: 'um' }));

    await expect(readBookingDetail(api, '101', item)).rejects.toBeInstanceOf(
      ScreenNotRecognizedError,
    );
  });

  it('preenche os dados do último evento de pagamento (FR-016)', async () => {
    respondWith(detailFixture('charged'));

    const { snapshot } = await readBookingDetail(api, '101', item);

    expect(snapshot).toMatchObject({
      prePaymentPresent: true,
      chargeFailed: false,
      chargeRecordPresent: true,
      validationOnly: false,
      chargeActionVisible: false,
      reservationStatus: 'active',
      payment: {
        // Sem fuso na resposta: horário de Brasília (UTC-3).
        chargedAt: '2026-11-02T14:30:00.000Z',
        chargedBy: 'Operador Exemplo',
        chargedAmount: '500.00',
        transactionId: 'TRX-0001',
        authorizationCode: 'AUT-0001',
        processorReference: 'REF-0001',
        isInstallment: false,
        installmentCount: 1,
        installmentAmount: '500.00',
        prePaymentState: 'Success',
        prePaymentMessage: 'Transação exemplo',
      },
    });
  });

  it('validação: valor zero e data do "Validado em"', async () => {
    respondWith(detailFixture('validated'));
    const { snapshot } = await readBookingDetail(api, '101', item);
    expect(snapshot.payment).toMatchObject({
      chargedAt: '2026-11-02T14:30:00.000Z',
      chargedAmount: '0.00',
    });
  });

  it('formato real (2026-11-11): fração de 7 dígitos e fuso', async () => {
    const body = detailFixture('charged');
    const event = body.lastPaymentEvent as Json;
    respondWith({
      ...body,
      lastPaymentEvent: { ...event, dateTime: '2026-11-02T11:30:00.1234567-03:00' },
    });

    const { snapshot } = await readBookingDetail(api, '101', item);

    expect(snapshot.payment.chargedAt).toBe('2026-11-02T14:30:00.123Z');
  });

  it('data com fuso é respeitada', async () => {
    const body = detailFixture('charged');
    const event = body.lastPaymentEvent as Json;
    respondWith({ ...body, lastPaymentEvent: { ...event, dateTime: '2026-11-02T11:30:00Z' } });

    const { snapshot } = await readBookingDetail(api, '101', item);

    expect(snapshot.payment.chargedAt).toBe('2026-11-02T11:30:00.000Z');
  });

  it('sem pré-pagamento e sem evento: pagamento vazio', async () => {
    respondWith(detailFixture('charge-at-terminal'));
    const { snapshot } = await readBookingDetail(api, '101', item);
    expect(snapshot.payment).toEqual({
      chargedAt: null,
      chargedBy: null,
      chargedAmount: null,
      transactionId: null,
      authorizationCode: null,
      processorReference: null,
      isInstallment: null,
      installmentCount: null,
      installmentAmount: null,
      prePaymentState: null,
      prePaymentMessage: null,
    });
  });

  it.each([
    ['sem hasCreditCardInfo', { hasCreditCardInfo: undefined }],
    ['sem canCharge', { canCharge: undefined }],
    ['statusId como texto', { statusId: 'cancelada' }],
    ['evento sem justValidate', { lastPaymentEvent: { user: 'X', dateTime: null } }],
    ['evento com data inválida', { lastPaymentEvent: { justValidate: false, dateTime: 'ontem' } }],
  ])(
    'campo obrigatório ausente ou inválido (%s) → ScreenNotRecognizedError com a resposta',
    async (_, changes) => {
      const body = detailFixture('charged', changes);
      respondWith(body);

      const error = await readBookingDetail(api, '101', item).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ScreenNotRecognizedError);
      expect((error as ScreenNotRecognizedError).evidence?.response).toBe(JSON.stringify(body));
    },
  );
});
