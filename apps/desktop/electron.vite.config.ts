// Build dos três processos do app (specs/002, research R-01 e R-11).
//
// Todas as bibliotecas são empacotadas dentro do código gerado (`externalizeDeps: false`): o
// `package.json` do app não tem `dependencies`, e o electron-builder não precisa copiar
// `node_modules` (evita os problemas dele com os links do pnpm). Só `electron` e os módulos do
// Node ficam de fora, como o electron-vite já faz por padrão.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

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
          inlineDynamicImports: true,
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
