/**
 * Tela Reservas (specs/002, US3, FR-020 a FR-023, FR-005; specs/003, US3 e US4): consulta das
 * reservas gravadas com filtros combinados, busca livre e busca por valor, feitas pelo servidor;
 * "carregar mais" mantém os filtros; o detalhe abre num painel lateral. Nada é gravado: o que
 * está na tela fica só em memória (FR-008a).
 *
 * Tratativas (specs/003): cada linha mostra "Enviada" ou "Cobrada"; o perfil operador marca
 * reservas para aplicar o mesmo documento a várias. A seleção fica fora desta tela
 * (`state/selection`): pesquisar de novo, trocar filtros ou carregar mais não desmarca nada.
 */
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  Reservation,
  ReservationListInput,
  TreatmentDocumentKind,
} from '../../../../shared/ipc-types';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { StatusBadge } from '../../components/StatusBadge';
import { TreatmentBadge } from '../../components/TreatmentBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatMoney, parseAmountInput, sumMoney } from '../../presentation/format';
import { CLASSIFICATION_LABELS, RESERVATION_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { SELECTION_LIMIT, useSelection } from '../../state/selection';
import { AttachDialog } from './AttachDialog';
import { GuestName, ReservationDetail } from './ReservationDetail';
import { EMPTY_FILTERS, ReservationFilters, type FilterDraft } from './ReservationFilters';
import { SelectionDrawer } from './SelectionDrawer';

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
    ...(draft.treatmentStatuses.length > 0 && {
      treatmentStatus: draft.treatmentStatuses as Applied['treatmentStatus'],
    }),
    // "Falta cobrar": a regra é do servidor; a tela só pede (specs/003, FR-002).
    ...(draft.pendingCharge && { pendingCharge: true }),
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
  const { state, isOperator } = useConnection();
  const selection = useSelection();
  const initial: FilterDraft = { ...EMPTY_FILTERS, executionId: initialExecutionId };
  const [draft, setDraft] = useState<FilterDraft>(initial);
  const [applied, setApplied] = useState<Applied>(() => toQuery(initial, undefined, undefined));
  const [errors, setErrors] = useState<{ q?: string; amount?: string; period?: string }>({});
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  /** Lote em andamento: o tipo do documento e as reservas marcadas quando o diálogo abriu. */
  const [batch, setBatch] = useState<{
    kind: TreatmentDocumentKind;
    reservations: Array<{ hotelCode: string; reservationNumber: string }>;
  } | null>(null);

  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => unwrap(hunit.reservations.channels()),
  });
  const hotelNames = useMemo(
    () => new Map((hotels.data ?? []).map((hotel) => [hotel.code, hotel.name])),
    [hotels.data],
  );

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
  const offline = state?.status === 'offline';

  function applyDraft(next: FilterDraft) {
    const found: typeof errors = {};
    const text = next.q.trim();
    if (text.length === 1) found.q = 'Digite ao menos 2 caracteres na busca.';
    let amount: string | undefined;
    if (next.amount.trim() !== '') {
      amount = parseAmountInput(next.amount) ?? undefined;
      if (amount === undefined) found.amount = 'Valor inválido. Use, por exemplo, 1.234,56.';
    }
    // O seletor de intervalo já ordena as datas; falta só o caso de escolher apenas o início.
    if (Boolean(next.checkInFrom) !== Boolean(next.checkInTo)) {
      found.period = 'Escolha também o fim do período (ou limpe o período).';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setApplied(toQuery(next, text.length >= 2 ? text : undefined, amount));
  }

  function addToSelection(reservations: Reservation[]) {
    const { skipped } = selection.add(reservations);
    setLimitReached(skipped > 0);
  }

  function toggle(reservation: Reservation, checked: boolean) {
    if (checked) addToSelection([reservation]);
    else {
      selection.remove([reservation]);
      setLimitReached(false);
    }
  }

  const selectedOnPage = items.filter((reservation) => selection.has(reservation));
  const allOnPageSelected = items.length > 0 && selectedOnPage.length === items.length;
  const selectedCount = selection.items.length;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Reservas</Title>
        <StaleDataNotice updatedAt={list.dataUpdatedAt} offline={offline} />
      </Group>
      <ReservationFilters
        disabled={offline}
        draft={draft}
        onChange={setDraft}
        onSearch={() => applyDraft(draft)}
        onQuickFilter={(next) => {
          setDraft(next);
          applyDraft(next);
        }}
        onClear={() => {
          setDraft(EMPTY_FILTERS);
          setErrors({});
          setApplied({});
        }}
        hotels={hotels.data ?? []}
        channels={channels.data ?? []}
        errors={errors}
      />

      {isOperator && selectedCount > 0 && (
        <Paper withBorder p="sm" radius="md" data-testid="selection-bar">
          <Group justify="space-between">
            <Text size="sm">
              <b>{selectedCount}</b>{' '}
              {selectedCount === 1 ? 'reserva selecionada' : 'reservas selecionadas'} — total de{' '}
              <b>{formatMoney(sumMoney(selection.items.map((item) => item.totalAmount)))}</b>
            </Text>
            <Group gap="xs">
              <Button variant="default" size="xs" onClick={() => setSelectionOpen(true)}>
                Ver seleção
              </Button>
              <Button
                variant="default"
                size="xs"
                disabled={offline}
                onClick={() => setBatch({ kind: 'request', reservations: selection.items })}
              >
                Anexar tratativa
              </Button>
              <Button
                size="xs"
                disabled={offline}
                onClick={() => setBatch({ kind: 'proof', reservations: selection.items })}
              >
                Anexar comprovante
              </Button>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  selection.clear();
                  setLimitReached(false);
                }}
              >
                Desmarcar todas
              </Button>
            </Group>
          </Group>
        </Paper>
      )}
      {limitReached && (
        <Alert color="yellow" role="alert" withCloseButton onClose={() => setLimitReached(false)}>
          Selecione no máximo {SELECTION_LIMIT.toLocaleString('pt-BR')} reservas. As que passaram do
          limite não foram marcadas.
        </Alert>
      )}

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
              {isOperator && (
                <Table.Th w={36}>
                  <Checkbox
                    aria-label="Selecionar todas as reservas listadas"
                    checked={allOnPageSelected}
                    indeterminate={selectedOnPage.length > 0 && !allOnPageSelected}
                    onChange={(event) => {
                      if (event.currentTarget.checked) addToSelection(items);
                      else {
                        selection.remove(items);
                        setLimitReached(false);
                      }
                    }}
                  />
                </Table.Th>
              )}
              <Table.Th>Hotel</Table.Th>
              <Table.Th>Número</Table.Th>
              <Table.Th>Hóspede</Table.Th>
              <Table.Th>Canal</Table.Th>
              <Table.Th>Check-in</Table.Th>
              <Table.Th>Check-out</Table.Th>
              <Table.Th>Valor total</Table.Th>
              <Table.Th>Situação de cobrança</Table.Th>
              <Table.Th>Tratativa</Table.Th>
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
                {isOperator && (
                  <Table.Td onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      aria-label={`Selecionar a reserva ${reservation.reservationNumber}`}
                      checked={selection.has(reservation)}
                      onChange={(event) => toggle(reservation, event.currentTarget.checked)}
                    />
                  </Table.Td>
                )}
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
                  <TreatmentBadge status={reservation.treatment.status} />
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
            disabled={offline}
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
        {selected && <ReservationDetailLoader initial={selected} />}
      </Drawer>

      <SelectionDrawer
        opened={selectionOpen}
        onClose={() => setSelectionOpen(false)}
        hotelNames={hotelNames}
      />

      {batch && (
        <AttachDialog
          kind={batch.kind}
          reservations={batch.reservations}
          onClose={(result) => {
            setBatch(null);
            // Depois do lote, só as que falharam continuam marcadas, para repetir (FR-006a).
            if (result) selection.keepOnly(result.failedKeys);
          }}
        />
      )}
    </Stack>
  );
}

/** O detalhe busca a reserva atualizada no servidor; enquanto isso, mostra a linha da lista. */
function ReservationDetailLoader({ initial }: { initial: Reservation }) {
  const hunit = useHunit();
  const key = { hotelCode: initial.hotelCode, reservationNumber: initial.reservationNumber };
  const detail = useQuery({
    queryKey: ['reservation', key.hotelCode, key.reservationNumber],
    queryFn: () => unwrap(hunit.reservations.get(key)),
    initialData: initial,
  });
  return <ReservationDetail reservation={detail.data} />;
}
