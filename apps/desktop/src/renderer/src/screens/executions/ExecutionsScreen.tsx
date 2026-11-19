/**
 * Tela Execuções (specs/002, US2, FR-015, FR-019): todas as execuções, das mais recentes para as
 * mais antigas, inclusive as iniciadas em outras máquinas, com atualização a cada 10 s enquanto a
 * tela está aberta; o detalhe abre num painel lateral.
 *
 * Desde a 006 (T055; telas 3.1 e 6.1, research R-13): cada execução em andamento num card escuro no
 * topo (quando começou, o período e quem iniciou, "N de M hotéis concluídos", a barra, o percentual e
 * "Ver detalhes" em lima); as demais no "Histórico", como linhas de lista (quando, período e quem; o
 * resultado; a situação; a seta) e o rodapé "N execuções · as mais recentes primeiro". Os envios ao
 * Comercial ficam na área Comercial.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ExecutionSummary } from '../../../../shared/ipc-types';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatDuration, formatTime } from '../../presentation/format';
import { formatWhen, jobStatusBadge, requesterName } from '../../presentation/jobs';
import { END_REASON_MESSAGES, EXECUTION_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { executionKey } from '../../state/executions';
import {
  Action,
  AppDrawer,
  EXECUTION_COLUMNS,
  ExecutionRow,
  ListCard,
  ListHeader,
  Notice,
  PageHeader,
  RunningJobCard,
  SectionTitle,
  StatusBadge,
} from '../../ui';
import { ACTIVE_EXECUTION, hotelProgress } from './ExecutionParts';
import { ExecutionDetail } from './ExecutionDetail';

const PAGE_SIZE = 50;
const REFRESH_MS = 10_000;

/** "13/11 a 19/11/2026": o período curto das listas do design. */
function shortPeriod(period: ExecutionSummary['period']): string {
  const from = formatDate(period.from);
  const to = formatDate(period.to);
  return from.slice(6) === to.slice(6) ? `${from.slice(0, 5)} a ${to}` : `${from} a ${to}`;
}

/** O resultado de uma execução encerrada, na coluna "Resultado" (tela 3.1). */
function resultText(execution: ExecutionSummary): string {
  if (execution.status === 'completed' && execution.finishedAt) {
    const seconds = (Date.parse(execution.finishedAt) - Date.parse(execution.createdAt)) / 1000;
    return `Encerrada às ${formatTime(execution.finishedAt)} · ${formatDuration(seconds)}`;
  }
  return execution.endReason ? END_REASON_MESSAGES[execution.endReason] : '';
}

export function ExecutionsScreen({
  initialExecutionId = null,
  onOpenReservations,
}: {
  initialExecutionId?: string | null;
  onOpenReservations?: (executionId: string) => void;
}) {
  const hunit = useHunit();
  const { state, client } = useConnection();
  const [selected, setSelected] = useState<string | null>(initialExecutionId);

  const list = useInfiniteQuery({
    queryKey: ['executions'],
    queryFn: ({ pageParam }) =>
      unwrap(
        hunit.executions.list({
          limit: PAGE_SIZE,
          ...(pageParam !== null && { cursor: pageParam }),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: REFRESH_MS,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const running = items.filter((item) => ACTIVE_EXECUTION.has(item.status));
  const history = items.filter((item) => !ACTIVE_EXECUTION.has(item.status));
  const detail = (item: ExecutionSummary) =>
    `Check-in ${shortPeriod(item.period)} · ${requesterName(item.requestedClient, client?.name)}`;

  return (
    <Stack gap={16}>
      <PageHeader
        title="Execuções"
        action={
          <StaleDataNotice updatedAt={list.dataUpdatedAt} offline={state?.status === 'offline'} />
        }
      />
      {list.isError && items.length === 0 && <Notice tone="red">{messageOf(list.error)}</Notice>}
      {list.isSuccess && items.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhuma execução ainda.
        </Text>
      )}

      {running.map((item) => (
        <RunningExecutionCard
          key={item.id}
          execution={item}
          detail={detail(item)}
          onOpen={() => setSelected(item.id)}
        />
      ))}

      {history.length > 0 && (
        <Stack gap={12}>
          <SectionTitle>Histórico</SectionTitle>
          <ListCard
            label="Histórico das execuções"
            header={<ListHeader columns={EXECUTION_COLUMNS} />}
          >
            {history.map((item) => {
              const status = jobStatusBadge(EXECUTION_STATUS_LABELS[item.status], item.status);
              const when = formatWhen(item.createdAt);
              return (
                <ExecutionRow
                  key={item.id}
                  when={when}
                  detail={detail(item)}
                  result={resultText(item)}
                  status={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
                  openLabel={`Abrir a execução de ${when}`}
                  opened={selected === item.id}
                  onOpen={() => setSelected(item.id)}
                />
              );
            })}
          </ListCard>
        </Stack>
      )}
      {items.length > 0 && (
        <Group justify="space-between" gap={12}>
          <Text size="xs" c="dimmed">
            {items.length} {items.length === 1 ? 'execução' : 'execuções'} · as mais recentes
            primeiro
          </Text>
          {list.hasNextPage && (
            <Action
              variant="secondary"
              onClick={() => void list.fetchNextPage()}
              disabled={state?.status === 'offline'}
              loading={list.isFetchingNextPage}
            >
              Carregar mais
            </Action>
          )}
        </Group>
      )}

      <AppDrawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title="Detalhe da execução"
        closeLabel="Fechar detalhe"
      >
        {selected && (
          <ExecutionDetail
            executionId={selected}
            onOpenExecution={setSelected}
            onOpenReservations={onOpenReservations}
          />
        )}
      </AppDrawer>
    </Stack>
  );
}

/**
 * Card escuro de uma execução em andamento: o andamento dos hotéis vem do detalhe dela, buscado com a
 * lista (a cada 10 s) e no mesmo cache da gaveta, que acompanha os eventos do servidor.
 */
function RunningExecutionCard({
  execution,
  detail,
  onOpen,
}: {
  execution: ExecutionSummary;
  detail: string;
  onOpen: () => void;
}) {
  const hunit = useHunit();
  const full = useQuery({
    queryKey: executionKey(execution.id),
    queryFn: () => unwrap(hunit.executions.get(execution.id)),
    refetchInterval: REFRESH_MS,
  });
  const { done, total } = full.data ? hotelProgress(full.data) : { done: 0, total: 0 };
  return (
    <RunningJobCard
      badge={EXECUTION_STATUS_LABELS[execution.status].name}
      title={`Iniciada em ${formatWhen(execution.createdAt)}`}
      detail={detail}
      progressLabel={
        total > 0
          ? `${done} de ${total} ${total === 1 ? 'hotel concluído' : 'hotéis concluídos'}`
          : 'Preparando os hotéis'
      }
      percent={total > 0 ? (done / total) * 100 : 0}
      actionLabel="Ver detalhes"
      onAction={onOpen}
    />
  );
}
