/**
 * Uma instância por usuário da máquina (specs/002, T082, FR-027, research R-13): abrir o app de
 * novo não abre outro; a janela que já estava aberta volta para a frente.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  APP_ROOT,
  appEnvironment,
  launchApp,
  MAIN_ENTRY,
  newUserDataDir,
  type LaunchedApp,
} from './app-fixture.js';

/** Caminho do executável do Electron instalado pelo pacote `electron`. */
const electronPath = createRequire(import.meta.url)('electron') as string;

let launched: LaunchedApp;
let userDataDir: string;

beforeAll(async () => {
  userDataDir = await newUserDataDir();
  launched = await launchApp({ userDataDir });
});

afterAll(async () => {
  await launched?.close();
  await rm(userDataDir, { recursive: true, force: true });
});

describe('instância única (FR-027)', () => {
  it('a segunda instância encerra sozinha e a janela da primeira volta a ficar visível', async () => {
    // A janela só aparece no `ready-to-show`; minimizar antes disso não tem efeito.
    await vi.waitFor(
      async () => {
        const visible = await launched.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible(),
        );
        expect(visible).toBe(true);
      },
      { timeout: 10_000 },
    );
    await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.minimize(),
    );
    await vi.waitFor(async () => {
      const minimized = await launched.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.isMinimized(),
      );
      expect(minimized).toBe(true);
    });

    const second = spawn(electronPath, [MAIN_ENTRY], {
      cwd: APP_ROOT,
      env: appEnvironment(userDataDir),
      stdio: 'ignore',
    });
    const exitCode = await new Promise<number | null>((resolve) => second.on('exit', resolve));

    expect(exitCode).toBe(0);
    await vi.waitFor(
      async () => {
        const state = await launched.app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          return { minimized: window?.isMinimized(), visible: window?.isVisible() };
        });
        expect(state).toEqual({ minimized: false, visible: true });
      },
      { timeout: 10_000 },
    );
    expect(launched.app.windows()).toHaveLength(1);
  });
});
