/**
 * Acompanhamento e resultado de um envio ao Comercial (specs/005, US1, FR-005 a FR-008, FR-020):
 * estado, quantas foram verificadas e quantas faltam, a reserva em verificação, o resultado de
 * cada reserva, cancelar e retomar. Tudo vem do servidor; o pedido de token aparece no diálogo
 * comum (`TwoFactorDialog`), como nas execuções.
 *
 * Desde a 006 (T050; telas 7.2 e 7.4): "Envio ao Comercial" com o selo da situação ("Em andamento"
 * em lima) e a data e o cliente à direita; a caixa cinza com "N de M verificadas — faltam X", as
 * contagens, a barra de progresso e a reserva em verificação; "Cancelar envio" em vermelho suave ou
 * "Retomar as não verificadas (N)" como principal; e cada reserva numa linha com o hotel, o motivo
 * e o selo do resultado.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type {
  CommercialDispatch,
  CommercialDispatchIgnored,
  CommercialDispatchItem,
} from '../../../../shared/ipc-types';
import { useHunit } from '../../hunit';
import { formatDateTime } from '../../presentation/format';
import { dispatchTally } from '../../presentation/jobs';
import {
  DISPATCH_IGNORED_REASONS,
  DISPATCH_OUTCOME_LABELS,
  DISPATCH_STATUS_LABELS,
  END_REASON_MESSAGES,
  errorMessage,
} from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import {
  Action,
  Card,
  CardHeader,
  HotelRow,
  Notice,
  ProgressBar,
  RowList,
  StatusBadge,
} from '../../ui';

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
  const status = badgeOf(DISPATCH_STATUS_LABELS[dispatch.status]);

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

  const tally = dispatchTally(counts);

  return (
    <Stack gap={16} data-testid="dispatch-view">
      <CardHeader
        title={dispatch.purpose === 'hunit_check' ? 'Verificação no Hunit' : 'Envio ao Comercial'}
        aside={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
        actions={
          <Text size="xs" c="dimmed">
            {formatDateTime(dispatch.createdAt)} — {dispatch.requestedClient}
          </Text>
        }
      />

      <Card tone="subtle" padding={12} block="Andamento do envio">
        <Group justify="space-between" gap={8}>
          <Text size="sm" fw={700}>
            {processed} de {counts.total} verificadas
            {counts.pending > 0 ? ` — faltam ${counts.pending}` : ''}
          </Text>
          <Text size="xs" c="dimmed">
            {tally}
          </Text>
        </Group>
        <ProgressBar
          value={counts.total > 0 ? (processed / counts.total) * 100 : 0}
          label="Andamento do envio"
        />
        {dispatch.current && (
          <Text size="xs" c="dimmed">
            Verificando a reserva {dispatch.current.reservationNumber} (
            {hotel(dispatch.current.hotelCode)}) no Hunit…
          </Text>
        )}
        {dispatch.status === 'awaiting_2fa' && (
          <Notice tone="amber" compact role="status">
            Aguardando o token do Hunit.
          </Notice>
        )}
      </Card>

      {isDispatchFinished(dispatch) && dispatch.endReason && dispatch.status !== 'completed' && (
        <Notice tone={dispatch.status === 'failed' ? 'red' : 'amber'} role="status">
          {END_REASON_MESSAGES[dispatch.endReason]}
          {dispatch.endMessage ? ` ${dispatch.endMessage}` : ''}
        </Notice>
      )}
      {dispatch.resumedByDispatchId && (
        <Text size="sm" c="dimmed">
          Este envio já foi retomado.
        </Text>
      )}
      {error && <Notice tone="red">{error}</Notice>}

      {isOperator && (ACTIVE.has(dispatch.status) || canResume) && (
        <Group gap={8}>
          {ACTIVE.has(dispatch.status) && (
            <Action
              variant="danger-light"
              size="xs"
              loading={busy}
              disabled={!isOnline}
              onClick={() => void act('cancel')}
            >
              Cancelar envio
            </Action>
          )}
          {canResume && (
            <Action
              variant="primary"
              size="xs"
              loading={busy}
              disabled={!isOnline}
              onClick={() => void act('resume')}
            >
              Retomar as não verificadas ({counts.notVerified})
            </Action>
          )}
        </Group>
      )}

      <RowList label="Resultado de cada reserva">
        {dispatch.items.map((item) => {
          const outcome = badgeOf(DISPATCH_OUTCOME_LABELS[item.outcome]);
          const reason = reasonText(item);
          return (
            <HotelRow
              key={`${item.hotelCode}/${item.reservationNumber}`}
              title={item.reservationNumber}
              summary={`${hotel(item.hotelCode)}${reason ? ` · ${reason}` : ''}`}
              status={<StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>}
            />
          );
        })}
      </RowList>
    </Stack>
  );
}
