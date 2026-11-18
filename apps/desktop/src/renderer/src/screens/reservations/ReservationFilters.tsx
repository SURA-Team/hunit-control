/**
 * Busca e filtros da lista de reservas (specs/006, T033; telas 4.1 e 4.12, research R-10 e R-11):
 * - a barra: busca única (hóspede, número, transação, autorização ou valor; a tela aplica 400 ms
 *   depois da última tecla), a "Origem" sempre visível e o botão "Filtros";
 * - o painel "Filtros avançados": hotéis, período de check-in, situação da reserva, ativa ou
 *   cancelada, canal e "só as não encontradas na última verificação", valendo na hora;
 * - a linha "Filtros aplicados": um chip removível por filtro do painel em vigor e o da execução, sem
 *   a Origem, que já aparece na barra (FR-034).
 *
 * "Falta cobrar" e "A verificar" saíram daqui: viraram filtros rápidos (research R-09). A busca é
 * feita pelo servidor, e os filtros ficam só em memória (specs/002, FR-008a).
 */
import { useId } from 'react';
import type {
  Hotel,
  ReservationDetailedSituation,
  ReservationFilters,
  ReservationStatus,
} from '../../../../shared/ipc-types';
import { formatDate } from '../../presentation/format';
import {
  DETAILED_SITUATION_LABELS,
  ORIGIN_OPTIONS,
  SITUATION_ORDER,
  type OriginFilter,
} from '../../presentation/labels';
import {
  Action,
  AppliedFilters,
  CheckboxField,
  Field,
  FilterBar,
  FilterBarSearch,
  FilterPanel,
  FilterPanelWide,
  MultiSelectField,
  PeriodPicker,
  RemovableChip,
  SelectField,
} from '../../ui';

/**
 * "Ativa ou cancelada" (tela 4.12), uma escolha só. "Só não identificadas" não está no design: foi
 * decisão do usuário, para não perder o filtro que o app já tinha (research UX-3).
 */
export type StatusFilter = 'all' | ReservationStatus;

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Ativas e canceladas' },
  { value: 'active', label: 'Só ativas' },
  { value: 'cancelled', label: 'Só canceladas' },
  { value: 'unknown', label: 'Só não identificadas' },
];

const STATUS_DESCRIPTIONS: Readonly<Record<StatusFilter, string>> = {
  all: 'Todas as reservas',
  active: 'Esconde as canceladas',
  cancelled: 'Mostra só as canceladas',
  unknown: 'Sem a situação no Hunit',
};

/** Filtros do painel e o da execução (quando a lista veio do detalhe de uma execução). */
export interface PanelFilters {
  hotelCodes: string[];
  checkInFrom: string | null;
  checkInTo: string | null;
  situations: ReservationDetailedSituation[];
  status: StatusFilter;
  channel: string | null;
  notFound: boolean;
  executionId: string | null;
}

export const EMPTY_PANEL: PanelFilters = {
  hotelCodes: [],
  checkInFrom: null,
  checkInTo: null,
  situations: [],
  status: 'all',
  channel: null,
  notFound: false,
  executionId: null,
};

/** O período só vale com o início e o fim; só um deles é um período incompleto. */
export function periodIncomplete(panel: PanelFilters): boolean {
  return Boolean(panel.checkInFrom) !== Boolean(panel.checkInTo);
}

/** Os filtros da API a partir do painel e da Origem (sem a busca e sem o filtro rápido). */
export function filtersOf(panel: PanelFilters, origin: OriginFilter): ReservationFilters {
  const withPeriod = Boolean(panel.checkInFrom && panel.checkInTo);
  return {
    ...(panel.hotelCodes.length > 0 && { hotelCode: panel.hotelCodes }),
    ...(panel.situations.length > 0 && { detailedSituation: panel.situations }),
    ...(panel.status !== 'all' && { reservationStatus: [panel.status] }),
    ...(panel.channel && { channel: panel.channel }),
    ...(origin !== 'all' && { fromLegacy: origin === 'legacy' }),
    ...(panel.notFound && { notFound: true }),
    ...(withPeriod && { checkInFrom: panel.checkInFrom ?? '', checkInTo: panel.checkInTo ?? '' }),
    ...(panel.executionId && { executionId: panel.executionId }),
  };
}

interface AppliedChip {
  key: string;
  label: string;
  /** Nome do filtro para "Tirar o filtro …". */
  name: string;
  remove: (panel: PanelFilters) => PanelFilters;
}

/** Um chip por filtro do painel em vigor, na ordem do painel, e o da execução. */
export function appliedChips(panel: PanelFilters, hotels: readonly Hotel[]): AppliedChip[] {
  const names = new Map(hotels.map((hotel) => [hotel.code, hotel.name]));
  const chips: AppliedChip[] = [];
  if (panel.hotelCodes.length > 0) {
    const first = names.get(panel.hotelCodes[0] ?? '') ?? panel.hotelCodes[0] ?? '';
    chips.push({
      key: 'hotels',
      label:
        panel.hotelCodes.length === 1 ? first : `${first} e mais ${panel.hotelCodes.length - 1}`,
      name: 'de hotéis',
      remove: (current) => ({ ...current, hotelCodes: [] }),
    });
  }
  if (panel.checkInFrom && panel.checkInTo) {
    chips.push({
      key: 'period',
      label: `Check-in de ${formatDate(panel.checkInFrom)} a ${formatDate(panel.checkInTo)}`,
      name: 'de período',
      remove: (current) => ({ ...current, checkInFrom: null, checkInTo: null }),
    });
  }
  if (panel.situations.length > 0) {
    chips.push({
      key: 'situations',
      label:
        panel.situations.length <= 2
          ? panel.situations.map((value) => DETAILED_SITUATION_LABELS[value].name).join(', ')
          : `${panel.situations.length} situações`,
      name: 'de situação',
      remove: (current) => ({ ...current, situations: [] }),
    });
  }
  if (panel.status !== 'all') {
    chips.push({
      key: 'status',
      label: STATUS_OPTIONS.find((option) => option.value === panel.status)?.label ?? '',
      name: 'ativa ou cancelada',
      remove: (current) => ({ ...current, status: 'all' }),
    });
  }
  if (panel.channel) {
    chips.push({
      key: 'channel',
      label: `Canal: ${panel.channel}`,
      name: 'de canal',
      remove: (current) => ({ ...current, channel: null }),
    });
  }
  if (panel.notFound) {
    chips.push({
      key: 'notFound',
      label: 'Não encontradas na última verificação',
      name: 'de não encontradas',
      remove: (current) => ({ ...current, notFound: false }),
    });
  }
  if (panel.executionId) {
    chips.push({
      key: 'execution',
      label: `Execução ${panel.executionId.slice(0, 8)}`,
      name: 'da execução',
      remove: (current) => ({ ...current, executionId: null }),
    });
  }
  return chips;
}

interface BarProps {
  search: string;
  onSearch: (text: string) => void;
  searchError: string | null;
  origin: OriginFilter;
  onOrigin: (origin: OriginFilter) => void;
  panel: PanelFilters;
  onPanel: (panel: PanelFilters) => void;
  panelOpen: boolean;
  onPanelOpen: (open: boolean) => void;
  hotels: readonly Hotel[];
  channels: readonly string[];
}

export function ReservationFilterBar({
  search,
  onSearch,
  searchError,
  origin,
  onOrigin,
  panel,
  onPanel,
  panelOpen,
  onPanelOpen,
  hotels,
  channels,
}: BarProps) {
  const panelId = useId();
  const set = <K extends keyof PanelFilters>(key: K, value: PanelFilters[K]) =>
    onPanel({ ...panel, [key]: value });

  return (
    <FilterBar
      panel={
        <FilterPanel id={panelId} opened={panelOpen} onClose={() => onPanelOpen(false)}>
          <MultiSelectField
            label="Hotéis"
            placeholder={panel.hotelCodes.length === 0 ? 'Todos os hotéis' : undefined}
            data={hotels.map((hotel) => ({
              value: hotel.code,
              label: `${hotel.name} (${hotel.code})`,
            }))}
            value={panel.hotelCodes}
            onChange={(value) => set('hotelCodes', value)}
            searchable
            clearable
            hidePickedOptions
            nothingFoundMessage="Nenhum hotel encontrado"
          />
          <PeriodPicker
            value={{ from: panel.checkInFrom, to: panel.checkInTo }}
            onChange={({ from, to }) => onPanel({ ...panel, checkInFrom: from, checkInTo: to })}
            placeholder="Qualquer data"
            clearable
            error={
              periodIncomplete(panel)
                ? 'Escolha também o fim do período (ou limpe o período).'
                : null
            }
          />
          <MultiSelectField
            label="Situação da reserva"
            placeholder={panel.situations.length === 0 ? 'Todas as situações' : undefined}
            data={SITUATION_ORDER.map((value) => ({
              value,
              label: DETAILED_SITUATION_LABELS[value].name,
            }))}
            value={panel.situations}
            onChange={(value) => set('situations', value as ReservationDetailedSituation[])}
            clearable
            hidePickedOptions
          />
          <SelectField
            label="Ativa ou cancelada"
            data={[...STATUS_OPTIONS]}
            optionDescriptions={STATUS_DESCRIPTIONS}
            value={panel.status}
            onChange={(value) => set('status', (value ?? 'all') as StatusFilter)}
          />
          <SelectField
            label="Canal"
            placeholder="Todos os canais"
            data={[...channels]}
            value={panel.channel}
            onChange={(value) => set('channel', value)}
            allowDeselect
            clearable
            searchable
          />
          <FilterPanelWide>
            <CheckboxField
              label="Só as não encontradas na última verificação"
              checked={panel.notFound}
              onChange={(event) => set('notFound', event.currentTarget.checked)}
            />
          </FilterPanelWide>
        </FilterPanel>
      }
    >
      <FilterBarSearch>
        <Field
          size="md"
          aria-label="Buscar reservas"
          placeholder="Buscar por hóspede, nº da reserva, transação, autorização ou valor"
          value={search}
          onChange={(event) => onSearch(event.currentTarget.value)}
          error={searchError}
          spellCheck={false}
          autoComplete="off"
        />
      </FilterBarSearch>
      <SelectField
        inlineLabel
        size="md"
        label="Origem"
        data={[...ORIGIN_OPTIONS]}
        value={origin}
        onChange={(value) => onOrigin((value ?? 'all') as OriginFilter)}
      />
      <Action
        variant={panelOpen ? 'primary' : 'secondary'}
        aria-expanded={panelOpen}
        aria-controls={panelId}
        onClick={() => onPanelOpen(!panelOpen)}
      >
        Filtros
      </Action>
    </FilterBar>
  );
}

/** A linha "Filtros aplicados" (R-11); sem filtro do painel em vigor, nada. */
export function AppliedFilterChips({
  panel,
  hotels,
  onPanel,
  onClearAll,
}: {
  panel: PanelFilters;
  hotels: readonly Hotel[];
  onPanel: (panel: PanelFilters) => void;
  onClearAll: () => void;
}) {
  const chips = appliedChips(panel, hotels);
  if (chips.length === 0) return null;
  return (
    <AppliedFilters onClearAll={onClearAll}>
      {chips.map((chip) => (
        <RemovableChip
          key={chip.key}
          label={chip.label}
          removeLabel={chip.name}
          onRemove={() => onPanel(chip.remove(panel))}
        />
      ))}
    </AppliedFilters>
  );
}
