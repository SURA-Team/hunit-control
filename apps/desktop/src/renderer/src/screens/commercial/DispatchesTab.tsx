/**
 * Aba "Envios" da área Comercial (specs/005, FR-020): os envios, dos mais recentes para os mais
 * antigos, com quem enviou, quando, o estado e as contagens; ao abrir um, o acompanhamento e o
 * resultado de cada reserva (`DispatchView`), com cancelar e retomar para o perfil operador.
 */
import { Alert, Button, Drawer, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useHunitAccess } from '../../components/HunitAccess';
import { StatusBadge } from '../../components/StatusBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime } from '../../presentation/format';
import { DISPATCH_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { useDispatch } from '../../state/dispatches';
import { DispatchView, isDispatchFinished } from '../dispatch/DispatchView';

const PAGE_SIZE = 20;

export function DispatchesTab() {
  const hunit = useHunit();
  const [openId, setOpenId] = useState<string | null>(null);
  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const hotelNames = useMemo(
    () => new Map((hotels.data ?? []).map((hotel) => [hotel.code, hotel.name])),
    [hotels.data],
  );

  const list = useInfiniteQuery({
    queryKey: ['dispatches'],
    queryFn: ({ pageParam }) =>
      unwrap(
        hunit.dispatches.list({
          limit: PAGE_SIZE,
          ...(pageParam !== null && { cursor: pageParam }),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: 15_000,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Stack gap="md">
      {list.isError && (
        <Alert color="red" role="alert">
          {messageOf(list.error)}
        </Alert>
      )}
      {list.isSuccess && items.length === 0 && (
        <Text c="dimmed">Nenhum envio ao Comercial ainda.</Text>
      )}
      {items.length > 0 && (
        <Table highlightOnHover striped verticalSpacing={6} aria-label="Envios ao Comercial">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Quando</Table.Th>
              <Table.Th>Quem enviou</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Reservas</Table.Th>
              <Table.Th>Enviadas</Table.Th>
              <Table.Th>Retiradas</Table.Th>
              <Table.Th>Não verificadas</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((dispatch) => (
              <Table.Tr
                key={dispatch.id}
                onClick={() => setOpenId(dispatch.id)}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td>{formatDateTime(dispatch.createdAt)}</Table.Td>
                <Table.Td>{dispatch.requestedClient}</Table.Td>
                <Table.Td>
                  <StatusBadge label={DISPATCH_STATUS_LABELS[dispatch.status]} size="xs" />
                </Table.Td>
                <Table.Td>{dispatch.counts.total}</Table.Td>
                <Table.Td>{dispatch.counts.sent}</Table.Td>
                <Table.Td>{dispatch.counts.withdrawn}</Table.Td>
                <Table.Td>{dispatch.counts.notVerified}</Table.Td>
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
        opened={openId !== null}
        onClose={() => setOpenId(null)}
        position="right"
        size="xl"
        title={<Title order={3}>Envio ao Comercial</Title>}
        closeButtonProps={{ 'aria-label': 'Fechar envio' }}
        transitionProps={{ duration: 0 }}
      >
        {openId && (
          <DispatchDetail
            key={openId}
            dispatchId={openId}
            hotelNames={hotelNames}
            onOpen={setOpenId}
          />
        )}
      </Drawer>
    </Stack>
  );
}

function DispatchDetail({
  dispatchId,
  hotelNames,
  onOpen,
}: {
  dispatchId: string;
  hotelNames: ReadonlyMap<string, string>;
  onOpen: (dispatchId: string) => void;
}) {
  const { isOperator } = useConnection();
  const access = useHunitAccess();
  const dispatch = useDispatch(dispatchId);

  if (dispatch.isError) {
    return (
      <Alert color="red" role="alert">
        {messageOf(dispatch.error)}
      </Alert>
    );
  }
  if (!dispatch.data) return <Text size="sm">Carregando o envio…</Text>;
  const resumable =
    isOperator &&
    isDispatchFinished(dispatch.data) &&
    dispatch.data.resumedByDispatchId === null &&
    dispatch.data.counts.notVerified > 0;

  return (
    <Stack gap="md">
      {resumable && access.form}
      <DispatchView
        dispatch={dispatch.data}
        hotelNames={hotelNames}
        onResumed={onOpen}
        onMissingAccess={() => access.expired()}
      />
      {dispatch.data.resumedByDispatchId && (
        <Group>
          <Button
            variant="default"
            size="xs"
            onClick={() => onOpen(dispatch.data.resumedByDispatchId ?? dispatchId)}
          >
            Ver a retomada
          </Button>
        </Group>
      )}
    </Stack>
  );
}
