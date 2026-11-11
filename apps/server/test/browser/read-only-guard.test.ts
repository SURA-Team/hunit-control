import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installBrowserGuard, type BlockedRequest } from '../../src/hunit/read-only-guard.js';
import { launchTestBrowser } from '../helpers/browser.js';

const API = 'https://hunit-api.test';
const SITE = 'https://hunit.test';

let browser: Browser;
let context: BrowserContext;
let page: Page;
let blocked: BlockedRequest[];
/** Requisições que passaram pela proteção e chegaram ao "servidor" simulado. */
let reachedServer: string[];

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  blocked = [];
  reachedServer = [];
  context = await browser.newContext();

  // "Servidor" simulado: responde 200 a tudo o que a proteção deixar passar.
  await context.route('**/*', async (route) => {
    const request = route.request();
    reachedServer.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({
      status: 200,
      contentType: request.isNavigationRequest() ? 'text/html' : 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: request.isNavigationRequest() ? '<html><body>ok</body></html>' : '{}',
    });
  });
  await installBrowserGuard(context, {
    apiUrl: API,
    onBlocked: (request) => blocked.push(request),
  });

  page = await context.newPage();
  await page.goto(`${SITE}/login`);
});

afterEach(async () => {
  await context.close();
});

/** Faz a página pedir uma URL (como o site do Hunit faria) e diz o que aconteceu. */
function fetchFromPage(method: string, url: string): Promise<number | 'abortada'> {
  const call = `fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(method)} })`;
  return page.evaluate<number | 'abortada'>(`${call}.then((r) => r.status, () => 'abortada')`);
}

describe('installBrowserGuard (T045b, FR-012)', () => {
  it('deixa passar as requisições do login', async () => {
    expect(await fetchFromPage('GET', `${API}/api/Account/GetCurrentUser`)).toBe(200);
    expect(await fetchFromPage('POST', `${API}/signin-oidc`)).toBe(200);

    expect(blocked).toEqual([]);
    expect(reachedServer).toContain('GET /api/Account/GetCurrentUser');
    expect(reachedServer).toContain('POST /signin-oidc');
  });

  it('aborta rotas proibidas antes de saírem do navegador', async () => {
    expect(await fetchFromPage('POST', `${API}/api/Payment/ChargePrePayment`)).toBe('abortada');
    expect(await fetchFromPage('POST', `${API}/api/Company/CancelBooking`)).toBe('abortada');
    expect(await fetchFromPage('GET', `${API}/api/Payment/UpdatePrePaymentInformation?id=1`)).toBe(
      'abortada',
    );
    expect(await fetchFromPage('POST', `${API}/API/company/bookingpaymentdetails/`)).toBe(
      'abortada',
    );

    expect(blocked).toEqual([
      { method: 'POST', path: '/api/Payment/ChargePrePayment', reason: 'blocked_route' },
      { method: 'POST', path: '/api/Company/CancelBooking', reason: 'blocked_route' },
      { method: 'GET', path: '/api/Payment/UpdatePrePaymentInformation', reason: 'blocked_route' },
      { method: 'POST', path: '/API/company/bookingpaymentdetails/', reason: 'blocked_route' },
    ]);
    expect(reachedServer.filter((request) => /payment|cancel/i.test(request))).toEqual([]);
  });

  it('aborta o que a tela do Hunit pede por conta própria e não faz parte do login', async () => {
    expect(await fetchFromPage('GET', `${API}/api/Entity/GetBookings?Page=1`)).toBe('abortada');
    expect(await fetchFromPage('GET', `${API}/api/Account/ReleaseAccess`)).toBe('abortada');
    expect(await fetchFromPage('POST', `${API}/hubs/notifications/negotiate`)).toBe('abortada');

    expect(blocked.map((request) => `${request.method} ${request.path} ${request.reason}`)).toEqual(
      [
        'GET /api/Entity/GetBookings not_allowed',
        'GET /api/Account/ReleaseAccess not_allowed',
        'POST /hubs/notifications/negotiate not_allowed',
      ],
    );
  });

  it('não interfere em outros servidores (tela de login, arquivos do site)', async () => {
    expect(await fetchFromPage('POST', 'https://login.test/auth/login-actions/authenticate')).toBe(
      200,
    );
    expect(await fetchFromPage('GET', `${SITE}/assets/index.js`)).toBe(200);

    expect(blocked).toEqual([]);
  });

  it('aborta a navegação da página para uma rota proibida', async () => {
    await expect(page.goto(`${API}/api/Payment/ChargePrePayment`)).rejects.toThrow(
      /ERR_BLOCKED_BY_CLIENT/,
    );

    expect(blocked).toEqual([
      { method: 'GET', path: '/api/Payment/ChargePrePayment', reason: 'blocked_route' },
    ]);
  });

  it('deixa a página navegar para o início do login', async () => {
    const response = await page.goto(`${API}/api/Account/SSOLogin?returnUrl=%2F`);

    expect(response?.status()).toBe(200);
    expect(blocked).toEqual([]);
  });

  it('aborta o envio de formulário para uma rota proibida', async () => {
    await page.setContent(
      `<form method="post" action="${API}/api/Company/EditBooking"><button>Enviar</button></form>`,
    );

    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect.poll(() => blocked.length).toBe(1);

    expect(blocked).toEqual([
      { method: 'POST', path: '/api/Company/EditBooking', reason: 'blocked_route' },
    ]);
    expect(reachedServer).not.toContain('POST /api/Company/EditBooking');
  });

  it('fecha conexões em tempo real com o hunit-api', async () => {
    const outcome = await page.evaluate<string>(`new Promise((resolve) => {
      const socket = new WebSocket('wss://hunit-api.test/hubs/notifications?id=1');
      socket.onopen = () => resolve('aberta');
      socket.onclose = () => resolve('fechada');
      setTimeout(() => resolve('sem resposta'), 5000);
    })`);

    expect(outcome).toBe('fechada');
    expect(blocked).toEqual([
      { method: 'WEBSOCKET', path: '/hubs/notifications', reason: 'not_allowed' },
    ]);
  });

  it('vale para todas as páginas do contexto, inclusive as abertas depois', async () => {
    const other = await context.newPage();
    await other.goto(`${SITE}/outra`);

    const result = await other.evaluate<number | 'abortada'>(
      `fetch('${API}/api/Payment/ChargePrePayment', { method: 'POST' }).then((r) => r.status, () => 'abortada')`,
    );

    expect(result).toBe('abortada');
    expect(blocked).toHaveLength(1);
  });
});
