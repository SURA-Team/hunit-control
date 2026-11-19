/**
 * Entrada da interface (specs/002, research R-08 e R-09): Mantine em português, datas em
 * DD/MM/AAAA e o TanStack Query como cache **só em memória** — nada é gravado no navegador.
 * Desde a 006, o tema e a fonte da nova identidade (research R-02 e R-03): a Manrope vai embutida
 * no app, sem internet.
 */
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@fontsource-variable/manrope';
import './ui/global.css';
import 'dayjs/locale/pt-br';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { HunitContext, windowHunit } from './hunit';
import { ConnectionProvider } from './state/connection';
import { SelectionProvider } from './state/selection';
import { cssVariablesResolver, theme } from './ui/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Servidor fora do ar: o principal já testa a volta a cada 5 s; quando volta, as consultas
      // são refeitas (state/connection.tsx). Sem novas tentativas aqui.
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado.');

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <DatesProvider settings={{ locale: 'pt-br', firstDayOfWeek: 0 }}>
        <QueryClientProvider client={queryClient}>
          <HunitContext.Provider value={windowHunit()}>
            <ConnectionProvider>
              {/* Acima das telas: a seleção do lote sobrevive às pesquisas e à troca de área. */}
              <SelectionProvider>
                <App />
              </SelectionProvider>
            </ConnectionProvider>
          </HunitContext.Provider>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
