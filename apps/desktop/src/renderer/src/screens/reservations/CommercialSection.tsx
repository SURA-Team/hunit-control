/**
 * Envio ao Comercial de uma reserva, no detalhe (specs/005, US1 e US2; FR-009, FR-011, FR-016 a
 * FR-019, FR-023): a aba da planilha, o último envio e quem enviou, desfazer (com confirmação) e
 * reverter no prazo; o retorno do Comercial — código de autorização, hotel da cobrança ao lado do
 * hotel da reserva (destacado quando diferentes), valor cobrado, valor a cobrar e diferença,
 * responsável e quando foi lido — com "Confirmar", "Recusar" e "Desfazer confirmação".
 *
 * O histórico do Comercial aparece junto com o da tratativa (`TreatmentSection`), por data. O que
 * cada ação aceita é decidido pelo servidor; o perfil consulta só vê.
 */
import {
  Alert,
  Badge,
  Button,
  Chip,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type {
  CommercialReturn,
  Reservation,
  ReservationKey,
  Result,
} from '../../../../shared/ipc-types';
import { StatusBadge } from '../../components/StatusBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDate, formatDateTime, formatMoney } from '../../presentation/format';
import {
  errorMessage,
  LINE_STATE_LABELS,
  REJECTION_SUGGESTIONS,
  RETURN_STATE_LABELS,
  SHEET_TAB_NAMES,
} from '../../presentation/labels';
import { useConnection } from '../../state/connection';

const MAX_REASON = 500;

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" component="div">
        {children}
      </Text>
    </div>
  );
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
    <Stack gap={2}>
      <Group gap={6}>
        <Text size="sm" fw={differs ? 700 : undefined} c={differs ? 'orange.8' : undefined}>
          {chargeHotel}
        </Text>
        {differs && (
          <Badge color="orange" size="xs" variant="light">
            Diferente do hotel da reserva
          </Badge>
        )}
      </Group>
      <Text size="xs" c="dimmed">
        Hotel da reserva: {hotelName}
      </Text>
    </Stack>
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

  return (
    <Paper withBorder p="sm" radius="sm" data-testid="commercial-section">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Title order={5}>Comercial</Title>
          {line && <StatusBadge label={LINE_STATE_LABELS[line.state]} />}
          {line?.syncPending && (
            <Badge color="yellow" variant="light" size="sm">
              Atualização da planilha pendente
            </Badge>
          )}
        </Group>
        {canWrite && line && (
          <Group gap="xs">
            {line.state === 'open' && (
              <Button
                size="xs"
                variant="default"
                color="red"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
              >
                Desfazer envio
              </Button>
            )}
            {line.restorableUntil && (
              <Button
                size="xs"
                variant="default"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => hunit.commercial.restoreLine(key),
                    'Envio revertido: a linha voltou para "A cobrar".',
                  )
                }
              >
                Reverter envio desfeito
              </Button>
            )}
          </Group>
        )}
      </Group>

      <Stack gap="sm">
        {detail.isError && (
          <Alert color="red" role="alert">
            {messageOf(detail.error)}
          </Alert>
        )}
        {message && (
          <Alert color={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
            {message.text}
          </Alert>
        )}

        {line && (
          <SimpleGrid cols={3} spacing="sm">
            <Field label="Aba da planilha">
              {line.tab ? SHEET_TAB_NAMES[line.tab] : 'Fora da planilha'}
            </Field>
            <Field label="Último envio">
              {formatDateTime(line.lastSentAt)}
              <Text size="xs" c="dimmed">
                por {line.lastSentBy}
              </Text>
            </Field>
            <Field label="Primeiro envio">{formatDateTime(line.firstSentAt)}</Field>
            {line.cancelledAt && (
              <Field label="Envio desfeito">
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
              </Field>
            )}
            {line.concludedAt && (
              <Field label="Concluída">{formatDateTime(line.concludedAt)}</Field>
            )}
          </SimpleGrid>
        )}
        {line?.returnProblem && (
          <Alert color="orange" title="Retorno com problema">
            {line.returnProblem}
          </Alert>
        )}
        {line?.sheetIssue && (
          <Text size="sm" c="dimmed">
            Planilha: {line.sheetIssue}
          </Text>
        )}

        {current && (
          <Paper withBorder p="sm" radius="sm" data-testid="commercial-return">
            <Group justify="space-between" mb={6}>
              <Group gap="xs">
                <Text fw={600} size="sm">
                  Retorno do Comercial
                </Text>
                <StatusBadge label={RETURN_STATE_LABELS[current.state]} size="xs" />
              </Group>
              <Text size="xs" c="dimmed">
                lido em {formatDateTime(current.readAt)}
              </Text>
            </Group>
            <SimpleGrid cols={3} spacing="sm">
              <Field label="Código de autorização">{current.authorizationCode}</Field>
              <Field label="Hotel da cobrança">
                <ChargeHotel chargeHotel={current.chargeHotel} hotelName={hotelName} />
              </Field>
              <Field label="Responsável pela cobrança">{current.chargedBy}</Field>
              <Field label="Valor cobrado">{formatMoney(current.chargedAmount)}</Field>
              <Field label="Valor a cobrar">{formatMoney(current.expectedAmount)}</Field>
              <Field label="Diferença">
                <Text
                  size="sm"
                  c={
                    current.difference && Number(current.difference) !== 0 ? 'orange.8' : undefined
                  }
                >
                  <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(current.difference)}</span>
                </Text>
              </Field>
            </SimpleGrid>
            {current.decidedAt && (
              <Text size="xs" c="dimmed" mt={6}>
                {RETURN_STATE_LABELS[current.state].name} em {formatDateTime(current.decidedAt)}
                {current.decidedBy ? ` por ${current.decidedBy}` : ''}
                {current.rejectionReason ? `: ${current.rejectionReason}` : ''}
              </Text>
            )}
            {canWrite && current.state === 'awaiting_validation' && (
              <Group gap="xs" mt="sm">
                <Button
                  size="xs"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => hunit.commercial.confirmReturn(current.id),
                      'Retorno confirmado: vale como comprovante.',
                    )
                  }
                >
                  Confirmar
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  color="red"
                  disabled={busy}
                  onClick={() => {
                    setMessage(null);
                    setRejecting(current);
                  }}
                >
                  Recusar
                </Button>
              </Group>
            )}
            {canWrite && current.state === 'confirmed' && (
              <Group gap="xs" mt="sm">
                <Button
                  size="xs"
                  variant="default"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => hunit.commercial.undoConfirmation(current.id),
                      'Confirmação desfeita: o retorno volta a aguardar validação.',
                    )
                  }
                >
                  Desfazer confirmação
                </Button>
              </Group>
            )}
          </Paper>
        )}

        {earlier.length > 0 && (
          <Table verticalSpacing={2} aria-label="Retornos anteriores">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Retorno anterior</Table.Th>
                <Table.Th>Código</Table.Th>
                <Table.Th>Valor cobrado</Table.Th>
                <Table.Th>Situação</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {earlier.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>{formatDateTime(item.readAt)}</Table.Td>
                  <Table.Td>{item.authorizationCode}</Table.Td>
                  <Table.Td>{formatMoney(item.chargedAmount)}</Table.Td>
                  <Table.Td>
                    <StatusBadge label={RETURN_STATE_LABELS[item.state]} size="xs" />
                    {item.rejectionReason && (
                      <Text size="xs" c="dimmed">
                        {item.rejectionReason}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <Modal
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={<Text fw={600}>Desfazer o envio ao Comercial?</Text>}
        transitionProps={{ duration: 0 }}
      >
        <Stack gap="md">
          <Text size="sm">
            A linha vai para a aba &quot;Concluídas&quot; como &quot;Pedido cancelado pelo
            Financeiro&quot;, e a reserva volta a ficar sem tratativa (a não ser que tenha uma por
            e-mail). Dá para reverter em até 30 dias.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConfirmCancel(false)}>
              Manter
            </Button>
            <Button
              color="red"
              onClick={() => {
                setConfirmCancel(false);
                void run(() => hunit.commercial.cancelLine(key), 'Envio desfeito.');
              }}
            >
              Desfazer envio
            </Button>
          </Group>
        </Stack>
      </Modal>

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
    </Paper>
  );
}

/** Recusa do retorno (FR-017): motivo obrigatório, com sugestões, que o Comercial vê na planilha. */
export function RejectDialog({
  onCancel,
  onReject,
}: {
  onCancel: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const text = reason.trim();
    if (text === '') {
      setError('Informe o motivo da recusa.');
      return;
    }
    onReject(text);
  }

  return (
    <Modal
      opened
      onClose={onCancel}
      title={<Text fw={600}>Recusar o retorno do Comercial</Text>}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Alert color="yellow">
          O motivo aparece para o Comercial na planilha, na coluna &quot;Validação do
          Financeiro&quot;. Não escreva dados do hóspede.
        </Alert>
        <Group gap={6}>
          {REJECTION_SUGGESTIONS.map((suggestion) => (
            <Chip
              key={suggestion}
              checked={reason === suggestion}
              onChange={() => {
                setReason(suggestion);
                setError(null);
              }}
              size="xs"
            >
              {suggestion}
            </Chip>
          ))}
        </Group>
        <Textarea
          label="Motivo da recusa"
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
            setError(null);
          }}
          maxLength={MAX_REASON}
          rows={3}
          error={error}
          description={`${reason.length}/${MAX_REASON}`}
          data-autofocus
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel}>
            Voltar
          </Button>
          <Button color="red" onClick={submit}>
            Recusar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
