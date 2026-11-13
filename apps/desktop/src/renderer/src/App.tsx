/**
 * Estrutura da interface (specs/002, FR-004, FR-005, research R-09): quatro áreas fixas
 * (Executar, Execuções, Reservas, Configuração), navegação por estado, sem roteador. Sem conexão
 * confirmada, só a Configuração fica disponível. As ações de operador somem para o perfil consulta.
 */
import { AppShell, Badge, Group, NavLink, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import alertSound from '../../../resources/sounds/token-alert.wav';
import { ConnectionBanner } from './components/ConnectionBanner';
import { TwoFactorDialog } from './components/TwoFactorDialog';
import { useHunit } from './hunit';
import { ExecutionsScreen } from './screens/executions/ExecutionsScreen';
import { ReservationsScreen } from './screens/reservations/ReservationsScreen';
import { RunScreen } from './screens/run/RunScreen';
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

export function App() {
  const hunit = useHunit();
  const { state, client, isOnline, isOperator } = useConnection();
  const [chosen, setChosen] = useState<Area>('run');
  /** Execução aberta na área Execuções (ex.: "Ver a execução ativa" na tela Executar). */
  const [openExecutionId, setOpenExecutionId] = useState<string | null>(null);
  /** Execução usada como filtro ao abrir a área Reservas pelo detalhe de uma execução. */
  const [reservationsExecutionId, setReservationsExecutionId] = useState<string | null>(null);
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

  const openExecution = (executionId: string) => {
    setOpenExecutionId(executionId);
    setChosen('executions');
  };

  const content: Record<Area, ReactNode> = {
    run: <RunScreen onOpenExecution={openExecution} />,
    executions: (
      <ExecutionsScreen
        key={openExecutionId ?? 'lista'}
        initialExecutionId={openExecutionId}
        onOpenReservations={(executionId) => {
          setReservationsExecutionId(executionId);
          setChosen('reservations');
        }}
      />
    ),
    reservations: (
      <ReservationsScreen
        key={reservationsExecutionId ?? 'todas'}
        initialExecutionId={reservationsExecutionId}
      />
    ),
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
            onClick={() => {
              if (item === 'executions') setOpenExecutionId(null);
              if (item === 'reservations') setReservationsExecutionId(null);
              setChosen(item);
            }}
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
      <TwoFactorDialog />
    </AppShell>
  );
}
