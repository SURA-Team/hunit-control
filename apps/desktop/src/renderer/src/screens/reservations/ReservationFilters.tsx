/**
 * Filtros da consulta de reservas (specs/002, FR-020 a FR-020b): busca livre, valor no formato
 * brasileiro, hotel, período de check-in, situações, canal, "não encontrada" e execução. Os filtros
 * só valem ao clicar em "Buscar"; a busca é feita pelo servidor.
 *
 * Tratativas (specs/003, FR-002, FR-002a, FR-015): o filtro único "Situação da reserva" (os
 * mesmos valores da coluna da lista) e os atalhos "Falta cobrar" e "A verificar" — estes valem na
 * hora, e quem decide o que entra em cada um é o servidor.
 *
 * Envio ao Comercial (specs/005, FR-023): a situação inclui "Validar comprovante" (retorno do
 * Comercial aguardando validação).
 */
import {
  Badge,
  Button,
  Checkbox,
  CloseButton,
  Group,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  TextInput,
} from '@mantine/core';
import type { Hotel } from '../../../../shared/ipc-types';
import {
  ORIGIN_OPTIONS,
  DETAILED_SITUATION_LABELS,
  RESERVATION_STATUS_LABELS,
  SITUATION_ORDER,
  type OriginFilter,
} from '../../presentation/labels';
import { PeriodPicker } from '../../ui/PeriodPicker';

export interface FilterDraft {
  q: string;
  amount: string;
  hotelCodes: string[];
  /** Situação da reserva: a mesma da coluna da lista (FR-002, FR-015). */
  situations: string[];
  /** Ativa, cancelada ou não identificada no Hunit. */
  reservationStatuses: string[];
  /** "Falta cobrar": exige cobrança e ainda não tem comprovante. */
  pendingCharge: boolean;
  /** "A verificar": o Hunit mudou a situação depois da tratativa (FR-002a). */
  needsReview: boolean;
  channel: string | null;
  /** Origem (specs/004, FR-011): todas, só do sistema anterior ou só do HUNIT Control. */
  origin: OriginFilter;
  notFound: boolean;
  checkInFrom: string | null;
  checkInTo: string | null;
  executionId: string | null;
}

export const EMPTY_FILTERS: FilterDraft = {
  q: '',
  amount: '',
  hotelCodes: [],
  situations: [],
  reservationStatuses: [],
  pendingCharge: false,
  needsReview: false,
  channel: null,
  origin: 'all',
  notFound: false,
  checkInFrom: null,
  checkInTo: null,
  executionId: null,
};

interface Props {
  draft: FilterDraft;
  onChange: (draft: FilterDraft) => void;
  onSearch: () => void;
  /** Atalho que vale na hora, sem clicar em "Buscar". */
  onQuickFilter: (draft: FilterDraft) => void;
  onClear: () => void;
  /** Servidor indisponível: a busca fica desabilitada (FR-005). */
  disabled: boolean;
  hotels: Hotel[];
  channels: string[];
  errors: { q?: string | null; amount?: string | null; period?: string | null };
}

export function ReservationFilters({
  draft,
  onChange,
  onSearch,
  onQuickFilter,
  onClear,
  disabled,
  hotels,
  channels,
  errors,
}: Props) {
  const set = <K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <Paper withBorder p="md" radius="md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="Busca livre"
              description="Número da reserva, hóspede, transação, código de autorização ou referência da operadora"
              value={draft.q}
              onChange={(event) => set('q', event.currentTarget.value)}
              error={errors.q}
              spellCheck={false}
            />
            <TextInput
              label="Valor (R$)"
              description="Valor total ou valor cobrado, como no extrato (ex.: 1.234,56)"
              value={draft.amount}
              onChange={(event) => set('amount', event.currentTarget.value)}
              error={errors.amount}
              inputMode="decimal"
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <MultiSelect
              label="Hotéis"
              placeholder={draft.hotelCodes.length === 0 ? 'Todos os hotéis' : undefined}
              data={hotels.map((hotel) => ({
                value: hotel.code,
                label: `${hotel.name} (${hotel.code})`,
              }))}
              value={draft.hotelCodes}
              onChange={(value) => set('hotelCodes', value)}
              searchable
              clearable
              hidePickedOptions
            />
            <PeriodPicker
              value={{ from: draft.checkInFrom, to: draft.checkInTo }}
              onChange={({ from, to }) => onChange({ ...draft, checkInFrom: from, checkInTo: to })}
              placeholder="Qualquer data"
              clearable
              error={errors.period}
            />
            <MultiSelect
              label="Situação da reserva"
              placeholder={draft.situations.length === 0 ? 'Todas as situações' : undefined}
              data={SITUATION_ORDER.map((value) => ({
                value,
                label: DETAILED_SITUATION_LABELS[value].name,
              }))}
              value={draft.situations}
              onChange={(value) => set('situations', value)}
              clearable
              hidePickedOptions
            />
            <MultiSelect
              label="Ativa ou cancelada"
              placeholder={
                draft.reservationStatuses.length === 0 ? 'Ativas e canceladas' : undefined
              }
              data={(['active', 'cancelled', 'unknown'] as const).map((value) => ({
                value,
                label: RESERVATION_STATUS_LABELS[value].name,
              }))}
              value={draft.reservationStatuses}
              onChange={(value) => set('reservationStatuses', value)}
              clearable
              hidePickedOptions
            />
            <Select
              label="Canal"
              placeholder="Todos os canais"
              data={channels}
              value={draft.channel}
              onChange={(value) => set('channel', value)}
              clearable
              searchable
            />
            <Select
              label="Origem"
              data={[...ORIGIN_OPTIONS]}
              value={draft.origin}
              onChange={(value) => set('origin', value ?? 'all')}
              allowDeselect={false}
            />
          </SimpleGrid>
          <Group justify="space-between">
            <Group gap="sm">
              <Button
                variant={draft.pendingCharge ? 'filled' : 'light'}
                size="xs"
                aria-pressed={draft.pendingCharge}
                disabled={disabled}
                title="Reservas que exigem cobrança e ainda não têm comprovante"
                onClick={() => onQuickFilter({ ...draft, pendingCharge: !draft.pendingCharge })}
              >
                Falta cobrar
              </Button>
              <Button
                variant={draft.needsReview ? 'filled' : 'light'}
                color="yellow"
                size="xs"
                aria-pressed={draft.needsReview}
                disabled={disabled}
                title="Reservas com tratativa que o Hunit passou a mostrar numa situação que não exige cobrança"
                onClick={() => onQuickFilter({ ...draft, needsReview: !draft.needsReview })}
              >
                A verificar
              </Button>
              <Checkbox
                label="Só as não encontradas na última verificação"
                checked={draft.notFound}
                onChange={(event) => set('notFound', event.currentTarget.checked)}
              />
              {draft.executionId && (
                <Badge
                  variant="light"
                  rightSection={
                    <CloseButton
                      size="xs"
                      aria-label="Tirar o filtro da execução"
                      onClick={() => set('executionId', null)}
                    />
                  }
                >
                  Execução {draft.executionId.slice(0, 8)}
                </Badge>
              )}
            </Group>
            <Group gap="sm">
              <Button variant="default" onClick={onClear}>
                Limpar
              </Button>
              <Button type="submit" disabled={disabled}>
                Buscar
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
