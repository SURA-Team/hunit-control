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
    // Um projeto por grupo de testes. Para rodar só um: `pnpm test --project domain`.
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
        // Testes do servidor que não precisam de banco de dados nem de navegador.
        test: {
          name: 'server',
          root: fromRoot('./apps/server'),
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        // Testes que abrem o Chromium do Playwright (camada do Hunit, captura de evidências).
        // Exigem o navegador instalado: pnpm --filter @hunit/server exec playwright install chromium
        test: {
          name: 'server-browser',
          root: fromRoot('./apps/server'),
          include: ['test/browser/**/*.test.ts', 'test/hunit/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Testes do servidor com PostgreSQL real: exigem o Docker em execução. Um container é
        // criado para a rodada inteira (globalSetup) e cada arquivo de teste usa um banco próprio.
        test: {
          name: 'server-db',
          root: fromRoot('./apps/server'),
          include: [
            'test/contract/**/*.test.ts',
            'test/integration/**/*.test.ts',
            'test/security/**/*.test.ts',
          ],
          globalSetup: [fromRoot('./apps/server/test/helpers/postgres-global-setup.ts')],
          // Na primeira vez o Docker ainda precisa baixar a imagem do PostgreSQL.
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
