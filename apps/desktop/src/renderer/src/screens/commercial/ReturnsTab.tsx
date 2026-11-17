/**
 * Aba "Retornos a validar" da área Comercial (specs/005, US2, FR-016, FR-016a, FR-017): as
 * reservas com retorno do Comercial aguardando a validação do Financeiro ("Validar comprovante"),
 * com o código de autorização, o hotel da cobrança ao lado do hotel da reserva, o valor cobrado, o
 * valor a cobrar e a diferença. O operador confirma uma a uma ou as marcadas (com a lista de
 * revisão) e recusa uma a uma, com o motivo.
 */
import { Alert, Button, Checkbox, Drawer, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Reservation, ReservationTreatment, Result } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime, formatMoney } from '../../presentation/format';
import { errorMessage } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { selectionKey, toSelected } from '../../state/selection';
import { ChargeHotel, RejectDialog } from '../reservations/CommercialSection';
import { ConfirmBatchDialog } from '../reservations/ConfirmBatchDialog';
import { ReservationDetailLoader } from '../reservations/ReservationsScreen';

const PAGE_SIZE = 50;

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

  return (
    <Stack gap="md">
      {message && (
        <Alert color={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
          {message.text}
        </Alert>
      )}
      {list.isError && (
        <Alert color="red" role="alert">
          {messageOf(list.error)}
        </Alert>
      )}
      {list.isSuccess && items.length === 0 && (
        <Text c="dimmed">Nenhum retorno do Comercial aguardando validação.</Text>
      )}
      {canWrite && items.length > 0 && (
        <Group gap="sm">
          <Button size="xs" disabled={marked.length === 0} onClick={() => setBatchOpen(true)}>
            Confirmar marcados ({marked.length})
          </Button>
          <Text size="xs" c="dimmed">
            A recusa é uma a uma, com o motivo.
          </Text>
        </Group>
      )}
      {items.length > 0 && (
        <Table striped highlightOnHover verticalSpacing={6} aria-label="Retornos a validar">
          <Table.Thead>
            <Table.Tr>
              {canWrite && (
                <Table.Th w={36}>
                  <Checkbox
                    aria-label="Marcar todos os retornos listados"
                    checked={marked.length === items.length}
                    indeterminate={marked.length > 0 && marked.length < items.length}
                    onChange={(event) =>
                      setChecked(
                        event.currentTarget.checked
                          ? new Set(items.map((item) => selectionKey(item)))
                          : new Set(),
                      )
                    }
                  />
                </Table.Th>
              )}
              <Table.Th>Reserva</Table.Th>
              <Table.Th>Código de autorização</Table.Th>
              <Table.Th>Hotel da cobrança</Table.Th>
              <Table.Th>Valor cobrado</Table.Th>
              <Table.Th>Valor a cobrar</Table.Th>
              <Table.Th>Diferença</Table.Th>
              <Table.Th>Responsável</Table.Th>
              <Table.Th>Lido em</Table.Th>
              {canWrite && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((reservation) => {
              const brief = reservation.commercial?.currentReturn ?? null;
              const differs =
                brief !== null && brief.difference !== null && Number(brief.difference) !== 0;
              return (
                <Table.Tr key={selectionKey(reservation)}>
                  {canWrite && (
                    <Table.Td>
                      <Checkbox
                        aria-label={`Marcar a reserva ${reservation.reservationNumber}`}
                        checked={checked.has(selectionKey(reservation))}
                        onChange={(event) => toggle(reservation, event.currentTarget.checked)}
                      />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => setOpened(reservation)}
                    >
                      {reservation.reservationNumber}
                    </Button>
                  </Table.Td>
                  <Table.Td>{brief?.authorizationCode ?? '—'}</Table.Td>
                  <Table.Td>
                    {brief ? (
                      <ChargeHotel
                        chargeHotel={brief.chargeHotel}
                        hotelName={hotel(reservation.hotelCode)}
                      />
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>{formatMoney(brief?.chargedAmount)}</Table.Td>
                  <Table.Td>{formatMoney(reservation.totalAmount)}</Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      c={differs ? 'orange.8' : undefined}
                      fw={differs ? 700 : undefined}
                    >
                      <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(brief?.difference)}</span>
                    </Text>
                  </Table.Td>
                  <Table.Td>{brief?.chargedBy ?? '—'}</Table.Td>
                  <Table.Td>{formatDateTime(brief?.readAt)}</Table.Td>
                  {canWrite && (
                    <Table.Td>
                      {brief && (
                        <Group gap={6} wrap="nowrap">
                          <Button
                            size="compact-xs"
                            disabled={busy}
                            onClick={() =>
                              void decide(
                                () => hunit.commercial.confirmReturn(brief.id),
                                `Retorno da reserva ${reservation.reservationNumber} confirmado.`,
                              )
                            }
                          >
                            Confirmar
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="default"
                            color="red"
                            disabled={busy}
                            onClick={() => setRejecting(reservation)}
                          >
                            Recusar
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
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
      <Drawer
        opened={opened !== null}
        onClose={() => setOpened(null)}
        position="right"
        size="xl"
        title={<Title order={3}>Detalhe da reserva</Title>}
        closeButtonProps={{ 'aria-label': 'Fechar detalhe' }}
        transitionProps={{ duration: 0 }}
      >
        {opened && <ReservationDetailLoader initial={opened} />}
      </Drawer>
    </Stack>
  );
}
