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
 */
import { Group, Stack, Text } from '@mantine/core';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Reservation, ReservationTreatment, Result } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime, formatMoney } from '../../presentation/format';
import { errorMessage } from '../../presentation/labels';
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
  type ListColumn,
} from '../../ui';
import { AmountDifference, ChargeHotel, RejectDialog } from '../reservations/CommercialSection';
import { ConfirmBatchDialog } from '../reservations/ConfirmBatchDialog';
import { ReservationDetailLoader } from '../reservations/ReservationsScreen';

const PAGE_SIZE = 50;

/** Colunas da tela 7.8; "Ações" só para o operador. */
const COLUMNS: readonly ListColumn[] = [
  { key: 'reservation', label: 'Reserva' },
  { key: 'chargeHotel', label: 'Hotel da cobrança' },
  { key: 'amounts', label: 'Cobrado / a cobrar' },
  { key: 'difference', label: 'Diferença' },
  { key: 'responsible', label: 'Responsável' },
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
  const [opened, setOpened] = useState<Reservation | null>(null);
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
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const marked = items.filter((item) => checked.has(selectionKey(item)));

  function refresh() {
    for (const queryKey of [['reservations'], ['reservation'], ['treatment'], ['commercial']]) {
      void queryClient.invalidateQueries({ queryKey });
    }
    void queryClient.invalidateQueries({ queryKey: ['commercial-sheet'] });
  }

  async function decide(action: () => Promise<Result<ReservationTreatment>>, success: string) {
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

  const toggle = (reservation: Reservation, value: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      if (value) next.add(selectionKey(reservation));
      else next.delete(selectionKey(reservation));
      return next;
    });

  const columns = canWrite ? [...COLUMNS, ACTIONS_COLUMN] : COLUMNS;
  const allMarked = items.length > 0 && marked.length === items.length;

  return (
    <Stack gap={16}>
      {message && (
        <Notice tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}
      {list.isError && <Notice tone="red">{messageOf(list.error)}</Notice>}
      {list.isSuccess && items.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum retorno do Comercial aguardando validação.
        </Text>
      )}
      {items.length > 0 && (
        <ListCard
          label="Retornos a validar"
          toolbar={
            canWrite && (
              <>
                <SelectionBox
                  aria-label="Marcar todos os retornos listados"
                  checked={allMarked}
                  indeterminate={marked.length > 0 && !allMarked}
                  onChange={(event) =>
                    setChecked(
                      event.currentTarget.checked
                        ? new Set(items.map((item) => selectionKey(item)))
                        : new Set(),
                    )
                  }
                />
                <Action
                  variant="secondary"
                  size="xs"
                  disabled={marked.length === 0}
                  onClick={() => setBatchOpen(true)}
                >
                  Confirmar marcados ({marked.length})
                </Action>
                <span>A recusa é uma a uma, com o motivo.</span>
              </>
            )
          }
          header={
            <ListHeader columns={columns} withArrow={false} {...(canWrite && { select: '' })} />
          }
        >
          {items.map((reservation) => {
            const brief = reservation.commercial?.currentReturn ?? null;
            const read = brief ? `lido em ${formatDateTime(brief.readAt)}` : null;
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
                      onOpen={() => setOpened(reservation)}
                      openLabel={`Abrir a reserva ${reservation.reservationNumber}`}
                      secondary={brief?.authorizationCode ?? '—'}
                      narrow={brief ? `${brief.chargedBy} · ${read}` : null}
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
                    <ListCell primary={brief.chargedBy} secondary={read} />
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
          hotelNames={hotelNames}
          onClose={() => {
            setBatchOpen(false);
            setChecked(new Set());
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
        {opened && <ReservationDetailLoader initial={opened} />}
      </AppDrawer>
    </Stack>
  );
}
