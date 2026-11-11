// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Infraestrutura que o domínio não pode importar (constitution, princípio II):
 * regras de negócio não dependem de navegador, banco de dados nem servidor HTTP.
 */
const infraForbiddenInDomain = ['playwright', 'playwright-core', 'pg', 'drizzle-orm', 'fastify'];
const domainPurityMessage =
  'packages/domain contém apenas regras de negócio puras: não pode depender de navegador, banco de dados ou HTTP (constitution, princípio II).';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
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
);
