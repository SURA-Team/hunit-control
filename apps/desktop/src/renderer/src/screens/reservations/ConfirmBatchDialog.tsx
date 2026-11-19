/**
 * Confirmações em lote a partir da seleção (specs/005):
 *
 * - "Confirmar 'Verificar'" (FR-029): antes, quantas têm o alerta, quantas ficam de fora (sem
 *   alerta) e a contagem por status do Hunit. Cada confirmação segue a regra da individual (só tira
 *   o alerta e registra no histórico).
 * - "Confirmar retornos" (FR-016a): antes, a lista de revisão com o código de autorização, o hotel
 *   da cobrança ao lado do hotel da reserva, o valor cobrado, o valor a cobrar e a diferença. A
 *   recusa é sempre individual, no detalhe.
 *
 * O que a tela mostra antes é o que a seleção sabia ao marcar; quem decide é o servidor, que
 * devolve o desfecho de cada reserva. Depois do lote, só as que falharam continuam selecionadas.
 *
 * Desde a 006 (T053; telas 7.12 e 7.13): diálogo padrão (largo para os retornos, estreito para o
 * "Verificar"), o resumo com as quantidades em negrito, a revisão dos retornos e a contagem por
 * status do Hunit em listas dentro de uma caixa cinza (com os selos), "Cancelar" em texto e
 * "Confirmar N retornos" ou "Confirmar N" como principal; o desfecho com o mesmo resumo do anexo em
 * lote.
 */
import { Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  Classification,
  ConfirmationBatchResult,
  ReservationKey,
} from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatMoney } from '../../presentation/format';
import {
  BATCH_REASON_MESSAGES,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_ORDER,
} from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import type { SelectedReservation } from '../../state/selection';
import {
  Action,
  AppDialog,
  BatchSummary,
  InsetList,
  ListCell,
  ListHeader,
  ListRow,
  Notice,
  ReasonList,
  StatusBadge,
  SummaryLine,
  type ListColumn,
} from '../../ui';
import { AmountDifference, ChargeHotel } from './CommercialSection';

export type BatchKind = 'reviews' | 'returns';

const TITLES: Record<BatchKind, string> = {
  reviews: 'Confirmar "Verificar"',
  returns: 'Confirmar retornos do Comercial',
};

/** Colunas da revisão dos retornos (tela 7.12). */
const RETURN_COLUMNS: readonly ListColumn[] = [
  { key: 'reservation', label: 'Reserva' },
  { key: 'chargeHotel', label: 'Hotel da cobrança' },
  { key: 'amounts', label: 'Cobrado / a cobrar' },
  { key: 'difference', label: 'Diferença' },
];

/** Colunas da contagem por status do Hunit (tela 7.13). */
const COUNT_COLUMNS: readonly ListColumn[] = [
  { key: 'situation', label: 'Status do Hunit' },
  { key: 'count', label: 'Reservas' },
];

const keyOf = ({ hotelCode, reservationNumber }: ReservationKey): ReservationKey => ({
  hotelCode,
  reservationNumber,
});

function countByClassification(items: readonly SelectedReservation[]) {
  const counts = new Map<Classification, number>();
  for (const item of items)
    counts.set(item.classification, (counts.get(item.classification) ?? 0) + 1);
  return CLASSIFICATION_ORDER.filter((code) => counts.has(code)).map((code) => ({
    code,
    count: counts.get(code) ?? 0,
  }));
}

export function ConfirmBatchDialog({
  kind,
  items,
  hotelNames,
  onClose,
}: {
  kind: BatchKind;
  items: SelectedReservation[];
  hotelNames: ReadonlyMap<string, string>;
  /** `failed` = as que não mudaram por erro (continuam selecionadas); `null` = cancelado. */
  onClose: (result: { failed: ReservationKey[] } | null) => void;
}) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmationBatchResult | null>(null);

  const included =
    kind === 'reviews'
      ? items.filter((item) => item.needsReview)
      : items.filter((item) => item.currentReturn?.state === 'awaiting_validation');
  const outside = items.length - included.length;
  const hotel = (code: string) => hotelNames.get(code) ?? code;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      // Vão todas as selecionadas: o servidor confere cada uma e diz quais ficaram de fora.
      const reservations = items.map(keyOf);
      const done = await unwrap(
        kind === 'reviews'
          ? hunit.treatments.confirmReviews({ reservations })
          : hunit.commercial.confirmReturns({ reservations }),
      );
      setResult(done);
      for (const queryKey of [['reservations'], ['reservation'], ['treatment'], ['commercial']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      void queryClient.invalidateQueries({ queryKey: ['commercial-sheet'] });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (!result) return onClose(null);
    onClose({
      failed: result.items.filter((item) => item.outcome === 'failed').map(keyOf),
    });
  }

  const confirmed = result?.items.filter((item) => item.outcome === 'confirmed').length ?? 0;
  const ignored = result?.items.filter((item) => item.outcome === 'ignored') ?? [];
  const failed = result?.items.filter((item) => item.outcome === 'failed') ?? [];
  const confirmLabel =
    kind === 'returns'
      ? `Confirmar ${included.length} ${included.length === 1 ? 'retorno' : 'retornos'}`
      : `Confirmar ${included.length}`;

  return (
    <AppDialog
      opened
      size={kind === 'returns' ? 'lg' : 'sm'}
      onClose={close}
      title={TITLES[kind]}
      closeOnClickOutside={false}
      instant
      {...(result
        ? {
            actions: (
              <Action variant="primary" size="sm" onClick={close}>
                Fechar
              </Action>
            ),
          }
        : {
            onCancel: close,
            actions: (
              <Action
                variant="primary"
                size="sm"
                onClick={() => void confirm()}
                loading={busy}
                disabled={included.length === 0}
              >
                {confirmLabel}
              </Action>
            ),
          })}
    >
      {result ? (
        <BatchSummary data-testid="batch-result">
          <SummaryLine tone={failed.length > 0 ? 'amber' : 'green'}>
            <b>{confirmed}</b> {confirmed === 1 ? 'reserva confirmada' : 'reservas confirmadas'}
            {ignored.length > 0 ? `; ${ignored.length} ficaram de fora` : ''}
            {failed.length > 0 ? `; ${failed.length} com erro (continuam selecionadas)` : ''}.
          </SummaryLine>
          <ReasonList
            label="Reservas que ficaram de fora"
            items={ignored.map((item) => ({
              key: `${item.hotelCode}/${item.reservationNumber}`,
              title: `${item.reservationNumber} (${hotel(item.hotelCode)})`,
              reason: item.reason ? BATCH_REASON_MESSAGES[item.reason] : '—',
            }))}
          />
        </BatchSummary>
      ) : (
        <Stack gap={16}>
          <Text size="sm" data-testid="batch-summary">
            <b>
              {included.length}{' '}
              {kind === 'reviews'
                ? included.length === 1
                  ? 'reserva'
                  : 'reservas'
                : included.length === 1
                  ? 'retorno'
                  : 'retornos'}
            </b>{' '}
            {kind === 'reviews' ? 'com o alerta "Verificar"' : 'aguardando validação'}
            {outside > 0 && (
              <>
                {' '}
                — <b>{outside}</b> {outside === 1 ? 'fica' : 'ficam'} de fora (
                {kind === 'reviews' ? 'sem o alerta' : 'sem retorno aguardando validação'})
              </>
            )}
            .
          </Text>

          {kind === 'reviews' && included.length > 0 && (
            <InsetList
              label="Contagem por status do Hunit"
              header={<ListHeader columns={COUNT_COLUMNS} withArrow={false} />}
            >
              {countByClassification(included).map(({ code, count }) => {
                const badge = badgeOf(CLASSIFICATION_LABELS[code]);
                return (
                  <ListRow
                    key={code}
                    columns={COUNT_COLUMNS}
                    withArrow={false}
                    cells={{
                      situation: <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>,
                      count: <ListCell strong primary={count} />,
                    }}
                  />
                );
              })}
            </InsetList>
          )}
          {kind === 'reviews' && (
            <Text size="xs" c="dimmed">
              Confirmar só tira o alerta: a tratativa continua registrada, e cada reserva ganha o
              registro no histórico.
            </Text>
          )}

          {kind === 'returns' && included.length > 0 && (
            <InsetList label="Revisão dos retornos">
              {included.map((item) => {
                const brief = item.currentReturn;
                if (!brief) return null;
                return (
                  <ListRow
                    key={`${item.hotelCode}/${item.reservationNumber}`}
                    columns={RETURN_COLUMNS}
                    withArrow={false}
                    cells={{
                      reservation: (
                        <ListCell
                          strong
                          primary={item.reservationNumber}
                          secondary={brief.authorizationCode}
                        />
                      ),
                      chargeHotel: (
                        <ChargeHotel
                          chargeHotel={brief.chargeHotel}
                          hotelName={hotel(item.hotelCode)}
                        />
                      ),
                      amounts: (
                        <ListCell
                          primary={`${formatMoney(brief.chargedAmount)} cobrado`}
                          secondary={`${formatMoney(item.totalAmount)} a cobrar`}
                          compact={
                            <>
                              diferença <AmountDifference value={brief.difference} />
                            </>
                          }
                        />
                      ),
                      difference: <AmountDifference value={brief.difference} />,
                    }}
                  />
                );
              })}
            </InsetList>
          )}
          {kind === 'returns' && (
            <Text size="xs" c="dimmed">
              Cada retorno confirmado vale como comprovante, e o valor cobrado informado pelo
              Comercial passa a ser o valor cobrado da reserva. Para recusar, abra a reserva.
            </Text>
          )}

          {error && <Notice tone="red">{error}</Notice>}
        </Stack>
      )}
    </AppDialog>
  );
}
