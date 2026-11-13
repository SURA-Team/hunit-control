/**
 * Configuração do instalador (specs/002, T075, research R-11): o app compilado para os testes de
 * ponta a ponta não tem as fuses (o Playwright precisa do que elas desligam), então elas são
 * conferidas aqui, na configuração que gera o instalador.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const appRoot = path.resolve(import.meta.dirname, '..', '..');

interface BuilderConfig {
  appId?: string;
  asar?: boolean;
  files?: string[];
  nsis?: { oneClick?: boolean; perMachine?: boolean };
  publish?: unknown;
  electronFuses?: Record<string, boolean>;
}

const builder = parse(
  readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8'),
) as BuilderConfig;
const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;

describe('electron-builder.yml', () => {
  it('identidade do app igual à usada nas notificações (AppUserModelID)', () => {
    expect(builder.appId).toBe('io.github.sura-team.hunit-control');
  });

  it('instalador NSIS por usuário, sem administrador', () => {
    expect(builder.nsis).toMatchObject({ oneClick: true, perMachine: false });
  });

  it('código em asar, só o que o electron-vite gerou, sem publicação automática', () => {
    expect(builder.asar).toBe(true);
    expect(builder.files).toEqual(['out/**']);
    expect(builder.publish).toBeNull();
  });

  it('fuses: sem rodar como Node, sem NODE_OPTIONS, sem inspeção, asar verificado', () => {
    expect(builder.electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
    });
  });
});

describe('package.json do app', () => {
  it('não tem dependencies: tudo vai empacotado pelo Vite (R-11)', () => {
    expect(manifest['dependencies']).toBeUndefined();
  });

  it('define o nome do produto, que é a pasta de dados (%APPDATA%\\HUNIT Control)', () => {
    expect(manifest['productName']).toBe('HUNIT Control');
  });
});
