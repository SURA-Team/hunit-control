/**
 * Módulo de Relatórios (specs/007; telas 8.1 a 8.7): o panorama do período de check-in — volume,
 * valor em aberto, valor já cobrado, distribuição dos valores e o ranking dos hotéis —, com o detalhe
 * do hotel, "Todos os hotéis" e a ida para a área Reservas filtrada. Só leitura, para os dois perfis.
 *
 * Estados (US5, research R-06): carregando (os números em espera, selo "Atualizando…"), vazio (8.4),
 * servidor indisponível com dados (8.5: o alerta do app, "dados de HH:MM", ações desabilitadas) e sem
 * dados (só o alerta do app). Sem atualização automática: só ao abrir, trocar o período ou
 * "Atualizar dados".
 *
 * Filtros (FR-005a, research R-14): o botão "Filtros" ao lado dos atalhos abre o painel da área
 * Reservas (sem o período, com a Origem); valem para todo o relatório, para a gaveta do hotel e para
 * a ida a Reservas, e ficam guardados com o período ao trocar de área.
 */
import { Box, Group, SimpleGrid, Stack } from '@mantine/core';
import { reportPeriod } from '@hunit/domain';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import type { HotelReportRow } from '../../../../shared/ipc-types';
import { formatMoney, formatTime } from '../../presentation/format';
import {
  localToday,
  offlineSubtitle,
  periodBetween,
  rankingPosition,
  reportSubtitle,
} from '../../presentation/report';
import { unwrap, useHunit } from '../../hunit';
import { useConnection } from '../../state/connection';
import { useReportOverview } from '../../state/reports';
import { Action, DataStatus, EmptyState, Notice, PageHeader, ReservationsIcon } from '../../ui';
import type { ReservationsPreset } from '../reservations/ReservationsScreen';
import { AllHotelsDrawer } from './AllHotelsDrawer';
import { HotelDetailDrawer } from './HotelDetailDrawer';
import { HotelRankingCard } from './HotelRankingCard';
import {
  EMPTY_REPORT_FILTERS,
  ReportAppliedFilters,
  ReportFilterPanel,
  ReportFiltersButton,
  hasReportFilters,
  reportFilterInput,
  type ReportFilterState,
} from './ReportFilters';
import { ReportPeriodBar } from './ReportPeriodBar';
import { ChargedValueCard, OpenValueCard, ValueDistributionCard, VolumeCards } from './ReportCards';

export type ReportPeriod = { from: string; to: string };

/** Período padrão ao abrir o módulo: "Últimos 30 dias" (premissa da spec). */
export function defaultReportPeriod(): ReportPeriod {
  return reportPeriod('last_30_days', localToday());
}

export function ReportsScreen({
  period,
  onPeriodChange,
  filters = EMPTY_REPORT_FILTERS,
  onFiltersChange = () => undefined,
  onOpenReservations,
}: {
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  filters?: ReportFilterState;
  onFiltersChange?: (filters: ReportFilterState) => void;
  onOpenReservations: (preset: ReservationsPreset) => void;
}) {
  const hunit = useHunit();
  const { state } = useConnection();
  const offline = state?.status === 'offline';
  const filterInput = useMemo(() => reportFilterInput(filters), [filters]);
  const filtered = hasReportFilters(filters);
  const query = useReportOverview(period, filterInput);
  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => unwrap(hunit.reservations.channels()),
  });
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(false);
  const report = query.data ?? null;
  const [hotel, setHotel] = useState<HotelReportRow | null>(null);
  const [allOpen, setAllOpen] = useState(false);

  // Sem servidor e sem dados deste período: só o alerta do app (FR-025), nenhum número.
  if (!report && (offline || query.isError)) {
    return (
      <Stack gap={16}>
        <PageHeader title="Relatórios" subtitle="Reservas com cartão virtual" />
        {!offline && (
          <Notice
            tone="red"
            title="Não foi possível carregar o relatório"
            action={
              <Action variant="secondary" size="xs" onClick={() => void query.refetch()}>
                Tentar de novo
              </Action>
            }
          >
            Confira a conexão com o servidor e tente de novo.
          </Notice>
        )}
      </Stack>
    );
  }

  const loading = report === null || query.isFetching;
  const actionsDisabled = offline || query.isFetching;
  const empty = report !== null && !query.isFetching && report.reservations === 0;

  const badge = offline ? (
    <DataStatus tone="amber">{`dados de ${formatTime(query.dataUpdatedAt)} — servidor indisponível`}</DataStatus>
  ) : loading ? (
    <DataStatus tone="lime">Atualizando…</DataStatus>
  ) : (
    <DataStatus tone="green">Dados atualizados</DataStatus>
  );

  const subtitle = report
    ? offline
      ? offlineSubtitle(report.generatedAt)
      : reportSubtitle(report.generatedAt)
    : 'Reservas com cartão virtual';

  const openReservations = (row: HotelReportRow | null) => {
    if (!report) return;
    const { hotelCodes, situations, status, channel, notFound } = filters.panel;
    const chosenHotels = row ? [row.hotelCode] : hotelCodes;
    onOpenReservations({
      ...(chosenHotels.length > 0 && { hotelCodes: chosenHotels }),
      checkInFrom: period.from,
      checkInTo: period.to,
      quickFilter: 'pending_charge',
      expectedCount: row ? row.openCount : report.open.count,
      ...(filtered && { filters: { situations, status, channel, notFound } }),
      ...(filters.origin !== 'all' && { origin: filters.origin }),
    });
  };

  return (
    <Stack gap={16} data-testid={loading ? 'report-loading' : 'report-loaded'}>
      <PageHeader
        title="Relatórios"
        subtitle={subtitle}
        action={
          <>
            {badge}
            <Action
              variant="secondary"
              disabled={actionsDisabled}
              onClick={() => void query.refetch()}
            >
              Atualizar dados
            </Action>
          </>
        }
      />

      <ReportPeriodBar
        period={period}
        onChange={onPeriodChange}
        reservations={query.isFetching ? null : (report?.reservations ?? null)}
        lastVerifiedAt={query.isFetching ? null : (report?.lastVerifiedAt ?? null)}
        disabled={offline}
        filterAction={
          <ReportFiltersButton
            panelId={panelId}
            opened={panelOpen}
            onOpenedChange={setPanelOpen}
            disabled={offline}
          />
        }
        filterPanel={
          <ReportFilterPanel
            panelId={panelId}
            opened={panelOpen && !offline}
            onClose={() => setPanelOpen(false)}
            filters={filters}
            onChange={onFiltersChange}
            hotels={hotels.data ?? []}
            channels={channels.data ?? []}
          />
        }
      />
      <ReportAppliedFilters
        filters={filters}
        onChange={onFiltersChange}
        hotels={hotels.data ?? []}
      />

      {empty ? (
        filtered ? (
          <EmptyState
            icon={<ReservationsIcon size={32} />}
            title="Nenhuma reserva com estes filtros"
            description={`Não há check-ins com cartão virtual entre ${periodBetween(period.from, period.to)} com os filtros aplicados. Tire algum filtro ou escolha outro período.`}
            onClear={() => onFiltersChange(EMPTY_REPORT_FILTERS)}
            clearLabel="Limpar filtros"
          />
        ) : (
          <EmptyState
            icon={<ReservationsIcon size={32} />}
            title="Nenhuma reserva neste período"
            description={`Não há check-ins com cartão virtual entre ${periodBetween(period.from, period.to)}. Escolha outro período para ver os indicadores.`}
            onClear={() => onPeriodChange(defaultReportPeriod())}
            clearLabel="Ver os últimos 30 dias"
          />
        )
      ) : (
        <>
          <VolumeCards report={query.isFetching ? null : report} />
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={16}>
            <OpenValueCard
              report={query.isFetching ? null : report}
              onOpenReservations={() => openReservations(null)}
              disabled={actionsDisabled}
            />
            <ChargedValueCard report={query.isFetching ? null : report} />
          </SimpleGrid>
          <Group align="stretch" gap={16} wrap="wrap">
            <Box style={{ flex: '1 1 340px', minWidth: 0, display: 'grid' }}>
              <ValueDistributionCard report={query.isFetching ? null : report} />
            </Box>
            <Box style={{ flex: '1.7 1 480px', minWidth: 0, display: 'grid' }}>
              <HotelRankingCard
                rows={query.isFetching ? null : (report?.hotelRows ?? null)}
                onOpenHotel={setHotel}
                onOpenAll={() => setAllOpen(true)}
                hotelsDisabled={actionsDisabled}
              />
            </Box>
          </Group>
        </>
      )}

      <AllHotelsDrawer
        opened={allOpen && hotel === null && report !== null}
        rows={report?.hotelRows ?? []}
        period={period}
        totalOpen={formatMoney(report?.open.amount ?? '0.00')}
        onClose={() => setAllOpen(false)}
        onOpenHotel={setHotel}
        hotelsDisabled={actionsDisabled}
      />
      <HotelDetailDrawer
        row={hotel}
        period={period}
        filters={filterInput}
        position={hotel && report ? rankingPosition(report.hotelRows, hotel.hotelCode) : null}
        onClose={() => setHotel(null)}
        onOpenReservations={(row) => openReservations(row)}
        disabled={actionsDisabled}
      />
    </Stack>
  );
}
