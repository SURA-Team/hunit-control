/**
 * Janela do app, endurecida (specs/002, research R-02 e R-13).
 *
 * A interface roda isolada (`contextIsolation`, `sandbox`, sem Node), sem corretor ortográfico (que
 * gravaria um dicionário com o que se digita), sem navegar para fora do app, sem abrir janelas e
 * sem nenhuma permissão do navegador. As ferramentas de desenvolvedor só existem fora do pacote.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, session } from 'electron';

export interface RendererLocation {
  /** Endereço que o app carrega e do qual aceita pedidos pela ponte. */
  url: string;
  /** Prefixo de endereço considerado "do próprio app". */
  trustedPrefix: string;
}

/** Onde está a interface: servidor do electron-vite no desenvolvimento, arquivo no pacote. */
export function rendererLocation(): RendererLocation {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    return { url: devUrl, trustedPrefix: new URL(devUrl).origin };
  }
  const index = path.join(import.meta.dirname, '..', 'renderer', 'index.html');
  return {
    url: pathToFileURL(index).href,
    trustedPrefix: pathToFileURL(path.dirname(index)).href,
  };
}

/** Nega todas as permissões que a página possa pedir (câmera, notificações web, etc.). */
export function denyAllPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

export function createMainWindow(location: RendererLocation): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'HUNIT Control',
    // Sem `icon`: no Windows a janela usa o ícone do executável (electron-builder.yml).
    webPreferences: {
      preload: path.join(import.meta.dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  // Nada de navegar para fora do app nem abrir outras janelas.
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(location.trustedPrefix)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!url.startsWith(location.trustedPrefix)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.once('ready-to-show', () => window.show());
  void window.loadURL(location.url);
  return window;
}
