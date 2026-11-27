/**
 * Aba "Retornos a validar" da área Comercial (specs/005, US2, FR-016, FR-016a, FR-017): as
 * reservas com retorno do Comercial aguardando a validação do Financeiro ("Validar comprovante"),
 * com o código de autorização, o hotel da cobrança ao lado do hotel da reserva, o valor cobrado, o
 * valor a cobrar e a diferença. O operador confirma uma a uma ou as marcadas (com a lista de
 * revisão) e recusa uma a uma, com o motivo.
 *
 * Desde a 006 (T052; tela 7.8): a lista em card com a faixa de ações no topo (marcar todos, "Confirmar
 * marcados (N)" e "a recusa é uma a uma"), a reserva com o código, o hotel da cobrança (em âmbar e
 * com o selo quando difere do hotel da reserva), "cobrado / a cobrar", a diferença em âmbar, o
 * responsável e quando foi lido, e "Confirmar" (principal da linha) e "Recusar" em vermelho suave. Em
 * conteúdo estreito, o responsável vai para a linha da reserva e a diferença para a dos valores.
 *
 * Desde a homologação da 008 (R-19; spec FR-007c): as "Cancelada" do Comercial ficam no topo, com o
 * selo "Cancelada" em vermelho, a situação como ele escreveu, o valor a cobrar (vira R$ 0,00 ao
 * confirmar), "Confirmar" (o nome acessível é "Confirmar cancelamento"; o texto curto cabe na coluna
 * de ações, como nos retornos) e "Recusar" (com o motivo). Entram em "Confirmar marcados".
 *
 * Desde a 009 (specs/009, US1; FR-006 a FR-009; research R-08): a situação livre do Comercial vem
 * logo depois das "Cancelada", com o selo "Outra situação" em âmbar, a situação como ele escreveu, o
 * responsável e o que mais ele preencheu, e as três decisões ("Cobrada", "Sem cobrança" e "Recusar"),
 * uma reserva por vez: sem caixa de marcar e fora de "Confirmar marcados" (FR-007).
 */
import { Group, Stack, Text } from '@mantine/core';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  CommercialSheetStatus,
  Reservation,
  ReservationKey,
  Result,
} from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatDateTime, formatMoney } from '../../presentation/format';
import {
  CANCELLATION_BADGE,
  describeCharge,
  errorMessage,
  SITUATION_RETURN_BADGE,
} from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import { selectionKey, toSelected } from '../../state/selection';
import {
  Action,
  AppDrawer,
  ListActions,
  ListCard,
  ListCell,
  ListHeader,
  ListRow,
  Notice,
  SelectionBox,
  StatusBadge,
  type ListColumn,
} from '../../ui';
import { AmountDifference, ChargeHotel, RejectDialog } from '../reservations/CommercialSection';
import { ConfirmBatchDialog } from '../reservations/ConfirmBatchDialog';
import { ReservationDetailLoader } from '../reservations/ReservationsScreen';
import { useSheetStatus } from './SheetTab';
import { SituationReturnActions } from './SituationReturnDialogs';

/** "Cancelada" do Comercial aguardando validação (homologação da 008, R-19). */
type Cancellation = CommercialSheetStatus['reports'][number];

const PAGE_SIZE = 50;

/** Colunas da tela 7.8; "Ações" só para o operador. */
const COLUMNS: readonly ListColumn[] = [
  { key: 'reservation', label: 'Reserva' },
  { key: 'chargeHotel', label: 'Hotel da cobrança' },
  { key: 'amounts', label: 'Cobrado / a cobrar' },
  { key: 'difference', label: 'Diferença' },
  { key: 'responsible', label: 'Responsável e cobrança' },
];
const ACTIONS_COLUMN: ListColumn = { key: 'actions', label: '' };

export function ReturnsTab() {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const { isOperator, state } = useConnection();
  const canWrite = isOperator && state?.status !== 'offline';
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [rejecting, setRejecting] = useState<Reservation | null>(null);
  const [rejectingCancellation, setRejectingCancellation] = useState<Cancellation | null>(null);
  const [opened, setOpened] = useState<
    { initial: Reservation } | { reservationKey: ReservationKey } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const hotelNames = useMemo(
    () => new Map((hotels.data ?? []).map((hotel) => [hotel.code, hotel.name])),
    [hotels.data],
  );
  const hotel = (code: string) => hotelNames.get(code) ?? code;

  const list = useInfiniteQuery({
    queryKey: ['reservations', { detailedSituation: ['return_pending'] }],
    queryFn: ({ pageParam }) =>
      unwrap(
        hunit.reservations.list({
          detailedSituation: ['return_pending'],
          limit: PAGE_SIZE,
          ...(pageParam !== null && { cursor: pageParam }),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const all = list.data?.pages.flatMap((page) => page.items) ?? [];
  // A situação livre do Comercial (specs/009) fica numa linha própria, fora da seleção em lote.
  const situations = all.filter(
    (item) => item.commercial?.situationReturn?.state === 'awaiting_validation',
  );
  const items = all.filter(
    (item) => item.commercial?.situationReturn?.state !== 'awaiting_validation',
  );
  const marked = items.filter((item) => checked.has(selectionKey(item)));
  const cancellations = useSheetStatus().data?.reports ?? [];
  const markedCancellations = cancellations.filter((item) => checked.has(selectionKey(item)));
  const markedCount = marked.length + markedCancellations.length;
  const selectableCount = items.length + cancellations.length;
  const rowCount = selectableCount + situations.length;

  function refresh() {
    for (const queryKey of [['reservations'], ['reservation'], ['treatment'], ['commercial']]) {
      void queryClient.invalidateQueries({ queryKey });
    }
    void queryClient.invalidateQueries({ queryKey: ['commercial-sheet'] });
  }

  async function decide(action: () => Promise<Result<unknown>>, success: string) {
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    setMessage(
      result.ok
        ? { tone: 'green', text: success }
        : { tone: 'red', text: errorMessage(result.error) },
    );
    refresh();
  }

  const toggle = (reservation: ReservationKey, value: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      if (value) next.add(selectionKey(reservation));
      else next.delete(selectionKey(reservation));
      return next;
    });

  const columns = canWrite ? [...COLUMNS, ACTIONS_COLUMN] : COLUMNS;
  const allMarked = selectableCount > 0 && markedCount === selectableCount;

  return (
    <Stack gap={16}>
      {message && (
        <Notice tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}
      {list.isError && <Notice tone="red">{messageOf(list.error)}</Notice>}
      {list.isSuccess && rowCount === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum retorno do Comercial aguardando validação.
        </Text>
      )}
      {rowCount > 0 && (
        <ListCard
          label="Retornos a validar"
          toolbar={
            canWrite && (
              <>
                <SelectionBox
                  aria-label="Marcar todos os retornos listados"
                  disabled={selectableCount === 0}
                  checked={allMarked}
                  indeterminate={markedCount > 0 && !allMarked}
                  onChange={(event) =>
                    setChecked(
                      event.currentTarget.checked
                        ? new Set([...cancellations, ...items].map((item) => selectionKey(item)))
                        : new Set(),
                    )
                  }
                />
                <Action
                  variant="secondary"
                  size="xs"
                  disabled={markedCount === 0}
                  onClick={() => setBatchOpen(true)}
                >
                  Confirmar marcados ({markedCount})
                </Action>
                <span>A recusa e as outras situações do Comercial são uma a uma.</span>
              </>
            )
          }
          header={
            <ListHeader columns={columns} withArrow={false} {...(canWrite && { select: '' })} />
          }
        >
          {cancellations.map((cancellation) => {
            const key = {
              hotelCode: cancellation.hotelCode,
              reservationNumber: cancellation.reservationNumber,
            };
            const number = cancellation.reservationNumber;
            return (
              <ListRow
                key={`cancelada/${selectionKey(key)}`}
                columns={columns}
                block={`Cancelada ${number}`}
                selected={checked.has(selectionKey(key))}
                {...(canWrite && {
                  select: (
                    <SelectionBox
                      aria-label={`Marcar a reserva ${number}`}
                      checked={checked.has(selectionKey(key))}
                      onChange={(event) => toggle(key, event.currentTarget.checked)}
                    />
                  ),
                })}
                cells={{
                  reservation: (
                    <ListCell
                      strong
                      primary={number}
                      onOpen={() => setOpened({ reservationKey: key })}
                      openLabel={`Abrir a reserva ${number}`}
                      secondary={`lido em ${formatDateTime(cancellation.readAt)}`}
                      narrow={cancellation.chargedBy ?? 'responsável não informado'}
                    />
                  ),
                  chargeHotel: (
                    <Stack gap={2} align="flex-start">
                      <StatusBadge tone={badgeOf(CANCELLATION_BADGE).tone}>
                        {CANCELLATION_BADGE.name}
                      </StatusBadge>
                      <Text size="sm">{`"${cancellation.situationText}"`}</Text>
                      <Text size="xs" c="dimmed">
                        Hotel da reserva: {hotel(cancellation.hotelCode)}
                      </Text>
                    </Stack>
                  ),
                  amounts: (
                    <ListCell
                      primary={`${formatMoney(cancellation.totalAmount)} a cobrar`}
                      secondary="vira R$ 0,00 ao confirmar"
                    />
                  ),
                  difference: '—',
                  responsible: (
                    <ListCell
                      primary={cancellation.chargedBy ?? '—'}
                      secondary="Cancelada, sem cobrança"
                    />
                  ),
                  actions: (
                    <ListActions>
                      <Action
                        size="xs"
                        variant="primary"
                        disabled={busy}
                        aria-label="Confirmar cancelamento"
                        onClick={() =>
                          void decide(
                            () => hunit.commercial.confirmCancellation(key),
                            `Reserva ${number} marcada como cancelada sem cobrança.`,
                          )
                        }
                      >
                        Confirmar
                      </Action>
                      <Action
                        size="xs"
                        variant="danger-light"
                        disabled={busy}
                        onClick={() => setRejectingCancellation(cancellation)}
                      >
                        Recusar
                      </Action>
                    </ListActions>
                  ),
                }}
              />
            );
          })}
          {situations.map((reservation) => {
            const situation = reservation.commercial?.situationReturn;
            if (!situation) return null;
            const number = reservation.reservationNumber;
            return (
              <ListRow
                key={`situacao/${selectionKey(reservation)}`}
                columns={columns}
                block={`Outra situação ${number}`}
                {...(canWrite && { select: <span aria-hidden="true" /> })}
                cells={{
                  reservation: (
                    <ListCell
                      strong
                      primary={number}
                      onOpen={() => setOpened({ initial: reservation })}
                      openLabel={`Abrir a reserva ${number}`}
                      secondary={
                        situation.authorizationCode ?? `lido em ${formatDateTime(situation.readAt)}`
                      }
                      narrow={situation.chargedBy}
                    />
                  ),
                  chargeHotel: (
                    <Stack gap={2} align="flex-start">
                      <StatusBadge tone={badgeOf(SITUATION_RETURN_BADGE).tone}>
                        {SITUATION_RETURN_BADGE.name}
                      </StatusBadge>
                      <Text size="sm">{`"${situation.situationText}"`}</Text>
                      <Text size="xs" c="dimmed">
                        {situation.chargeHotel
                          ? `Cobrança em ${situation.chargeHotel}`
                          : `Hotel da reserva: ${hotel(reservation.hotelCode)}`}
                      </Text>
                    </Stack>
                  ),
                  amounts: (
                    <ListCell
                      primary={
                        situation.chargedAmount === null
                          ? 'valor não informado'
                          : `${formatMoney(situation.chargedAmount)} cobrado`
                      }
                      secondary={`${formatMoney(reservation.amountToCharge)} a cobrar`}
                    />
                  ),
                  difference: '—',
                  responsible: (
                    <ListCell
                      primary={situation.chargedBy}
                      secondary={
                        situation.chargeDate
                          ? `cobrança em ${formatDate(situation.chargeDate)}`
                          : 'situação informada pelo Comercial'
                      }
                    />
                  ),
                  actions: (
                    <SituationReturnActions
                      reservation={reservation}
                      situation={situation}
                      busy={busy}
                      decide={decide}
                    />
                  ),
                }}
              />
            );
          })}
          {items.map((reservation) => {
            const brief = reservation.commercial?.currentReturn ?? null;
            return (
              <ListRow
                key={selectionKey(reservation)}
                columns={columns}
                block={`Retorno ${reservation.reservationNumber}`}
                selected={checked.has(selectionKey(reservation))}
                {...(canWrite && {
                  select: (
                    <SelectionBox
                      aria-label={`Marcar a reserva ${reservation.reservationNumber}`}
                      checked={checked.has(selectionKey(reservation))}
                      onChange={(event) => toggle(reservation, event.currentTarget.checked)}
                    />
                  ),
                })}
                cells={{
                  reservation: (
                    <ListCell
                      strong
                      primary={reservation.reservationNumber}
                      onOpen={() => setOpened({ initial: reservation })}
                      openLabel={`Abrir a reserva ${reservation.reservationNumber}`}
                      secondary={brief?.authorizationCode ?? '—'}
                      // Conteúdo estreito: a coluna "Responsável e cobrança" vem para esta linha,
                      // com a situação e a data (homologação da 008, cenário 3.15).
                      narrow={
                        brief
                          ? `${brief.chargedBy} · ${describeCharge(brief.chargeSituation, brief.chargeDate)}`
                          : null
                      }
                    />
                  ),
                  chargeHotel: brief ? (
                    <ChargeHotel
                      chargeHotel={brief.chargeHotel}
                      hotelName={hotel(reservation.hotelCode)}
                    />
                  ) : (
                    '—'
                  ),
                  amounts: (
                    <ListCell
                      primary={`${formatMoney(brief?.chargedAmount)} cobrado`}
                      secondary={`${formatMoney(reservation.totalAmount)} a cobrar`}
                      compact={
                        brief && (
                          <>
                            diferença <AmountDifference value={brief.difference} />
                          </>
                        )
                      }
                    />
                  ),
                  difference: <AmountDifference value={brief?.difference ?? null} />,
                  responsible: brief ? (
                    <ListCell
                      primary={brief.chargedBy}
                      secondary={describeCharge(brief.chargeSituation, brief.chargeDate)}
                    />
                  ) : (
                    '—'
                  ),
                  actions: brief && (
                    <ListActions>
                      <Action
                        size="xs"
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          void decide(
                            () => hunit.commercial.confirmReturn(brief.id),
                            `Retorno da reserva ${reservation.reservationNumber} confirmado.`,
                          )
                        }
                      >
                        Confirmar
                      </Action>
                      <Action
                        size="xs"
                        variant="danger-light"
                        disabled={busy}
                        onClick={() => setRejecting(reservation)}
                      >
                        Recusar
                      </Action>
                    </ListActions>
                  ),
                }}
              />
            );
          })}
        </ListCard>
      )}
      {list.hasNextPage && (
        <Group>
          <Action
            variant="secondary"
            onClick={() => void list.fetchNextPage()}
            loading={list.isFetchingNextPage}
          >
            Carregar mais
          </Action>
        </Group>
      )}

      {batchOpen && (
        <ConfirmBatchDialog
          kind="returns"
          items={marked.map(toSelected)}
          cancellationKeys={markedCancellations.map((item) => ({
            hotelCode: item.hotelCode,
            reservationNumber: item.reservationNumber,
          }))}
          hotelNames={hotelNames}
          onClose={() => {
            setBatchOpen(false);
            setChecked(new Set());
          }}
        />
      )}
      {rejectingCancellation && (
        <RejectDialog
          title='Recusar a "Cancelada" do Comercial'
          confirmLabel="Recusar"
          suggestions={[]}
          onCancel={() => setRejectingCancellation(null)}
          onReject={(reason) => {
            const key = {
              hotelCode: rejectingCancellation.hotelCode,
              reservationNumber: rejectingCancellation.reservationNumber,
            };
            setRejectingCancellation(null);
            void decide(
              () => hunit.commercial.rejectCancellation({ key, reason }),
              `"Cancelada" da reserva ${key.reservationNumber} recusada: o motivo aparece para o Comercial na planilha.`,
            );
          }}
        />
      )}
      {rejecting?.commercial?.currentReturn && (
        <RejectDialog
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const returnId = rejecting.commercial?.currentReturn?.id ?? '';
            const number = rejecting.reservationNumber;
            setRejecting(null);
            void decide(
              () => hunit.commercial.rejectReturn({ returnId, reason }),
              `Retorno da reserva ${number} recusado: o motivo aparece para o Comercial na planilha.`,
            );
          }}
        />
      )}
      <AppDrawer
        opened={opened !== null}
        onClose={() => setOpened(null)}
        title="Detalhe da reserva"
        closeLabel="Fechar detalhe"
      >
        {opened && <ReservationDetailLoader {...opened} />}
      </AppDrawer>
    </Stack>
  );
}
