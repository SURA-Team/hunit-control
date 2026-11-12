/**
 * Preparação da rodada de testes de ponta a ponta do app (specs/002, T039): compila o app uma vez
 * com o electron-vite. O PostgreSQL vem da preparação global do servidor (postgres-global-setup).
 */
import path from 'node:path';
import { build } from 'electron-vite';

export async function setup(): Promise<void> {
  const appRoot = path.resolve(import.meta.dirname, '..', '..');
  // O electron-vite procura a interface (src/renderer) a partir da pasta atual.
  const previous = process.cwd();
  process.chdir(appRoot);
  try {
    await build({ root: appRoot, logLevel: 'warn' });
  } finally {
    process.chdir(previous);
  }
}
