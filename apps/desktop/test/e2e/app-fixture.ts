/**
 * Abre o app compilado pelo Playwright (`_electron`) para os testes de ponta a ponta (specs/002,
 * T039, research R-12). Cada teste usa uma pasta de dados temporária própria; os diálogos do
 * Windows são substituídos no processo principal e as notificações ficam registradas para o
 * teste conferir. O app compilado para teste não tem as fuses do instalador (o Playwright precisa
 * do argumento de inspeção que elas desligam); elas são conferidas por builder-config.test.ts.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

export const APP_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const MAIN_ENTRY = path.join(APP_ROOT, 'out', 'main', 'index.js');

export interface RecordedNotification {
  title: string;
  body: string;
}

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
  close(): Promise<void>;
}

/** Ambiente do processo do app: sem `ELECTRON_RUN_AS_NODE` (o editor a define) e com os ganchos de teste. */
export function appEnvironment(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env['HUNIT_DESKTOP_USER_DATA_DIR'] = userDataDir;
  env['HUNIT_DESKTOP_TEST_HOOKS'] = '1';
  return env;
}

export async function newUserDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'hunit-desktop-e2e-'));
}

export async function launchApp(options: { userDataDir?: string } = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? (await newUserDataDir());
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    env: appEnvironment(userDataDir),
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return {
    app,
    window,
    userDataDir,
    async close() {
      await app.close().catch(() => undefined);
      if (!options.userDataDir) await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

/** "Abrir arquivo" passa a devolver este arquivo, sem mostrar o diálogo. */
export async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, filePath);
}

/** "Salvar como" passa a devolver este caminho, sem mostrar o diálogo. */
export async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
  }, filePath);
}

/** Diálogos de confirmação respondem com este botão e ficam registrados. */
export async function stubMessageBox(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const hooks = ((globalThis as Record<string, unknown>)['__hunitTest'] ??= {}) as {
      messageBoxes?: string[];
    };
    hooks.messageBoxes = [];
    dialog.showMessageBox = (...args: unknown[]) => {
      const options = args.at(-1) as { message?: string };
      hooks.messageBoxes?.push(options.message ?? '');
      return Promise.resolve({ response: answer, checkboxChecked: false });
    };
  }, response);
}

/** Notificações do Windows pedidas pelo app desde que ele abriu. */
export async function notifications(app: ElectronApplication): Promise<RecordedNotification[]> {
  return app.evaluate(() => {
    const hooks = (globalThis as Record<string, unknown>)['__hunitTest'] as
      { notifications?: RecordedNotification[] } | undefined;
    return hooks?.notifications ?? [];
  });
}

export interface ConnectionSettings {
  serverUrl: string;
  certificatePem: string;
  apiKey: string;
}

/** Preenche a configuração pela interface (primeiro uso, US1 cenário 1) e espera ficar online. */
export async function configureApp(
  launched: LaunchedApp,
  settings: ConnectionSettings,
): Promise<void> {
  const { app, window, userDataDir } = launched;
  const certificateFile = path.join(userDataDir, 'hunit-raiz.crt');
  await writeFile(certificateFile, settings.certificatePem);
  await stubOpenDialog(app, certificateFile);

  await window.getByLabel('Endereço do servidor').fill(settings.serverUrl);
  await window.getByRole('button', { name: /escolher certificado/i }).click();
  await window.getByText('Impressão digital (SHA-256):', { exact: false }).waitFor();
  await window.getByLabel('Chave de acesso').fill(settings.apiKey);
  await window.getByRole('button', { name: 'Testar conexão' }).click();
  await window.getByText('Conexão confirmada').waitFor();
  await window.getByRole('button', { name: 'Salvar conexão' }).click();
  await window
    .getByRole('banner')
    .getByText(/^(Operador|Consulta)$/)
    .waitFor({ timeout: 15_000 });
}

export type { ElectronApplication, Page };
