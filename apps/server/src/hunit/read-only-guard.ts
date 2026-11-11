/**
 * Proteção de somente leitura (FR-012, SC-003; research R-13a; constitution, princípio II).
 *
 * O sistema nunca pode cobrar, alterar ou cancelar nada no Hunit, nem ver dados de cartão.
 * Como a API interna do Hunit tem rotas que fazem exatamente isso, toda requisição a ela
 * passa por aqui, em duas frentes:
 *
 * 1. `assertApiClientRequest` — o que o NOSSO cliente da API pode pedir: só GET, só as rotas
 *    de leitura de `API_CLIENT_ALLOWED_ROUTES`;
 * 2. `installBrowserGuard` — o que a PÁGINA aberta no navegador pode pedir ao hunit-api: só o
 *    necessário para o login (`BROWSER_LOGIN_ALLOWED_ROUTES`); o resto é abortado.
 *
 *    Limite do Playwright: num redirecionamento HTTP ("302, vá para X"), só o primeiro endereço
 *    passa pela interceptação; o salto para X sai do navegador sem poder ser abortado. Esses
 *    saltos são DETECTADOS e informados com `sent: true`, e quem usa o navegador (o gateway)
 *    interrompe o acesso. Na prática só o login (Keycloak e a própria API) redireciona.
 *
 * Nas duas, a lista de bloqueio (`isBlockedRoute`) é conferida primeiro e vence qualquer
 * permissão: mesmo que alguém acrescente por engano uma rota perigosa a uma lista de
 * permissão, ela continua bloqueada.
 */
import type { BrowserContext } from 'playwright';

/** Rotas de leitura que o cliente da API do sistema pode chamar, sempre com GET. */
export const API_CLIENT_ALLOWED_ROUTES: readonly string[] = [
  '/api/Account/GetCurrentUser', // usuário logado e catálogo de hotéis
  '/api/Account/GetCurrentUserCompanies', // catálogo de hotéis (paginado)
  '/api/Entity/GetBookings', // listagem de reservas
  '/api/Company/BookingDetail', // detalhe de uma reserva
];

export interface AllowedBrowserRoute {
  method: string;
  path: string;
}

/** Requisições ao hunit-api que a página faz durante o login com 2FA. */
export const BROWSER_LOGIN_ALLOWED_ROUTES: readonly AllowedBrowserRoute[] = [
  { method: 'GET', path: '/api/Account/GetCurrentUser' }, // a tela confere se há sessão
  { method: 'GET', path: '/api/Account/SSOLogin' }, // redireciona para a tela de login
  // Retorno do login para o hunit-api. A rota real ainda não foi observada (research R-13);
  // esta é a rota padrão desse tipo de login e deve ser confirmada no primeiro acesso real
  // (tasks.md, T022). Se estiver errada, o login falha e o bloqueio informa a rota pedida.
  { method: 'GET', path: '/signin-oidc' },
  { method: 'POST', path: '/signin-oidc' },
];

/**
 * Rotas que o sistema NUNCA pode chamar, com qualquer método (research R-13a).
 * As ações são reconhecidas pelo nome em qualquer posição do caminho.
 */
const BLOCKED_ROUTE_PATTERNS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /^\/api\/payment(\/|$)/, why: 'cobrança e dados de pagamento' },
  { pattern: /(^|\/)calculeprepayment[^/]*(\/|$)/, why: 'primeiro passo da cobrança' },
  { pattern: /(^|\/)chargeprepayment[^/]*(\/|$)/, why: 'executa a cobrança' },
  { pattern: /(^|\/)updateprepaymentinformation[^/]*(\/|$)/, why: 'altera dados de pagamento' },
  { pattern: /(^|\/)bookingpaymentdetails[^/]*(\/|$)/, why: 'revela dados do cartão' },
  { pattern: /(^|\/)cancelbooking[^/]*(\/|$)/, why: 'cancela a reserva' },
  { pattern: /(^|\/)editbooking[^/]*(\/|$)/, why: 'altera a reserva' },
  { pattern: /(^|\/)reactivateintegration[^/]*(\/|$)/, why: 'altera a integração da reserva' },
  { pattern: /(^|\/)bookings\/[^/]+\/events(\/|$)/, why: 'altera a reserva' },
];

export type GuardRefusal = 'blocked_route' | 'not_allowed' | 'invalid_url';

export type GuardVerdict = { allowed: true } | { allowed: false; reason: GuardRefusal };

const ALLOWED: GuardVerdict = { allowed: true };
const refuse = (reason: GuardRefusal): GuardVerdict => ({ allowed: false, reason });

/**
 * Forma única de comparar caminhos: decodifica `%xx`, ignora maiúsculas/minúsculas, barras
 * repetidas e barra final — o servidor do Hunit trata essas variações como a mesma rota.
 * Devolve `null` se o caminho não puder ser decodificado.
 */
function normalizePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const normalized = decoded
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalized === '' ? '/' : normalized;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Indica se o caminho é de uma rota que o sistema nunca pode chamar. */
export function isBlockedRoute(pathname: string): boolean {
  const path = normalizePath(pathname);
  // Caminho que não dá para interpretar é tratado como bloqueado.
  return path === null || BLOCKED_ROUTE_PATTERNS.some(({ pattern }) => pattern.test(path));
}

const apiClientAllowedPaths = new Set(
  API_CLIENT_ALLOWED_ROUTES.map((route) => normalizePath(route)),
);
const browserAllowedRoutes = new Set(
  BROWSER_LOGIN_ALLOWED_ROUTES.map((route) => `${route.method} ${normalizePath(route.path)}`),
);
const browserAllowedPaths = new Set(
  BROWSER_LOGIN_ALLOWED_ROUTES.map((route) => normalizePath(route.path)),
);

/**
 * Decide se o cliente da API do sistema pode fazer a requisição: precisa ser um GET para uma
 * das rotas de leitura permitidas, no endereço exato da API do Hunit.
 */
export function checkApiClientRequest(method: string, url: string, apiUrl: string): GuardVerdict {
  const target = parseUrl(url);
  const api = parseUrl(apiUrl);
  if (!target || !api) return refuse('invalid_url');

  if (isBlockedRoute(target.pathname)) return refuse('blocked_route');
  if (target.origin !== api.origin) return refuse('not_allowed');
  if (method.toUpperCase() !== 'GET') return refuse('not_allowed');

  return apiClientAllowedPaths.has(normalizePath(target.pathname))
    ? ALLOWED
    : refuse('not_allowed');
}

/**
 * Decide se a página aberta no navegador pode fazer a requisição. Só as requisições ao
 * hunit-api são controladas; as demais (tela de login, arquivos do site) seguem normalmente.
 */
export function checkBrowserRequest(method: string, url: string, apiUrl: string): GuardVerdict {
  const target = parseUrl(url);
  const api = parseUrl(apiUrl);
  if (!target || !api) return refuse('invalid_url');

  if (target.hostname !== api.hostname) return ALLOWED;
  if (isBlockedRoute(target.pathname)) return refuse('blocked_route');

  const path = normalizePath(target.pathname);
  const upperMethod = method.toUpperCase();
  // OPTIONS é a consulta prévia do navegador (CORS); só vale para as rotas permitidas.
  const allowed =
    upperMethod === 'OPTIONS'
      ? browserAllowedPaths.has(path)
      : browserAllowedRoutes.has(`${upperMethod} ${path}`);
  return allowed ? ALLOWED : refuse('not_allowed');
}

/** Uma requisição ao Hunit foi recusada pela proteção de somente leitura. */
export class ReadOnlyGuardError extends Error {
  constructor(
    readonly method: string,
    /** Caminho pedido, sem os parâmetros. */
    readonly path: string,
    readonly reason: GuardRefusal,
  ) {
    super(
      `Requisição ao Hunit recusada pela proteção de somente leitura: ${method} ${path} (${reason}).`,
    );
    this.name = 'ReadOnlyGuardError';
  }
}

function pathOf(url: string): string {
  return parseUrl(url)?.pathname ?? '(URL inválida)';
}

/**
 * Lança `ReadOnlyGuardError` se o cliente da API do sistema não puder fazer a requisição.
 * Deve ser chamada antes de TODA requisição à API do Hunit.
 */
export function assertApiClientRequest(method: string, url: string, apiUrl: string): void {
  const verdict = checkApiClientRequest(method, url, apiUrl);
  if (!verdict.allowed)
    throw new ReadOnlyGuardError(method.toUpperCase(), pathOf(url), verdict.reason);
}

export interface BlockedRequest {
  /** Método HTTP, ou "WEBSOCKET" para conexões em tempo real. */
  method: string;
  /** Caminho pedido, sem os parâmetros. */
  path: string;
  reason: GuardRefusal;
  /**
   * `true` quando a requisição veio de um redirecionamento: ela saiu do navegador (a
   * interceptação não alcança esses saltos) e foi apenas detectada, não bloqueada.
   */
  sent?: boolean;
}

export interface BrowserGuardOptions {
  /** Endereço da API interna do Hunit (HUNIT_API_URL). */
  apiUrl: string;
  /** Chamado a cada requisição abortada, ou detectada fora da lista num redirecionamento. */
  onBlocked?: (request: BlockedRequest) => void;
}

/**
 * Instala a proteção no contexto do navegador: toda requisição da página ao hunit-api que não
 * faça parte do login é abortada antes de sair da máquina.
 *
 * Deve ser instalada logo depois de o contexto ser criado, antes de qualquer página abrir.
 * As requisições feitas pelo cliente da API do sistema não passam por aqui: quem as controla
 * é `assertApiClientRequest`.
 */
export async function installBrowserGuard(
  context: BrowserContext,
  options: BrowserGuardOptions,
): Promise<void> {
  const { apiUrl, onBlocked } = options;
  const apiHost = new URL(apiUrl).hostname;
  const isApiHost = (url: URL) => url.hostname === apiHost;

  await context.route(isApiHost, async (route) => {
    const request = route.request();
    const verdict = checkBrowserRequest(request.method(), request.url(), apiUrl);
    if (verdict.allowed) {
      await route.fallback();
      return;
    }
    onBlocked?.({ method: request.method(), path: pathOf(request.url()), reason: verdict.reason });
    await route.abort('blockedbyclient');
  });

  // Saltos de redirecionamento não passam pela interceptação acima (limite do Playwright):
  // ficam ao menos detectados, para o acesso ser interrompido.
  context.on('request', (request) => {
    if (request.redirectedFrom() === null) return;
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (!isApiHost(url)) return;
    const verdict = checkBrowserRequest(request.method(), request.url(), apiUrl);
    if (!verdict.allowed) {
      onBlocked?.({
        method: request.method(),
        path: pathOf(request.url()),
        reason: verdict.reason,
        sent: true,
      });
    }
  });

  // Conexões em tempo real (notificações do Hunit) não são necessárias e ficam fechadas.
  await context.routeWebSocket(isApiHost, (webSocket) => {
    onBlocked?.({ method: 'WEBSOCKET', path: pathOf(webSocket.url()), reason: 'not_allowed' });
    void webSocket.close();
  });
}
