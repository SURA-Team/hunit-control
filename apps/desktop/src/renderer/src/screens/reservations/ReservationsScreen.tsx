/**
 * Tela Reservas (specs/002, US3, FR-020 a FR-023, FR-005): consulta das reservas gravadas com
 * filtros combinados, busca livre e busca por valor, feitas pelo servidor; "carregar mais" mantém
 * os filtros; o detalhe abre num painel lateral. Nada é gravado: o que está na tela fica só em
 * memória (FR-008a).
 */
import { Alert, Button, Drawer, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Reservation, ReservationListInput } from '../../../../shared/ipc-types';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { StatusBadge } from '../../components/StatusBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatMoney, parseAmountInput } from '../../presentation/format';
import { CLASSIFICATION_LABELS, RESERVATION_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { GuestName, ReservationDetail } from './ReservationDetail';
import { EMPTY_FILTERS, ReservationFilters, type FilterDraft } from './ReservationFilters';

const PAGE_SIZE = 50;

type Applied = Omit<ReservationListInput, 'cursor' | 'limit'>;

/** Filtros da tela no formato da API; campos vazios ficam de fora. */
function toQuery(draft: FilterDraft, q: string | undefined, amount: string | undefined): Applied {
  return {
    ...(q !== undefined && { q }),
    ...(amount !== undefined && { amount }),
    ...(draft.hotelCodes.length > 0 && { hotelCode: draft.hotelCodes }),
    ...(draft.classifications.length > 0 && {
      classification: draft.classifications as Applied['classification'],
    }),
    ...(draft.reservationStatuses.length > 0 && {
      reservationStatus: draft.reservationStatuses as Applied['reservationStatus'],
    }),
    ...(draft.channel && { channel: draft.channel }),
    ...(draft.notFound && { notFound: true }),
    ...(draft.checkInFrom && { checkInFrom: draft.checkInFrom }),
    ...(draft.checkInTo && { checkInTo: draft.checkInTo }),
    ...(draft.executionId && { executionId: draft.executionId }),
  };
}

export function ReservationsScreen({
  initialExecutionId = null,
}: {
  initialExecutionId?: string | null;
}) {
  const hunit = useHunit();
  const { state } = useConnection();
  const initial: FilterDraft = { ...EMPTY_FILTERS, executionId: initialExecutionId };
  const [draft, setDraft] = useState<FilterDraft>(initial);
  const [applied, setApplied] = useState<Applied>(() => toQuery(initial, undefined, undefined));
  const [errors, setErrors] = useState<{ q?: string; amount?: string; period?: string }>({});
  const [selected, setSelected] = useState<Reservation | null>(null);

  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => unwrap(hunit.reservations.channels()),
  });
  const hotelNames = new Map((hotels.data ?? []).map((hotel) => [hotel.code, hotel.name]));

  const list = useInfiniteQuery({
    queryKey: ['reservations', applied],
    queryFn: ({ pageParam }) =>
      unwrap(
        hunit.reservations.list({
          ...applied,
          limit: PAGE_SIZE,
          ...(pageParam !== null && { cursor: pageParam }),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  function search() {
    const next: typeof errors = {};
    const text = draft.q.trim();
    if (text.length === 1) next.q = 'Digite ao menos 2 caracteres na busca.';
    let amount: string | undefined;
    if (draft.amount.trim() !== '') {
      amount = parseAmountInput(draft.amount) ?? undefined;
      if (amount === undefined) next.amount = 'Valor inválido. Use, por exemplo, 1.234,56.';
    }
    if (draft.checkInFrom && draft.checkInTo && draft.checkInTo < draft.checkInFrom) {
      next.period = 'A data final não pode ser antes do início.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setApplied(toQuery(draft, text.length >= 2 ? text : undefined, amount));
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Reservas</Title>
        <StaleDataNotice updatedAt={list.dataUpdatedAt} offline={state?.status === 'offline'} />
      </Group>
      <ReservationFilters
        draft={draft}
        onChange={setDraft}
        onSearch={search}
        onClear={() => {
          setDraft(EMPTY_FILTERS);
          setErrors({});
          setApplied({});
        }}
        hotels={hotels.data ?? []}
        channels={channels.data ?? []}
        errors={errors}
      />

      {list.isError && items.length === 0 && (
        <Alert color="red" role="alert">
          {messageOf(list.error)}
        </Alert>
      )}
      {list.isSuccess && items.length === 0 && (
        <Text c="dimmed">Nenhuma reserva encontrada com estes filtros.</Text>
      )}
      {items.length > 0 && (
        <Table highlightOnHover striped verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Hotel</Table.Th>
              <Table.Th>Número</Table.Th>
              <Table.Th>Hóspede</Table.Th>
              <Table.Th>Canal</Table.Th>
              <Table.Th>Check-in</Table.Th>
              <Table.Th>Check-out</Table.Th>
              <Table.Th>Valor total</Table.Th>
              <Table.Th>Situação de cobrança</Table.Th>
              <Table.Th>Reserva</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((reservation) => (
              <Table.Tr
                key={`${reservation.hotelCode}/${reservation.reservationNumber}`}
                onClick={() => setSelected(reservation)}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td>
                  {hotelNames.get(reservation.hotelCode) ?? reservation.hotelCode}
                </Table.Td>
                <Table.Td>{reservation.reservationNumber}</Table.Td>
                <Table.Td>
                  <GuestName reservation={reservation} />
                </Table.Td>
                <Table.Td>{reservation.channel ?? '—'}</Table.Td>
                <Table.Td>{formatDate(reservation.checkIn)}</Table.Td>
                <Table.Td>{formatDate(reservation.checkOut)}</Table.Td>
                <Table.Td>{formatMoney(reservation.totalAmount)}</Table.Td>
                <Table.Td>
                  <StatusBadge label={CLASSIFICATION_LABELS[reservation.classification]} />
                </Table.Td>
                <Table.Td>
                  <StatusBadge label={RESERVATION_STATUS_LABELS[reservation.reservationStatus]} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {list.hasNextPage && (
        <Group>
          <Button
            variant="default"
            onClick={() => void list.fetchNextPage()}
            loading={list.isFetchingNextPage}
          >
            Carregar mais
          </Button>
        </Group>
      )}

      <Drawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        position="right"
        size="xl"
        title={<Title order={3}>Detalhe da reserva</Title>}
        closeButtonProps={{ 'aria-label': 'Fechar detalhe' }}
        transitionProps={{ duration: 0 }}
      >
        {selected && <ReservationDetail reservation={selected} />}
      </Drawer>
    </Stack>
  );
}
