import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
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
          // Com a suíte inteira em paralelo (inclusive o teste de cópia de segurança, que sobe
          // outro PostgreSQL), testes de banco que levam ~4 s passavam dos 5 s padrão.
          testTimeout: 15_000,
        },
      },
      {
        // App desktop, processo principal (specs/002, research R-12): configuração, cofre, cliente
        // da API com TLS fixado contra um servidor HTTPS local, fluxo de eventos. Sem dependência
        // externa: o Electron é simulado.
        test: {
          name: 'desktop',
          root: fromRoot('./apps/desktop'),
          include: ['test/main/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // App desktop, interface (React) com a Testing Library num DOM simulado (jsdom).
        plugins: [react()],
        test: {
          name: 'desktop-ui',
          root: fromRoot('./apps/desktop'),
          include: ['test/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['test/renderer/setup.ts'],
        },
      },
      {
        // App desktop de ponta a ponta: o app compilado aberto pelo Playwright (_electron) contra
        // a API da 001 com o FakeHunitGateway e um PostgreSQL do Testcontainers, atrás de um
        // terminador TLS. Exige o Docker em execução. Um arquivo por vez: cada um abre o app.
        test: {
          name: 'desktop-e2e',
          root: fromRoot('./apps/desktop'),
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          globalSetup: [
            fromRoot('./apps/server/test/helpers/postgres-global-setup.ts'),
            fromRoot('./apps/desktop/test/e2e/global-setup.ts'),
          ],
          testTimeout: 60_000,
          // Compilar o app e subir o PostgreSQL (na primeira vez, baixar a imagem) leva tempo.
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
