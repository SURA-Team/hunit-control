import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readFromServerRoot = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

describe('imagem Docker do servidor (research R-18)', () => {
  const manifest = JSON.parse(readFromServerRoot('package.json')) as {
    dependencies: Record<string, string>;
  };
  const playwrightVersion = manifest.dependencies['playwright'];

  it('fixa o pacote playwright em uma versão exata', () => {
    expect(playwrightVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('usa a imagem oficial do Playwright na mesma versão do pacote', () => {
    const dockerfile = readFromServerRoot('Dockerfile');
    const imageVersion = /^ARG PLAYWRIGHT_VERSION=(\S+)$/m.exec(dockerfile)?.[1];

    expect(imageVersion).toBe(playwrightVersion);
  });
});
