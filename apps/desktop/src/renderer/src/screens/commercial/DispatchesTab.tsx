/**
 * Aba "Envios" da área Comercial (specs/005, FR-020): os envios, dos mais recentes para os mais
 * antigos, com quem enviou, quando, o estado e as contagens; ao abrir um, o acompanhamento e o
 * resultado de cada reserva (`DispatchView`), com cancelar e retomar para o perfil operador.
 *
 * Desde a 006 (T052; telas 7.7 e 7.7a, aprovada pela UX, research R-13): o envio em andamento num
 * card escuro no topo (quando começou, quem enviou, "N de M reservas verificadas", a barra, o
 * percentual e "Ver envio" em lima); os demais no "Histórico", como linhas de lista (quando, quem e
 * quantas; o resultado; a situação; a seta). O detalhe abre numa gaveta.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { CommercialDispatch } from '../../../../shared/ipc-types';
import { useHunitAccess } from '../../components/HunitAccess';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { dispatchTally, formatWhen, requesterName } from '../../presentation/jobs';
import { DISPATCH_STATUS_LABELS } from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import { useDispatch } from '../../state/dispatches';
import {
  Action,
  AppDrawer,
  DISPATCH_COLUMNS,
  ExecutionRow,
  ListCard,
  ListHeader,
  Notice,
  RunningJobCard,
  SectionTitle,
  StatusBadge,
} from '../../ui';
import { DispatchView, isDispatchFinished } from '../dispatch/DispatchView';

const PAGE_SIZE = 20;

type DispatchItem = Pick<CommercialDispatch, 'id' | 'status' | 'createdAt' | 'requestedClient'> & {
  counts: CommercialDispatch['counts'];
};

export function DispatchesTab() {
  const hunit = useHunit();
  const { state } = useConnection();
  const thisClient = state?.client?.name ?? null;
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
  const items: DispatchItem[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const running = items.filter((item) => !isDispatchFinished(item));
  const history = items.filter((item) => isDispatchFinished(item));
  const who = (item: DispatchItem) =>
    `${requesterName(item.requestedClient, thisClient)} · ${item.counts.total} reservas`;

  return (
    <Stack gap={16}>
      {list.isError && <Notice tone="red">{messageOf(list.error)}</Notice>}

      {running.map((item) => {
        const processed = item.counts.total - item.counts.pending;
        return (
          <RunningJobCard
            key={item.id}
            badge={DISPATCH_STATUS_LABELS[item.status].name}
            title={`Iniciado em ${formatWhen(item.createdAt)}`}
            detail={who(item)}
            progressLabel={`${processed} de ${item.counts.total} reservas verificadas`}
            percent={item.counts.total > 0 ? (processed / item.counts.total) * 100 : 0}
            actionLabel="Ver envio"
            onAction={() => setOpenId(item.id)}
          />
        );
      })}

      {list.isSuccess && items.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum envio ao Comercial ainda.
        </Text>
      )}
      {history.length > 0 && (
        <Stack gap={12}>
          {/* O título só separa a lista do card escuro: sem envio em andamento, não aparece (7.7). */}
          {running.length > 0 && <SectionTitle>Histórico</SectionTitle>}
          <ListCard label="Envios ao Comercial" header={<ListHeader columns={DISPATCH_COLUMNS} />}>
            {history.map((item) => {
              const status = badgeOf(DISPATCH_STATUS_LABELS[item.status]);
              const when = formatWhen(item.createdAt);
              return (
                <ExecutionRow
                  key={item.id}
                  when={when}
                  detail={who(item)}
                  result={dispatchTally(item.counts)}
                  status={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
                  openLabel={`Abrir o envio de ${when}`}
                  opened={openId === item.id}
                  onOpen={() => setOpenId(item.id)}
                />
              );
            })}
          </ListCard>
        </Stack>
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

      <AppDrawer
        opened={openId !== null}
        onClose={() => setOpenId(null)}
        title="Detalhe do envio"
        closeLabel="Fechar envio"
      >
        {openId && (
          <DispatchDetail
            key={openId}
            dispatchId={openId}
            hotelNames={hotelNames}
            onOpen={setOpenId}
          />
        )}
      </AppDrawer>
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

  if (dispatch.isError) return <Notice tone="red">{messageOf(dispatch.error)}</Notice>;
  if (!dispatch.data) return <Text size="sm">Carregando o envio…</Text>;
  const resumable =
    isOperator &&
    isDispatchFinished(dispatch.data) &&
    dispatch.data.resumedByDispatchId === null &&
    dispatch.data.counts.notVerified > 0;

  return (
    <Stack gap={16}>
      {resumable && access.form}
      <DispatchView
        dispatch={dispatch.data}
        hotelNames={hotelNames}
        onResumed={onOpen}
        onMissingAccess={() => access.expired()}
      />
      {dispatch.data.resumedByDispatchId && (
        <Group>
          <Action
            variant="secondary"
            size="xs"
            onClick={() => onOpen(dispatch.data.resumedByDispatchId ?? dispatchId)}
          >
            Ver a retomada
          </Action>
        </Group>
      )}
    </Stack>
  );
}
