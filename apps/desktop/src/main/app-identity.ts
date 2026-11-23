/**
 * Identidade do app no Windows (specs/008, US6, FR-027, research R-10): a marca do HUNIT Control na
 * barra de tarefas, com a janela aberta, piscando no aviso e fixada.
 *
 * - O app instalado usa o AUMID do instalador (`appId` do `electron-builder.yml`, o mesmo do atalho
 *   do Menu Iniciar); o desenvolvimento e os testes usam outro (`.dev`), para o Windows não ligar a
 *   identidade do app instalado ao `electron.exe` que rodou com ela.
 * - A janela recebe o ícone nos dois modos: empacotada, o `icon.ico` que vai junto do app
 *   (`extraResources`); em desenvolvimento, o `icon.png` gerado da marca.
 * - No Windows, os detalhes da janela ligam o botão da barra de tarefas ao ícone do executável.
 *
 * Sem Electron aqui: as regras ficam testáveis sem abrir o app.
 */
import path from 'node:path';

/** O `appId` do instalador (conferido em `test/main/builder-config.test.ts`). */
export const APP_ID = 'io.github.sura-team.hunit-control';

export const APP_DISPLAY_NAME = 'HUNIT Control';

/** AUMID do app: o do instalador só no app empacotado. */
export function appUserModelId(packaged: boolean): string {
  return packaged ? APP_ID : `${APP_ID}.dev`;
}

export interface IconLocation {
  packaged: boolean;
  /** `process.resourcesPath` (a pasta `resources` do app instalado). */
  resourcesPath: string;
  /** Pasta do código do processo principal (`out/main`). */
  moduleDir: string;
}

/** Ícone da janela: o `.ico` do app instalado ou o `.png` da marca em desenvolvimento. */
export function windowIconPath({ packaged, resourcesPath, moduleDir }: IconLocation): string {
  return packaged
    ? path.join(resourcesPath, 'icon.ico')
    : path.join(moduleDir, '..', '..', 'resources', 'icon.png');
}

export interface AppDetails {
  appId: string;
  appIconPath: string;
  appIconIndex: number;
  relaunchDisplayName: string;
}

/**
 * Detalhes da janela no Windows (`BrowserWindow.setAppDetails`): o AUMID e o ícone do executável
 * para o botão da barra de tarefas. Fora do Windows, nada.
 */
export function applyAppDetails(
  window: { setAppDetails(details: AppDetails): void },
  options: { platform: NodeJS.Platform; packaged: boolean; execPath: string },
): void {
  if (options.platform !== 'win32') return;
  window.setAppDetails({
    appId: appUserModelId(options.packaged),
    appIconPath: options.execPath,
    appIconIndex: 0,
    relaunchDisplayName: APP_DISPLAY_NAME,
  });
}
