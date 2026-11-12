// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Infraestrutura que o domínio não pode importar (constitution, princípio II):
 * regras de negócio não dependem de navegador, banco de dados nem servidor HTTP.
 */
const infraForbiddenInDomain = ['playwright', 'playwright-core', 'pg', 'drizzle-orm', 'fastify'];
const domainPurityMessage =
  'packages/domain contém apenas regras de negócio puras: não pode depender de navegador, banco de dados ou HTTP (constitution, princípio II).';

/**
 * A interface do app desktop roda isolada, sem Node e sem rede (specs/002, research R-02): só fala
 * com o processo principal pela ponte `window.hunit`. Rede, disco, segredos e Electron ficam no
 * processo principal.
 */
const rendererIsolationMessage =
  'A interface do app (src/renderer) não acessa Electron, Node, rede nem o processo principal: use a ponte window.hunit (specs/002, research R-02).';
const forbiddenInRenderer = ['electron', 'undici', 'openapi-fetch', 'eventsource-parser'];
const rendererStorageMessage =
  'A interface não grava nada no navegador: dados de reservas e credenciais ficam só em memória (specs/002, research R-14, FR-008a).';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/out/',
    'apps/desktop/release/',
    '**/.vitest/',
    'packages/contracts/src/generated.ts',
    'legacy/',
    'specs/',
    '.specify/',
    '.claude/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Arquivos JavaScript (como este) não fazem parte de nenhum tsconfig.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: infraForbiddenInDomain.map((name) => ({ name, message: domainPurityMessage })),
          patterns: [
            {
              group: [
                ...infraForbiddenInDomain.map((name) => `${name}/*`),
                '@playwright/*',
                '@fastify/*',
              ],
              message: domainPurityMessage,
            },
          ],
        },
      ],
    },
  },

  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'apps/desktop/test/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: forbiddenInRenderer.map((name) => ({ name, message: rendererIsolationMessage })),
          patterns: [
            {
              group: ['node:*', 'electron/*', 'undici/*'],
              message: rendererIsolationMessage,
            },
            {
              group: ['**/main', '**/main/**', '**/preload', '**/preload/**'],
              message: rendererIsolationMessage,
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: rendererStorageMessage },
        { name: 'sessionStorage', message: rendererStorageMessage },
        { name: 'indexedDB', message: rendererStorageMessage },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'localStorage', message: rendererStorageMessage },
        { object: 'window', property: 'sessionStorage', message: rendererStorageMessage },
        { object: 'window', property: 'indexedDB', message: rendererStorageMessage },
      ],
    },
  },
  {
    files: ['apps/desktop/src/main/**/*.ts', 'apps/desktop/src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'O processo principal não desenha telas (specs/002, R-02).' },
          ],
          patterns: [
            {
              group: ['react-dom', 'react-dom/*', '@mantine/*', '@tanstack/*'],
              message: 'O processo principal não desenha telas (specs/002, R-02).',
            },
          ],
        },
      ],
    },
  },
);
