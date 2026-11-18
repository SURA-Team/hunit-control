/**
 * Fonte embutida no build da interface (specs/006, FR-004, research R-03): a Manrope vai dentro do
 * app como arquivos .woff2, nada no build busca fonte na internet e a política de conteúdo do
 * index.html continua a mesma (`font-src 'self'`, `connect-src 'none'`).
 *
 * Compila só a interface, com os plugins do electron.vite.config.ts, numa pasta temporária: não
 * mexe no out/ que os testes de ponta a ponta usam.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfigFromFile } from 'electron-vite';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const appRoot = path.resolve(import.meta.dirname, '..', '..');

/** A política de conteúdo da interface (specs/002, research R-02; specs/003, research R-08). */
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; font-src 'self'; worker-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

let outDir = '';
let files: string[] = [];

const readOut = (file: string) => readFile(path.join(outDir, file), 'utf8');
const textFiles = () => files.filter((file) => /\.(html|js|mjs|css|json|svg)$/i.test(file));

beforeAll(async () => {
  outDir = await mkdtemp(path.join(os.tmpdir(), 'hunit-renderer-'));
  const { config } = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    undefined,
    appRoot,
    'error',
  );
  await build({
    configFile: false,
    root: path.join(appRoot, 'src', 'renderer'),
    base: './',
    logLevel: 'error',
    plugins: config.renderer?.plugins ?? [],
    build: { outDir, emptyOutDir: true },
  });
  files = (await readdir(outDir, { recursive: true })).map((file) => file.replaceAll('\\', '/'));
}, 240_000);

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe('fonte embutida no build da interface (FR-004)', () => {
  it('leva os arquivos .woff2 da Manrope', () => {
    expect(files.filter((file) => /manrope.*\.woff2$/i.test(file)).length).toBeGreaterThan(0);
  });

  it('declara a Manrope só com arquivos do próprio app', async () => {
    const css = (await Promise.all(files.filter((f) => f.endsWith('.css')).map(readOut))).join(
      '\n',
    );
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.some((face) => face.includes('Manrope Variable'))).toBe(true);
    for (const face of faces) expect(face).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
  });

  it('nenhum arquivo do build aponta para fontes na internet', async () => {
    for (const file of textFiles()) {
      expect(await readOut(file), file).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/i);
    }
  });

  it('a política de conteúdo do index.html continua a mesma', async () => {
    const html = await readOut('index.html');
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
    expect(csp).toBe(EXPECTED_CSP);
  });
});
