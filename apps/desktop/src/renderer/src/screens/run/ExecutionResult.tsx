/**
 * Estado e resultado de uma execução iniciada na tela Executar (specs/002, US1 cenários 2, 5 e 7,
 * FR-013, data-model §6): situação, contagens por situação de cobrança, hotéis concluídos e com
 * falha (com o motivo) e a mensagem do motivo de término. Depois de prazo do token esgotado ou
 * token recusado, oferece "Iniciar de novo" com os mesmos dados.
 */
import { Alert, Button, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { Execution, ExecutionEndReason } from '../../../../shared/ipc-types';
import { ClassificationCountsGrid } from '../../components/ClassificationCountsGrid';
import { EvidenceList } from '../../components/EvidenceList';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate, formatDuration } from '../../presentation/format';
import {
  END_REASON_MESSAGES,
  EXECUTION_STATUS_LABELS,
  HOTEL_STATUS_LABELS,
} from '../../presentation/labels';

/** Motivos em que basta iniciar de novo com os mesmos dados (US1, cenário 5). */
const RESTARTABLE: ReadonlySet<ExecutionEndReason> = new Set([
  'two_factor_timeout',
  'invalid_token',
]);

interface Props {
  execution: Execution;
  onRestart?: () => void;
  restarting?: boolean;
}

export function ExecutionResult({ execution, onRestart, restarting = false }: Props) {
  const { status, endReason } = execution;
  const finished = status === 'completed' || status === 'failed' || status === 'cancelled';

  return (
    <Paper withBorder p="md" radius="md" data-testid="execution-result">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="sm">
            <Title order={4}>{finished ? 'Resultado da execução' : 'Execução em andamento'}</Title>
            <StatusBadge label={EXECUTION_STATUS_LABELS[status]} size="md" />
          </Group>
          <Text size="sm" c="dimmed">
            Check-in de {formatDate(execution.period.from)} a {formatDate(execution.period.to)}
          </Text>
        </Group>

        {endReason && (
          <Alert color={status === 'cancelled' ? 'gray' : 'red'} role="status">
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">{END_REASON_MESSAGES[endReason]}</Text>
              {onRestart && RESTARTABLE.has(endReason) && (
                <Button size="xs" onClick={onRestart} loading={restarting}>
                  Iniciar de novo
                </Button>
              )}
            </Group>
          </Alert>
        )}

        <ClassificationCountsGrid counts={execution.counts} />

        {execution.hotels.length > 0 && (
          <Table striped highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Hotel</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Reservas</Table.Th>
                <Table.Th>Duração</Table.Th>
                <Table.Th>Motivo</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {execution.hotels.map((hotel) => (
                <Table.Tr key={hotel.hotelCode}>
                  <Table.Td>
                    {hotel.hotelName ?? hotel.hotelCode}{' '}
                    <Text span size="xs" c="dimmed">
                      ({hotel.hotelCode})
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge label={HOTEL_STATUS_LABELS[hotel.status]} />
                  </Table.Td>
                  <Table.Td>{hotel.reservationsSeen ?? 0}</Table.Td>
                  <Table.Td>{formatDuration(hotel.durationSeconds)}</Table.Td>
                  <Table.Td>
                    {hotel.failureReason && (
                      <Text size="sm" c="red.8">
                        {hotel.failureReason}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <EvidenceList executionId={execution.id} />
      </Stack>
    </Paper>
  );
}
