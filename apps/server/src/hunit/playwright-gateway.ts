import type { ReservationSnapshot } from '@hunit/domain';
import type { Browser, BrowserContext, Page } from 'playwright';
import { capturePageEvidence } from '../evidence/capture.js';
import type { Logger } from '../logging.js';
import { launchBrowser, newHunitContext } from './browser.js';
import {
  HunitUnavailableError,
  InvalidCredentialsError,
  InvalidTokenError,
  ScreenNotRecognizedError,
  TwoFactorTimeoutError,
  type HunitError,
} from './errors.js';
import type {
  CreateHunitGateway,
  HunitCredentials,
  HunitGateway,
  HunitHotel,
  LoginOutcome,
  ReservationPage,
} from './gateway.js';
import { HunitEntryPage, isLoginExpiredPage, LoginPage, TwoFactorPage } from './login-pages.js';
import { HunitApiClient } from './network/api-client.js';
import { readCatalog } from './network/catalog.js';
import { installBrowserGuard, type BlockedRequest } from './read-only-guard.js';

export interface PlaywrightGatewayOptions {
  /** Endereço da tela do Hunit (HUNIT_WEB_URL). */
  webUrl: string;
  /** Endereço da API interna do Hunit (HUNIT_API_URL). */
  apiUrl: string;
  logger: Logger;
  /** Tempo máximo de cada etapa (abrir a tela, esperar a resposta a um envio). Padrão: 30 s. */
  stepTimeoutMs?: number;
  /** Abre o navegador. Padrão: Chromium sem janela. */
  launch?: () => Promise<Browser>;
  /**
   * Chamado com o contexto novo, antes de a proteção de somente leitura ser instalada. Usado
   * pelos testes para simular o Hunit.
   */
  configureContext?: (context: BrowserContext) => Promise<void>;
  /**
   * Chamado quando uma tela do login é reconhecida. Usado pela verificação manual do login
   * (`hunit-login-check`) para guardar as telas reais como material de fixtures (T020).
   */
  onScreen?: (screen: 'hunit_entry' | 'login' | 'two_factor', page: Page) => Promise<void>;
}

const DEFAULT_STEP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

type Probe<T> = readonly [outcome: T, test: () => Promise<boolean>];

/**
 * Cria o gateway real: Playwright para o login com token (Page Objects) e a API interna do
 * Hunit para as leituras (research R-13a).
 */
export function createPlaywrightGatewayFactory(
  options: PlaywrightGatewayOptions,
): CreateHunitGateway {
  return async ({ executionId }) =>
    PlaywrightHunitGateway.open(options, options.logger.child({ executionId }));
}

export class PlaywrightHunitGateway implements HunitGateway {
  private readonly entryPage: HunitEntryPage;
  private readonly loginPage: LoginPage;
  private readonly twoFactorPage: TwoFactorPage;
  private readonly api: HunitApiClient;
  private readonly stepTimeoutMs: number;
  /** Mostrado por extenso na tela do token; coberto nas capturas de tela. */
  private username: string | null = null;
  private closed = false;

  private constructor(
    private readonly options: PlaywrightGatewayOptions,
    private readonly logger: Logger,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    /** Requisições abortadas pela proteção de somente leitura nesta sessão. */
    readonly blockedRequests: readonly BlockedRequest[],
  ) {
    this.stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    this.entryPage = new HunitEntryPage(page);
    this.loginPage = new LoginPage(page);
    this.twoFactorPage = new TwoFactorPage(page);
    this.api = new HunitApiClient(context.request, {
      apiUrl: options.apiUrl,
      webUrl: options.webUrl,
      timeoutMs: this.stepTimeoutMs,
    });
  }

  static async open(
    options: PlaywrightGatewayOptions,
    logger: Logger,
  ): Promise<PlaywrightHunitGateway> {
    const browser = await (options.launch ?? launchBrowser)();
    try {
      const context = await newHunitContext(browser);
      await options.configureContext?.(context);

      const blocked: BlockedRequest[] = [];
      // A proteção vem antes de qualquer página: nada sai do navegador sem passar por ela.
      await installBrowserGuard(context, {
        apiUrl: options.apiUrl,
        onBlocked: (request) => {
          blocked.push(request);
          if (request.sent) {
            logger.warn(
              { blocked: request },
              'redirecionamento para rota do Hunit fora da lista de permissão',
            );
          } else {
            logger.debug({ blocked: request }, 'requisição ao Hunit bloqueada pela proteção');
          }
        },
      });

      const page = await context.newPage();
      page.setDefaultTimeout(options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);
      return new PlaywrightHunitGateway(options, logger, browser, context, page, blocked);
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  async login(credentials: HunitCredentials): Promise<LoginOutcome> {
    this.username = credentials.username;
    await this.openLoginScreen();
    await this.loginPage.submit(credentials.username, credentials.password);

    const outcome = await this.waitFor(
      [
        ['two_factor', () => this.twoFactorPage.isShown()],
        ['invalid', () => this.loginPage.isShowingError()],
        ['authenticated', () => Promise.resolve(this.isOnHunitApp())],
      ],
      'depois de enviar usuário e senha, não apareceu a tela do token, uma mensagem de erro nem o Hunit',
    );

    if (outcome === 'two_factor') {
      await this.options.onScreen?.('two_factor', this.page);
      return 'two_factor_required';
    }
    if (outcome === 'invalid') {
      throw new InvalidCredentialsError({ evidence: await this.captureScreen() });
    }
    await this.finishAccess();
    return 'authenticated';
  }

  async submitToken(token: string): Promise<void> {
    if (!(await this.twoFactorPage.isShown())) {
      // A tela do token sumiu enquanto o operador digitava: o Keycloak encerrou a tentativa.
      await this.failWithExpiredOrUnknown('a tela do token não está mais aberta');
    }
    await this.twoFactorPage.submit(token);

    const outcome = await this.waitFor(
      [
        ['authenticated', () => Promise.resolve(this.isOnHunitApp())],
        ['invalid', () => this.twoFactorPage.isShowingError()],
        ['expired', () => this.isLoginExpired()],
      ],
      'depois de enviar o token, não apareceu o Hunit, uma mensagem de erro nem a tela de login',
    );

    if (outcome === 'invalid') {
      throw new InvalidTokenError({ evidence: await this.captureScreen() });
    }
    if (outcome === 'expired') {
      throw new TwoFactorTimeoutError({ evidence: await this.captureScreen() });
    }
    await this.finishAccess();
  }

  async listHotels(): Promise<HunitHotel[]> {
    return readCatalog(this.api);
  }

  // Os parâmetros (hotel, período, página; hotel, reserva) entram com a T046.
  searchReservations(): Promise<ReservationPage> {
    return Promise.reject(
      new Error('Consulta de reservas ainda não implementada (tasks.md, T046).'),
    );
  }

  readReservation(): Promise<ReservationSnapshot> {
    return Promise.reject(new Error('Leitura de reserva ainda não implementada (tasks.md, T046).'));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.username = null;
    try {
      await this.context.close();
    } finally {
      await this.browser.close();
    }
  }

  /**
   * Abre o Hunit e chega à tela de usuário e senha. A tela de entrada do Hunit mostra o botão
   * "Login único", que leva ao login; se o Hunit redirecionar direto, o botão é dispensado.
   */
  private async openLoginScreen(): Promise<void> {
    try {
      await this.page.goto(new URL('/login', this.options.webUrl).toString(), {
        waitUntil: 'domcontentloaded',
      });
    } catch (error) {
      throw new HunitUnavailableError('a tela do Hunit não abriu', { cause: error });
    }

    const first = await this.waitFor(
      [
        ['login', () => this.loginPage.isShown()],
        ['entry', () => this.entryPage.isShown()],
      ],
      'não apareceu a tela de entrada do Hunit (botão "Login único") nem a de login',
    );
    if (first === 'entry') {
      await this.options.onScreen?.('hunit_entry', this.page);
      await this.entryPage.continueToLogin();
      await this.waitFor(
        [['login', () => this.loginPage.isShown()]],
        'depois do botão "Login único", a tela de login (campos "Endereço de e-mail" e "Senha") não apareceu',
      );
    }
    await this.options.onScreen?.('login', this.page);
  }

  /**
   * O acesso terminou na tela do Hunit: confere a sessão pela API e sai da tela, para que ela não
   * fique disparando as próprias requisições (todas bloqueadas pela proteção).
   */
  private async finishAccess(): Promise<void> {
    await this.page.goto('about:blank').catch(() => undefined);
    this.assertNoRedirectViolation();
    // Lança SessionExpiredError se o login não criou a sessão na API.
    await readCatalog(this.api);
  }

  /**
   * Um redirecionamento levou o navegador a uma rota do Hunit fora da lista de permissão (a
   * proteção só consegue detectar esses saltos, não abortá-los). O fluxo do Hunit não é o
   * mapeado: o acesso é interrompido, citando a rota, para ela ser avaliada (research R-13a).
   */
  private assertNoRedirectViolation(): void {
    const sent = this.blockedRequests.filter((request) => request.sent);
    if (sent.length === 0) return;
    const routes = [...new Set(sent.map((request) => `${request.method} ${request.path}`))];
    throw new ScreenNotRecognizedError(
      `o login passou por rota do Hunit fora da lista de permissão: ${routes.join(', ')}`,
    );
  }

  private isOnHunitApp(): boolean {
    try {
      return new URL(this.page.url()).origin === new URL(this.options.webUrl).origin;
    } catch {
      return false;
    }
  }

  /** Depois do token: voltar à tela de usuário e senha, ou a página de expiração, é expiração. */
  private async isLoginExpired(): Promise<boolean> {
    return (await this.loginPage.isShown()) || (await isLoginExpiredPage(this.page));
  }

  private async failWithExpiredOrUnknown(detail: string): Promise<never> {
    const evidence = await this.captureScreen();
    if (await this.isLoginExpired()) throw new TwoFactorTimeoutError({ evidence });
    throw new ScreenNotRecognizedError(detail, { evidence });
  }

  /**
   * Espera a primeira situação reconhecida, na ordem dada. Se nenhuma aparecer no prazo, a tela
   * é desconhecida: `ScreenNotRecognizedError` com captura de tela e HTML (ou
   * `HunitUnavailableError`, se a página nem carregou).
   */
  private async waitFor<T>(probes: ReadonlyArray<Probe<T>>, detail: string): Promise<T> {
    const deadline = Date.now() + this.stepTimeoutMs;
    for (;;) {
      for (const [outcome, test] of probes) {
        if (await test().catch(() => false)) return outcome;
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw await this.unrecognized(detail);
  }

  private async unrecognized(detail: string): Promise<HunitError> {
    const blocked = this.blockedRequests.map(
      (request) => `${request.method} ${request.path}${request.sent ? ' (redirecionamento)' : ''}`,
    );
    const fullDetail =
      blocked.length > 0
        ? `${detail} (requisições bloqueadas pela proteção: ${[...new Set(blocked)].join(', ')})`
        : detail;

    if (this.page.url().startsWith('chrome-error://') && blocked.length === 0) {
      return new HunitUnavailableError('a página do Hunit não carregou');
    }
    return new ScreenNotRecognizedError(fullDetail, { evidence: await this.captureScreen() });
  }

  private captureScreen() {
    return capturePageEvidence(this.page, {
      sensitiveTexts: this.username ? [this.username] : [],
    });
  }
}
