/**
 * "Hunit" falso em HTTP, para testar o gateway real (Playwright) sem acessar o Hunit.
 *
 * Imita o fluxo observado (research R-13): a tela de entrada do Hunit tem o botão "Login único",
 * que leva ao `SSOLogin` da API, que manda para o login (Keycloak); usuário e senha levam à tela do token; o
 * token leva ao retorno do login na API, que cria o cookie de sessão e volta para a tela do
 * Hunit. As telas são as fixtures em `test/fixtures/hunit/html/`.
 *
 * São três servidores, porque a proteção de somente leitura reconhece a API pelo nome do host:
 * tela e login em `127.0.0.1`, API em `localhost`.
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'hunit');
const SESSION_COOKIE = 'hunit_session';

export function readHtmlFixture(name: string, values: Record<string, string> = {}): string {
  let html = readFileSync(path.join(FIXTURES, 'html', name), 'utf8');
  for (const [key, value] of Object.entries(values)) html = html.replaceAll(`{{${key}}}`, value);
  return html;
}

export function readJsonFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'json', name), 'utf8'));
}

export interface FakeHunitServerOptions {
  username: string;
  password: string;
  token: string;
  /** A tela de entrada redireciona direto para o login, sem o botão "Login único". */
  directRedirect?: boolean;
  /** O Hunit não pede token (conclui direto depois da senha). */
  skipTwoFactor?: boolean;
  /** Resposta ao token: a tentativa de login expirou (tela de login ou página de expiração). */
  expireOnToken?: 'login' | 'page';
  /** Tela de login no lugar da original (ex.: com rótulos alterados). */
  loginScreen?: string;
  /** Rota de retorno do login na API. Padrão: `/signin-oidc`. */
  callbackPath?: string;
  /** Corpo de `GetCurrentUser` para a sessão válida. Padrão: a fixture `current-user.json`. */
  currentUser?: unknown;
}

export interface FakeHunitServer {
  webUrl: string;
  apiUrl: string;
  /** Requisições recebidas pela API ("MÉTODO /caminho"). */
  apiRequests: string[];
  /** Tokens recebidos pela tela do token. */
  tokensReceived: string[];
  close(): Promise<void>;
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function html(response: ServerResponse, body: string, status = 200): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function redirect(
  response: ServerResponse,
  location: string,
  headers: Record<string, string> = {},
) {
  response.writeHead(302, { location, ...headers });
  response.end();
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

export async function startFakeHunitServer(
  options: FakeHunitServerOptions,
): Promise<FakeHunitServer> {
  const apiRequests: string[] = [];
  const tokensReceived: string[] = [];
  const callbackPath = options.callbackPath ?? '/signin-oidc';
  const urls = { web: '', api: '', login: '' };

  const web = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', urls.web);
    if (pathname === '/login') {
      const ssoUrl = `${urls.api}/api/Account/SSOLogin?returnUrl=%2F`;
      if (options.directRedirect) redirect(response, ssoUrl);
      else html(response, readHtmlFixture('hunit-entry.html', { ssoUrl }));
      return;
    }
    // A tela do Hunit, que chama a API sozinha ao abrir (a proteção deve bloquear).
    html(
      response,
      `<!DOCTYPE html><html><head><title>Hunit</title></head><body><h1>Reservas</h1>
       <script>fetch(${JSON.stringify(urls.api)} + '/api/Account/MenuCapabilities', { credentials: 'include' }).catch(() => {});</script>
       </body></html>`,
    );
  });

  const login = createServer((request, response) => {
    void (async () => {
      const { pathname } = new URL(request.url ?? '/', urls.login);
      const loginScreen = (extra: Record<string, string> = {}) =>
        options.loginScreen ??
        readHtmlFixture('login.html', { action: '/login-actions/authenticate', ...extra });

      if (request.method === 'GET' && pathname.startsWith('/auth/')) {
        html(response, loginScreen());
        return;
      }

      if (request.method === 'POST' && pathname === '/login-actions/authenticate') {
        const form = await readForm(request);
        if (
          form.get('username') !== options.username ||
          form.get('password') !== options.password
        ) {
          html(
            response,
            readHtmlFixture('login-error.html', {
              action: '/login-actions/authenticate',
              username: form.get('username') ?? '',
            }),
          );
          return;
        }
        if (options.skipTwoFactor) {
          redirect(response, `${urls.api}${callbackPath}?code=ok`);
          return;
        }
        html(
          response,
          readHtmlFixture('two-factor.html', {
            action: '/login-actions/otp',
            username: options.username,
          }),
        );
        return;
      }

      if (request.method === 'POST' && pathname === '/login-actions/otp') {
        const token = (await readForm(request)).get('otp') ?? '';
        tokensReceived.push(token);
        if (options.expireOnToken === 'login') {
          html(
            response,
            readHtmlFixture('login-expired.html', { action: '/login-actions/authenticate' }),
          );
        } else if (options.expireOnToken === 'page') {
          html(response, readHtmlFixture('page-expired.html', { action: '/auth/restart' }));
        } else if (token === options.token) {
          redirect(response, `${urls.api}${callbackPath}?code=ok`);
        } else {
          html(
            response,
            readHtmlFixture('two-factor-error.html', {
              action: '/login-actions/otp',
              username: options.username,
            }),
          );
        }
        return;
      }

      html(response, 'não encontrado', 404);
    })();
  });

  const api = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', urls.api);
    apiRequests.push(`${request.method ?? '?'} ${pathname}`);

    if (pathname === '/api/Account/SSOLogin') {
      redirect(response, `${urls.login}/auth/realms/hsystem/protocol/openid-connect/auth`);
      return;
    }
    if (pathname === callbackPath) {
      redirect(response, `${urls.web}/`, {
        'set-cookie': `${SESSION_COOKIE}=valid; Path=/; HttpOnly`,
      });
      return;
    }
    if (pathname === '/api/Account/GetCurrentUser') {
      if (!(request.headers.cookie ?? '').includes(`${SESSION_COOKIE}=valid`)) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(options.currentUser ?? readJsonFixture('current-user.json')));
      return;
    }
    response.writeHead(404).end();
  });

  const [webPort, loginPort, apiPort] = await Promise.all([
    listen(web),
    listen(login),
    listen(api),
  ]);
  urls.web = `http://127.0.0.1:${webPort}`;
  urls.login = `http://127.0.0.1:${loginPort}`;
  urls.api = `http://localhost:${apiPort}`;

  return {
    webUrl: urls.web,
    apiUrl: urls.api,
    apiRequests,
    tokensReceived,
    async close() {
      await Promise.all(
        [web, login, api].map(
          (server) =>
            new Promise<void>((resolve) => {
              server.closeAllConnections();
              server.close(() => resolve());
            }),
        ),
      );
    },
  };
}
