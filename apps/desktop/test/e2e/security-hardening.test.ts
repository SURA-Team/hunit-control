/**
 * Proteções da janela e da interface no app real (specs/002, T081, research R-02): isolamento,
 * sandbox, sem Node, ponte só com as funções do contrato, sem navegar nem abrir janelas, sem rede
 * pela interface (CSP) e sem permissões do navegador. Não precisa do servidor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, type LaunchedApp } from './app-fixture.js';

let launched: LaunchedApp;

beforeAll(async () => {
  launched = await launchApp();
});

afterAll(async () => {
  await launched?.close();
});

/** As funções de window.hunit, por área, como em contracts/ipc.md. */
const BRIDGE = {
  app: ['info'],
  connection: ['getConfig', 'getState', 'onState', 'pickCertificate', 'remove', 'save', 'test'],
  preferences: ['set'],
  attention: ['onPlaySound', 'test'],
  credentials: ['clear', 'onCleared', 'set', 'status'],
  activity: ['ping'],
  hotels: ['list'],
  executions: [
    'cancel',
    'get',
    'list',
    'onChanged',
    'resume',
    'sendToken',
    'start',
    'unwatch',
    'watch',
  ],
  twoFactor: ['onClosed', 'onRequested'],
  evidence: ['list', 'save'],
  reservations: ['channels', 'get', 'list'],
};

describe('janela endurecida', () => {
  it('toda janela tem isolamento, sandbox, sem Node e sem webview', async () => {
    const preferences = await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) =>
        // Presente no Electron 45, mas fora dos tipos publicados.
        (
          window.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
        ).getLastWebPreferences(),
      ),
    );

    expect(preferences.length).toBeGreaterThan(0);
    for (const webPreferences of preferences) {
      expect(webPreferences).toMatchObject({
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
      });
    }
  });

  it('a interface não enxerga require, process nem ipcRenderer', async () => {
    const globals = await launched.window.evaluate(() => {
      const scope = window as unknown as Record<string, unknown>;
      return {
        require: typeof scope['require'],
        process: typeof scope['process'],
        ipcRenderer: typeof scope['ipcRenderer'],
      };
    });

    expect(globals).toEqual({
      require: 'undefined',
      process: 'undefined',
      ipcRenderer: 'undefined',
    });
  });

  it('window.hunit tem só as funções do contrato da ponte', async () => {
    const shape = await launched.window.evaluate(() => {
      const hunit = (window as unknown as { hunit: Record<string, Record<string, unknown>> }).hunit;
      return Object.fromEntries(
        Object.entries(hunit).map(([area, functions]) => [
          area,
          Object.entries(functions)
            .filter(([, value]) => typeof value === 'function')
            .map(([name]) => name)
            .sort(),
        ]),
      );
    });

    expect(shape).toEqual(BRIDGE);
  });
});

describe('sem sair do app', () => {
  it('navegar para um endereço externo não sai da página do app', async () => {
    const before = launched.window.url();

    await launched.window.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(launched.window.url()).toBe(before);
  });

  it('window.open não abre nenhuma janela', async () => {
    const opened = await launched.window.evaluate(
      () => window.open('https://example.com/') === null,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(opened).toBe(true);
    expect(launched.app.windows()).toHaveLength(1);
  });
});

describe('sem rede nem permissões pela interface', () => {
  it('fetch feito pela interface é bloqueado pela CSP (connect-src none)', async () => {
    const outcome = await launched.window.evaluate(async () => {
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        violations.push(event.effectiveDirective),
      );
      const result = await fetch('https://127.0.0.1:9/').then(
        () => 'respondeu',
        () => 'bloqueado',
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { result, violations };
    });

    expect(outcome.result).toBe('bloqueado');
    expect(outcome.violations).toContain('connect-src');
  });

  it('pedidos de permissão da página são negados', async () => {
    const permission = await launched.window.evaluate(() => Notification.requestPermission());

    expect(permission).toBe('denied');
  });
});
