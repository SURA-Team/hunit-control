/**
 * Detalhe de uma execução, em painel lateral (specs/002, US2, FR-016 a FR-018, FR-016a, research
 * R-06 e R-07): estado, hotel atual, progresso de cada hotel, tempo estimado, contagens e os avisos
 * do servidor. Para o perfil operador: cancelar (com confirmação), retomar (com o acesso do cofre)
 * e o campo do token, inclusive para execuções de outras máquinas. O estado vem sempre do GET; o
 * app não decide nada sobre a execução.
 *
 * Desde a 006 (T056; telas 3.2 a 3.4): "Execução" com o selo e quem iniciou; o período; o hotel atual
 * numa caixa cinza; o tempo restante; a faixa escura "N de M hotéis concluídos"; as contagens em
 * caixas (`CountCard`); os hotéis em linhas simples (FR-020); os avisos do servidor e as evidências
 * em cards; "Ver as reservas desta execução" em contorno; "Cancelar execução" em vermelho suave e
 * "Retomar" como principal; os diálogos de cancelar e do acesso para retomar no padrão.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { Execution } from '../../../../shared/ipc-types';
import { ClassificationCountsGrid } from '../../components/ClassificationCountsGrid';
import { EvidenceList } from '../../components/EvidenceList';
import { StaleDataNotice } from '../../components/StaleDataNotice';
import { errorCode, messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatDateTime, formatDuration, formatTime } from '../../presentation/format';
import { jobStatusBadge, requesterName } from '../../presentation/jobs';
import { END_REASON_MESSAGES, EXECUTION_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { useExecution } from '../../state/executions';
import {
  Action,
  AppDialog,
  Card,
  CardHeader,
  Field,
  Notice,
  PasswordField,
  SectionTitle,
  StatusBadge,
} from '../../ui';
import { ACTIVE_EXECUTION, ExecutionHotels, ExecutionProgressStrip } from './ExecutionParts';

const RESUMABLE = new Set(['failed', 'cancelled']);

interface Props {
  executionId: string;
  onOpenExecution: (executionId: string) => void;
  /** Abre a tela Reservas filtrada por esta execução (FR-020). */
  onOpenReservations?: ((executionId: string) => void) | undefined;
}

export function ExecutionDetail({ executionId, onOpenExecution, onOpenReservations }: Props) {
  const query = useExecution(executionId);
  const { state } = useConnection();
  const execution = query.data;

  return (
    <Stack gap={16} data-testid="execution-detail">
      <StaleDataNotice updatedAt={query.dataUpdatedAt} offline={state?.status === 'offline'} />
      {query.isError && !execution && <Notice tone="red">{messageOf(query.error)}</Notice>}
      {execution && (
        <DetailContent
          key={execution.id}
          execution={execution}
          onOpenExecution={onOpenExecution}
          onOpenReservations={onOpenReservations}
        />
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
  onOpenReservations,
}: {
  execution: Execution;
  onOpenExecution: Props['onOpenExecution'];
  onOpenReservations: Props['onOpenReservations'];
}) {
  const { isOperator, isOnline, client } = useConnection();
  const { current, timing, warnings } = execution;
  const active = ACTIVE_EXECUTION.has(execution.status);
  const status = jobStatusBadge(EXECUTION_STATUS_LABELS[execution.status], execution.status);

  return (
    <>
      <Group justify="space-between" gap={8}>
        <Group gap={8}>
          <SectionTitle order={3}>Execução</SectionTitle>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </Group>
        <Text size="sm" c="dimmed">
          {requesterName(execution.requestedClient, client?.name)}
        </Text>
      </Group>
      <Text size="sm">
        Check-in de {formatDate(execution.period.from)} a {formatDate(execution.period.to)} —
        iniciada em {formatDateTime(execution.createdAt)}
        {execution.finishedAt ? `, encerrada em ${formatDateTime(execution.finishedAt)}` : ''}
      </Text>

      {execution.parentExecutionId && (
        <Group>
          <Action
            variant="text"
            size="xs"
            onClick={() => onOpenExecution(execution.parentExecutionId ?? '')}
          >
            Retomada de {execution.parentExecutionId.slice(0, 8)}
          </Action>
        </Group>
      )}

      {execution.endReason && (
        <Notice tone={execution.status === 'cancelled' ? 'amber' : 'red'} role="status">
          {END_REASON_MESSAGES[execution.endReason]}
        </Notice>
      )}

      {current && (
        <Card tone="subtle" padding={12}>
          <Text size="sm">
            <Text span fw={700}>
              Hotel atual:
            </Text>{' '}
            {hotelName(execution, current.hotelCode)}
            {current.page
              ? ` — página ${current.page}${current.pagesTotal ? ` de ${current.pagesTotal}` : ''}`
              : ''}
            {current.reservationNumber ? `, reserva ${current.reservationNumber}` : ''}
          </Text>
        </Card>
      )}
      {active && timing?.estimatedRemainingSeconds != null && (
        <Text size="sm">
          Tempo estimado restante:{' '}
          <Text span fw={700}>
            {formatDuration(timing.estimatedRemainingSeconds)}
          </Text>
        </Text>
      )}

      {isOperator && execution.status === 'awaiting_2fa' && (
        <TokenField executionId={execution.id} disabled={!isOnline} />
      )}

      {active && <ExecutionProgressStrip execution={execution} />}
      <ClassificationCountsGrid counts={execution.counts} />
      <ExecutionHotels execution={execution} warnings={warnings} />

      {warnings.length > 0 && (
        <Card block="Avisos do servidor" data-testid="execution-warnings">
          <CardHeader title="Avisos do servidor" />
          <Stack component="ul" gap={4} m={0} pl={18}>
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
        </Card>
      )}

      <EvidenceList executionId={execution.id} />

      {onOpenReservations && (
        <Group>
          <Action variant="secondary" onClick={() => onOpenReservations(execution.id)}>
            Ver as reservas desta execução
          </Action>
        </Group>
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
    <Card tone="subtle" padding={12} block="Token do autenticador">
      <form onSubmit={submit}>
        <Group align="flex-end" gap={8} wrap="nowrap">
          <Field
            flex={1}
            label="Token do autenticador"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            error={invalid ? 'O token tem de 4 a 10 dígitos.' : null}
          />
          <Action
            type="submit"
            variant="primary"
            size="sm"
            loading={send.isPending}
            disabled={disabled}
          >
            Enviar token
          </Action>
        </Group>
      </form>
      {send.isSuccess && (
        <Text size="sm" role="status">
          Token entregue, aguardando o Hunit…
        </Text>
      )}
      {send.isError && (
        <Text size="sm" c="var(--hc-vermelho-9)" role="alert">
          {messageOf(send.error)}
        </Text>
      )}
    </Card>
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
  const canCancel = ACTIVE_EXECUTION.has(execution.status);
  const canResume = RESUMABLE.has(execution.status);

  return (
    <Stack gap={12}>
      {(canCancel || canResume || resumedId) && (
        <Group gap={8}>
          {/* Sem o "Leve" (FR-013, T038): cancelar é destrutiva; abrir a retomada, secundária. */}
          {canCancel && (
            <Action
              variant="danger-light"
              onClick={() => setConfirmCancel(true)}
              disabled={disabled}
            >
              Cancelar execução
            </Action>
          )}
          {canResume && (
            <Action
              variant="primary"
              onClick={() => resume.mutate()}
              loading={resume.isPending}
              disabled={disabled}
            >
              Retomar
            </Action>
          )}
          {resumedId && (
            <Action variant="secondary" onClick={() => onOpenExecution(resumedId)}>
              Abrir a retomada
            </Action>
          )}
        </Group>
      )}
      {resumeError && <Notice tone="red">{resumeError}</Notice>}
      {cancel.isError && <Notice tone="red">{messageOf(cancel.error)}</Notice>}

      {/* Tela 3.3: "Não" em contorno e "Sim, cancelar" em vermelho cheio (FR-009). */}
      <AppDialog
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancelar a execução?"
        actions={
          <>
            <Action variant="secondary" size="sm" onClick={() => setConfirmCancel(false)}>
              Não
            </Action>
            <Action
              variant="danger"
              size="sm"
              onClick={() => cancel.mutate()}
              loading={cancel.isPending}
            >
              Sim, cancelar
            </Action>
          </>
        }
      >
        <Text size="sm">
          Os hotéis já concluídos ficam gravados; os que faltam podem ser retomados depois.
        </Text>
      </AppDialog>

      <AppDialog
        opened={askAccess !== null}
        onClose={() => setAskAccess(null)}
        title="Acesso ao Hunit para retomar"
        onCancel={() => setAskAccess(null)}
        actions={
          <Action
            variant="primary"
            size="sm"
            onClick={() => saveAndResume.mutate()}
            loading={saveAndResume.isPending}
            disabled={username.trim() === '' || password === ''}
          >
            Guardar e retomar
          </Action>
        }
      >
        <Stack gap={16}>
          {askAccess && (
            <Notice tone="amber" role="status">
              {askAccess}
            </Notice>
          )}
          <Field
            label="Usuário do Hunit"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            autoComplete="off"
          />
          <PasswordField
            label="Senha do Hunit"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="off"
          />
        </Stack>
      </AppDialog>
    </Stack>
  );
}
