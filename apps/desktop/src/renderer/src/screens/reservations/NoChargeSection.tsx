/**
 * "Cancelada sem cobrança" no detalhe da reserva (specs/008, US4, FR-018 a FR-023; telas 7.17 e
 * 7.18, research R-08).
 *
 * - Reserva que aceita a ação (exige cobrança, sem comprovante, sem retorno aguardando validação):
 *   o card "Reserva cancelada sem nada a cobrar?" com "Marcar como cancelada sem cobrança", só para
 *   o perfil operador (FR-018). Com retorno do Comercial aguardando validação, o botão fica
 *   desabilitado com o motivo (FR-022).
 * - O diálogo pequeno de confirmação mostra o valor atual → R$ 0,00 e para onde a reserva vai, com a
 *   observação opcional (até 500 caracteres); "Voltar" e fechar não gravam nada (FR-019). A situação
 *   que a pessoa viu vai junto: se mudou, o servidor recusa e nada é marcado.
 * - Reserva marcada: o card "Cancelada sem cobrança" com o valor (e o anterior), quem marcou e
 *   quando, onde está, a observação, o aviso quando o Hunit mostra a reserva como cobrada (FR-023)
 *   e "Desfazer" (perigosa suave) com o diálogo pequeno padrão da 006 (FR-021). O perfil consulta
 *   vê o card sem a ação.
 *
 * Quem aceita a ação é decidido pelo servidor; aqui o card só aparece quando a reserva, como veio,
 * deve aceitar. Uma recusa (409) mostra a mensagem do motivo e a tela é atualizada.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { Reservation, ReservationKey, Result } from '../../../../shared/ipc-types';
import { useHunit } from '../../hunit';
import { formatDateTime, formatMoney } from '../../presentation/format';
import { errorMessage } from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import {
  Action,
  AppDialog,
  AttentionIcon,
  Card,
  CardHeader,
  DataField,
  DataGrid,
  Notice,
  TextAreaField,
  UndoIcon,
} from '../../ui';
import { commercialKey } from './CommercialSection';

/** Tamanho máximo da observação (FR-019, data-model §3.2). */
export const NO_CHARGE_NOTE_MAX = 500;

/** Motivo de o botão ficar desabilitado para o operador (FR-022), ou null. */
function blockedReason(reservation: Reservation): string | null {
  return reservation.treatment.detailedSituation === 'return_pending'
    ? 'Há retorno do Comercial aguardando validação: confirme ou recuse o retorno antes.'
    : null;
}

/** A reserva, como veio, aceita a marcação (ou só a aceitaria depois de validar o retorno). */
function offersMark(reservation: Reservation): boolean {
  return (
    reservation.noCharge === null &&
    reservation.treatment.acceptsDocuments &&
    reservation.treatment.status !== 'charged'
  );
}

function guestOf(reservation: Reservation): string {
  return reservation.anonymized || !reservation.guestName
    ? 'nome anonimizado'
    : reservation.guestName;
}

export function NoChargeSection({ reservation }: { reservation: Reservation }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const { isOperator, state } = useConnection();
  const key: ReservationKey = {
    hotelCode: reservation.hotelCode,
    reservationNumber: reservation.reservationNumber,
  };
  const [marking, setMarking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const canWrite = isOperator && state?.status !== 'offline';
  const mark = reservation.noCharge;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['treatment'] });
    void queryClient.invalidateQueries({ queryKey: commercialKey(key) });
    void queryClient.invalidateQueries({ queryKey: ['commercial-sheet'] });
  }

  async function run(action: () => Promise<Result<Reservation>>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage(
        result.ok
          ? { tone: 'green', text: success }
          : { tone: 'red', text: errorMessage(result.error) },
      );
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function confirmMark() {
    const text = note.trim();
    setMarking(false);
    await run(
      () =>
        hunit.reservations.markNoCharge({
          key,
          expectedSituation: reservation.treatment.detailedSituation,
          ...(text !== '' && { note: text }),
        }),
      'Reserva marcada como cancelada sem cobrança.',
    );
    setNote('');
  }

  async function confirmUndo(markId: string) {
    setUndoing(false);
    await run(
      () => hunit.reservations.undoNoCharge({ key, markId }),
      'Marcação desfeita: a reserva voltou à situação do Hunit.',
    );
  }

  const feedback = message && (
    <Notice tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
      {message.text}
    </Notice>
  );

  // Marcada (tela 7.18).
  if (mark) {
    return (
      <Card block="Cancelada sem cobrança" data-testid="no-charge-section">
        <CardHeader
          title="Cancelada sem cobrança"
          actions={
            canWrite && (
              <Action
                size="xs"
                variant="danger-light"
                leftSection={<UndoIcon size={14} />}
                disabled={busy}
                onClick={() => {
                  setMessage(null);
                  setUndoing(true);
                }}
              >
                Desfazer
              </Action>
            )
          }
        />
        {mark.hunitShowsCharge && (
          <Notice
            tone="amber"
            role="none"
            title="O Hunit mostra cobrança"
            icon={<AttentionIcon size={14} />}
            data-testid="no-charge-hunit-charged"
          >
            Depois da marcação, o Hunit passou a mostrar esta reserva como cobrada. A marcação
            continua; confira a reserva{canWrite ? ' e desfaça a marcação se for o caso' : ''}.
          </Notice>
        )}
        {feedback}
        <DataGrid label="Marcação “Cancelada sem cobrança”">
          <DataField label="Valor a cobrar">
            {formatMoney(reservation.amountToCharge)}
            <Text size="xs" c="dimmed">
              antes {formatMoney(mark.previousAmount)}
            </Text>
          </DataField>
          <DataField label="Marcada em">
            {formatDateTime(mark.markedAt)}
            <Text size="xs" c="dimmed">
              por {mark.markedBy}
            </Text>
          </DataField>
          <DataField label="Onde está">
            Concluídas
            <Text size="xs" c="dimmed">
              não vai mais ao Comercial
            </Text>
          </DataField>
        </DataGrid>
        {mark.note && (
          <Text size="sm" c="dimmed" data-testid="no-charge-note">
            Observação: {mark.note}
          </Text>
        )}

        {/* Destrutiva confirmada no padrão da 006: "Desfazer" em vermelho cheio; "Manter" cancela. */}
        <AppDialog
          opened={undoing}
          onClose={() => setUndoing(false)}
          title="Desfazer a marcação?"
          onCancel={() => setUndoing(false)}
          cancelLabel="Manter"
          actions={
            <Action variant="danger" size="sm" onClick={() => void confirmUndo(mark.id)}>
              Desfazer
            </Action>
          }
        >
          <Text size="sm">
            A reserva volta ao valor a cobrar de {formatMoney(mark.previousAmount)} e à situação que
            o Hunit informa. Se ela já foi enviada ao Comercial e ainda exige cobrança, a linha
            volta para “A cobrar”.
          </Text>
        </AppDialog>
      </Card>
    );
  }

  // Sem a ação: só a mensagem da última tentativa (ex.: recusada porque a situação mudou).
  if (!isOperator || !offersMark(reservation)) {
    return feedback ? <Stack data-testid="no-charge-section">{feedback}</Stack> : null;
  }

  const blocked = blockedReason(reservation);

  // Aceita a ação (tela 7.17).
  return (
    <Card block="Reserva cancelada sem nada a cobrar?" data-testid="no-charge-section">
      <CardHeader title="Reserva cancelada sem nada a cobrar?" />
      <Text size="sm" c="dimmed">
        Se o hóspede cancelou e não há valor a cobrar, marque a reserva como cancelada sem cobrança.
        O valor a cobrar fica R$ 0,00 e ela vai para “Concluídas”. Dá para desfazer depois.
      </Text>
      {blocked && (
        <Text size="sm" c="dimmed" data-testid="no-charge-blocked">
          {blocked}
        </Text>
      )}
      {feedback}
      <Group>
        <Action
          size="xs"
          variant="danger-light"
          disabled={!canWrite || busy || blocked !== null}
          onClick={() => {
            setMessage(null);
            setMarking(true);
          }}
        >
          Marcar como cancelada sem cobrança
        </Action>
      </Group>

      {/* Fechar ou "Voltar" não grava nada (FR-019). */}
      <AppDialog
        opened={marking}
        onClose={() => setMarking(false)}
        title="Marcar como cancelada sem cobrança?"
        onCancel={() => setMarking(false)}
        cancelLabel="Voltar"
        actions={
          <Action variant="danger" size="sm" onClick={() => void confirmMark()}>
            Marcar como cancelada
          </Action>
        }
        data-testid="no-charge-dialog"
      >
        <Stack gap={16}>
          <Notice tone="amber" role="none">
            Use só quando a reserva foi cancelada e não há nada a cobrar. A reserva sai das
            pendências e não é mais enviada ao Comercial.
          </Notice>
          <Card tone="subtle" padding={16}>
            <SummaryRow label="Reserva">
              {reservation.reservationNumber} · {guestOf(reservation)}
            </SummaryRow>
            <SummaryRow label="Valor a cobrar">
              {formatMoney(reservation.amountToCharge)} → R$ 0,00
            </SummaryRow>
            <SummaryRow label="Vai para">
              Concluídas, com a situação “Cancelada sem cobrança”
            </SummaryRow>
          </Card>
          <TextAreaField
            label="Observação (opcional)"
            placeholder="Ex.: hóspede cancelou antes do check-in"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            maxLength={NO_CHARGE_NOTE_MAX}
            rows={3}
            counter={`${note.length}/${NO_CHARGE_NOTE_MAX}`}
            data-autofocus
          />
        </Stack>
      </AppDialog>
    </Card>
  );
}

/** Linha "Rótulo  valor" da caixa cinza do diálogo (tela 7.17). */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap={16} wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" flex="0 0 110px">
        {label}
      </Text>
      <Text size="sm" fw={600}>
        {children}
      </Text>
    </Group>
  );
}
