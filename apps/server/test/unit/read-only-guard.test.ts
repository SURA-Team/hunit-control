import { describe, expect, it } from 'vitest';
import {
  API_CLIENT_ALLOWED_ROUTES,
  assertApiClientRequest,
  BROWSER_LOGIN_ALLOWED_ROUTES,
  checkApiClientRequest,
  checkBrowserRequest,
  isBlockedRoute,
  ReadOnlyGuardError,
} from '../../src/hunit/read-only-guard.js';

const API = 'https://hunit-api.hsystem.com.br';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Rotas que o sistema nunca pode chamar (research R-13a, "Rotas que o sistema NUNCA pode
 * chamar"). Cada uma é testada com todos os métodos e em várias grafias.
 */
const DANGEROUS_ROUTES = [
  '/api/Payment/CalculePrePayment',
  '/api/Payment/ChargePrePayment',
  '/api/Payment/UpdatePrePaymentInformation',
  '/api/Payment/UpdatePrePaymentInformationPost',
  '/api/Company/BookingPaymentDetails',
  '/api/Company/CancelBooking',
  '/api/Company/EditBooking',
  '/api/Company/ReactivateIntegration',
  '/api/bookings/18921964/events/cancel-invalid-card',
  '/api/bookings/18921964/events/update-dates',
  '/api/bookings/18921964/events',
];

/** Grafias diferentes que o servidor do Hunit trataria como a mesma rota. */
function spellings(route: string): string[] {
  const lastSegment = route.slice(route.lastIndexOf('/') + 1);
  const encodedFirstLetter = `%${lastSegment.charCodeAt(0).toString(16)}${lastSegment.slice(1)}`;
  return [
    route,
    route.toLowerCase(),
    route.toUpperCase(),
    `${route}/`,
    `${route}?id=1&x=2`,
    route.replace('/api/', '/api//'),
    route.replace('/api/', '//api/'),
    route.slice(0, route.lastIndexOf('/') + 1) + encodedFirstLetter,
    route.replaceAll('/', '%2F').replace('%2F', '/'),
    `/x/..${route}`,
  ];
}

describe('lista de bloqueio (T045, FR-012)', () => {
  it.each(DANGEROUS_ROUTES)('reconhece %s como rota proibida, em qualquer grafia', (route) => {
    for (const spelling of spellings(route)) {
      const { pathname } = new URL(`${API}${spelling}`);
      expect(isBlockedRoute(pathname), spelling).toBe(true);
    }
  });

  it('bloqueia as ações perigosas mesmo fora do caminho conhecido', () => {
    for (const path of [
      '/api/Outro/ChargePrePayment',
      '/api/v2/Company/CancelBooking',
      '/api/Company/EditBookingV2',
      '/api/Payment',
      '/api/Payment/QualquerCoisaNova',
      '/api/Company/BookingPaymentDetails/123',
    ]) {
      expect(isBlockedRoute(path), path).toBe(true);
    }
  });

  it('trata como bloqueado o caminho que não dá para interpretar', () => {
    expect(isBlockedRoute('/api/%E0%A4%A')).toBe(true);
  });

  it('não bloqueia as rotas de leitura', () => {
    for (const path of [
      ...API_CLIENT_ALLOWED_ROUTES,
      '/api/Company/ForBooking',
      '/api/bookings/18921964/channel-eligibility',
      '/api/Entity/GetChannels',
    ]) {
      expect(isBlockedRoute(path), path).toBe(false);
    }
  });

  it('nenhuma rota das listas de permissão é uma rota proibida', () => {
    const allowed = [
      ...API_CLIENT_ALLOWED_ROUTES,
      ...BROWSER_LOGIN_ALLOWED_ROUTES.map((route) => route.path),
    ];

    expect(allowed.filter((path) => isBlockedRoute(path))).toEqual([]);
  });
});

describe('cliente da API do sistema (T045a)', () => {
  it('permite exatamente quatro rotas de leitura', () => {
    expect(API_CLIENT_ALLOWED_ROUTES).toEqual([
      '/api/Account/GetCurrentUser',
      '/api/Account/GetCurrentUserCompanies',
      '/api/Entity/GetBookings',
      '/api/Company/BookingDetail',
    ]);
  });

  it.each(API_CLIENT_ALLOWED_ROUTES)('permite GET %s, com ou sem parâmetros', (route) => {
    expect(checkApiClientRequest('GET', `${API}${route}`, API)).toEqual({ allowed: true });
    expect(checkApiClientRequest('get', `${API}${route}?Page=2&PageSize=30`, API)).toEqual({
      allowed: true,
    });
    expect(checkApiClientRequest('GET', `${API}${route.toLowerCase()}/`, API)).toEqual({
      allowed: true,
    });
  });

  it.each(API_CLIENT_ALLOWED_ROUTES)('recusa qualquer método diferente de GET em %s', (route) => {
    for (const method of METHODS.filter((candidate) => candidate !== 'GET')) {
      expect(checkApiClientRequest(method, `${API}${route}`, API), method).toEqual({
        allowed: false,
        reason: 'not_allowed',
      });
    }
  });

  it.each(DANGEROUS_ROUTES)('recusa %s com qualquer método e grafia', (route) => {
    for (const method of METHODS) {
      for (const spelling of spellings(route)) {
        expect(
          checkApiClientRequest(method, `${API}${spelling}`, API),
          `${method} ${spelling}`,
        ).toEqual({
          allowed: false,
          reason: 'blocked_route',
        });
      }
    }
  });

  it.each([
    '/api/Company/ForBooking?bookingId=1',
    '/api/bookings/18921964/channel-eligibility',
    '/api/Account/SelectCompany',
    '/api/Account/ReleaseAccess',
    '/api/Account/SSOLogin',
    '/api/Entity/GetBookingsExport',
    '/api/Entity/GetBookings/extra',
    '/hubs/notifications/negotiate',
    '/signin-oidc',
    '/',
  ])('recusa GET em rota fora da lista de permissão: %s', (route) => {
    expect(checkApiClientRequest('GET', `${API}${route}`, API)).toEqual({
      allowed: false,
      reason: 'not_allowed',
    });
  });

  it('recusa outro servidor, outra porta ou conexão sem HTTPS', () => {
    const route = '/api/Entity/GetBookings';
    for (const url of [
      `https://hunit.hsystem.com.br${route}`,
      `https://hunit-api.hsystem.com.br.exemplo.test${route}`,
      `https://exemplo.test/hunit-api.hsystem.com.br${route}`,
      `http://hunit-api.hsystem.com.br${route}`,
      `https://hunit-api.hsystem.com.br:8443${route}`,
      `https://usuario@hunit-api.hsystem.com.br.exemplo.test${route}`,
    ]) {
      expect(checkApiClientRequest('GET', url, API), url).toEqual({
        allowed: false,
        reason: 'not_allowed',
      });
    }
  });

  it('recusa URL inválida', () => {
    expect(checkApiClientRequest('GET', '/api/Entity/GetBookings', API)).toEqual({
      allowed: false,
      reason: 'invalid_url',
    });
    expect(checkApiClientRequest('GET', `${API}/api/Entity/GetBookings`, 'não é url')).toEqual({
      allowed: false,
      reason: 'invalid_url',
    });
  });

  it('assertApiClientRequest lança um erro que cita método e caminho, sem os parâmetros', () => {
    expect(() =>
      assertApiClientRequest('GET', `${API}/api/Entity/GetBookings?Page=1`, API),
    ).not.toThrow();

    let error: unknown;
    try {
      assertApiClientRequest('post', `${API}/api/Payment/ChargePrePayment?bookingId=123`, API);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ReadOnlyGuardError);
    expect(error).toMatchObject({
      method: 'POST',
      path: '/api/Payment/ChargePrePayment',
      reason: 'blocked_route',
    });
    expect((error as Error).message).toBe(
      'Requisição ao Hunit recusada pela proteção de somente leitura: ' +
        'POST /api/Payment/ChargePrePayment (blocked_route).',
    );
  });
});

describe('página aberta no navegador (T045b)', () => {
  it.each(BROWSER_LOGIN_ALLOWED_ROUTES)('permite $method $path (login)', ({ method, path }) => {
    expect(checkBrowserRequest(method, `${API}${path}?returnUrl=x`, API)).toEqual({
      allowed: true,
    });
  });

  it('permite a consulta prévia (OPTIONS) só das rotas do login', () => {
    expect(checkBrowserRequest('OPTIONS', `${API}/api/Account/GetCurrentUser`, API)).toEqual({
      allowed: true,
    });
    expect(checkBrowserRequest('OPTIONS', `${API}/api/Entity/GetBookings`, API)).toEqual({
      allowed: false,
      reason: 'not_allowed',
    });
  });

  it.each([
    ['POST', '/api/Account/GetCurrentUser'],
    ['POST', '/api/Account/SSOLogin'],
    ['POST', '/api/Account/SelectCompany'],
    ['GET', '/api/Account/ReleaseAccess'],
    ['GET', '/api/Entity/GetBookings'],
    ['GET', '/api/Company/BookingDetail'],
    ['GET', '/api/Company/MenuCapabilities'],
    ['POST', '/hubs/notifications/negotiate'],
    ['DELETE', '/signin-oidc'],
  ])('aborta %s %s (não faz parte do login)', (method, path) => {
    expect(checkBrowserRequest(method, `${API}${path}`, API)).toEqual({
      allowed: false,
      reason: 'not_allowed',
    });
  });

  it.each(DANGEROUS_ROUTES)('aborta %s com qualquer método e grafia', (route) => {
    for (const method of METHODS) {
      for (const spelling of spellings(route)) {
        expect(
          checkBrowserRequest(method, `${API}${spelling}`, API),
          `${method} ${spelling}`,
        ).toEqual({
          allowed: false,
          reason: 'blocked_route',
        });
      }
    }
  });

  it('controla o hunit-api também sem HTTPS ou em outra porta', () => {
    expect(
      checkBrowserRequest(
        'POST',
        'http://hunit-api.hsystem.com.br/api/Payment/ChargePrePayment',
        API,
      ),
    ).toEqual({ allowed: false, reason: 'blocked_route' });
    expect(
      checkBrowserRequest(
        'GET',
        'https://hunit-api.hsystem.com.br:8443/api/Entity/GetBookings',
        API,
      ),
    ).toEqual({ allowed: false, reason: 'not_allowed' });
  });

  it('não interfere nas requisições a outros servidores (tela de login, arquivos do site)', () => {
    for (const [method, url] of [
      ['GET', 'https://hunit.hsystem.com.br/login'],
      ['GET', 'https://hunit.hsystem.com.br/assets/index.js'],
      ['POST', 'https://login.hsystem.com.br/auth/realms/hsystem/login-actions/authenticate'],
    ] as const) {
      expect(checkBrowserRequest(method, url, API), url).toEqual({ allowed: true });
    }
  });

  it('recusa URL inválida', () => {
    expect(checkBrowserRequest('GET', 'não é url', API)).toEqual({
      allowed: false,
      reason: 'invalid_url',
    });
  });
});
