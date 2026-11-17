/**
 * "Copiar para e-mail" (specs/005, US5, FR-027, FR-028): copia o resultado da pesquisa (todas as
 * páginas, até 2 000) ou, à escolha do operador, as reservas selecionadas, numa tabela com as
 * colunas e os nomes da planilha do Comercial, a linha de total e, acima, os filtros e o momento dos
 * dados. A tabela é montada no processo principal e vai para a área de transferência formatada e
 * como texto; nunca leva o nome do hóspede, e nada é gravado em disco.
 */
import { Alert, Button, Group, Modal, Radio, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import type { CopyResult, CopyRow, Hotel, ReservationFilters } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatMoney } from '../../presentation/format';
import {
  DETAILED_SITUATION_LABELS,
  ORIGIN_OPTIONS,
  RESERVATION_STATUS_LABELS,
} from '../../presentation/labels';
import type { SelectedReservation } from '../../state/selection';

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
    <Modal
      opened
      onClose={onClose}
      title={<Title order={3}>Copiar para e-mail</Title>}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        {copied ? (
          <Alert color="green" role="status" data-testid="copy-result">
            {copied.copied} {copied.copied === 1 ? 'reserva copiada' : 'reservas copiadas'}. Cole no
            corpo do e-mail (Ctrl+V): a tabela vai formatada.
            {copied.truncated &&
              ` A pesquisa tem ${copied.total.toLocaleString('pt-BR')} reservas; foram copiadas as ${copied.copied.toLocaleString('pt-BR')} primeiras.`}
          </Alert>
        ) : (
          <>
            <Text size="sm">
              Copia uma tabela com hotel, reserva, check-in, canal, valor a cobrar, motivo, ativa ou
              cancelada e situação, como na planilha do Comercial, com o total. O nome do hóspede
              não vai na cópia.
            </Text>
            {selected.length > 0 && (
              <Radio.Group
                label="O que copiar"
                value={source}
                onChange={(value) => setSource(value)}
              >
                <Stack gap={6} mt={6}>
                  <Radio
                    value="selection"
                    label={`As reservas selecionadas (${selected.length})`}
                  />
                  <Radio value="filter" label="O resultado da pesquisa (todas as páginas)" />
                </Stack>
              </Radio.Group>
            )}
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
          </>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {copied ? 'Fechar' : 'Cancelar'}
          </Button>
          {!copied && (
            <Button onClick={() => void copy()} loading={busy}>
              Copiar
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
