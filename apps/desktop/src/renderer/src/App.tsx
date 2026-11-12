/**
 * Estrutura da interface (specs/002, FR-004, FR-005, research R-09): quatro áreas fixas
 * (Executar, Execuções, Reservas, Configuração), navegação por estado, sem roteador. Sem conexão
 * confirmada, só a Configuração fica disponível. As ações de operador somem para o perfil consulta.
 */
import { AppShell, Badge, Group, NavLink, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import alertSound from '../../../resources/sounds/token-alert.wav';
import { ConnectionBanner } from './components/ConnectionBanner';
import { useHunit } from './hunit';
import { SetupScreen } from './screens/setup/SetupScreen';
import { useConnection } from './state/connection';

export type Area = 'run' | 'executions' | 'reservations' | 'setup';

/** No máximo um aviso de atividade por minuto (research R-05). */
const ACTIVITY_PING_MS = 60_000;

const AREA_TITLES: Record<Area, string> = {
  run: 'Executar',
  executions: 'Execuções',
  reservations: 'Reservas',
  setup: 'Configuração',
};

export interface AppScreens {
  run: ReactNode;
  executions: ReactNode;
  reservations: ReactNode;
}

export function App({ screens }: { screens?: Partial<AppScreens> }) {
  const hunit = useHunit();
  const { state, client, isOnline, isOperator } = useConnection();
  const [chosen, setChosen] = useState<Area>('run');
  const lastPing = useRef(0);

  // Sem conexão confirmada (não configurado, certificado ou chave recusados), só a configuração.
  const needsSetup =
    state?.status === 'not_configured' ||
    state?.status === 'untrusted_server' ||
    state?.status === 'unauthorized';
  const available: Area[] = needsSetup
    ? ['setup']
    : isOperator
      ? ['run', 'executions', 'reservations', 'setup']
      : ['executions', 'reservations', 'setup'];
  const area: Area = available.includes(chosen) ? chosen : (available[0] ?? 'setup');

  // Ação do operador renova o prazo do cofre do acesso ao Hunit.
  useEffect(() => {
    const ping = () => {
      const now = Date.now();
      if (now - lastPing.current < ACTIVITY_PING_MS) return;
      lastPing.current = now;
      hunit.activity.ping();
    };
    window.addEventListener('keydown', ping, true);
    window.addEventListener('pointerdown', ping, true);
    return () => {
      window.removeEventListener('keydown', ping, true);
      window.removeEventListener('pointerdown', ping, true);
    };
  }, [hunit]);

  // Som do aviso, pedido pelo processo principal (só com a preferência ligada, R-07).
  useEffect(
    () =>
      hunit.attention.onPlaySound(() => {
        void new Audio(alertSound).play().catch(() => undefined);
      }),
    [hunit],
  );

  const content: Record<Area, ReactNode> = {
    run: screens?.run ?? null,
    executions: screens?.executions ?? null,
    reservations: screens?.reservations ?? null,
    setup: <SetupScreen />,
  };

  return (
    <AppShell navbar={{ width: 220, breakpoint: 0 }} header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={3}>HUNIT Control</Title>
          {client && (
            <Group gap="xs">
              <Text size="sm">{client.name}</Text>
              <Badge variant="light" color={isOperator ? 'blue' : 'gray'}>
                {isOperator ? 'Operador' : 'Consulta'}
              </Badge>
            </Group>
          )}
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {available.map((item) => (
          <NavLink
            key={item}
            label={AREA_TITLES[item]}
            active={area === item}
            onClick={() => setChosen(item)}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Stack gap="md">
          <ConnectionBanner state={state} onOpenSetup={() => setChosen('setup')} />
          {!isOnline && state === null && <Text c="dimmed">Carregando…</Text>}
          {content[area]}
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
