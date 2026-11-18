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

/** Tamanho da janela, em px, como a usuária vê (com a moldura do Windows). */
export interface WindowSize {
  width: number;
  height: number;
}

export interface LaunchOptions {
  userDataDir?: string;
  /** Tamanho da janela; sem ele, o padrão do app (1 280 × 820). */
  window?: WindowSize;
  /** Zoom da página (1.25 = 125 %), como a escala de tela do Windows (specs/006, SC-007). */
  zoomFactor?: number;
}

/**
 * Muda o tamanho da janela do app e o zoom da página e espera a interface se acomodar (specs/006,
 * roteiros de larguras e de redimensionamento, research R-16).
 *
 * Numa tela menor que o pedido, o Windows limita a janela; aí o zoom diminui na mesma proporção,
 * para a página ter a largura em px de CSS que teria com a janela inteira (as quebras do layout são
 * medidas nela). Numa tela de 1 920 × 1 080 a 100 %, todos os tamanhos dos roteiros cabem.
 */
export async function resizeWindow(
  app: ElectronApplication,
  window: Page,
  size: WindowSize,
  zoomFactor?: number,
): Promise<void> {
  const cssWidth = await app.evaluate(
    ({ BrowserWindow }, { size: target, zoom }) => {
      const main = BrowserWindow.getAllWindows()[0];
      if (!main) throw new Error('Janela do app não encontrada.');
      main.setSize(target.width, target.height);
      const [width = target.width] = main.getSize();
      const shrink = Math.min(1, width / target.width);
      if (zoom !== undefined || shrink < 1) main.webContents.setZoomFactor((zoom ?? 1) * shrink);
      const [contentWidth = width] = main.getContentSize();
      return contentWidth / main.webContents.getZoomFactor();
    },
    { size, zoom: zoomFactor },
  );
  // O tamanho e o zoom chegam à página depois: espera a largura em px de CSS bater.
  await window.waitForFunction(
    (expected) => Math.abs(globalThis.innerWidth - expected) <= 1,
    cssWidth,
  );
  // Dois quadros: o redimensionamento e o novo layout já desenhado.
  await window.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? (await newUserDataDir());
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    env: appEnvironment(userDataDir),
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  if (options.window || options.zoomFactor !== undefined) {
    const size = options.window ?? { width: 1280, height: 820 };
    await resizeWindow(app, window, size, options.zoomFactor);
  }
  return {
    app,
    window,
    userDataDir,
    async close() {
      // Com execução ativa desta máquina, fechar pede confirmação (FR-026): responde "fechar".
      await stubMessageBox(app, 0).catch(() => undefined);
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

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Data local a `days` dias de hoje (os testes usam datas relativas para não depender do mês). */
export function daysFromToday(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

/** Data no formato da API (AAAA-MM-DD), no horário local. */
export function isoDate(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** Rótulo de um dia no calendário do Mantine em pt-BR (ex.: "3 novembro 2026"). */
function dayLabel(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`;
}

/** Escolhe o período no seletor de intervalo da tela, clicando nos dias. */
export async function pickPeriod(window: Page, from: Date, to: Date): Promise<void> {
  await window.getByLabel('Período de check-in').click();
  for (const date of [from, to]) {
    await window
      .getByRole('button', { name: dayLabel(date), exact: true })
      .first()
      .click();
  }
}
