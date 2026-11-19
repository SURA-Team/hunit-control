/**
 * "Copiar para e-mail" (specs/005, US5, FR-027, FR-028): copia o resultado da pesquisa (todas as
 * páginas, até 2 000) ou, à escolha do operador, as reservas selecionadas, numa tabela com as
 * colunas e os nomes da planilha do Comercial, a linha de total e, acima, os filtros e o momento dos
 * dados. A tabela é montada no processo principal e vai para a área de transferência formatada e
 * como texto; nunca leva o nome do hóspede, e nada é gravado em disco.
 *
 * Desde a 006 (T053; tela 7.14): diálogo padrão estreito, "O que copiar" em botões de opção,
 * "Cancelar" em texto e "Copiar" como principal; depois de copiar, o resultado em verde e "Fechar".
 */
import { Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { CopyResult, CopyRow, Hotel, ReservationFilters } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatMoney } from '../../presentation/format';
import {
  DETAILED_SITUATION_LABELS,
  ORIGIN_OPTIONS,
  RESERVATION_STATUS_LABELS,
} from '../../presentation/labels';
import { QUICK_FILTER_LABELS } from '../../presentation/reservations';
import type { SelectedReservation } from '../../state/selection';
import { Action, AppDialog, Notice, RadioField } from '../../ui';

/** Os filtros da pesquisa em português, para a linha acima da tabela. */
export function describeFilters(filters: ReservationFilters, hotels: readonly Hotel[]): string {
  const names = new Map(hotels.map((hotel) => [hotel.code, hotel.name]));
  const parts: string[] = [];
  if (filters.hotelCode?.length) {
    parts.push(`Hotéis: ${filters.hotelCode.map((code) => names.get(code) ?? code).join(', ')}`);
  }
  if (filters.checkInFrom && filters.checkInTo) {
    parts.push(`Check-in de ${formatDate(filters.checkInFrom)} a ${formatDate(filters.checkInTo)}`);
  }
  if (filters.detailedSituation?.length) {
    parts.push(
      `Situação: ${filters.detailedSituation.map((value) => DETAILED_SITUATION_LABELS[value].name).join(', ')}`,
    );
  }
  if (filters.reservationStatus?.length) {
    parts.push(
      `Ativa ou cancelada: ${filters.reservationStatus.map((value) => RESERVATION_STATUS_LABELS[value].name).join(', ')}`,
    );
  }
  // Filtro rápido em vigor na lista (specs/006, FR-016).
  if (filters.quickFilter) parts.push(QUICK_FILTER_LABELS[filters.quickFilter]);
  if (filters.pendingCharge) parts.push('Falta cobrar');
  if (filters.needsReview) parts.push('A verificar');
  if (filters.channel) parts.push(`Canal: ${filters.channel}`);
  if (filters.fromLegacy !== undefined) {
    const origin = ORIGIN_OPTIONS.find(
      (option) => option.value === (filters.fromLegacy ? 'legacy' : 'hunit'),
    );
    parts.push(`Origem: ${origin?.label ?? ''}`);
  }
  if (filters.q) parts.push(`Busca: "${filters.q}"`);
  if (filters.amount) parts.push(`Valor: ${formatMoney(filters.amount)}`);
  if (filters.notFound) parts.push('Só as não encontradas');
  if (filters.executionId) parts.push(`Execução ${filters.executionId.slice(0, 8)}`);
  const text = parts.length > 0 ? `Filtros: ${parts.join('; ')}` : 'Todas as reservas';
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

/** Só as colunas da cópia: o nome do hóspede da seleção não vai para o principal. */
function toCopyRow(item: SelectedReservation, hotelNames: ReadonlyMap<string, string>): CopyRow {
  return {
    hotelName: hotelNames.get(item.hotelCode) ?? item.hotelCode,
    reservationNumber: item.reservationNumber,
    checkIn: item.checkIn,
    channel: item.channel,
    totalAmount: item.totalAmount,
    classification: item.classification,
    reservationStatus: item.reservationStatus,
    detailedSituation: item.detailedSituation,
  };
}

export function CopyDialog({
  filters,
  hotels,
  hotelNames,
  selected,
  onClose,
}: {
  filters: ReservationFilters;
  hotels: readonly Hotel[];
  hotelNames: ReadonlyMap<string, string>;
  /** Reservas selecionadas (vazio = só o resultado da pesquisa). */
  selected: SelectedReservation[];
  onClose: () => void;
}) {
  const hunit = useHunit();
  const [source, setSource] = useState<'filter' | 'selection'>(
    selected.length > 0 ? 'selection' : 'filter',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyResult | null>(null);

  async function copy() {
    setBusy(true);
    setError(null);
    try {
      const result = await unwrap(
        source === 'selection'
          ? hunit.clipboard.copyReservations({
              source: 'selection',
              rows: selected.map((item) => toCopyRow(item, hotelNames)),
            })
          : hunit.clipboard.copyReservations({
              source: 'filter',
              filters,
              description: describeFilters(filters, hotels),
            }),
      );
      setCopied(result);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppDialog
      opened
      onClose={onClose}
      title="Copiar para e-mail"
      instant
      {...(copied
        ? {
            actions: (
              <Action variant="primary" size="sm" onClick={onClose}>
                Fechar
              </Action>
            ),
          }
        : {
            onCancel: onClose,
            actions: (
              <Action variant="primary" size="sm" onClick={() => void copy()} loading={busy}>
                Copiar
              </Action>
            ),
          })}
    >
      <Stack gap={16}>
        {copied ? (
          <Notice tone="green" role="status" data-testid="copy-result">
            {copied.copied} {copied.copied === 1 ? 'reserva copiada' : 'reservas copiadas'}. Cole no
            corpo do e-mail (Ctrl+V): a tabela vai formatada.
            {copied.truncated &&
              ` A pesquisa tem ${copied.total.toLocaleString('pt-BR')} reservas; foram copiadas as ${copied.copied.toLocaleString('pt-BR')} primeiras.`}
          </Notice>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              Copia uma tabela com hotel, reserva, check-in, canal, valor a cobrar, motivo, ativa ou
              cancelada e situação, como na planilha do Comercial, com o total. O nome do hóspede
              não vai na cópia.
            </Text>
            {selected.length > 0 && (
              <RadioField
                label="O que copiar"
                value={source}
                onChange={(value) => setSource(value as 'filter' | 'selection')}
                options={[
                  {
                    value: 'selection',
                    label: `As reservas selecionadas (${selected.length})`,
                  },
                  { value: 'filter', label: 'O resultado da pesquisa (todas as páginas)' },
                ]}
              />
            )}
            {error && <Notice tone="red">{error}</Notice>}
          </>
        )}
      </Stack>
    </AppDialog>
  );
}
