/**
 * Tela Execuções (specs/002, US2, FR-015, FR-019): todas as execuções, das mais recentes para as
 * mais antigas, inclusive as iniciadas em outras máquinas, com atualização a cada 10 s enquanto a
 * tela está aberta; o detalhe abre num painel lateral.
 */
import { Alert, Button, Drawer, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { StatusBadge } from '../../components/StatusBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatDateTime } from '../../presentation/format';
import { END_REASON_MESSAGES, EXECUTION_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { ExecutionDetail } from './ExecutionDetail';

const PAGE_SIZE = 50;
const REFRESH_MS = 10_000;

export function ExecutionsScreen({
  initialExecutionId = null,
}: {
  initialExecutionId?: string | null;
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

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Execuções</Title>
        <StaleDataNotice updatedAt={list.dataUpdatedAt} offline={state?.status === 'offline'} />
      </Group>
      {list.isError && items.length === 0 && (
        <Alert color="red" role="alert">
          {messageOf(list.error)}
        </Alert>
      )}
      {list.isSuccess && items.length === 0 && <Text c="dimmed">Nenhuma execução ainda.</Text>}
      {items.length > 0 && (
        <Table highlightOnHover striped verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Iniciada em</Table.Th>
              <Table.Th>Quem iniciou</Table.Th>
              <Table.Th>Período de check-in</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Motivo de término</Table.Th>
              <Table.Th>Encerrada em</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((execution) => (
              <Table.Tr
                key={execution.id}
                onClick={() => setSelected(execution.id)}
                style={{ cursor: 'pointer' }}
                aria-selected={selected === execution.id}
              >
                <Table.Td>{formatDateTime(execution.createdAt)}</Table.Td>
                <Table.Td>
                  {execution.requestedClient}
                  {client?.name === execution.requestedClient && (
                    <Text span size="xs" c="dimmed">
                      {' '}
                      (esta máquina)
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {formatDate(execution.period.from)} a {formatDate(execution.period.to)}
                </Table.Td>
                <Table.Td>
                  <StatusBadge label={EXECUTION_STATUS_LABELS[execution.status]} />
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {execution.endReason ? END_REASON_MESSAGES[execution.endReason] : ''}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {execution.finishedAt ? formatDateTime(execution.finishedAt) : ''}
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
        title={<Title order={3}>Detalhe da execução</Title>}
        closeButtonProps={{ 'aria-label': 'Fechar detalhe' }}
        transitionProps={{ duration: 0 }}
      >
        {selected && <ExecutionDetail executionId={selected} onOpenExecution={setSelected} />}
      </Drawer>
    </Stack>
  );
}
