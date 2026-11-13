/**
 * Detalhe de uma execução, em painel lateral (specs/002, US2, FR-016 a FR-018, FR-016a, research
 * R-06 e R-07): estado, hotel atual, progresso de cada hotel, tempo estimado, contagens e os avisos
 * do servidor. Para o perfil operador: cancelar (com confirmação), retomar (com o acesso do cofre)
 * e o campo do token, inclusive para execuções de outras máquinas. O estado vem sempre do GET; o
 * app não decide nada sobre a execução.
 */
import {
  Alert,
  Button,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { Execution, ExecutionEvent } from '../../../../shared/ipc-types';
import { ClassificationCountsGrid } from '../../components/ClassificationCountsGrid';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { StatusBadge } from '../../components/StatusBadge';
import { errorCode, messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatDateTime, formatDuration, formatTime } from '../../presentation/format';
import {
  END_REASON_MESSAGES,
  EXECUTION_STATUS_LABELS,
  HOTEL_STATUS_LABELS,
} from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { useExecution } from '../../state/executions';

const ACTIVE = new Set(['queued', 'running', 'awaiting_2fa']);
const RESUMABLE = new Set(['failed', 'cancelled']);

interface Props {
  executionId: string;
  onOpenExecution: (executionId: string) => void;
}

export function ExecutionDetail({ executionId, onOpenExecution }: Props) {
  const query = useExecution(executionId);
  const { state } = useConnection();
  const execution = query.data;

  return (
    <Stack gap="md" data-testid="execution-detail">
      <StaleDataNotice updatedAt={query.dataUpdatedAt} offline={state?.status === 'offline'} />
      {query.isError && !execution && (
        <Alert color="red" role="alert">
          {messageOf(query.error)}
        </Alert>
      )}
      {execution && (
        <DetailContent key={execution.id} execution={execution} onOpenExecution={onOpenExecution} />
      )}
    </Stack>
  );
}

function hotelName(execution: Execution, hotelCode: string | null | undefined): string {
  if (!hotelCode) return '';
  const hotel = execution.hotels.find((candidate) => candidate.hotelCode === hotelCode);
  return hotel?.hotelName ? `${hotel.hotelName} (${hotelCode})` : hotelCode;
}

function DetailContent({
  execution,
  onOpenExecution,
}: {
  execution: Execution;
  onOpenExecution: Props['onOpenExecution'];
}) {
  const { isOperator, isOnline, client } = useConnection();
  const { current, timing, warnings } = execution;
  const latestWarningByHotel = new Map<string, ExecutionEvent>();
  for (const warning of warnings) {
    if (warning.hotelCode && !latestWarningByHotel.has(warning.hotelCode)) {
      latestWarningByHotel.set(warning.hotelCode, warning);
    }
  }
  const mine = client?.name === execution.requestedClient;

  return (
    <>
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={4}>Execução</Title>
          <StatusBadge label={EXECUTION_STATUS_LABELS[execution.status]} size="md" />
        </Group>
        <Text size="sm" c="dimmed">
          {execution.requestedClient}
          {mine ? ' (esta máquina)' : ''}
        </Text>
      </Group>
      <Text size="sm">
        Check-in de {formatDate(execution.period.from)} a {formatDate(execution.period.to)} —
        iniciada em {formatDateTime(execution.createdAt)}
        {execution.finishedAt ? `, encerrada em ${formatDateTime(execution.finishedAt)}` : ''}
      </Text>

      {execution.parentExecutionId && (
        <Group gap="xs">
          <Button
            variant="subtle"
            size="compact-sm"
            onClick={() => onOpenExecution(execution.parentExecutionId ?? '')}
          >
            Retomada de {execution.parentExecutionId.slice(0, 8)}
          </Button>
        </Group>
      )}

      {execution.endReason && (
        <Alert color={execution.status === 'cancelled' ? 'gray' : 'red'} role="status">
          {END_REASON_MESSAGES[execution.endReason]}
        </Alert>
      )}

      {current && (
        <Paper withBorder p="sm" radius="sm">
          <Text size="sm">
            <Text span fw={600}>
              Hotel atual:
            </Text>{' '}
            {hotelName(execution, current.hotelCode)}
            {current.page
              ? ` — página ${current.page}${current.pagesTotal ? ` de ${current.pagesTotal}` : ''}`
              : ''}
            {current.reservationNumber ? `, reserva ${current.reservationNumber}` : ''}
          </Text>
        </Paper>
      )}
      {ACTIVE.has(execution.status) && timing?.estimatedRemainingSeconds != null && (
        <Text size="sm">
          Tempo estimado restante:{' '}
          <Text span fw={600}>
            {formatDuration(timing.estimatedRemainingSeconds)}
          </Text>
        </Text>
      )}

      {isOperator && execution.status === 'awaiting_2fa' && (
        <TokenField executionId={execution.id} disabled={!isOnline} />
      )}

      <ClassificationCountsGrid counts={execution.counts} />

      {execution.hotels.length > 0 && (
        <Table striped verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Hotel</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th>Páginas</Table.Th>
              <Table.Th>Reservas</Table.Th>
              <Table.Th>Duração</Table.Th>
              <Table.Th>Motivo ou aviso</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {execution.hotels.map((hotel) => {
              const warning =
                hotel.status === 'running' ? latestWarningByHotel.get(hotel.hotelCode) : undefined;
              return (
                <Table.Tr key={hotel.hotelCode} data-testid={`hotel-${hotel.hotelCode}`}>
                  <Table.Td>{hotelName(execution, hotel.hotelCode)}</Table.Td>
                  <Table.Td>
                    <StatusBadge label={HOTEL_STATUS_LABELS[hotel.status]} />
                  </Table.Td>
                  <Table.Td>
                    {hotel.pagesTotal ? `${hotel.pagesDone ?? 0} de ${hotel.pagesTotal}` : '—'}
                  </Table.Td>
                  <Table.Td>{hotel.reservationsSeen ?? 0}</Table.Td>
                  <Table.Td>{formatDuration(hotel.durationSeconds)}</Table.Td>
                  <Table.Td>
                    {hotel.failureReason && (
                      <Text size="sm" c={hotel.status === 'failed' ? 'red.8' : 'orange.8'}>
                        {hotel.failureReason}
                      </Text>
                    )}
                    {warning && (
                      <Text size="sm" c="orange.8">
                        {formatTime(warning.at)} — {warning.message}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      {warnings.length > 0 && (
        <Paper withBorder p="sm" radius="sm" data-testid="execution-warnings">
          <Title order={5} mb={6}>
            Avisos do servidor
          </Title>
          <Stack component="ul" gap={4} m={0} pl="md">
            {warnings.map((warning) => (
              <Text component="li" size="sm" key={warning.id}>
                <Text span c="dimmed">
                  {formatTime(warning.at)}
                </Text>{' '}
                {warning.hotelCode ? `[${hotelName(execution, warning.hotelCode)}] ` : ''}
                {warning.message}
              </Text>
            ))}
          </Stack>
        </Paper>
      )}

      {isOperator && (
        <OperatorActions
          execution={execution}
          onOpenExecution={onOpenExecution}
          disabled={!isOnline}
        />
      )}
    </>
  );
}

function TokenField({ executionId, disabled }: { executionId: string; disabled: boolean }) {
  const hunit = useHunit();
  const [token, setToken] = useState('');
  const send = useMutation({
    mutationFn: (value: string) =>
      unwrap(hunit.executions.sendToken({ executionId, token: value })),
    onSuccess: () => setToken(''),
  });
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = token.trim();
    if (!/^[0-9]{4,10}$/.test(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    send.mutate(value);
  }

  return (
    <Paper withBorder p="sm" radius="sm" bg="yellow.0">
      <form onSubmit={submit}>
        <Group align="flex-end">
          <TextInput
            label="Token do autenticador"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            error={invalid ? 'O token tem de 4 a 10 dígitos.' : null}
          />
          <Button type="submit" loading={send.isPending} disabled={disabled}>
            Enviar token
          </Button>
        </Group>
      </form>
      {send.isSuccess && (
        <Text size="sm" mt={6} role="status">
          Token entregue, aguardando o Hunit…
        </Text>
      )}
      {send.isError && (
        <Text size="sm" mt={6} c="red" role="alert">
          {messageOf(send.error)}
        </Text>
      )}
    </Paper>
  );
}

function OperatorActions({
  execution,
  onOpenExecution,
  disabled,
}: {
  execution: Execution;
  onOpenExecution: Props['onOpenExecution'];
  disabled: boolean;
}) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [askAccess, setAskAccess] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resumedId, setResumedId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['executions'] });

  const cancel = useMutation({
    mutationFn: () => unwrap(hunit.executions.cancel(execution.id)),
    onSuccess: async (updated) => {
      setConfirmCancel(false);
      queryClient.setQueryData(['execution', execution.id], updated);
      await refresh();
    },
  });

  const resume = useMutation({
    mutationFn: () => unwrap(hunit.executions.resume(execution.id)),
    onSuccess: async (resumed) => {
      setAskAccess(null);
      setResumedId(resumed.id);
      await refresh();
    },
    onError: (error) => {
      const code = errorCode(error);
      if (code === 'credentials_missing' || code === 'credentials_expired') {
        setAskAccess(messageOf(error));
      }
    },
  });

  const saveAndResume = useMutation({
    mutationFn: async () => {
      await unwrap(hunit.credentials.set({ username: username.trim(), password }));
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['credentials'] });
      return resume.mutateAsync();
    },
  });

  const resumeError =
    resume.error &&
    askAccess === null &&
    !['credentials_missing', 'credentials_expired'].includes(errorCode(resume.error) ?? '')
      ? messageOf(resume.error)
      : null;

  return (
    <Stack gap="sm">
      <Group>
        {ACTIVE.has(execution.status) && (
          <Button
            color="red"
            variant="light"
            onClick={() => setConfirmCancel(true)}
            disabled={disabled}
          >
            Cancelar execução
          </Button>
        )}
        {RESUMABLE.has(execution.status) && (
          <Button onClick={() => resume.mutate()} loading={resume.isPending} disabled={disabled}>
            Retomar
          </Button>
        )}
        {resumedId && (
          <Button variant="light" onClick={() => onOpenExecution(resumedId)}>
            Abrir a retomada
          </Button>
        )}
      </Group>
      {resumeError && (
        <Alert color="red" role="alert">
          {resumeError}
        </Alert>
      )}
      {cancel.isError && (
        <Alert color="red" role="alert">
          {messageOf(cancel.error)}
        </Alert>
      )}

      <Modal
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancelar a execução?"
        centered
      >
        <Stack>
          <Text size="sm">
            Os hotéis já concluídos ficam gravados; os que faltam podem ser retomados depois.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmCancel(false)}>
              Não
            </Button>
            <Button color="red" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              Sim, cancelar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={askAccess !== null}
        onClose={() => setAskAccess(null)}
        title="Acesso ao Hunit para retomar"
        centered
      >
        <Stack>
          {askAccess && (
            <Text size="sm" c="orange.8">
              {askAccess}
            </Text>
          )}
          <TextInput
            label="Usuário do Hunit"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            autoComplete="off"
          />
          <PasswordInput
            label="Senha do Hunit"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="off"
          />
          <Group justify="flex-end">
            <Button
              onClick={() => saveAndResume.mutate()}
              loading={saveAndResume.isPending}
              disabled={username.trim() === '' || password === ''}
            >
              Guardar e retomar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
