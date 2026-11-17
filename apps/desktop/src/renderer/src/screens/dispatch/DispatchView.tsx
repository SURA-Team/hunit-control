/**
 * Acompanhamento e resultado de um envio ao Comercial (specs/005, US1, FR-005 a FR-008, FR-020):
 * estado, quantas foram verificadas e quantas faltam, a reserva em verificação, o resultado de
 * cada reserva, cancelar e retomar. Tudo vem do servidor; o pedido de token aparece no diálogo
 * comum (`TwoFactorDialog`), como nas execuções.
 */
import { Alert, Button, Group, Paper, Progress, Stack, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import type {
  CommercialDispatch,
  CommercialDispatchIgnored,
  CommercialDispatchItem,
} from '../../../../shared/ipc-types';
import { StatusBadge } from '../../components/StatusBadge';
import { useHunit } from '../../hunit';
import { formatDateTime } from '../../presentation/format';
import {
  DISPATCH_IGNORED_REASONS,
  DISPATCH_OUTCOME_LABELS,
  DISPATCH_STATUS_LABELS,
  END_REASON_MESSAGES,
  errorMessage,
} from '../../presentation/labels';
import { useConnection } from '../../state/connection';

const FINAL = new Set<CommercialDispatch['status']>(['completed', 'failed', 'cancelled']);
const ACTIVE = new Set<CommercialDispatch['status']>(['queued', 'running', 'awaiting_2fa']);

export function isDispatchFinished(dispatch: Pick<CommercialDispatch, 'status'>): boolean {
  return FINAL.has(dispatch.status);
}

/** O motivo de cada reserva: o servidor manda texto ou, para as que ficaram fora, o código. */
function reasonText(item: CommercialDispatchItem): string {
  if (!item.reason) return '';
  if (item.outcome === 'ignored' && Object.hasOwn(DISPATCH_IGNORED_REASONS, item.reason)) {
    return DISPATCH_IGNORED_REASONS[item.reason as CommercialDispatchIgnored['reason']];
  }
  return item.reason;
}

export function DispatchView({
  dispatch,
  hotelNames,
  onResumed,
  onMissingAccess,
}: {
  dispatch: CommercialDispatch;
  hotelNames: ReadonlyMap<string, string>;
  /** Retomado: a tela passa a mostrar o envio novo. */
  onResumed: (dispatchId: string) => void;
  /** Retomar pediu o acesso ao Hunit e o cofre está vazio. */
  onMissingAccess?: () => void;
}) {
  const hunit = useHunit();
  const { isOperator, isOnline } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { counts } = dispatch;
  const processed = counts.total - counts.pending;
  const hotel = (code: string) => hotelNames.get(code) ?? code;
  const canResume =
    isOperator &&
    isDispatchFinished(dispatch) &&
    dispatch.resumedByDispatchId === null &&
    counts.notVerified > 0;

  async function act(action: 'cancel' | 'resume') {
    setBusy(true);
    setError(null);
    const result =
      action === 'cancel'
        ? await hunit.dispatches.cancel(dispatch.id)
        : await hunit.dispatches.resume(dispatch.id);
    setBusy(false);
    if (!result.ok) {
      if (
        result.error.code === 'credentials_missing' ||
        result.error.code === 'credentials_expired'
      ) {
        onMissingAccess?.();
      }
      setError(errorMessage(result.error));
      return;
    }
    if (action === 'resume') onResumed(result.data.id);
  }

  return (
    <Stack gap="sm" data-testid="dispatch-view">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={4}>Envio ao Comercial</Title>
          <StatusBadge label={DISPATCH_STATUS_LABELS[dispatch.status]} />
        </Group>
        <Text size="sm" c="dimmed">
          {formatDateTime(dispatch.createdAt)} — {dispatch.requestedClient}
        </Text>
      </Group>

      <Paper withBorder p="sm" radius="sm">
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm">
              <b>{processed}</b> de <b>{counts.total}</b> verificadas
              {counts.pending > 0 ? ` — faltam ${counts.pending}` : ''}
            </Text>
            <Text size="sm" c="dimmed">
              {counts.sent} enviada(s) · {counts.withdrawn} retirada(s) · {counts.notVerified} não
              verificada(s){counts.ignored > 0 ? ` · ${counts.ignored} fora do envio` : ''}
            </Text>
          </Group>
          <Progress
            value={counts.total > 0 ? (processed / counts.total) * 100 : 0}
            aria-label="Andamento do envio"
          />
          {dispatch.current && (
            <Text size="sm" c="dimmed">
              Verificando a reserva {dispatch.current.reservationNumber} (
              {hotel(dispatch.current.hotelCode)}) no Hunit…
            </Text>
          )}
          {dispatch.status === 'awaiting_2fa' && (
            <Text size="sm" c="orange.8">
              Aguardando o token do Hunit.
            </Text>
          )}
        </Stack>
      </Paper>

      {isDispatchFinished(dispatch) && dispatch.endReason && dispatch.status !== 'completed' && (
        <Alert color={dispatch.status === 'failed' ? 'red' : 'gray'} role="status">
          {END_REASON_MESSAGES[dispatch.endReason]}
          {dispatch.endMessage ? ` ${dispatch.endMessage}` : ''}
        </Alert>
      )}
      {dispatch.resumedByDispatchId && (
        <Text size="sm" c="dimmed">
          Este envio já foi retomado.
        </Text>
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}

      {isOperator && (
        <Group gap="xs">
          {ACTIVE.has(dispatch.status) && (
            <Button
              variant="default"
              color="red"
              size="xs"
              loading={busy}
              disabled={!isOnline}
              onClick={() => void act('cancel')}
            >
              Cancelar envio
            </Button>
          )}
          {canResume && (
            <Button
              size="xs"
              loading={busy}
              disabled={!isOnline}
              onClick={() => void act('resume')}
            >
              Retomar as não verificadas ({counts.notVerified})
            </Button>
          )}
        </Group>
      )}

      <Table verticalSpacing={4} striped aria-label="Resultado de cada reserva">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Hotel</Table.Th>
            <Table.Th>Reserva</Table.Th>
            <Table.Th>Resultado</Table.Th>
            <Table.Th>Motivo</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {dispatch.items.map((item) => (
            <Table.Tr key={`${item.hotelCode}/${item.reservationNumber}`}>
              <Table.Td>{hotel(item.hotelCode)}</Table.Td>
              <Table.Td>{item.reservationNumber}</Table.Td>
              <Table.Td>
                <StatusBadge label={DISPATCH_OUTCOME_LABELS[item.outcome]} size="xs" />
              </Table.Td>
              <Table.Td>
                <Text size="sm">{reasonText(item)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
