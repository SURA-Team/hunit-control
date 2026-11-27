/**
 * As decisões do Financeiro sobre a situação livre do Comercial (specs/009, US1; FR-006 a FR-009;
 * research R-04 e R-08): "Confirmar como cobrada", "Confirmar como cancelada sem cobrança" e
 * "Recusar", uma reserva por vez.
 *
 * Até o desenho da UX chegar (research R-08), os diálogos seguem os da 008: o pequeno, com o resumo
 * e o campo, como o da marcação "Cancelada sem cobrança" (tela 7.17). "Confirmar como cobrada" usa o
 * valor do Comercial; sem ele, pede o valor (vira o valor informado à mão). A recusa usa o diálogo
 * de sempre, com o motivo que o Comercial vê na planilha.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import type { CommercialSituationReturn, Reservation, Result } from '../../../../shared/ipc-types';
import { useHunit } from '../../hunit';
import { formatDate, formatMoney, parseAmountInput } from '../../presentation/format';
import { SITUATION_RETURN_ACTIONS } from '../../presentation/labels';
import { Action, AppDialog, Card, Field, ListActions, Notice, TextAreaField } from '../../ui';
import { RejectDialog } from '../reservations/CommercialSection';
import { NO_CHARGE_NOTE_MAX } from '../reservations/NoChargeSection';

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap={16} wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" flex="0 0 130px">
        {label}
      </Text>
      <Text size="sm" fw={600}>
        {children}
      </Text>
    </Group>
  );
}

/** O que o Comercial escreveu, como aparece nos dois diálogos. */
function SituationSummary({ situation }: { situation: CommercialSituationReturn }) {
  return (
    <>
      <SummaryRow label="Situação">{`"${situation.situationText}"`}</SummaryRow>
      <SummaryRow label="Responsável">{situation.chargedBy}</SummaryRow>
      {situation.authorizationCode && (
        <SummaryRow label="Código">{situation.authorizationCode}</SummaryRow>
      )}
      {situation.chargeHotel && (
        <SummaryRow label="Hotel da cobrança">{situation.chargeHotel}</SummaryRow>
      )}
      {situation.chargeDate && (
        <SummaryRow label="Data da cobrança">{formatDate(situation.chargeDate)}</SummaryRow>
      )}
    </>
  );
}

/** "Confirmar como cobrada": o valor do Comercial, ou o campo de valor obrigatório. */
export function ChargedDialog({
  reservation,
  situation,
  onCancel,
  onConfirm,
}: {
  reservation: Pick<Reservation, 'reservationNumber' | 'amountToCharge'>;
  situation: CommercialSituationReturn;
  onCancel: () => void;
  onConfirm: (chargedAmount: string | undefined) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fromCommercial = situation.chargedAmount;

  function submit() {
    if (fromCommercial !== null) {
      onConfirm(undefined);
      return;
    }
    const amount = parseAmountInput(draft);
    if (amount === null || Number(amount) <= 0) {
      setError('Informe o valor cobrado, por exemplo 1.234,56.');
      return;
    }
    onConfirm(amount);
  }

  return (
    <AppDialog
      opened
      onClose={onCancel}
      title="Confirmar como cobrada?"
      instant
      onCancel={onCancel}
      cancelLabel="Voltar"
      actions={
        <Action variant="primary" size="sm" onClick={submit}>
          Confirmar como cobrada
        </Action>
      }
      data-testid="situation-charged-dialog"
    >
      <Stack gap={16}>
        <Notice tone="amber" role="none">
          A confirmação vale como comprovante: a reserva sai das pendências e a linha vai para
          &quot;Concluídas&quot; na planilha.
        </Notice>
        <Card tone="subtle" padding={16}>
          <Stack gap={8}>
            <SummaryRow label="Reserva">{reservation.reservationNumber}</SummaryRow>
            <SituationSummary situation={situation} />
            <SummaryRow label="Valor a cobrar">
              {formatMoney(reservation.amountToCharge)}
            </SummaryRow>
            {fromCommercial !== null && (
              <SummaryRow label="Valor cobrado">
                {formatMoney(fromCommercial)} (informado pelo Comercial)
              </SummaryRow>
            )}
          </Stack>
        </Card>
        {fromCommercial === null && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Field
              label="Valor cobrado (R$)"
              description="O Comercial não informou o valor. Ele fica como valor informado à mão."
              placeholder="Ex.: 1.234,56"
              inputMode="decimal"
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setError(null);
              }}
              error={error}
              data-autofocus
            />
          </form>
        )}
      </Stack>
    </AppDialog>
  );
}

/** "Confirmar como cancelada sem cobrança": o diálogo da 7.17, com a situação do Comercial. */
export function NoChargeDecisionDialog({
  reservation,
  situation,
  onCancel,
  onConfirm,
}: {
  reservation: Pick<Reservation, 'reservationNumber' | 'amountToCharge'>;
  situation: CommercialSituationReturn;
  onCancel: () => void;
  onConfirm: (note: string | undefined) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <AppDialog
      opened
      onClose={onCancel}
      title="Confirmar como cancelada sem cobrança?"
      instant
      onCancel={onCancel}
      cancelLabel="Voltar"
      actions={
        <Action
          variant="danger"
          size="sm"
          onClick={() => onConfirm(note.trim() === '' ? undefined : note.trim())}
        >
          Marcar como cancelada
        </Action>
      }
      data-testid="situation-no-charge-dialog"
    >
      <Stack gap={16}>
        <Notice tone="amber" role="none">
          A reserva sai das pendências e não é mais enviada ao Comercial. A observação diz que a
          situação veio do Comercial.
        </Notice>
        <Card tone="subtle" padding={16}>
          <Stack gap={8}>
            <SummaryRow label="Reserva">{reservation.reservationNumber}</SummaryRow>
            <SituationSummary situation={situation} />
            <SummaryRow label="Valor a cobrar">
              {formatMoney(reservation.amountToCharge)} → R$ 0,00
            </SummaryRow>
            <SummaryRow label="Vai para">
              Concluídas, com a situação “Cancelada sem cobrança”
            </SummaryRow>
          </Stack>
        </Card>
        <TextAreaField
          label="Observação (opcional)"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          maxLength={NO_CHARGE_NOTE_MAX}
          rows={3}
          counter={`${note.length}/${NO_CHARGE_NOTE_MAX}`}
          data-autofocus
        />
      </Stack>
    </AppDialog>
  );
}

function StackedActions({ children }: { children: ReactNode }) {
  return (
    <Stack gap={6} align="stretch">
      {children}
    </Stack>
  );
}

type Decide = (action: () => Promise<Result<unknown>>, success: string) => Promise<void> | void;

/**
 * As três ações sobre uma situação livre aguardando validação, com os diálogos. Quem usa passa
 * `decide`, que chama a ponte, mostra a mensagem e atualiza a tela. Na lista (`layout = 'stack'`), uma
 * embaixo da outra: as três não cabem lado a lado na coluna de ações (até o desenho da UX, R-08); na
 * gaveta, lado a lado.
 */
export function SituationReturnActions({
  reservation,
  situation,
  busy,
  decide,
  layout = 'stack',
}: {
  reservation: Pick<Reservation, 'reservationNumber' | 'amountToCharge'>;
  situation: CommercialSituationReturn;
  busy: boolean;
  decide: Decide;
  layout?: 'stack' | 'row';
}) {
  const hunit = useHunit();
  const [open, setOpen] = useState<'charged' | 'no_charge' | 'reject' | null>(null);
  const number = reservation.reservationNumber;
  const close = () => setOpen(null);

  const Actions = layout === 'stack' ? StackedActions : ListActions;
  return (
    <>
      <Actions>
        <Action
          size="xs"
          variant="primary"
          disabled={busy}
          aria-label={`${SITUATION_RETURN_ACTIONS.charged} a reserva ${number}`}
          onClick={() => setOpen('charged')}
        >
          Cobrada
        </Action>
        <Action
          size="xs"
          variant="secondary"
          disabled={busy}
          aria-label={`${SITUATION_RETURN_ACTIONS.noCharge} a reserva ${number}`}
          onClick={() => setOpen('no_charge')}
        >
          Sem cobrança
        </Action>
        <Action
          size="xs"
          variant="danger-light"
          disabled={busy}
          aria-label={`${SITUATION_RETURN_ACTIONS.reject} a situação da reserva ${number}`}
          onClick={() => setOpen('reject')}
        >
          {SITUATION_RETURN_ACTIONS.reject}
        </Action>
      </Actions>
      {open === 'charged' && (
        <ChargedDialog
          reservation={reservation}
          situation={situation}
          onCancel={close}
          onConfirm={(chargedAmount) => {
            close();
            void decide(
              () =>
                hunit.commercial.confirmSituationReturn({
                  returnId: situation.id,
                  as: 'charged',
                  ...(chargedAmount !== undefined && { chargedAmount }),
                }),
              `Reserva ${number} confirmada como cobrada.`,
            );
          }}
        />
      )}
      {open === 'no_charge' && (
        <NoChargeDecisionDialog
          reservation={reservation}
          situation={situation}
          onCancel={close}
          onConfirm={(note) => {
            close();
            void decide(
              () =>
                hunit.commercial.confirmSituationReturn({
                  returnId: situation.id,
                  as: 'no_charge',
                  ...(note !== undefined && { note }),
                }),
              `Reserva ${number} marcada como cancelada sem cobrança.`,
            );
          }}
        />
      )}
      {open === 'reject' && (
        <RejectDialog
          title="Recusar a situação informada pelo Comercial"
          confirmLabel="Recusar"
          suggestions={[]}
          onCancel={close}
          onReject={(reason) => {
            close();
            void decide(
              () => hunit.commercial.rejectReturn({ returnId: situation.id, reason }),
              `Situação da reserva ${number} recusada: o motivo aparece para o Comercial na planilha.`,
            );
          }}
        />
      )}
    </>
  );
}
