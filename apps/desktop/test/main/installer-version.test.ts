/**
 * Versão do instalador (specs/002, research R-11, "Versão do instalador"): major e minor do
 * package.json, último número = commits do Git, para cada atualização gerar um número novo.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitCommitCount, installerVersion } from '../../scripts/installer-version.mjs';

const appRoot = path.resolve(import.meta.dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
  version: string;
  scripts: Record<string, string>;
};

describe('installerVersion', () => {
  it('troca o último número pela quantidade de commits', () => {
    expect(installerVersion('0.2.0', 131)).toBe('0.2.131');
    expect(installerVersion('1.10.7', 2)).toBe('1.10.2');
  });

  it('mais commits geram uma versão maior', () => {
    const before = installerVersion('0.2.0', 131).split('.').map(Number);
    const after = installerVersion('0.2.0', 132).split('.').map(Number);
    expect(after[2]).toBeGreaterThan(before[2] ?? 0);
  });

  it('recusa versão fora do formato major.minor.patch', () => {
    expect(() => installerVersion('0.2', 10)).toThrow(/Versão inválida/);
    expect(() => installerVersion('0.2.0-beta', 10)).toThrow(/Versão inválida/);
  });

  it('recusa contagem que não cabe na versão do arquivo do Windows (16 bits)', () => {
    expect(() => installerVersion('0.2.0', 0)).toThrow(/commits inválida/);
    expect(() => installerVersion('0.2.0', 65_536)).toThrow(/commits inválida/);
    expect(() => installerVersion('0.2.0', Number.NaN)).toThrow(/commits inválida/);
  });

  it('lê a contagem do repositório', () => {
    expect(gitCommitCount(appRoot)).toBeGreaterThan(0);
  });
});

describe('package.json do app', () => {
  it('guarda a versão como major.minor.0 (o último número vem do Git)', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.0$/);
  });

  it('gera o instalador pelo script que calcula a versão', () => {
    expect(manifest.scripts.dist).toBe('node scripts/dist.mjs');
  });
});
