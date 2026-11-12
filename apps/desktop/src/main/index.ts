/**
 * Ciclo de vida do app desktop (specs/002, research R-02, R-13 e R-14).
 *
 * - Uma instância por usuário da máquina: abrir de novo traz a janela existente para a frente
 *   (FR-027). A trava fica na pasta de dados, por isso a pasta alternativa dos testes é definida
 *   antes de pedir a trava.
 * - Fechar a janela encerra o app; o cofre do acesso ao Hunit é esvaziado (FR-026).
 * - O app nunca chama `crashReporter.start()` e não grava registros (R-14).
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  safeStorage,
  type IpcMainInvokeEvent,
} from 'electron';
import { EVENTS, SEND, type EventChannel } from '../shared/ipc-channels.js';
import type { Preferences, Result } from '../shared/ipc-types.js';
import { ApiClient } from './api-client.js';
import { Attention } from './attention.js';
import { ConfigStore, DEFAULT_PREFERENCES } from './config-store.js';
import { ConnectionManager } from './connection.js';
import { CredentialsVault } from './credentials-vault.js';
import { createInvokeHandlers, type InvokeHandlers } from './ipc-handlers.js';
import { createMainWindow, denyAllPermissions, rendererLocation } from './window.js';

const APP_USER_MODEL_ID = 'io.github.sura-team.hunit-control';
/** Certificado raiz não passa de alguns KB; arquivo maior não é o que o operador quis escolher. */
const MAX_CERTIFICATE_FILE_BYTES = 64 * 1024;

// Pasta de dados alternativa só para os testes de ponta a ponta, nunca no app instalado.
const testDataDir = process.env['HUNIT_DESKTOP_USER_DATA_DIR'];
if (!app.isPackaged && testDataDir) app.setPath('userData', testDataDir);

/**
 * Ganchos dos testes de ponta a ponta (nunca no app instalado): as notificações pedidas ficam
 * registradas para o teste conferir, já que a notificação real do Windows não é observável.
 */
const testHooks =
  !app.isPackaged && process.env['HUNIT_DESKTOP_TEST_HOOKS'] === '1'
    ? (((globalThis as Record<string, unknown>)['__hunitTest'] ??= {
        notifications: [],
      }) as { notifications: Array<{ title: string; body: string }> })
    : null;

app.setAppUserModelId(APP_USER_MODEL_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  let mainWindow: BrowserWindow | null = null;
  let preferences: Preferences = DEFAULT_PREFERENCES;

  const send = (channel: EventChannel, payload?: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  await app.whenReady();
  denyAllPermissions();

  const configStore = new ConfigStore({
    filePath: path.join(app.getPath('userData'), 'config.json'),
    safeStorage,
  });
  const initial = await configStore.load();
  if (initial.status === 'ok') preferences = initial.config.preferences;

  const vault = new CredentialsVault({
    idleHours: preferences.idleHours,
    onCleared: (reason) => send(EVENTS.credentialsCleared, { reason }),
  });

  const connection = new ConnectionManager({
    loadConfig: async () => {
      const loaded = await configStore.load();
      if (loaded.status !== 'ok') return null;
      preferences = loaded.config.preferences;
      return {
        serverUrl: loaded.config.serverUrl,
        caCertificatePem: loaded.config.certificatePem,
        apiKey: configStore.decryptApiKey(loaded.config),
      };
    },
    createApi: (config) => new ApiClient(config),
    onState: (state) => send(EVENTS.connectionState, state),
  });

  const attention = new Attention({
    getWindow: () => mainWindow,
    showNotification: (options) => {
      testHooks?.notifications.push({ title: options.title, body: options.body });
      if (Notification.isSupported()) new Notification(options).show();
    },
    playSound: () => send(EVENTS.attentionPlaySound),
    isSoundEnabled: () => preferences.soundEnabled,
  });

  const handlers: InvokeHandlers = createInvokeHandlers({
    appVersion: app.getVersion(),
    config: configStore,
    connection,
    vault,
    attention,
    dialogs: {
      pickCertificateFile: async () => {
        const options = {
          title: 'Certificado raiz do servidor',
          properties: ['openFile' as const],
          filters: [{ name: 'Certificado', extensions: ['crt', 'cer', 'pem'] }],
        };
        const picked = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        const file = picked.filePaths[0];
        if (picked.canceled || !file) return null;
        if ((await stat(file)).size > MAX_CERTIFICATE_FILE_BYTES) {
          return { content: '' };
        }
        return { content: await readFile(file, 'utf8') };
      },
    },
    createApi: (config) => new ApiClient(config),
    onPreferences: (next) => {
      preferences = next;
    },
  });

  const location = rendererLocation();

  /** Só a página do próprio app, na janela principal, fala com a ponte. */
  const isTrusted = (event: IpcMainInvokeEvent | Electron.IpcMainEvent) =>
    mainWindow !== null &&
    event.sender.id === mainWindow.webContents.id &&
    (event.senderFrame?.url ?? '').startsWith(location.trustedPrefix);

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, input: unknown): Promise<Result<unknown>> => {
      if (!isTrusted(event)) {
        return Promise.resolve({ ok: false, error: { code: 'invalid_input' } });
      }
      return handler(input);
    });
  }
  ipcMain.on(SEND.activityPing, (event) => {
    if (isTrusted(event)) vault.activity();
  });

  mainWindow = createMainWindow(location);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    vault.dispose();
    void connection.dispose();
  });

  await connection.start();
}
