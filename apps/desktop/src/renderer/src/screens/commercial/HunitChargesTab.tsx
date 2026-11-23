/**
 * Aba "Cobradas no Hunit" da área Comercial (specs/008, US3; tela 7.15; research R-07): as reservas
 * que o Comercial marcou como "Cobrada no Hunit" na planilha e a verificação de cada uma no Hunit.
 * A situação vem do servidor, derivada da última leitura da reserva no Hunit depois do relato
 * (execuções e "Verificar agora"); nada aqui decide se a cobrança existe.
 *
 * "Verificar agora" é só do operador e usa o acesso ao Hunit guardado, como o envio (sem ele, o
 * mesmo formulário de acesso da 005). O andamento e o pedido de token aparecem no card escuro e no
 * diálogo do token, como num envio.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { HunitChargeItem, ReservationKey } from '../../../../shared/ipc-types';
import { useHunitAccess } from '../../components/HunitAccess';
import { errorCode, messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime, formatMoney } from '../../presentation/format';
import { formatWhen } from '../../presentation/jobs';
import {
  CLASSIFICATION_LABELS,
  DISPATCH_STATUS_LABELS,
  HUNIT_CHARGE_STATUS_LABELS,
} from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import { useDispatch } from '../../state/dispatches';
import {
  Action,
  AppDialog,
  AppDrawer,
  EmptyState,
  ListCard,
  ListCell,
  ListHeader,
  ListRow,
  Notice,
  RunningJobCard,
  StatusBadge,
  type ListColumn,
} from '../../ui';
import { DispatchView, isDispatchFinished } from '../dispatch/DispatchView';
import { ReservationDetailLoader } from '../reservations/ReservationsScreen';

export const HUNIT_CHARGES_KEY = ['hunit-charges'] as const;

/**
 * Colunas da tela 7.15, com chaves próprias (larguras e quebras em `lists.module.css`): em conteúdo
 * estreito, quem marcou passa para a linha do hóspede e o valor, para a linha da reserva.
 */
const COLUMNS: readonly ListColumn[] = [
  { key: 'reservation', label: 'Reserva' },
  { key: 'guest', label: 'Hóspede e hotel' },
  { key: 'toCharge', label: 'Valor a cobrar' },
  { key: 'reportedBy', label: 'Marcada pelo Comercial' },
  { key: 'hunitCheck', label: 'Verificação no Hunit' },
];

/** Segunda linha da situação (tela 7.15; research R-13). */
export function hunitStatusDetail(item: HunitChargeItem): string {
  if (item.status === 'awaiting') return 'confere na próxima execução';
  if (item.status === 'confirmed') return 'foi para Concluídas';
  if (item.requiresCharge) return 'continua pendente';
  return `${CLASSIFICATION_LABELS[item.classification].name} no Hunit`;
}

export function HunitChargesTab() {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const { isOperator, state } = useConnection();
  const canWrite = isOperator && state?.status !== 'offline';
  const access = useHunitAccess();
  const [asking, setAsking] = useState(false);
  const [openedDispatch, setOpenedDispatch] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReservationKey | null>(null);

  const queue = useQuery({
    queryKey: HUNIT_CHARGES_KEY,
    queryFn: () => unwrap(hunit.commercial.hunitCharges()),
    refetchInterval: 15_000,
  });
  const running = useQuery({
    queryKey: ['dispatches', 'hunit_check', 'active'],
    queryFn: () =>
      unwrap(hunit.dispatches.list({ purpose: 'hunit_check', active: true, limit: 5 })),
    refetchInterval: 5_000,
  });

  // A verificação andou ou terminou: a fila muda (a situação é derivada no servidor).
  useEffect(
    () =>
      hunit.dispatches.onChanged(() => {
        void queryClient.invalidateQueries({ queryKey: HUNIT_CHARGES_KEY });
        void queryClient.invalidateQueries({ queryKey: ['dispatches', 'hunit_check'] });
      }),
    [hunit, queryClient],
  );

  const check = useMutation({
    mutationFn: async () => {
      await access.saveTyped();
      return unwrap(hunit.commercial.checkHunitCharges());
    },
    onSuccess: (dispatch) => {
      setAsking(false);
      setOpenedDispatch(dispatch.id);
      void queryClient.invalidateQueries({ queryKey: ['dispatches'] });
    },
    onError: (error) => {
      const code = errorCode(error);
      if (code === 'credentials_missing' || code === 'credentials_expired') {
        if (code === 'credentials_expired') access.expired();
        setAsking(true);
      }
    },
  });

  function startCheck() {
    if (!access.hasPassword) {
      setAsking(true);
      return;
    }
    check.mutate();
  }

  const items = queue.data?.items ?? [];
  const active = (running.data?.items ?? []).filter((item) => !isDispatchFinished(item));

  // Faixa do topo do card, como na tela 7.15: a explicação e "Verificar agora" (secundária: a
  // verificação também roda sozinha a cada execução).
  const toolbar = (
    <Group justify="space-between" align="center" gap={12} wrap="nowrap" w="100%">
      <Text size="sm" c="var(--hc-texto-padrao)">
        O Comercial marcou estas reservas como “Cobrada no Hunit” na planilha. O app confere no
        Hunit se a cobrança existe antes de dar a reserva como concluída.
      </Text>
      {canWrite && (
        <Action
          variant="secondary"
          size="xs"
          onClick={startCheck}
          loading={check.isPending}
          disabled={active.length > 0}
        >
          Verificar agora
        </Action>
      )}
    </Group>
  );

  return (
    <Stack gap={16}>
      {check.isError && !asking && (
        <Notice tone="red" title="Não foi possível verificar">
          {messageOf(check.error)} As situações da fila continuam como estavam.
        </Notice>
      )}
      {queue.isError && <Notice tone="red">{messageOf(queue.error)}</Notice>}

      {active.map((item) => {
        const processed = item.counts.total - item.counts.pending;
        return (
          <RunningJobCard
            key={item.id}
            badge={DISPATCH_STATUS_LABELS[item.status].name}
            title={`Verificação no Hunit iniciada em ${formatWhen(item.createdAt)}`}
            detail={`${item.requestedClient} · ${item.counts.total} reservas`}
            progressLabel={`${processed} de ${item.counts.total} reservas conferidas`}
            percent={item.counts.total > 0 ? (processed / item.counts.total) * 100 : 0}
            actionLabel="Ver verificação"
            onAction={() => setOpenedDispatch(item.id)}
          />
        );
      })}

      {queue.isSuccess && items.length === 0 ? (
        <EmptyState
          title="Nenhuma reserva cobrada no Hunit para conferir"
          description="Quando o Comercial escolher “Cobrada no Hunit” na planilha, a reserva aparece aqui até o app conferir a cobrança no Hunit."
        />
      ) : (
        items.length > 0 && (
          <ListCard
            label="Cobradas no Hunit"
            toolbar={toolbar}
            header={<ListHeader columns={COLUMNS} />}
          >
            {items.map((item) => {
              const badge = badgeOf(HUNIT_CHARGE_STATUS_LABELS[item.status]);
              const key = { hotelCode: item.hotelCode, reservationNumber: item.reservationNumber };
              return (
                <ListRow
                  key={`${item.hotelCode}/${item.reservationNumber}`}
                  columns={COLUMNS}
                  withArrow
                  onOpen={() => setOpened(key)}
                  openLabel={`Abrir a reserva ${item.reservationNumber}`}
                  cells={{
                    reservation: (
                      <ListCell
                        strong
                        primary={item.reservationNumber}
                        secondary={item.channel ?? '—'}
                        compact={formatMoney(item.amountToCharge)}
                      />
                    ),
                    guest: (
                      <ListCell
                        primary={item.guestName ?? 'Hóspede anonimizado'}
                        secondary={item.hotelName}
                        narrow={`marcada por ${item.chargedBy} · lido em ${formatDateTime(item.readAt)}`}
                      />
                    ),
                    toCharge: formatMoney(item.amountToCharge),
                    reportedBy: (
                      <ListCell
                        primary={item.chargedBy}
                        secondary={`lido em ${formatDateTime(item.readAt)}`}
                      />
                    ),
                    hunitCheck: (
                      <Stack gap={2} align="flex-start">
                        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                        <Text size="xs" c="dimmed">
                          {hunitStatusDetail(item)}
                        </Text>
                      </Stack>
                    ),
                  }}
                />
              );
            })}
          </ListCard>
        )
      )}

      <Text size="xs" c="dimmed">
        A verificação roda a cada execução. Se a cobrança não aparecer no Hunit, a reserva continua
        pendente e pode ser conferida de novo com “Verificar agora”.
      </Text>

      <AppDialog
        opened={asking}
        onClose={() => setAsking(false)}
        title="Verificar no Hunit"
        onCancel={() => setAsking(false)}
        actions={
          <Action
            variant="primary"
            size="sm"
            onClick={() => check.mutate()}
            loading={check.isPending}
          >
            Verificar agora
          </Action>
        }
      >
        <Stack gap={12}>
          <Text size="sm">
            A verificação acessa o Hunit com o usuário e a senha guardados nesta máquina e pede o
            token, como um envio.
          </Text>
          {access.form}
          {check.isError && <Notice tone="red">{messageOf(check.error)}</Notice>}
        </Stack>
      </AppDialog>

      <AppDrawer
        opened={openedDispatch !== null}
        onClose={() => setOpenedDispatch(null)}
        title="Verificação no Hunit"
        closeLabel="Fechar verificação"
      >
        {openedDispatch && <CheckDetail dispatchId={openedDispatch} />}
      </AppDrawer>
      <AppDrawer
        opened={opened !== null}
        onClose={() => setOpened(null)}
        title="Detalhe da reserva"
        closeLabel="Fechar detalhe"
      >
        {opened && <ReservationDetailLoader reservationKey={opened} />}
      </AppDrawer>
    </Stack>
  );
}

function CheckDetail({ dispatchId }: { dispatchId: string }) {
  const access = useHunitAccess();
  const dispatch = useDispatch(dispatchId);
  if (dispatch.isError) return <Notice tone="red">{messageOf(dispatch.error)}</Notice>;
  if (!dispatch.data) return <Text size="sm">Carregando a verificação…</Text>;
  return (
    <DispatchView
      dispatch={dispatch.data}
      hotelNames={new Map()}
      onResumed={() => undefined}
      onMissingAccess={() => access.expired()}
    />
  );
}
