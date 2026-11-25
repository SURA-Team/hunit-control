/**
 * "Enviar ao Comercial" (specs/005, US1, FR-001 a FR-008): a partir da seleção, o servidor diz quem
 * aceita o envio (sem gravar nada e sem acessar o Hunit); o operador confere o resumo — aceitas,
 * as que ficam de fora com o motivo e o total dos valores —, informa o acesso ao Hunit (o mesmo das
 * execuções) e envia. Depois, a tela acompanha o envio até o fim; o token é pedido pelo diálogo
 * comum. Ao terminar, a seleção fica só com as reservas não verificadas, para tentar de novo.
 *
 * Desde a 006 (T050; telas 7.1 a 7.4): a conferência num diálogo estreito (520 px, como a tela
 * 7.1), com o resumo, a explicação, as que ficam de fora com o motivo (a caixa cinza do anexo em
 * lote), o acesso ao Hunit numa caixa cinza, "Cancelar" em texto e "Enviar N ao Comercial" como
 * principal; o andamento e o resultado num diálogo largo (780 px, telas 7.2 e 7.4), que fecha pelo X.
 * O aviso de que fechar não interrompe o envio não está no design: fica, pequeno, enquanto ele roda.
 */
import { Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { CommercialDispatch, ReservationKey } from '../../../../shared/ipc-types';
import { useHunitAccess } from '../../components/HunitAccess';
import { errorCode, messageOf, unwrap, useHunit } from '../../hunit';
import { formatMoney } from '../../presentation/format';
import { DISPATCH_IGNORED_REASONS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { useDispatch } from '../../state/dispatches';
import { Action, AppDialog, BatchSummary, Notice, ReasonList, SummaryLine } from '../../ui';
import { DispatchView, isDispatchFinished } from './DispatchView';

export function DispatchDialog({
  reservations,
  hotelNames,
  onClose,
}: {
  reservations: ReservationKey[];
  hotelNames: ReadonlyMap<string, string>;
  /** `notVerified` = as reservas que o envio não conseguiu verificar (ficam selecionadas). */
  onClose: (result: { notVerified: ReservationKey[] } | null) => void;
}) {
  const hunit = useHunit();
  const { isOnline } = useConnection();
  const access = useHunitAccess();
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useDispatch(dispatchId);
  const finishedRef = useRef<CommercialDispatch | null>(null);

  const check = useQuery({
    queryKey: ['dispatch-check', reservations],
    queryFn: () => unwrap(hunit.dispatches.check({ reservations })),
    gcTime: 0,
  });

  // O envio terminou com o diálogo aberto: guarda o resultado para a seleção.
  useEffect(() => {
    if (dispatch.data && isDispatchFinished(dispatch.data)) finishedRef.current = dispatch.data;
  }, [dispatch.data]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await access.saveTyped();
      const started = await unwrap(hunit.dispatches.start({ reservations }));
      setDispatchId(started.id);
    } catch (caught) {
      const code = errorCode(caught);
      if (code === 'credentials_expired') access.expired();
      setError(messageOf(caught));
    } finally {
      setStarting(false);
    }
  }

  function close() {
    const finished = finishedRef.current;
    if (!finished) return onClose(null);
    onClose({
      notVerified: finished.items
        .filter((item) => item.outcome === 'not_verified')
        .map(({ hotelCode, reservationNumber }) => ({ hotelCode, reservationNumber })),
    });
  }

  const summary = check.data;
  const resend = summary?.eligible.filter((item) => item.resend).length ?? 0;
  const hotel = (code: string) => hotelNames.get(code) ?? code;
  const conferring = dispatchId === null;

  return (
    <AppDialog
      opened
      size={conferring ? 'sm' : 'lg'}
      onClose={close}
      title="Enviar ao Comercial"
      closeOnClickOutside={false}
      instant
      {...(conferring && {
        onCancel: close,
        actions: (
          <Action
            variant="primary"
            size="sm"
            onClick={() => void start()}
            loading={starting}
            disabled={!isOnline || !summary || summary.eligible.length === 0}
          >
            Enviar {summary ? summary.eligible.length : ''} ao Comercial
          </Action>
        ),
      })}
    >
      {conferring ? (
        <Stack gap={16}>
          {check.isPending && <Text size="sm">Conferindo as reservas…</Text>}
          {check.isError && <Notice tone="red">{messageOf(check.error)}</Notice>}
          {summary && (
            <>
              <Text size="sm" data-testid="dispatch-summary">
                <b>{summary.eligible.length}</b>{' '}
                {summary.eligible.length === 1 ? 'reserva aceita' : 'reservas aceitas'} — total de{' '}
                <b>{formatMoney(summary.totalAmount)}</b>
                {resend > 0 && ` (${resend} já na planilha: a linha é atualizada)`}.
              </Text>
              <Text size="sm" c="dimmed">
                Antes de ir para a planilha, cada reserva é verificada no Hunit: as que não exigirem
                mais cobrança são retiradas, e as que não puderem ser verificadas não são enviadas.
              </Text>
              {summary.ignored.length > 0 && (
                <BatchSummary>
                  <SummaryLine tone="amber">
                    <b>{summary.ignored.length}</b>{' '}
                    {summary.ignored.length === 1 ? 'fica de fora' : 'ficam de fora'}
                  </SummaryLine>
                  <ReasonList
                    label="Reservas que ficam de fora"
                    items={summary.ignored.map((item) => ({
                      key: `${item.hotelCode}/${item.reservationNumber}`,
                      title: `${item.reservationNumber} (${hotel(item.hotelCode)})`,
                      reason: DISPATCH_IGNORED_REASONS[item.reason],
                    }))}
                  />
                </BatchSummary>
              )}
              {summary.eligible.length > 0 && access.form}
            </>
          )}
          {error && <Notice tone="red">{error}</Notice>}
        </Stack>
      ) : (
        <Stack gap={16}>
          {dispatch.data ? (
            <DispatchView
              dispatch={dispatch.data}
              hotelNames={hotelNames}
              onResumed={(id) => {
                finishedRef.current = null;
                setDispatchId(id);
              }}
              onMissingAccess={() => access.expired()}
            />
          ) : (
            <Text size="sm">Carregando o envio…</Text>
          )}
          {dispatch.data?.status === 'failed' && access.form}
          {dispatch.data && !isDispatchFinished(dispatch.data) && (
            <Text size="xs" c="dimmed">
              Fechar não interrompe o envio: ele continua no servidor, e o pedido de token aparece
              nesta máquina.
            </Text>
          )}
        </Stack>
      )}
    </AppDialog>
  );
}
