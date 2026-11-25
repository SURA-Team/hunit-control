/**
 * Estrutura da interface (specs/002, FR-004, FR-005, research R-09): áreas fixas (Executar,
 * Execuções, Reservas, Comercial — specs/005, research R-14 — e Configuração), navegação por
 * estado, sem roteador. Sem conexão
 * confirmada, só a Configuração fica disponível. As ações de operador somem para o perfil consulta.
 *
 * Desde a 006 (FR-001, FR-002, T016): cabeçalho com a marca, o cliente e o perfil, menu lateral
 * flutuante com o ícone de cada área e a ativa em pílula, e o conteúdo com largura máxima.
 *
 * Desde a 007 (FR-001, research R-08): a área Relatórios, nos dois perfis, entre Comercial e
 * Configuração. O período do relatório fica aqui (lembrado enquanto o app está aberto), e a ida do
 * relatório para Reservas leva os filtros (`ReservationsPreset`, research R-07).
 */
import { Text } from '@mantine/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import classes from './App.module.css';
import { ConnectionBanner } from './components/ConnectionBanner';
import { TwoFactorDialog } from './components/TwoFactorDialog';
import { useHunit } from './hunit';
import { CommercialScreen } from './screens/commercial/CommercialScreen';
import { ExecutionsScreen } from './screens/executions/ExecutionsScreen';
import {
  ReportsScreen,
  defaultReportPeriod,
  type ReportPeriod,
} from './screens/reports/ReportsScreen';
import {
  ReservationsScreen,
  type ReservationsPreset,
} from './screens/reservations/ReservationsScreen';
import { RunScreen } from './screens/run/RunScreen';
import { SetupScreen } from './screens/setup/SetupScreen';
import { playAlertSound } from './sound';
import { useConnection } from './state/connection';
import {
  AppHeader,
  CommercialIcon,
  ExecutionsIcon,
  ReservationsIcon,
  ReportsIcon,
  RunIcon,
  SettingsIcon,
  SideMenu,
  SideMenuItem,
} from './ui';

export type Area = 'run' | 'executions' | 'reservations' | 'commercial' | 'reports' | 'setup';

/** No máximo um aviso de atividade por minuto (research R-05). */
const ACTIVITY_PING_MS = 60_000;

const AREA_TITLES: Record<Area, string> = {
  run: 'Executar',
  executions: 'Execuções',
  reservations: 'Reservas',
  commercial: 'Comercial',
  reports: 'Relatórios',
  setup: 'Configuração',
};

const AREA_ICONS: Record<Area, ReactNode> = {
  run: <RunIcon />,
  executions: <ExecutionsIcon />,
  reservations: <ReservationsIcon />,
  commercial: <CommercialIcon />,
  reports: <ReportsIcon />,
  setup: <SettingsIcon />,
};

export function App() {
  const hunit = useHunit();
  const { state, client, isOnline, isOperator } = useConnection();
  const [chosen, setChosen] = useState<Area>('run');
  /** Execução aberta na área Execuções (ex.: "Ver a execução ativa" na tela Executar). */
  const [openExecutionId, setOpenExecutionId] = useState<string | null>(null);
  /** Execução usada como filtro ao abrir a área Reservas pelo detalhe de uma execução. */
  const [reservationsExecutionId, setReservationsExecutionId] = useState<string | null>(null);
  /** Filtros vindos do relatório ao abrir a área Reservas (specs/007, research R-07). */
  const [reservationsPreset, setReservationsPreset] = useState<ReservationsPreset | null>(null);
  /** Período do relatório, lembrado enquanto o app está aberto (specs/007, premissas). */
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>(defaultReportPeriod);
  /** Muda a cada ida para Reservas, para a área começar de novo com os filtros pedidos. */
  const [reservationsVisit, setReservationsVisit] = useState(0);
  const lastPing = useRef(0);

  // Sem conexão confirmada (não configurado, certificado ou chave recusados), só a configuração.
  const needsSetup =
    state?.status === 'not_configured' ||
    state?.status === 'untrusted_server' ||
    state?.status === 'unauthorized';
  const available: Area[] = needsSetup
    ? ['setup']
    : isOperator
      ? ['run', 'executions', 'reservations', 'commercial', 'reports', 'setup']
      : ['executions', 'reservations', 'commercial', 'reports', 'setup'];
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

  // Som do aviso, pedido pelo processo principal (só com a preferência ligada, R-07), no volume
  // escolhido (specs/008, FR-002).
  useEffect(() => hunit.attention.onPlaySound(({ volume }) => playAlertSound(volume)), [hunit]);

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
          setReservationsPreset(null);
          setReservationsVisit((visit) => visit + 1);
          setChosen('reservations');
        }}
      />
    ),
    reservations: (
      <ReservationsScreen
        key={`${reservationsExecutionId ?? 'todas'}-${reservationsVisit}`}
        initialExecutionId={reservationsExecutionId}
        preset={reservationsPreset}
      />
    ),
    commercial: <CommercialScreen />,
    reports: (
      <ReportsScreen
        period={reportPeriod}
        onPeriodChange={setReportPeriod}
        onOpenReservations={(preset) => {
          setReservationsExecutionId(null);
          setReservationsPreset(preset);
          setReservationsVisit((visit) => visit + 1);
          setChosen('reservations');
        }}
      />
    ),
    setup: <SetupScreen />,
  };

  return (
    <div className={classes.shell}>
      <div className={classes.header}>
        <AppHeader
          clientName={client?.name ?? null}
          profile={client ? (isOperator ? 'operator' : 'reader') : null}
        />
      </div>
      <div className={classes.menu}>
        <SideMenu>
          {available.map((item) => (
            <SideMenuItem
              key={item}
              label={AREA_TITLES[item]}
              icon={AREA_ICONS[item]}
              active={area === item}
              onClick={() => {
                if (item === 'executions') setOpenExecutionId(null);
                if (item === 'reservations') {
                  // Pelo menu, a área abre sem os filtros da execução ou do relatório.
                  if (reservationsPreset) setReservationsVisit((visit) => visit + 1);
                  setReservationsExecutionId(null);
                  setReservationsPreset(null);
                }
                setChosen(item);
              }}
            />
          ))}
        </SideMenu>
      </div>
      <main className={classes.main}>
        <div className={classes.content}>
          <ConnectionBanner state={state} onOpenSetup={() => setChosen('setup')} />
          {!isOnline && state === null && <Text c="dimmed">Carregando…</Text>}
          {content[area]}
        </div>
      </main>
      <TwoFactorDialog />
    </div>
  );
}
