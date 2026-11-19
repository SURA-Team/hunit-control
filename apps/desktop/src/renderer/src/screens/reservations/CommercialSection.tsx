/**
 * Envio ao Comercial de uma reserva, no detalhe (specs/005, US1 e US2; FR-009, FR-011, FR-016 a
 * FR-019, FR-023): a aba da planilha, o último envio e quem enviou, desfazer (com confirmação) e
 * reverter no prazo; o retorno do Comercial — código de autorização, hotel da cobrança ao lado do
 * hotel da reserva (destacado quando diferentes), valor cobrado, valor a cobrar e diferença,
 * responsável e quando foi lido — com "Confirmar", "Recusar" e "Desfazer confirmação".
 *
 * O histórico do Comercial aparece junto com o da tratativa (`TreatmentSection`), por data. O que
 * cada ação aceita é decidido pelo servidor; o perfil consulta só vê.
 *
 * Desde a 006 (T051; telas 7.5 e 7.6): card "Comercial" (bloco) com o selo da linha e "Desfazer envio"
 * em vermelho suave; os dados do envio em colunas; o retorno numa caixa cinza com o hotel da cobrança
 * e a diferença de valor em âmbar quando chamam atenção, "Confirmar" como principal e "Recusar" em
 * vermelho suave (como no design; a tarefa dizia contorno); a recusa num diálogo estreito com o aviso,
 * os motivos mais comuns em pílulas, o motivo com o contador e "Recusar retorno" em vermelho cheio.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type {
  CommercialReturn,
  Reservation,
  ReservationKey,
  Result,
} from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatDateTime, formatMoney } from '../../presentation/format';
import {
  errorMessage,
  LINE_STATE_LABELS,
  REJECTION_SUGGESTIONS,
  RETURN_STATE_LABELS,
  SHEET_TAB_NAMES,
} from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import {
  Action,
  AppDialog,
  Card,
  CardHeader,
  DataField,
  DataGrid,
  FilterChip,
  HotelRow,
  Notice,
  RowList,
  StatusBadge,
  TextAreaField,
} from '../../ui';

const MAX_REASON = 500;

/** Cor de atenção do design (âmbar) para o que destoa: hotel diferente, diferença de valor. */
const ATTENTION = 'var(--hc-amarelo-9)';

export const commercialKey = (key: ReservationKey) =>
  ['commercial', key.hotelCode, key.reservationNumber] as const;

/** Compara nomes de hotel sem diferenciar maiúsculas, acentos e espaços (só para destacar). */
export function sameHotelName(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  return normalize(a) === normalize(b);
}

/** Hotel da cobrança (o da maquininha) ao lado do hotel da reserva, destacado quando diferem. */
export function ChargeHotel({
  chargeHotel,
  hotelName,
}: {
  chargeHotel: string;
  hotelName: string;
}) {
  const differs = !sameHotelName(chargeHotel, hotelName);
  return (
    <Stack gap={2} align="flex-start">
      <Text size="sm" fw={differs ? 700 : undefined} c={differs ? ATTENTION : undefined}>
        {chargeHotel}
      </Text>
      {differs && <StatusBadge tone="amber">Diferente do hotel da reserva</StatusBadge>}
      <Text size="xs" c="dimmed">
        Hotel da reserva: {hotelName}
      </Text>
    </Stack>
  );
}

/** Diferença entre o valor cobrado e o valor a cobrar, em âmbar quando não é zero. */
export function AmountDifference({ value }: { value: string | null }) {
  const differs = value !== null && Number(value) !== 0;
  return (
    <Text
      span
      display="inline-block"
      size="sm"
      fw={differs ? 700 : undefined}
      c={differs ? ATTENTION : undefined}
      data-no-truncate=""
      style={{ whiteSpace: 'nowrap' }}
    >
      {formatMoney(value)}
    </Text>
  );
}

export function CommercialSection({ reservation }: { reservation: Reservation }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const { isOperator, state } = useConnection();
  const key: ReservationKey = {
    hotelCode: reservation.hotelCode,
    reservationNumber: reservation.reservationNumber,
  };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rejecting, setRejecting] = useState<CommercialReturn | null>(null);

  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const hotelName =
    hotels.data?.find((hotel) => hotel.code === reservation.hotelCode)?.name ??
    reservation.hotelCode;
  const detail = useQuery({
    queryKey: commercialKey(key),
    queryFn: () => unwrap(hunit.commercial.get(key)),
  });
  const line = detail.data?.line ?? null;
  const returns = detail.data?.returns ?? [];
  const current = returns.find((item) => item.state !== 'superseded') ?? null;
  const earlier = returns.filter((item) => item !== current);
  const canWrite = isOperator && state?.status !== 'offline';

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['commercial'] });
    void queryClient.invalidateQueries({ queryKey: ['treatment'] });
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['commercial-sheet'] });
  }

  async function run<T>(action: () => Promise<Result<T>>, success: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (!result.ok) {
        setMessage({ tone: 'red', text: errorMessage(result.error) });
        return false;
      }
      setMessage({ tone: 'green', text: success });
      return true;
    } finally {
      setBusy(false);
      refresh();
    }
  }

  // Nunca enviada pela planilha e sem histórico: a seção não aparece.
  if (detail.isSuccess && line === null && returns.length === 0) return null;

  const lineBadge = line ? badgeOf(LINE_STATE_LABELS[line.state]) : null;
  const currentBadge = current ? badgeOf(RETURN_STATE_LABELS[current.state]) : null;

  return (
    <Card block="Comercial" data-testid="commercial-section">
      <CardHeader
        title="Comercial"
        aside={
          (lineBadge || line?.syncPending) && (
            <Group gap={8}>
              {lineBadge && <StatusBadge tone={lineBadge.tone}>{lineBadge.label}</StatusBadge>}
              {line?.syncPending && (
                <StatusBadge tone="amber">Atualização da planilha pendente</StatusBadge>
              )}
            </Group>
          )
        }
        actions={
          canWrite &&
          line &&
          (line.state === 'open' || line.restorableUntil) && (
            <>
              {line.state === 'open' && (
                <Action
                  size="xs"
                  variant="danger-light"
                  disabled={busy}
                  onClick={() => setConfirmCancel(true)}
                >
                  Desfazer envio
                </Action>
              )}
              {line.restorableUntil && (
                <Action
                  size="xs"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => hunit.commercial.restoreLine(key),
                      'Envio revertido: a linha voltou para "A cobrar".',
                    )
                  }
                >
                  Reverter envio desfeito
                </Action>
              )}
            </>
          )
        }
      />

      {detail.isError && <Notice tone="red">{messageOf(detail.error)}</Notice>}
      {message && (
        <Notice tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}

      {line && (
        <DataGrid label="Envio ao Comercial">
          <DataField label="Aba da planilha">
            {line.tab ? SHEET_TAB_NAMES[line.tab] : 'Fora da planilha'}
          </DataField>
          <DataField label="Último envio">
            {formatDateTime(line.lastSentAt)}
            <Text size="xs" c="dimmed">
              por {line.lastSentBy}
            </Text>
          </DataField>
          <DataField label="Primeiro envio">{formatDateTime(line.firstSentAt)}</DataField>
          {line.cancelledAt && (
            <DataField label="Envio desfeito">
              {formatDateTime(line.cancelledAt)}
              {line.cancelledBy && (
                <Text size="xs" c="dimmed">
                  por {line.cancelledBy}
                </Text>
              )}
              {line.restorableUntil && (
                <Text size="xs" c="dimmed">
                  pode ser revertido até {formatDate(line.restorableUntil)}
                </Text>
              )}
            </DataField>
          )}
          {line.concludedAt && (
            <DataField label="Concluída">{formatDateTime(line.concludedAt)}</DataField>
          )}
        </DataGrid>
      )}
      {line?.returnProblem && (
        <Notice tone="amber" role="none" title="Retorno com problema">
          {line.returnProblem}
        </Notice>
      )}
      {line?.sheetIssue && (
        <Text size="sm" c="dimmed">
          Planilha: {line.sheetIssue}
        </Text>
      )}

      {current && currentBadge && (
        <Card
          tone="subtle"
          padding={12}
          block="Retorno do Comercial"
          data-testid="commercial-return"
        >
          <CardHeader
            title="Retorno do Comercial"
            aside={<StatusBadge tone={currentBadge.tone}>{currentBadge.label}</StatusBadge>}
            actions={
              <Text size="xs" c="dimmed">
                lido em {formatDateTime(current.readAt)}
              </Text>
            }
          />
          <DataGrid>
            <DataField label="Código de autorização">{current.authorizationCode}</DataField>
            <DataField label="Hotel da cobrança">
              <ChargeHotel chargeHotel={current.chargeHotel} hotelName={hotelName} />
            </DataField>
            <DataField label="Responsável pela cobrança">{current.chargedBy}</DataField>
            <DataField label="Valor cobrado">{formatMoney(current.chargedAmount)}</DataField>
            <DataField label="Valor a cobrar">{formatMoney(current.expectedAmount)}</DataField>
            <DataField label="Diferença">
              <AmountDifference value={current.difference} />
            </DataField>
          </DataGrid>
          {current.decidedAt && (
            <Text size="xs" c="dimmed">
              {RETURN_STATE_LABELS[current.state].name} em {formatDateTime(current.decidedAt)}
              {current.decidedBy ? ` por ${current.decidedBy}` : ''}
              {current.rejectionReason ? `: ${current.rejectionReason}` : ''}
            </Text>
          )}
          {canWrite && current.state === 'awaiting_validation' && (
            <Group gap={8} mt={8}>
              <Action
                size="xs"
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => hunit.commercial.confirmReturn(current.id),
                    'Retorno confirmado: vale como comprovante.',
                  )
                }
              >
                Confirmar
              </Action>
              <Action
                size="xs"
                variant="danger-light"
                disabled={busy}
                onClick={() => {
                  setMessage(null);
                  setRejecting(current);
                }}
              >
                Recusar
              </Action>
            </Group>
          )}
          {canWrite && current.state === 'confirmed' && (
            <Group gap={8} mt={8}>
              <Action
                size="xs"
                variant="danger-light"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => hunit.commercial.undoConfirmation(current.id),
                    'Confirmação desfeita: o retorno volta a aguardar validação.',
                  )
                }
              >
                Desfazer confirmação
              </Action>
            </Group>
          )}
        </Card>
      )}

      {earlier.length > 0 && (
        <Stack gap={8}>
          <CardHeader title="Retornos anteriores" />
          <RowList label="Retornos anteriores">
            {earlier.map((item) => {
              const badge = badgeOf(RETURN_STATE_LABELS[item.state]);
              return (
                <HotelRow
                  key={item.id}
                  title={`Lido em ${formatDateTime(item.readAt)}`}
                  summary={`Código ${item.authorizationCode} · ${formatMoney(item.chargedAmount)}${
                    item.rejectionReason ? ` · ${item.rejectionReason}` : ''
                  }`}
                  status={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
                />
              );
            })}
          </RowList>
        </Stack>
      )}

      {/* Destrutiva confirmada: "Desfazer envio" em vermelho cheio; "Manter" é o cancelar (FR-009). */}
      <AppDialog
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Desfazer o envio ao Comercial?"
        onCancel={() => setConfirmCancel(false)}
        cancelLabel="Manter"
        actions={
          <Action
            variant="danger"
            size="sm"
            onClick={() => {
              setConfirmCancel(false);
              void run(() => hunit.commercial.cancelLine(key), 'Envio desfeito.');
            }}
          >
            Desfazer envio
          </Action>
        }
      >
        <Text size="sm">
          A linha vai para a aba &quot;Concluídas&quot; como &quot;Pedido cancelado pelo
          Financeiro&quot;, e a reserva volta a ficar sem tratativa (a não ser que tenha uma por
          e-mail). Dá para reverter em até 30 dias.
        </Text>
      </AppDialog>

      {rejecting && (
        <RejectDialog
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const target = rejecting;
            setRejecting(null);
            void run(
              () => hunit.commercial.rejectReturn({ returnId: target.id, reason }),
              'Retorno recusado: o motivo aparece para o Comercial na planilha.',
            );
          }}
        />
      )}
    </Card>
  );
}

/**
 * Recusa do retorno (FR-017; tela 7.6): motivo obrigatório, com os mais comuns em pílulas, que o
 * Comercial vê na planilha. Diálogo estreito, "Voltar" em texto e "Recusar retorno" em vermelho cheio.
 */
export function RejectDialog({
  onCancel,
  onReject,
}: {
  onCancel: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const suggestionsId = useId();

  function submit() {
    const text = reason.trim();
    if (text === '') {
      setError('Informe o motivo da recusa.');
      return;
    }
    onReject(text);
  }

  return (
    <AppDialog
      opened
      onClose={onCancel}
      title="Recusar o retorno do Comercial"
      instant
      onCancel={onCancel}
      cancelLabel="Voltar"
      actions={
        <Action variant="danger" size="sm" onClick={submit}>
          Recusar retorno
        </Action>
      }
    >
      <Stack gap={16}>
        <Notice tone="amber" role="none">
          O motivo aparece para o Comercial na planilha, na coluna &quot;Validação do
          Financeiro&quot;. Não escreva dados do hóspede.
        </Notice>
        <Stack gap={8}>
          <Text size="sm" fw={600} id={suggestionsId}>
            Motivos mais comuns
          </Text>
          <Group gap={8} role="group" aria-labelledby={suggestionsId}>
            {REJECTION_SUGGESTIONS.map((suggestion) => (
              <FilterChip
                key={suggestion}
                label={suggestion}
                active={reason === suggestion}
                onClick={() => {
                  setReason(suggestion);
                  setError(null);
                }}
              />
            ))}
          </Group>
        </Stack>
        <TextAreaField
          label="Motivo da recusa"
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
            setError(null);
          }}
          maxLength={MAX_REASON}
          rows={3}
          error={error}
          counter={`${reason.length}/${MAX_REASON}`}
          data-autofocus
        />
      </Stack>
    </AppDialog>
  );
}
