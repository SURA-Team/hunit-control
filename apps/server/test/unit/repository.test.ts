import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * O que é esperado que o Git ignore dentro de apps/ e packages/: dependências, saídas de
 * build e arquivos com dados sensíveis.
 */
const EXPECTED_IGNORED = [
  /(^|\/)node_modules\/$/,
  /(^|\/)dist\/$/,
  /(^|\/)coverage\/$/,
  /(^|\/)\.vitest\/$/,
  /(^|\/)test\/fixtures\/hunit\/raw\/$/,
  /(^|\/)\.env(\.[^/]+)?$/,
  /\.(har|log|xlsx|xls|csv|tsv|tsbuildinfo)$/,
];

/** Arquivos e pastas ignorados pelo Git; `null` se o Git não estiver disponível. */
function ignoredPaths(): string[] | null {
  try {
    const output = execFileSync(
      'git',
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '--',
        'apps',
        'packages',
      ],
      { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return output.split('\n').filter((line) => line !== '');
  } catch {
    return null; // sem Git, ou fora de um repositório (ex.: dentro da imagem Docker)
  }
}

describe('repositório', () => {
  const ignored = ignoredPaths();

  // Uma regra genérica demais no .gitignore (ex.: "executions/") esconde pastas de código com
  // o mesmo nome: tudo funciona na máquina de quem escreveu, mas o código não vai para o Git.
  it.skipIf(ignored === null)('o .gitignore não esconde arquivos de código', () => {
    const unexpected = (ignored ?? []).filter(
      (path) => !EXPECTED_IGNORED.some((pattern) => pattern.test(path)),
    );

    expect(unexpected).toEqual([]);
  });
});
