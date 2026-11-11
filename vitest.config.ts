import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Nos testes, os pacotes do workspace são lidos direto do código-fonte,
    // sem depender de um build anterior (evita testar contra um `dist` desatualizado).
    alias: [
      { find: /^@hunit\/domain$/, replacement: fromRoot('./packages/domain/src/index.ts') },
      { find: /^@hunit\/contracts$/, replacement: fromRoot('./packages/contracts/src/index.ts') },
    ],
  },
  test: {
    // Um projeto por pacote. Para rodar só um: `pnpm test --project domain`.
    projects: [
      {
        test: {
          name: 'domain',
          root: fromRoot('./packages/domain'),
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'contracts',
          root: fromRoot('./packages/contracts'),
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          root: fromRoot('./apps/server'),
          include: ['test/**/*.test.ts'],
        },
      },
    ],
  },
});
