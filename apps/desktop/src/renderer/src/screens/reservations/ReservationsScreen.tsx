/**
 * Tela Reservas (specs/002, US3, FR-020 a FR-023, FR-005; specs/003, US3 e US4): consulta das
 * reservas gravadas com filtros combinados, busca livre e busca por valor, feitas pelo servidor;
 * "carregar mais" mantém os filtros; o detalhe abre num painel lateral. Nada é gravado: o que
 * está na tela fica só em memória (FR-008a).
 *
 * Tratativas (specs/003): cada linha mostra a situação da reserva numa coluna só — "Tratativa
 * enviada", "Comprovante enviado" ou o status do Hunit, com o alerta "Verificar" quando houver
 * (FR-002, FR-002a, FR-017); o perfil operador marca
 * reservas para aplicar o mesmo documento a várias. A seleção fica fora desta tela
 * (`state/selection`): pesquisar de novo, trocar filtros ou carregar mais não desmarca nada.
 *
 * Envio ao Comercial (specs/005): "Enviar ao Comercial", "Confirmar retornos" e "Confirmar
 * 'Verificar'" na barra da seleção; "Selecionar todas do filtro" (até 2 000, FR-030); a coluna
 * "Valor cobrado" com a origem (FR-024); e "Copiar para e-mail" (FR-027), também para o perfil
 * consulta.
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
  ReservationKey,
  ReservationListInput,
  TreatmentDocumentKind,
} from '../../../../shared/ipc-types';
import { ChargedAmount } from '../../components/ChargedAmount';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { LegacyBadge } from '../../components/LegacyBadge';
import { StatusBadge } from '../../components/StatusBadge';
import { SituationBadge } from '../../components/SituationBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatMoney, parseAmountInput, sumMoney } from '../../presentation/format';
import { RESERVATION_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { SELECTION_LIMIT, useSelection } from '../../state/selection';
import { DispatchDialog } from '../dispatch/DispatchDialog';
import { AttachDialog } from './AttachDialog';
import { ConfirmBatchDialog, type BatchKind } from './ConfirmBatchDialog';
import { CopyDialog } from './CopyDialog';
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
    // A situação com o detalhe do Comercial ("Validar comprovante", specs/005, FR-023).
    ...(draft.situations.length > 0 && {
      detailedSituation: draft.situations as Applied['detailedSituation'],
    }),
    ...(draft.reservationStatuses.length > 0 && {
      reservationStatus: draft.reservationStatuses as Applied['reservationStatus'],
    }),
    // "Falta cobrar" e "A verificar": a regra é do servidor; a tela só pede (specs/003).
    ...(draft.pendingCharge && { pendingCharge: true }),
    ...(draft.needsReview && { needsReview: true }),
    ...(draft.channel && { channel: draft.channel }),
    ...(draft.origin !== 'all' && { fromLegacy: draft.origin === 'legacy' }),
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
  /** Envio ao Comercial em andamento: as reservas marcadas quando o diálogo abriu (specs/005). */
  const [dispatching, setDispatching] = useState<ReservationKey[] | null>(null);
  const [confirming, setConfirming] = useState<BatchKind | null>(null);
  const [copying, setCopying] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllNotice, setSelectAllNotice] = useState<{
    tone: 'blue' | 'yellow' | 'red';
    text: string;
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

  /** "Selecionar todas do filtro" (FR-030): soma à seleção as 2 000 primeiras, na ordem da lista. */
  async function selectAllFromFilter() {
    setSelectingAll(true);
    setSelectAllNotice(null);
    try {
      const found = await unwrap(hunit.reservations.selectAll(applied));
      const { added, skipped } = selection.add(found.items);
      const parts = [
        `${added.toLocaleString('pt-BR')} ${added === 1 ? 'reserva selecionada' : 'reservas selecionadas'} do filtro`,
      ];
      if (found.truncated) {
        parts.push(
          `o filtro tem ${found.total.toLocaleString('pt-BR')}: só as ${found.items.length.toLocaleString('pt-BR')} primeiras da lista entram (limite de ${SELECTION_LIMIT.toLocaleString('pt-BR')}); ${(found.total - found.items.length).toLocaleString('pt-BR')} ficaram de fora`,
        );
      }
      if (skipped > 0) {
        parts.push(
          `${skipped.toLocaleString('pt-BR')} não couberam na seleção, que já tinha outras reservas`,
        );
      }
      setSelectAllNotice({
        tone: found.truncated || skipped > 0 ? 'yellow' : 'blue',
        text: `${parts.join('; ')}.`,
      });
    } catch (caught) {
      setSelectAllNotice({ tone: 'red', text: messageOf(caught) });
    } finally {
      setSelectingAll(false);
    }
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
        <Group gap="sm">
          <StaleDataNotice updatedAt={list.dataUpdatedAt} offline={offline} />
          <Button
            variant="default"
            size="xs"
            disabled={items.length === 0 || offline}
            onClick={() => setCopying(true)}
          >
            Copiar para e-mail
          </Button>
        </Group>
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
                size="xs"
                color="teal"
                disabled={offline}
                onClick={() =>
                  setDispatching(
                    selection.items.map(({ hotelCode, reservationNumber }) => ({
                      hotelCode,
                      reservationNumber,
                    })),
                  )
                }
              >
                Enviar ao Comercial
              </Button>
              <Button
                variant="default"
                size="xs"
                disabled={offline}
                onClick={() => setConfirming('returns')}
              >
                Confirmar retornos
              </Button>
              <Button
                variant="default"
                size="xs"
                color="yellow"
                disabled={offline}
                onClick={() => setConfirming('reviews')}
              >
                Confirmar &quot;Verificar&quot;
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

      {selectAllNotice && (
        <Alert
          color={selectAllNotice.tone}
          role={selectAllNotice.tone === 'red' ? 'alert' : 'status'}
          withCloseButton
          onClose={() => setSelectAllNotice(null)}
        >
          {selectAllNotice.text}
        </Alert>
      )}
      {isOperator && items.length > 0 && (
        <Group gap="sm">
          <Button
            variant="light"
            size="xs"
            loading={selectingAll}
            disabled={offline}
            onClick={() => void selectAllFromFilter()}
          >
            Selecionar todas do filtro
          </Button>
          <Text size="xs" c="dimmed">
            Todas as páginas, até {SELECTION_LIMIT.toLocaleString('pt-BR')} reservas, na ordem da
            lista.
          </Text>
        </Group>
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
              <Table.Th>Valor cobrado</Table.Th>
              <Table.Th>Situação da reserva</Table.Th>
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
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    {reservation.reservationNumber}
                    {reservation.legacy && <LegacyBadge />}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <GuestName reservation={reservation} />
                </Table.Td>
                <Table.Td>{reservation.channel ?? '—'}</Table.Td>
                <Table.Td>{formatDate(reservation.checkIn)}</Table.Td>
                <Table.Td>{formatDate(reservation.checkOut)}</Table.Td>
                <Table.Td>{formatMoney(reservation.totalAmount)}</Table.Td>
                <Table.Td>
                  <ChargedAmount treatment={reservation.treatment} />
                </Table.Td>
                <Table.Td>
                  <SituationBadge treatment={reservation.treatment} />
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

      {dispatching && (
        <DispatchDialog
          reservations={dispatching}
          hotelNames={hotelNames}
          onClose={(result) => {
            setDispatching(null);
            // Depois do envio, só as não verificadas continuam marcadas, para tentar de novo.
            if (result) selection.keepOnly(result.notVerified);
          }}
        />
      )}

      {confirming && (
        <ConfirmBatchDialog
          kind={confirming}
          items={selection.items}
          hotelNames={hotelNames}
          onClose={(result) => {
            setConfirming(null);
            if (result) selection.keepOnly(result.failed);
          }}
        />
      )}

      {copying && (
        <CopyDialog
          filters={applied}
          hotels={hotels.data ?? []}
          hotelNames={hotelNames}
          selected={isOperator ? selection.items : []}
          onClose={() => setCopying(false)}
        />
      )}
    </Stack>
  );
}

/** O detalhe busca a reserva atualizada no servidor; enquanto isso, mostra a linha da lista. */
export function ReservationDetailLoader({ initial }: { initial: Reservation }) {
  const hunit = useHunit();
  const key = { hotelCode: initial.hotelCode, reservationNumber: initial.reservationNumber };
  const detail = useQuery({
    queryKey: ['reservation', key.hotelCode, key.reservationNumber],
    queryFn: () => unwrap(hunit.reservations.get(key)),
    initialData: initial,
  });
  return <ReservationDetail reservation={detail.data} />;
}
