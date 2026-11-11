/**
 * Acesso ao Hunit pela camada real (T027, T032): Page Objects contra as fixtures de HTML e o
 * gateway Playwright contra o "Hunit" falso em HTTP.
 *
 * ATENÇÃO: as fixtures de login ainda são reconstruídas a partir dos HARs (research R-13). As
 * mensagens de erro seguem o padrão do Keycloak e precisam ser confirmadas com as telas reais
 * (tasks.md, T020/T021).
 */
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  HunitUnavailableError,
  InvalidCredentialsError,
  InvalidTokenError,
  ScreenNotRecognizedError,
  TwoFactorTimeoutError,
  type HunitError,
} from '../../src/hunit/errors.js';
import {
  HunitEntryPage,
  isLoginExpiredPage,
  LoginPage,
  TwoFactorPage,
} from '../../src/hunit/login-pages.js';
import { PlaywrightHunitGateway } from '../../src/hunit/playwright-gateway.js';
import { launchTestBrowser } from '../helpers/browser.js';
import {
  readHtmlFixture,
  startFakeHunitServer,
  type FakeHunitServer,
  type FakeHunitServerOptions,
} from '../helpers/fake-hunit-server.js';
import { captureLogs } from '../helpers/log-capture.js';

const USERNAME = 'operador.fixture@hotel.test';
const PASSWORD = 'SENHA-DA-FIXTURE-123';
const TOKEN = '246810';

let browser: Browser;

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser.close();
});

describe('Page Objects de login e token contra as fixtures', () => {
  let page: Page;

  beforeAll(async () => {
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page.close();
  });

  async function show(fixture: string) {
    await page.setContent(readHtmlFixture(fixture, { action: '#', username: USERNAME }));
    return { login: new LoginPage(page), twoFactor: new TwoFactorPage(page) };
  }

  it('reconhece a tela de entrada do Hunit pelo botão "Login único"', async () => {
    const { login } = await show('hunit-entry.html');

    expect(await new HunitEntryPage(page).isShown()).toBe(true);
    expect(await login.isShown()).toBe(false);
  });

  it('reconhece a tela de usuário e senha, sem erro', async () => {
    const { login, twoFactor } = await show('login.html');

    expect(await login.isShown()).toBe(true);
    expect(await login.isShowingError()).toBe(false);
    expect(await twoFactor.isShown()).toBe(false);
  });

  it('reconhece a mensagem de senha inválida', async () => {
    const { login } = await show('login-error.html');

    expect(await login.isShowingError()).toBe(true);
  });

  it('reconhece a tela do token e a mensagem de token inválido', async () => {
    const shown = await show('two-factor.html');
    expect(await shown.twoFactor.isShown()).toBe(true);
    expect(await shown.twoFactor.isShowingError()).toBe(false);
    expect(await shown.login.isShown()).toBe(false);

    const failed = await show('two-factor-error.html');
    expect(await failed.twoFactor.isShowingError()).toBe(true);
  });

  it('aceita também o rótulo "Código de uso único" na tela do token', async () => {
    await page.setContent(
      readHtmlFixture('two-factor.html', { action: '#', username: USERNAME }).replace(
        'Código do Autenticador',
        'Código de uso único',
      ),
    );

    expect(await new TwoFactorPage(page).isShown()).toBe(true);
  });

  it('reconhece a página de login expirado', async () => {
    await show('page-expired.html');
    expect(await isLoginExpiredPage(page)).toBe(true);

    await show('login.html');
    expect(await isLoginExpiredPage(page)).toBe(false);
  });

  it('não reconhece uma tela com rótulos diferentes (o Hunit mudou)', async () => {
    await page.setContent(
      readHtmlFixture('login.html', { action: '#' })
        .replace('Endereço de e-mail', 'Usuário')
        .replace('>Senha<', '>Palavra-passe<'),
    );

    expect(await new LoginPage(page).isShown()).toBe(false);
  });

  it('preenche e envia o formulário pelos rótulos', async () => {
    const { login } = await show('login.html');
    let submitted: URLSearchParams | null = null;
    await page.route('**/enviar', async (route) => {
      submitted = new URLSearchParams(route.request().postData() ?? '');
      await route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' });
    });
    await page.setContent(readHtmlFixture('login.html', { action: 'http://login.test/enviar' }));

    await login.submit(USERNAME, PASSWORD);

    await expect.poll(() => submitted?.get('username')).toBe(USERNAME);
    expect((submitted as URLSearchParams | null)?.get('password')).toBe(PASSWORD);
  });
});

describe('PlaywrightHunitGateway contra o Hunit falso', () => {
  let server: FakeHunitServer | null = null;
  let gateway: PlaywrightHunitGateway | null = null;

  afterEach(async () => {
    await gateway?.close();
    await server?.close();
    gateway = null;
    server = null;
  });

  async function open(options: Partial<FakeHunitServerOptions> = {}, stepTimeoutMs = 10_000) {
    server = await startFakeHunitServer({
      username: USERNAME,
      password: PASSWORD,
      token: TOKEN,
      ...options,
    });
    gateway = await PlaywrightHunitGateway.open(
      {
        webUrl: server.webUrl,
        apiUrl: server.apiUrl,
        logger: captureLogs().logger,
        stepTimeoutMs,
      },
      captureLogs().logger,
    );
    return { server, gateway };
  }

  async function rejection(promise: Promise<unknown>): Promise<HunitError> {
    try {
      await promise;
    } catch (error) {
      return error as HunitError;
    }
    throw new Error('era esperada uma falha');
  }

  it('depois do acesso, lê listagem e detalhe com a sessão do navegador e o hotel no cabeçalho', async () => {
    const { server, gateway } = await open();
    await gateway.login({ username: USERNAME, password: PASSWORD });
    await gateway.submitToken(TOKEN);

    const page = await gateway.searchReservations(
      '101',
      { from: '2026-11-01', to: '2026-11-07' },
      1,
    );
    const first = page.items[0];
    if (!first) throw new Error('a listagem da fixture veio vazia');
    const { snapshot } = await gateway.readReservation('101', first);

    expect(page).toMatchObject({ page: 1, totalPages: 2, totalItems: 3 });
    expect(snapshot).toMatchObject({ reservationNumber: 'BK-1001', chargeRecordPresent: true });
    expect(server.apiReads.map((read) => [read.url.split('?')[0], read.companyId])).toEqual([
      ['/api/Entity/GetBookings', '101'],
      ['/api/Company/BookingDetail', '101'],
    ]);
  });

  it('leitura de reservas sem sessão válida → SessionExpiredError', async () => {
    const { gateway } = await open();

    const error = await rejection(
      gateway.searchReservations('101', { from: '2026-11-01', to: '2026-11-07' }, 1),
    );

    expect(error.code).toBe('session_expired');
  });

  it('login com token: pede o token, conclui o acesso e lê o catálogo de hotéis ativos', async () => {
    const { server, gateway } = await open();

    expect(await gateway.login({ username: USERNAME, password: PASSWORD })).toBe(
      'two_factor_required',
    );
    await gateway.submitToken(TOKEN);

    expect(server.tokensReceived).toEqual([TOKEN]);
    expect(await gateway.listHotels()).toEqual([
      { code: '101', name: 'Hotel Exemplo Centro' },
      { code: '102', name: 'Hotel Exemplo Praia' },
    ]);
    // O que a tela do Hunit pede sozinha nunca chega à API (bloqueado, ou a tela já foi deixada).
    expect(server.apiRequests).not.toContain('GET /api/Account/MenuCapabilities');
    expect(gateway.blockedRequests.filter((request) => request.sent)).toEqual([]);
  });

  it('tela de entrada que redireciona direto (sem o botão): também chega ao login', async () => {
    const { gateway } = await open({ directRedirect: true });

    expect(await gateway.login({ username: USERNAME, password: PASSWORD })).toBe(
      'two_factor_required',
    );
  });

  it('login sem token: conclui o acesso direto', async () => {
    const { gateway } = await open({ skipTwoFactor: true });

    expect(await gateway.login({ username: USERNAME, password: PASSWORD })).toBe('authenticated');
    expect(await gateway.listHotels()).toHaveLength(2);
  });

  it('senha errada: InvalidCredentialsError com evidência sem a senha', async () => {
    const { gateway } = await open();

    const error = await rejection(gateway.login({ username: USERNAME, password: 'errada-123' }));

    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect(error.evidence?.screenshot?.length).toBeGreaterThan(0);
    expect(error.evidence?.html).toContain('Nome de usuário ou senha inválida.');
    expect(error.evidence?.html).not.toContain('errada-123');
  });

  it('token errado: InvalidTokenError', async () => {
    const { gateway } = await open();
    await gateway.login({ username: USERNAME, password: PASSWORD });

    expect(await rejection(gateway.submitToken('000000'))).toBeInstanceOf(InvalidTokenError);
  });

  it.each([['login'], ['page']] as const)(
    'tentativa de login expirada (%s): TwoFactorTimeoutError',
    async (expireOnToken) => {
      const { gateway } = await open({ expireOnToken });
      await gateway.login({ username: USERNAME, password: PASSWORD });

      expect(await rejection(gateway.submitToken(TOKEN))).toBeInstanceOf(TwoFactorTimeoutError);
    },
  );

  it('tela de login alterada: ScreenNotRecognizedError com captura e HTML', async () => {
    const changed = readHtmlFixture('login.html', {
      action: '/login-actions/authenticate',
    }).replace('Endereço de e-mail', 'Usuário');
    const { gateway } = await open({ loginScreen: changed }, 1_500);

    const error = await rejection(gateway.login({ username: USERNAME, password: PASSWORD }));

    expect(error).toBeInstanceOf(ScreenNotRecognizedError);
    expect(error.message).toContain('Endereço de e-mail');
    expect(error.evidence?.screenshot?.length).toBeGreaterThan(0);
    expect(error.evidence?.html).toContain('Usuário');
  });

  it('retorno do login (redirecionamento) numa rota fora da lista: interrompe citando a rota', async () => {
    const { gateway } = await open({ callbackPath: '/outra-rota-de-retorno' }, 2_000);
    await gateway.login({ username: USERNAME, password: PASSWORD });

    const error = await rejection(gateway.submitToken(TOKEN));

    // Limite do Playwright: o salto de redirecionamento não pode ser abortado, só detectado.
    expect(error).toBeInstanceOf(ScreenNotRecognizedError);
    expect(error.message).toContain('GET /outra-rota-de-retorno');
    expect(gateway.blockedRequests).toContainEqual({
      method: 'GET',
      path: '/outra-rota-de-retorno',
      reason: 'not_allowed',
      sent: true,
    });
  });

  it('Hunit fora do ar: HunitUnavailableError', async () => {
    const { server, gateway } = await open();
    await server.close();

    expect(
      await rejection(gateway.login({ username: USERNAME, password: PASSWORD })),
    ).toBeInstanceOf(HunitUnavailableError);
  });
});
