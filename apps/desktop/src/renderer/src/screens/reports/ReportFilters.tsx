/**
 * Filtros do relatório (specs/007, FR-005a, research R-14; ajuste pedido depois do merge, sem design
 * ainda): o botão "Filtros" ao lado dos atalhos do período abre o painel "Filtros avançados" da área
 * Reservas, sem o período (o relatório tem o próprio) e com a Origem; valem na hora, aparecem na
 * linha "Filtros aplicados" e seguem para a área Reservas na ida pelo relatório.
 */
import { REPORT_EXCLUDED_SITUATIONS } from '@hunit/domain';
import type { Hotel, ReportOverviewInput } from '../../../../shared/ipc-types';
import { SITUATION_ORDER, type OriginFilter } from '../../presentation/labels';
import { Action, FilterPanel } from '../../ui';
import {
  AppliedFilterChips,
  EMPTY_PANEL,
  PanelFields,
  filtersOf,
  type PanelFilters,
} from '../reservations/ReservationFilters';

/** Os filtros do relatório: os do painel (sem período e execução) e a Origem. */
export interface ReportFilterState {
  panel: PanelFilters;
  origin: OriginFilter;
}

export const EMPTY_REPORT_FILTERS: ReportFilterState = { panel: EMPTY_PANEL, origin: 'all' };

/** As situações do painel no relatório: sem as três que ficam fora dele (FR-008a). */
export const REPORT_SITUATION_OPTIONS = SITUATION_ORDER.filter(
  (situation) => !REPORT_EXCLUDED_SITUATIONS.includes(situation),
);

/** Os filtros da rota do resumo (contrato 1.11.0), sem o período. */
export function reportFilterInput(
  filters: ReportFilterState,
): Omit<ReportOverviewInput, 'checkInFrom' | 'checkInTo'> {
  const all = filtersOf(
    { ...filters.panel, checkInFrom: null, checkInTo: null, executionId: null },
    filters.origin,
  );
  return {
    ...(all.hotelCode && { hotelCode: all.hotelCode }),
    ...(all.detailedSituation && { detailedSituation: all.detailedSituation }),
    ...(all.reservationStatus && { reservationStatus: all.reservationStatus }),
    ...(all.channel && { channel: all.channel }),
    ...(all.fromLegacy !== undefined && { fromLegacy: all.fromLegacy }),
    ...(all.notFound && { notFound: all.notFound }),
  };
}

/** Há algum filtro em vigor? */
export function hasReportFilters(filters: ReportFilterState): boolean {
  return Object.keys(reportFilterInput(filters)).length > 0;
}

/** O botão "Filtros" (primário com o painel aberto, como na área Reservas). */
export function ReportFiltersButton({
  panelId,
  opened,
  onOpenedChange,
  disabled,
}: {
  panelId: string;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Action
      variant={opened ? 'primary' : 'secondary'}
      aria-expanded={opened}
      aria-controls={panelId}
      disabled={disabled}
      onClick={() => onOpenedChange(!opened)}
    >
      Filtros
    </Action>
  );
}

export function ReportFilterPanel({
  panelId,
  opened,
  onClose,
  filters,
  onChange,
  hotels,
  channels,
}: {
  panelId: string;
  opened: boolean;
  onClose: () => void;
  filters: ReportFilterState;
  onChange: (filters: ReportFilterState) => void;
  hotels: readonly Hotel[];
  channels: readonly string[];
}) {
  return (
    <FilterPanel id={panelId} opened={opened} onClose={onClose}>
      <PanelFields
        panel={filters.panel}
        onPanel={(panel) => onChange({ ...filters, panel })}
        hotels={hotels}
        channels={channels}
        withPeriod={false}
        situations={REPORT_SITUATION_OPTIONS}
        origin={{ value: filters.origin, onChange: (origin) => onChange({ ...filters, origin }) }}
      />
    </FilterPanel>
  );
}

/** A linha "Filtros aplicados" do relatório; sem filtro, nada. */
export function ReportAppliedFilters({
  filters,
  onChange,
  hotels,
}: {
  filters: ReportFilterState;
  onChange: (filters: ReportFilterState) => void;
  hotels: readonly Hotel[];
}) {
  return (
    <AppliedFilterChips
      panel={filters.panel}
      hotels={hotels}
      onPanel={(panel) => onChange({ ...filters, panel })}
      onClearAll={() => onChange(EMPTY_REPORT_FILTERS)}
      origin={{ value: filters.origin, onChange: (origin) => onChange({ ...filters, origin }) }}
      clearLabel="Limpar filtros"
    />
  );
}
