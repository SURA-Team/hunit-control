// Build dos três processos do app (specs/002, research R-01 e R-11).
//
// Todas as bibliotecas são empacotadas dentro do código gerado (`externalizeDeps: false`): o
// `package.json` do app não tem `dependencies`, e o electron-builder não precisa copiar
// `node_modules` (evita os problemas dele com os links do pnpm). Só `electron` e os módulos do
// Node ficam de fora, como o electron-vite já faz por padrão.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Só no servidor de desenvolvimento (`pnpm dev`): o React Refresh injeta um script inline e a
 * recarga da tela usa WebSocket, que a CSP do app bloqueia (research R-02). O build — que vai para
 * o instalador e para os testes de ponta a ponta — mantém a CSP como está no index.html.
 */
const developmentCsp: Plugin = {
  name: 'hunit-development-csp',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'none'", "connect-src 'self' ws://localhost:* http://localhost:*"),
};

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        output: {
          // Com `sandbox: true`, o preload precisa ser CommonJS num arquivo único (R-02).
          format: 'cjs',
          entryFileNames: '[name].cjs',
          codeSplitting: false,
        },
      },
    },
  },
  renderer: {
    plugins: [react(), developmentCsp],
  },
});
