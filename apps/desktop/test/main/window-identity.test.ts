/**
 * Identidade do app na barra de tarefas do Windows (specs/008, T034, FR-027, research R-10): o AUMID
 * do instalador só no app empacotado (desenvolvimento e testes com outro), o ícone da janela nos
 * dois modos e os detalhes da janela (AUMID e ícone do executável) só no Windows.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_ID,
  appUserModelId,
  applyAppDetails,
  windowIconPath,
} from '../../src/main/app-identity.js';

const appRoot = path.resolve(import.meta.dirname, '..', '..');

describe('AUMID por modo', () => {
  it('empacotado: o do instalador; desenvolvimento e testes: outro', () => {
    expect(appUserModelId(true)).toBe(APP_ID);
    expect(appUserModelId(false)).toBe(`${APP_ID}.dev`);
    expect(appUserModelId(false)).not.toBe(appUserModelId(true));
  });
});

describe('ícone da janela', () => {
  it('empacotado: o icon.ico junto do app (extraResources)', () => {
    const resourcesPath = path.join('C:', 'Programas', 'HUNIT Control', 'resources');
    expect(
      windowIconPath({ packaged: true, resourcesPath, moduleDir: path.join('x', 'out', 'main') }),
    ).toBe(path.join(resourcesPath, 'icon.ico'));
  });

  it('desenvolvimento: o icon.png da marca, que existe no repositório', () => {
    const icon = windowIconPath({
      packaged: false,
      resourcesPath: 'nao-usado',
      moduleDir: path.join(appRoot, 'out', 'main'),
    });
    expect(icon).toBe(path.join(appRoot, 'resources', 'icon.png'));
    expect(existsSync(icon)).toBe(true);
  });
});

describe('detalhes da janela (setAppDetails)', () => {
  it('no Windows: o AUMID do modo e o ícone do executável', () => {
    const window = { setAppDetails: vi.fn() };
    applyAppDetails(window, {
      platform: 'win32',
      packaged: true,
      execPath: 'C:\\HUNIT Control\\HUNIT Control.exe',
    });
    expect(window.setAppDetails).toHaveBeenCalledWith({
      appId: APP_ID,
      appIconPath: 'C:\\HUNIT Control\\HUNIT Control.exe',
      appIconIndex: 0,
      relaunchDisplayName: 'HUNIT Control',
    });

    applyAppDetails(window, { platform: 'win32', packaged: false, execPath: 'electron.exe' });
    expect(window.setAppDetails).toHaveBeenLastCalledWith(
      expect.objectContaining({ appId: `${APP_ID}.dev` }),
    );
  });

  it.each(['linux', 'darwin'] as const)('fora do Windows (%s): nada', (platform) => {
    const window = { setAppDetails: vi.fn() };
    applyAppDetails(window, { platform, packaged: true, execPath: '/opt/hunit' });
    expect(window.setAppDetails).not.toHaveBeenCalled();
  });
});
