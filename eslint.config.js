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

/** Importações proibidas em toda a interface (specs/002, research R-02). */
const rendererImportRestrictions = {
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
};

/**
 * Componentes únicos (specs/006, FR-030, research R-05): as telas montam a interface só com os
 * componentes de src/renderer/src/ui/. Os componentes visuais do Mantine e o calendário só podem ser
 * importados dentro de ui/; layout neutro (Stack, Group, Text, Title, SimpleGrid, Box…) continua livre.
 */
const uiOnlyMessage =
  'Use o componente de src/renderer/src/ui/: as telas não estilizam componentes do Mantine por conta própria (specs/006, FR-030, research R-05).';
const mantineOnlyInUi = [
  'ActionIcon',
  'Alert',
  'AppShell',
  'Badge',
  'Button',
  'Checkbox',
  'Chip',
  'CloseButton',
  'Drawer',
  'Menu',
  'Modal',
  'MultiSelect',
  'NavLink',
  'NumberInput',
  'Paper',
  'PasswordInput',
  'Progress',
  'Radio',
  'Select',
  'Switch',
  'Table',
  'Tabs',
  'TextInput',
  'Textarea',
];

/**
 * Arquivos da interface ainda não migrados para os componentes de ui/ (specs/006). A tarefa que
 * migra um arquivo o tira daqui; a lista é esvaziada e removida na T059 (tasks.md da 006).
 */
const NOT_YET_MIGRATED = [
  'components/ClassificationCountsGrid.tsx',
  'components/DocumentPreview.tsx',
  'components/EvidenceList.tsx',
  'components/LegacyBadge.tsx',
  'components/SituationBadge.tsx',
  'components/StatusBadge.tsx',
  'components/TwoFactorDialog.tsx',
  'screens/commercial/CommercialScreen.tsx',
  'screens/commercial/DispatchesTab.tsx',
  'screens/commercial/ProblemsTab.tsx',
  'screens/commercial/ReturnsTab.tsx',
  'screens/commercial/SheetTab.tsx',
  'screens/dispatch/DispatchDialog.tsx',
  'screens/dispatch/DispatchView.tsx',
  'screens/executions/ExecutionDetail.tsx',
  'screens/executions/ExecutionsScreen.tsx',
  'screens/reservations/AttachDialog.tsx',
  'screens/reservations/CommercialSection.tsx',
  'screens/reservations/ConfirmBatchDialog.tsx',
  'screens/reservations/CopyDialog.tsx',
  'screens/reservations/ReservationDetail.tsx',
  'screens/reservations/ReservationFilters.tsx',
  'screens/reservations/ReservationsScreen.tsx',
  'screens/reservations/SelectionDrawer.tsx',
  'screens/reservations/TreatmentSection.tsx',
  'screens/run/CredentialsForm.tsx',
  'screens/run/ExecutionResult.tsx',
  'screens/run/HotelSelect.tsx',
  'screens/run/RunScreen.tsx',
  'screens/setup/PreferencesForm.tsx',
  'screens/setup/SetupScreen.tsx',
].map((file) => `apps/desktop/src/renderer/src/${file}`);

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
      'no-restricted-imports': ['error', rendererImportRestrictions],
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
    // Telas e componentes de tela: só os componentes de ui/ (specs/006, FR-030). Este bloco repete
    // as restrições de toda a interface, porque a regra declarada aqui substitui a do bloco acima.
    files: [
      'apps/desktop/src/renderer/src/App.tsx',
      'apps/desktop/src/renderer/src/components/**/*.{ts,tsx}',
      'apps/desktop/src/renderer/src/screens/**/*.{ts,tsx}',
    ],
    ignores: NOT_YET_MIGRATED,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...rendererImportRestrictions.paths,
            { name: '@mantine/core', importNames: mantineOnlyInUi, message: uiOnlyMessage },
            { name: '@mantine/dates', message: uiOnlyMessage },
          ],
          patterns: rendererImportRestrictions.patterns,
        },
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
