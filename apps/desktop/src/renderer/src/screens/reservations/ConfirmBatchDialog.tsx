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
 */
import { Alert, Button, Group, Modal, ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
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
import type { SelectedReservation } from '../../state/selection';
import { ChargeHotel } from './CommercialSection';

export type BatchKind = 'reviews' | 'returns';

const TITLES: Record<BatchKind, string> = {
  reviews: 'Confirmar "Verificar"',
  returns: 'Confirmar retornos do Comercial',
};

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

  return (
    <Modal
      opened
      onClose={close}
      size={kind === 'returns' ? 'xl' : 'lg'}
      title={<Title order={3}>{TITLES[kind]}</Title>}
      closeOnClickOutside={false}
      transitionProps={{ duration: 0 }}
    >
      {result ? (
        <Stack gap="md" data-testid="batch-result">
          <Alert color={failed.length > 0 ? 'yellow' : 'green'} role="status">
            {confirmed} {confirmed === 1 ? 'reserva confirmada' : 'reservas confirmadas'}
            {ignored.length > 0 ? `; ${ignored.length} ficaram de fora` : ''}
            {failed.length > 0 ? `; ${failed.length} com erro (continuam selecionadas)` : ''}.
          </Alert>
          {ignored.length > 0 && (
            <ScrollArea.Autosize mah={240}>
              <Table verticalSpacing={2} aria-label="Reservas que ficaram de fora">
                <Table.Tbody>
                  {ignored.map((item) => (
                    <Table.Tr key={`${item.hotelCode}/${item.reservationNumber}`}>
                      <Table.Td>{hotel(item.hotelCode)}</Table.Td>
                      <Table.Td>{item.reservationNumber}</Table.Td>
                      <Table.Td>{item.reason ? BATCH_REASON_MESSAGES[item.reason] : ''}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
          <Group justify="flex-end">
            <Button onClick={close}>Fechar</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="md">
          <Text size="sm" data-testid="batch-summary">
            <b>{included.length}</b>{' '}
            {kind === 'reviews'
              ? included.length === 1
                ? 'reserva com o alerta "Verificar"'
                : 'reservas com o alerta "Verificar"'
              : included.length === 1
                ? 'retorno aguardando validação'
                : 'retornos aguardando validação'}
            {outside > 0 &&
              ` — ${outside} ${outside === 1 ? 'fica' : 'ficam'} de fora (${
                kind === 'reviews' ? 'sem o alerta' : 'sem retorno aguardando validação'
              })`}
            .
          </Text>

          {kind === 'reviews' && included.length > 0 && (
            <Table verticalSpacing={2} aria-label="Contagem por status do Hunit">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Status do Hunit</Table.Th>
                  <Table.Th>Reservas</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {countByClassification(included).map(({ code, count }) => (
                  <Table.Tr key={code}>
                    <Table.Td>{CLASSIFICATION_LABELS[code].name}</Table.Td>
                    <Table.Td>{count}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {kind === 'reviews' && (
            <Text size="sm" c="dimmed">
              Confirmar só tira o alerta: a tratativa continua registrada, e cada reserva ganha o
              registro no histórico.
            </Text>
          )}

          {kind === 'returns' && included.length > 0 && (
            <ScrollArea.Autosize mah={360}>
              <Table verticalSpacing={4} striped aria-label="Revisão dos retornos">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Reserva</Table.Th>
                    <Table.Th>Código de autorização</Table.Th>
                    <Table.Th>Hotel da cobrança</Table.Th>
                    <Table.Th>Valor cobrado</Table.Th>
                    <Table.Th>Valor a cobrar</Table.Th>
                    <Table.Th>Diferença</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {included.map((item) => {
                    const brief = item.currentReturn;
                    if (!brief) return null;
                    const differs = brief.difference !== null && Number(brief.difference) !== 0;
                    return (
                      <Table.Tr key={`${item.hotelCode}/${item.reservationNumber}`}>
                        <Table.Td>{item.reservationNumber}</Table.Td>
                        <Table.Td>{brief.authorizationCode}</Table.Td>
                        <Table.Td>
                          <ChargeHotel
                            chargeHotel={brief.chargeHotel}
                            hotelName={hotel(item.hotelCode)}
                          />
                        </Table.Td>
                        <Table.Td>{formatMoney(brief.chargedAmount)}</Table.Td>
                        <Table.Td>{formatMoney(item.totalAmount)}</Table.Td>
                        <Table.Td>
                          <Text
                            size="sm"
                            c={differs ? 'orange.8' : undefined}
                            fw={differs ? 700 : undefined}
                          >
                            <span style={{ whiteSpace: 'nowrap' }}>
                              {formatMoney(brief.difference)}
                            </span>
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
          {kind === 'returns' && (
            <Text size="sm" c="dimmed">
              Cada retorno confirmado vale como comprovante, e o valor cobrado informado pelo
              Comercial passa a ser o valor cobrado da reserva. Para recusar, abra a reserva.
            </Text>
          )}

          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close}>
              Cancelar
            </Button>
            <Button onClick={() => void confirm()} loading={busy} disabled={included.length === 0}>
              Confirmar {included.length}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
