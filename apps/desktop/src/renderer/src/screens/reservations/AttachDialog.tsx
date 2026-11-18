/**
 * Anexar a tratativa ou o comprovante a uma reserva ou a várias (specs/003, US1 a US3, FR-006,
 * FR-018): escolher o arquivo → pré-visualização → conferência do servidor (quem aceita, quem
 * fica de fora, total) → confirmação → desfecho de cada reserva.
 *
 * O arquivo fica na memória do processo principal; a interface só tem a pré-visualização e um
 * id. Cancelar antes de confirmar descarta o arquivo e não envia nada. Quem decide o que cada
 * reserva aceita é o servidor — aqui só se mostra o que ele respondeu.
 *
 * Desde a 006 (T039, FR-011; telas 4.6 e 4.8): diálogo padrão largo, "Cancelar" só texto,
 * "Escolher outro arquivo" e "Tentar de novo" em contorno e uma principal ("Confirmar"; no
 * desfecho, "Tentar de novo" quando o envio foi interrompido, senão "Fechar"). O resumo com os
 * ícones de aceitas e ignoradas vem com a T042.
 */
import { Alert, List, Stack, Table, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppError,
  PickedFile,
  ReservationKey,
  ReservationOutcome,
  TreatmentApplyResult,
  TreatmentCheck,
  TreatmentDocument,
  TreatmentDocumentKind,
} from '../../../../shared/ipc-types';
import { DocumentPreview } from '../../components/DocumentPreview';
import { useHunit } from '../../hunit';
import { formatDateTime, formatMoney } from '../../presentation/format';
import {
  errorMessage,
  OUTCOME_REASON_MESSAGES,
  TREATMENT_KIND_NAMES,
} from '../../presentation/labels';
import { Action, AppDialog } from '../../ui';

type Phase = 'picking' | 'checking' | 'confirm' | 'applying' | 'result';

export interface AttachDialogProps {
  kind: TreatmentDocumentKind;
  /** Uma reserva (anexar no detalhe) ou várias (lote da seleção). */
  reservations: ReservationKey[];
  /** Documento atual desse tipo, quando é uma reserva só: é o que será substituído. */
  current?: TreatmentDocument | null | undefined;
  /** `null` = nada foi registrado (cancelado ou recusado). */
  onClose: (result: TreatmentApplyResult | null) => void;
}

const KIND_ARTICLE: Record<TreatmentDocumentKind, string> = {
  request: 'a tratativa',
  proof: 'o comprovante',
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function reservationLabel(outcome: ReservationKey): string {
  return `${outcome.reservationNumber} (hotel ${outcome.hotelCode})`;
}

/** Reservas que não ficaram com o documento, com o motivo de cada uma. */
function LeftOut({ items }: { items: ReservationOutcome[] }) {
  if (items.length === 0) return null;
  return (
    <Table withTableBorder verticalSpacing={4} aria-label="Reservas que ficam de fora">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Reserva</Table.Th>
          <Table.Th>Motivo</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map((item) => (
          <Table.Tr key={`${item.hotelCode}/${item.reservationNumber}`}>
            <Table.Td>{reservationLabel(item)}</Table.Td>
            <Table.Td>
              {item.outcome === 'failed'
                ? 'Erro ao registrar. A reserva ficou como estava.'
                : item.reason
                  ? OUTCOME_REASON_MESSAGES[item.reason]
                  : '—'}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function AttachDialog({
  kind,
  reservations: selectedReservations,
  current,
  onClose,
}: AttachDialogProps) {
  const hunit = useHunit();
  // Só a chave de cada reserva vai para a ponte (a seleção guarda também dados de exibição).
  const reservations = useMemo<ReservationKey[]>(
    () =>
      selectedReservations.map(({ hotelCode, reservationNumber }) => ({
        hotelCode,
        reservationNumber,
      })),
    [selectedReservations],
  );
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('picking');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [check, setCheck] = useState<TreatmentCheck | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  /** Desfechos já recebidos (somados entre as tentativas). */
  const [items, setItems] = useState<ReservationOutcome[]>([]);
  /** Reservas que ainda faltam enviar depois de uma interrupção por conexão. */
  const [pending, setPending] = useState<ReservationKey[] | null>(null);
  const started = useRef(false);

  const single = reservations.length === 1;
  const kindName = TREATMENT_KIND_NAMES[kind].toLowerCase();

  const runCheck = useCallback(async () => {
    setPhase('checking');
    setError(null);
    const result = await hunit.treatments.check({ kind, reservations });
    if (result.ok) {
      setCheck(result.data);
    } else {
      setCheck(null);
      setError(result.error);
    }
    setPhase('confirm');
  }, [hunit, kind, reservations]);

  const pick = useCallback(async () => {
    setPhase('picking');
    setError(null);
    setFile(null);
    setCheck(null);
    const picked = await hunit.treatments.pickFile({ kind });
    if (!picked.ok) {
      setError(picked.error);
      setPhase('confirm');
      return;
    }
    if (picked.data === null) {
      onClose(null);
      return;
    }
    setFile(picked.data);
    await runCheck();
  }, [hunit, kind, onClose, runCheck]);

  // Ao abrir, vai direto para a escolha do arquivo.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void pick();
  }, [pick]);

  async function discard() {
    if (file) await hunit.treatments.discardFile(file.selectionId);
  }

  async function cancel() {
    await discard();
    onClose(null);
  }

  async function pickAnother() {
    await discard();
    await pick();
  }

  async function apply(keys: ReservationKey[]) {
    if (!file) return;
    setPhase('applying');
    setError(null);
    const result = await hunit.treatments.apply({
      selectionId: file.selectionId,
      kind,
      reservations: keys,
    });
    if (!result.ok) {
      // O servidor recusou o arquivo ou o pedido: nada foi registrado nesta tentativa.
      setError(result.error);
      setFile(null);
      setPhase('result');
      return;
    }
    setItems((previous) => [...previous, ...result.data.items]);
    setPending(result.data.retryable ? result.data.failedKeys : null);
    setError(result.data.error ?? null);
    setPhase('result');
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
    void queryClient.invalidateQueries({ queryKey: ['treatment'] });
  }

  async function finish() {
    const failed = items.filter((item) => item.outcome === 'failed');
    // Sair com o envio interrompido: o arquivo ainda está na memória do principal.
    if (pending !== null) await discard();
    if (items.length === 0 && pending === null) {
      onClose(null);
      return;
    }
    onClose({
      items,
      failedKeys: [...failed, ...(pending ?? [])].map(({ hotelCode, reservationNumber }) => ({
        hotelCode,
        reservationNumber,
      })),
      retryable: false,
    });
  }

  const busy = phase === 'picking' || phase === 'checking' || phase === 'applying';
  const accepted = check?.acceptedCount ?? 0;
  const leftOutInCheck = check?.items.filter((item) => item.outcome === 'ignored') ?? [];
  const registered = items.filter(
    (item) => item.outcome === 'registered' || item.outcome === 'replaced',
  );
  const leftOutInResult = items.filter(
    (item) => item.outcome === 'ignored' || item.outcome === 'failed',
  );

  const retrying = phase === 'result' && pending !== null && pending.length > 0;
  const actions =
    phase === 'confirm' ? (
      <>
        <Action variant="secondary" size="sm" onClick={() => void pickAnother()}>
          Escolher outro arquivo
        </Action>
        {file && !check && (
          <Action variant="secondary" size="sm" onClick={() => void runCheck()}>
            Tentar de novo
          </Action>
        )}
        <Action
          variant="primary"
          size="sm"
          onClick={() => void apply(reservations)}
          disabled={!file || accepted === 0}
        >
          Confirmar
        </Action>
      </>
    ) : phase === 'result' ? (
      <>
        <Action
          variant={retrying ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => void finish()}
        >
          Fechar
        </Action>
        {retrying && (
          <Action variant="primary" size="sm" onClick={() => void apply(pending)}>
            Tentar de novo
          </Action>
        )}
      </>
    ) : undefined;

  return (
    <AppDialog
      opened
      size="lg"
      onClose={() => void (phase === 'result' ? finish() : cancel())}
      title={`Anexar ${kindName}${single ? '' : ` a ${reservations.length} reservas`}`}
      closeOnClickOutside={false}
      closeOnEscape={!busy}
      withCloseButton={!busy}
      instant
      actions={actions}
      {...(phase === 'confirm' && { onCancel: () => void cancel() })}
    >
      <Stack gap="md">
        {phase === 'picking' && <Text c="dimmed">Escolha o arquivo…</Text>}

        {file && phase !== 'result' && <DocumentPreview key={file.selectionId} file={file} />}

        {phase === 'checking' && <Text c="dimmed">Conferindo as reservas no servidor…</Text>}

        {phase === 'confirm' && error && (
          <Alert color="red" role="alert">
            {errorMessage(error)}
          </Alert>
        )}

        {phase === 'confirm' && check && (
          <Stack gap="xs" data-testid="attach-summary">
            {single ? (
              accepted === 1 ? (
                check.replacingCount === 1 ? (
                  <Alert color="yellow" title={`Substitui ${KIND_ARTICLE[kind]} atual`}>
                    {current
                      ? `${current.fileName ?? 'arquivo já apagado'}, anexado por ${current.attachedBy} em ${formatDateTime(current.attachedAt)}. `
                      : ''}
                    O documento substituído fica guardado por 30 dias e pode ser revertido.
                  </Alert>
                ) : (
                  <Text size="sm">
                    Confira o arquivo acima. Ao confirmar, ele será registrado como{' '}
                    {KIND_ARTICLE[kind]} desta reserva.
                  </Text>
                )
              ) : (
                <Alert color="red" role="alert">
                  {leftOutInCheck[0]?.reason
                    ? OUTCOME_REASON_MESSAGES[leftOutInCheck[0].reason]
                    : 'Esta reserva não aceita o documento.'}
                </Alert>
              )
            ) : (
              <>
                <List size="sm" spacing={2}>
                  <List.Item>
                    <b>{accepted}</b> {plural(accepted, 'reserva aceita', 'reservas aceitam')} o
                    documento — total de <b>{formatMoney(check.acceptedTotalAmount)}</b>
                  </List.Item>
                  {check.replacingCount > 0 && (
                    <List.Item>
                      <b>{check.replacingCount}</b>{' '}
                      {plural(
                        check.replacingCount,
                        'já tem um documento desse tipo, que será substituído',
                        'já têm um documento desse tipo, que será substituído',
                      )}
                    </List.Item>
                  )}
                  <List.Item>
                    <b>{check.ignoredCount}</b>{' '}
                    {plural(check.ignoredCount, 'será ignorada', 'serão ignoradas')}
                  </List.Item>
                </List>
                <LeftOut items={leftOutInCheck} />
              </>
            )}
          </Stack>
        )}

        {phase === 'applying' && <Text c="dimmed">Enviando o arquivo e registrando…</Text>}

        {phase === 'result' && (
          <Stack gap="xs" data-testid="attach-result">
            {registered.length > 0 && (
              <Alert color="green" role="status">
                {single
                  ? `${TREATMENT_KIND_NAMES[kind]} registrad${kind === 'proof' ? 'o' : 'a'}.`
                  : `Documento registrado em ${registered.length} ${plural(registered.length, 'reserva', 'reservas')}.`}
              </Alert>
            )}
            {error && (
              <Alert color="red" role="alert">
                {errorMessage(error)}
                {pending !== null &&
                  ` ${pending.length} ${plural(pending.length, 'reserva ficou', 'reservas ficaram')} sem o documento. O arquivo continua pronto para enviar.`}
              </Alert>
            )}
            {leftOutInResult.length > 0 && (
              <>
                <Text size="sm">
                  {leftOutInResult.length}{' '}
                  {plural(leftOutInResult.length, 'reserva ficou', 'reservas ficaram')} de fora:
                </Text>
                <LeftOut items={leftOutInResult} />
              </>
            )}
          </Stack>
        )}
      </Stack>
    </AppDialog>
  );
}
