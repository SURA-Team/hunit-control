/**
 * Sonda do T076 (specs/002, research R-14, "A verificar"): o Electron grava minidumps em
 * `crashDumps` sem `crashReporter.start()`? Derruba de propósito a interface e o processo principal
 * e lista a pasta. Roda à parte (não entra na suíte): HUNIT_DESKTOP_CRASH_PROBE=1.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'vitest';
import { launchApp } from './app-fixture.js';

async function listAll(dir: string): Promise<string[]> {
  const found: string[] = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await listAll(full)));
      else found.push(full);
    }
  } catch {
    // Pasta inexistente.
  }
  return found;
}

describe.runIf(process.env['HUNIT_DESKTOP_CRASH_PROBE'] === '1')('sonda de minidumps', () => {
  it('lista o que o Electron grava ao falhar', { timeout: 60_000 }, async () => {
    const launched = await launchApp();
    const dumps = await launched.app.evaluate(({ app }) => app.getPath('crashDumps'));
    console.log('CRASH-DIR', dumps, 'antes:', await listAll(dumps));

    await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer(),
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    console.log('CRASH-DIR depois da interface:', await listAll(dumps));

    await launched.app.evaluate(() => process.crash()).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    console.log('CRASH-DIR depois do principal:', await listAll(dumps));
    console.log('USERDATA', await listAll(launched.userDataDir));
    await launched.close();
  });
});
