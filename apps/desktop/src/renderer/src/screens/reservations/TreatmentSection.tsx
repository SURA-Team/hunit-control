/**
 * Tratativa de uma reserva, no detalhe (specs/003, US1, US2, US4, FR-017): situação, alerta
 * "Verificar" (FR-002a), documentos atuais e anteriores, valor cobrado informado à mão e histórico
 * (os 5 mais recentes e "Mostrar mais", FR-017a).
 *
 * O perfil operador anexa, substitui, desfaz, reverte, informa o valor e confirma o alerta; o
 * perfil consulta só vê
 * e baixa (FR-014). O que cada reserva aceita, até quando um documento pode ser revertido e qual
 * valor vale vêm prontos do servidor.
 */
import {
  Alert,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  CommercialEvent,
  Reservation,
  ReservationKey,
  Result,
  TreatmentDocument,
  TreatmentDocumentKind,
  TreatmentEvent,
} from '../../../../shared/ipc-types';
import { StatusBadge } from '../../components/StatusBadge';
import { SituationBadge } from '../../components/SituationBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMoney,
  parseAmountInput,
} from '../../presentation/format';
import {
  CLASSIFICATION_LABELS,
  COMMERCIAL_EVENT_NAMES,
  DOCUMENT_STATE_LABELS,
  errorMessage,
  LEGACY_ORIGIN_NAME,
  TREATMENT_EVENT_NAMES,
  TREATMENT_KIND_NAMES,
  TREATMENT_KIND_ORDER,
} from '../../presentation/labels';
import { useConnection } from '../../state/connection';
import { AttachDialog } from './AttachDialog';
import { commercialKey } from './CommercialSection';

/** Itens do histórico mostrados de início e a cada "Mostrar mais" (FR-017a). */
export const HISTORY_FIRST = 5;
export const HISTORY_STEP = 10;

function eventDescription(event: TreatmentEvent): string {
  const action = TREATMENT_EVENT_NAMES[event.type];
  if (event.classification) return `${action}: ${CLASSIFICATION_LABELS[event.classification].name}`;
  if (event.kind) return `${action} ${TREATMENT_KIND_NAMES[event.kind].toLowerCase()}`;
  return event.amount ? `${action}: ${formatMoney(event.amount)}` : action;
}

/** Quem fez um item do histórico do Comercial (FR-020): cliente da API, a planilha ou o sistema. */
const COMMERCIAL_SHEET_ACTOR = 'Comercial (planilha)';

function commercialDescription(event: CommercialEvent): string {
  const action = COMMERCIAL_EVENT_NAMES[event.type];
  if (event.reason) return `${action}: ${event.reason}`;
  if (event.classification) return `${action}: ${CLASSIFICATION_LABELS[event.classification].name}`;
  return action;
}

interface HistoryItem {
  key: string;
  at: string;
  text: string;
  who: string;
}

/**
 * Histórico da tratativa e do Comercial juntos, do mais recente para o mais antigo (specs/005,
 * FR-020; 003 FR-017a).
 */
export function mergedHistory(
  treatment: readonly TreatmentEvent[],
  commercial: readonly CommercialEvent[],
): HistoryItem[] {
  const items: HistoryItem[] = [
    ...treatment.map((event) => ({
      key: `t${event.id}`,
      at: event.at,
      text: eventDescription(event),
      who: event.fromLegacy ? LEGACY_ORIGIN_NAME : event.client,
    })),
    ...commercial.map((event) => ({
      key: `c${event.id}`,
      at: event.at,
      text: commercialDescription(event),
      who: event.actor.kind === 'commercial_sheet' ? COMMERCIAL_SHEET_ACTOR : event.actor.name,
    })),
  ];
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function TreatmentSection({ reservation }: { reservation: Reservation }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const { isOperator, state } = useConnection();
  const key: ReservationKey = {
    hotelCode: reservation.hotelCode,
    reservationNumber: reservation.reservationNumber,
  };
  const [attaching, setAttaching] = useState<TreatmentDocumentKind | null>(null);
  /** Documento que o operador pediu para desfazer; a ação só acontece depois da confirmação. */
  const [removing, setRemoving] = useState<TreatmentDocument | null>(null);
  const [amountDraft, setAmountDraft] = useState('');
  const [message, setMessage] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyShown, setHistoryShown] = useState(HISTORY_FIRST);

  const detail = useQuery({
    queryKey: ['treatment', key.hotelCode, key.reservationNumber],
    queryFn: () => unwrap(hunit.treatments.get(key)),
  });
  // O histórico do Comercial entra no mesmo histórico (specs/005, FR-020).
  const commercial = useQuery({
    queryKey: commercialKey(key),
    queryFn: () => unwrap(hunit.commercial.get(key)),
  });
  const history = mergedHistory(detail.data?.events ?? [], commercial.data?.events ?? []);
  // Enquanto o detalhe não chega, vale o resumo que veio com a reserva.
  const treatment = detail.data?.treatment ?? reservation.treatment;
  const documents = detail.data?.documents ?? [];
  const previous = documents.filter(
    (document) => document.id !== treatment.request?.id && document.id !== treatment.proof?.id,
  );
  const offline = state?.status === 'offline';
  const canWrite = isOperator && !offline;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['treatment'] });
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
  }

  /** Executa uma ação da ponte, mostra o erro (se houver) e atualiza a tela. */
  async function run<T>(action: () => Promise<Result<T>>, success?: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (!result.ok) {
        setMessage({ tone: 'red', text: errorMessage(result.error) });
        return false;
      }
      if (success) setMessage({ tone: 'green', text: success });
      return true;
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function remove(document: TreatmentDocument) {
    setRemoving(null);
    await run(
      () => hunit.treatments.remove(document.id),
      document.kind === 'proof' ? 'Comprovante desfeito.' : 'Tratativa desfeita.',
    );
  }

  async function saveDocument(document: TreatmentDocument) {
    setMessage(null);
    const result = await hunit.treatments.saveDocument(document.id);
    if (!result.ok) setMessage({ tone: 'red', text: errorMessage(result.error) });
    else if (result.data) setMessage({ tone: 'green', text: `Salvo em ${result.data.savedTo}` });
  }

  async function submitAmount() {
    const amount = parseAmountInput(amountDraft);
    if (amount === null || Number(amount) <= 0) {
      setMessage({ tone: 'red', text: 'Valor inválido. Use, por exemplo, 1.234,56.' });
      return;
    }
    const done = await run(() => hunit.treatments.setManualAmount({ ...key, amount }));
    if (done) setAmountDraft('');
  }

  const documentActions = (document: TreatmentDocument) => (
    <Group gap={6} wrap="nowrap">
      {document.state !== 'purged' && (
        <Button size="compact-xs" variant="default" onClick={() => void saveDocument(document)}>
          Baixar
        </Button>
      )}
      {canWrite && document.endedAt === null && (
        <Button
          size="compact-xs"
          variant="default"
          color="red"
          disabled={busy}
          onClick={() => setRemoving(document)}
        >
          Desfazer
        </Button>
      )}
      {canWrite && document.revertibleUntil && (
        <Button
          size="compact-xs"
          variant="default"
          disabled={busy || !treatment.acceptsDocuments}
          onClick={() =>
            void run(() => hunit.treatments.revert(document.id), 'Documento revertido.')
          }
        >
          Reverter
        </Button>
      )}
    </Group>
  );

  return (
    <Paper withBorder p="sm" radius="sm" data-testid="treatment-section">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Title order={5}>Tratativa</Title>
          {treatment.status !== 'none' && <SituationBadge treatment={treatment} />}
          {treatment.status === 'none' && (
            <Text size="sm" c="dimmed">
              Sem tratativa
            </Text>
          )}
        </Group>
        {isOperator && (
          <Group gap="xs">
            {TREATMENT_KIND_ORDER.map((kind) => (
              <Button
                key={kind}
                size="xs"
                variant={kind === 'proof' ? 'filled' : 'default'}
                disabled={!canWrite || !treatment.acceptsDocuments || busy}
                onClick={() => {
                  setMessage(null);
                  setAttaching(kind);
                }}
              >
                {treatment[kind] ? 'Substituir' : 'Anexar'}{' '}
                {TREATMENT_KIND_NAMES[kind].toLowerCase()}
              </Button>
            ))}
          </Group>
        )}
      </Group>

      <Stack gap="sm">
        {isOperator && !treatment.acceptsDocuments && (
          <Text size="sm" c="dimmed">
            O status do Hunit desta reserva não exige cobrança, por isso ela não aceita novos
            documentos.
          </Text>
        )}
        {treatment.needsReview && (
          <Alert color="yellow" title="Verificar" data-testid="review-alert">
            <Stack gap="xs">
              <Text size="sm">
                Depois da tratativa, o Hunit passou a mostrar esta reserva como{' '}
                <b>{CLASSIFICATION_LABELS[reservation.classification].name}</b>. Confira a reserva
                {isOperator ? ' e confirme' : ''}. A tratativa continua registrada.
              </Text>
              {isOperator && (
                <Group>
                  <Button
                    size="xs"
                    color="yellow"
                    disabled={!canWrite || busy}
                    onClick={() =>
                      void run(() => hunit.treatments.confirmReview(key), 'Verificação confirmada.')
                    }
                  >
                    Confirmar
                  </Button>
                </Group>
              )}
            </Stack>
          </Alert>
        )}
        {message && (
          <Alert color={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
            {message.text}
          </Alert>
        )}
        {detail.isError && (
          <Alert color="red" role="alert">
            {messageOf(detail.error)}
          </Alert>
        )}

        <Table verticalSpacing={4} aria-label="Documentos da tratativa">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Documento</Table.Th>
              <Table.Th>Arquivo</Table.Th>
              <Table.Th>Anexado</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {TREATMENT_KIND_ORDER.map((kind) => {
              const document = treatment[kind];
              return (
                <Table.Tr key={kind}>
                  <Table.Td>{TREATMENT_KIND_NAMES[kind]}</Table.Td>
                  {document ? (
                    <DocumentCells document={document} actions={documentActions(document)} />
                  ) : (
                    <Table.Td colSpan={4}>
                      <Text size="sm" c="dimmed">
                        Nenhum
                      </Text>
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
            {previous.map((document) => (
              <Table.Tr key={document.id}>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {TREATMENT_KIND_NAMES[document.kind]} anterior
                  </Text>
                </Table.Td>
                <DocumentCells document={document} actions={documentActions(document)} />
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Group gap="sm" align="flex-end">
          <div>
            <Text size="xs" c="dimmed">
              Valor informado à mão
            </Text>
            <Text size="sm">
              {treatment.manualChargedAmount
                ? `${formatMoney(treatment.manualChargedAmount)} (informado à mão)`
                : '—'}
            </Text>
          </div>
          {canWrite && treatment.manualChargedAmount && (
            <Button
              size="compact-xs"
              variant="default"
              disabled={busy}
              onClick={() => void run(() => hunit.treatments.clearManualAmount(key))}
            >
              Remover valor
            </Button>
          )}
          {canWrite && treatment.proof && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitAmount();
              }}
            >
              <Group gap={6} align="flex-end">
                <TextInput
                  size="xs"
                  label="Valor que foi cobrado (R$)"
                  placeholder="1.234,56"
                  inputMode="decimal"
                  value={amountDraft}
                  onChange={(event) => setAmountDraft(event.currentTarget.value)}
                />
                <Button size="xs" type="submit" variant="default" disabled={busy}>
                  Informar valor
                </Button>
              </Group>
            </form>
          )}
        </Group>
        {treatment.chargedAmountOrigin === 'hunit' && treatment.manualChargedAmount && (
          <Text size="xs" c="dimmed">
            O Hunit já informa o valor ({formatMoney(treatment.effectiveChargedAmount)}); é ele que
            vale.
          </Text>
        )}

        {history.length > 0 && (
          <div>
            <Text size="sm" fw={600}>
              Histórico
            </Text>
            <ul aria-label="Histórico da tratativa" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {history.slice(0, historyShown).map((item) => (
                <li key={item.key}>
                  <Text size="sm" span>
                    {formatDateTime(item.at)} — {item.text} — {item.who}
                  </Text>
                </li>
              ))}
            </ul>
            {history.length > historyShown && (
              <Button
                size="compact-xs"
                variant="subtle"
                mt={4}
                onClick={() => setHistoryShown((shown) => shown + HISTORY_STEP)}
              >
                Mostrar mais
              </Button>
            )}
          </div>
        )}
      </Stack>

      <Modal
        opened={removing !== null}
        onClose={() => setRemoving(null)}
        title={
          <Text fw={600}>
            Desfazer {removing?.kind === 'proof' ? 'o comprovante' : 'a tratativa'}?
          </Text>
        }
        transitionProps={{ duration: 0 }}
      >
        <Stack gap="md">
          <Text size="sm">
            {removing?.fileName ?? 'O documento'} deixa de valer para esta reserva. Ele fica
            guardado por 30 dias e pode ser revertido nesse prazo.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setRemoving(null)}>
              Manter
            </Button>
            <Button color="red" onClick={() => removing && void remove(removing)}>
              Desfazer
            </Button>
          </Group>
        </Stack>
      </Modal>

      {attaching && (
        <AttachDialog
          kind={attaching}
          reservations={[key]}
          current={treatment[attaching]}
          onClose={() => {
            setAttaching(null);
            refresh();
          }}
        />
      )}
    </Paper>
  );
}

function DocumentCells({
  document,
  actions,
}: {
  document: TreatmentDocument;
  actions: React.ReactNode;
}) {
  return (
    <>
      <Table.Td style={{ wordBreak: 'break-word' }}>
        {document.fileName ?? (
          <Text span size="sm" c="dimmed" fs="italic">
            arquivo apagado
          </Text>
        )}{' '}
        <Text span size="xs" c="dimmed">
          {formatFileSize(document.sizeBytes)}
        </Text>
      </Table.Td>
      <Table.Td>
        {formatDateTime(document.attachedAt)}
        <Text size="xs" c="dimmed">
          por {document.fromLegacy ? LEGACY_ORIGIN_NAME : document.attachedBy}
        </Text>
      </Table.Td>
      <Table.Td>
        <StatusBadge label={DOCUMENT_STATE_LABELS[document.state]} size="xs" />
        {document.endedAt && (
          <Text size="xs" c="dimmed">
            {formatDateTime(document.endedAt)}
            {document.endedBy ? ` por ${document.endedBy}` : ''}
          </Text>
        )}
        {document.revertibleUntil && (
          <Text size="xs" c="dimmed">
            pode ser revertido até {formatDate(document.revertibleUntil)}
          </Text>
        )}
      </Table.Td>
      <Table.Td>{actions}</Table.Td>
    </>
  );
}
