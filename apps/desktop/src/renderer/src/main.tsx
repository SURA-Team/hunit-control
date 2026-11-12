/**
 * Entrada da interface (specs/002, research R-08 e R-09): Mantine em português, datas em
 * DD/MM/AAAA e o TanStack Query como cache **só em memória** — nada é gravado no navegador.
 */
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import 'dayjs/locale/pt-br';
import { createTheme, MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { HunitContext, windowHunit } from './hunit';
import { ConnectionProvider } from './state/connection';

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'Segoe UI, system-ui, sans-serif',
});

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
    <MantineProvider theme={theme}>
      <DatesProvider settings={{ locale: 'pt-br', firstDayOfWeek: 0 }}>
        <QueryClientProvider client={queryClient}>
          <HunitContext.Provider value={windowHunit()}>
            <ConnectionProvider>
              <App />
            </ConnectionProvider>
          </HunitContext.Provider>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
