/**
 * Tratativa de uma reserva, no detalhe (specs/003, US1, US2, US4, FR-017): situação, alerta
 * "Verificar" (FR-002a), documentos atuais e anteriores, valor cobrado informado à mão e histórico
 * (os 5 mais recentes e "Mostrar mais", FR-017a).
 *
 * O perfil operador anexa, substitui, desfaz, reverte, informa o valor e confirma o alerta; o
 * perfil consulta só vê e baixa (FR-014). O que cada reserva aceita, até quando um documento pode
 * ser revertido e qual valor vale vêm prontos do servidor.
 *
 * Desde a 006 (T038 e T045; telas 4.7 e 4.9, research R-12):
 * - card "Tratativa" com a situação ao lado do título e "Anexar/Substituir tratativa" e
 *   "Anexar/Substituir comprovante" com o mesmo peso (FR-012);
 * - cada documento numa linha (ícone, nome, arquivo, quem anexou, situação e as ações de documento
 *   "Baixar", "Desfazer" e "Reverter", FR-010, FR-020);
 * - o valor salvo numa caixa à parte, com "Remover valor", e o campo "Corrigir o valor cobrado" com
 *   "Informar valor" como principal: o digitado não substitui o salvo antes de confirmar (FR-026);
 * - com o alerta "Verificar", o aviso no topo com "Confirmar" (principal do aviso, que é um bloco à
 *   parte) e os botões de anexar desabilitados com o motivo ao lado; os documentos continuam com
 *   "Baixar" (FR-029). Só apresentação: o servidor continua aceitando o anexo (R-12).
 */
import { Group, Stack, Text } from '@mantine/core';
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
import { badgeOf, situationBadges } from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import {
  Action,
  AppDialog,
  AttentionIcon,
  Card,
  CardAside,
  CardHeader,
  DataField,
  DocumentAction,
  DocumentIcon,
  Field,
  HotelRow,
  Notice,
  RowList,
  StatusBadge,
} from '../../ui';
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

  /** Por que os botões de anexar estão desabilitados para o operador (FR-029). */
  const attachBlocked = !treatment.acceptsDocuments
    ? 'O status do Hunit desta reserva não exige cobrança, por isso ela não aceita novos documentos.'
    : treatment.needsReview
      ? 'Confirme o alerta “Verificar” antes de anexar novos documentos.'
      : null;

  const documentActions = (document: TreatmentDocument) => (
    <>
      {document.state !== 'purged' && (
        <DocumentAction kind="download" onClick={() => void saveDocument(document)} />
      )}
      {canWrite && document.endedAt === null && (
        <DocumentAction kind="undo" disabled={busy} onClick={() => setRemoving(document)} />
      )}
      {canWrite && document.revertibleUntil && (
        <DocumentAction
          kind="revert"
          disabled={busy || !treatment.acceptsDocuments}
          onClick={() =>
            void run(() => hunit.treatments.revert(document.id), 'Documento revertido.')
          }
        />
      )}
    </>
  );

  const documentRow = (title: string, document: TreatmentDocument) => (
    <HotelRow
      key={document.id}
      icon={<DocumentIcon />}
      title={title}
      summary={<DocumentSummary document={document} />}
      status={
        document.state === 'purged' ? undefined : (
          <StatusBadge tone={badgeOf(DOCUMENT_STATE_LABELS[document.state]).tone}>
            {DOCUMENT_STATE_LABELS[document.state].name}
          </StatusBadge>
        )
      }
      actions={documentActions(document)}
    />
  );

  return (
    <Card block="Tratativa" data-testid="treatment-section">
      <CardHeader
        title="Tratativa"
        aside={
          treatment.status === 'none' ? (
            <CardAside>Sem tratativa</CardAside>
          ) : (
            <Group gap={8}>
              {situationBadges({ reservationStatus: 'active', treatment }).map((badge) => (
                <StatusBadge key={badge.label} tone={badge.tone} title={badge.title}>
                  {badge.label}
                </StatusBadge>
              ))}
            </Group>
          )
        }
        actions={
          isOperator && (
            <>
              {/* Mesmo peso para tratativa e comprovante (FR-012). */}
              {TREATMENT_KIND_ORDER.map((kind) => (
                <Action
                  key={kind}
                  size="xs"
                  variant="secondary"
                  disabled={!canWrite || attachBlocked !== null || busy}
                  onClick={() => {
                    setMessage(null);
                    setAttaching(kind);
                  }}
                >
                  {treatment[kind] ? 'Substituir' : 'Anexar'}{' '}
                  {TREATMENT_KIND_NAMES[kind].toLowerCase()}
                </Action>
              ))}
            </>
          )
        }
      />

      {isOperator && attachBlocked && (
        <Text size="sm" c="dimmed" data-testid="attach-blocked">
          {attachBlocked}
        </Text>
      )}
      {treatment.needsReview && (
        <Notice
          tone="amber"
          role="none"
          title="Verificar"
          icon={<AttentionIcon size={14} />}
          block="Verificar"
          data-testid="review-alert"
          action={
            isOperator && (
              <Action
                size="sm"
                variant="primary"
                disabled={!canWrite || busy}
                onClick={() =>
                  void run(() => hunit.treatments.confirmReview(key), 'Verificação confirmada.')
                }
              >
                Confirmar
              </Action>
            )
          }
        >
          Depois da tratativa, o Hunit passou a mostrar esta reserva como{' '}
          <b>{CLASSIFICATION_LABELS[reservation.classification].name}</b>. Confira a reserva
          {isOperator ? ' e confirme' : ''}. A tratativa continua registrada.
        </Notice>
      )}
      {message && (
        <Notice tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}
      {detail.isError && <Notice tone="red">{messageOf(detail.error)}</Notice>}

      <RowList label="Documentos da tratativa">
        {TREATMENT_KIND_ORDER.map((kind) => {
          const document = treatment[kind];
          return document ? (
            documentRow(TREATMENT_KIND_NAMES[kind], document)
          ) : (
            <HotelRow
              key={kind}
              icon={<DocumentIcon />}
              title={TREATMENT_KIND_NAMES[kind]}
              summary="Nenhum arquivo anexado"
            />
          );
        })}
        {previous.map((document) =>
          documentRow(`${TREATMENT_KIND_NAMES[document.kind]} anterior`, document),
        )}
      </RowList>

      {/* O valor salvo fica à parte do campo de correção (FR-026, tela 4.7). */}
      {treatment.manualChargedAmount ? (
        <Card tone="subtle" padding={12} data-testid="manual-amount">
          <Group justify="space-between" wrap="nowrap" gap={16}>
            <DataField label="Valor informado à mão">
              <b>{formatMoney(treatment.manualChargedAmount)}</b>
            </DataField>
            {canWrite && (
              <DocumentAction
                kind="remove"
                disabled={busy}
                onClick={() => void run(() => hunit.treatments.clearManualAmount(key))}
              />
            )}
          </Group>
        </Card>
      ) : (
        <DataField label="Valor informado à mão">—</DataField>
      )}
      {treatment.chargedAmountOrigin === 'hunit' && treatment.manualChargedAmount && (
        <Text size="xs" c="dimmed">
          O Hunit já informa o valor ({formatMoney(treatment.effectiveChargedAmount)}); é ele que
          vale.
        </Text>
      )}
      {canWrite && treatment.proof && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitAmount();
          }}
        >
          <Group gap={8} align="flex-end" wrap="nowrap">
            <Field
              flex={1}
              label="Corrigir o valor cobrado (R$)"
              placeholder="Ex.: 1.234,56"
              inputMode="decimal"
              value={amountDraft}
              onChange={(event) => setAmountDraft(event.currentTarget.value)}
            />
            <Action size="sm" type="submit" variant="primary" disabled={busy}>
              Informar valor
            </Action>
          </Group>
        </form>
      )}

      {history.length > 0 && (
        <Stack gap={8}>
          <CardHeader title="Histórico" />
          <ul aria-label="Histórico da tratativa" style={{ margin: 0, paddingLeft: 18 }}>
            {history.slice(0, historyShown).map((item) => (
              <li key={item.key}>
                <Text size="sm" span>
                  {formatDateTime(item.at)} — {item.text} — {item.who}
                </Text>
              </li>
            ))}
          </ul>
          {history.length > historyShown && (
            <Group>
              <Action
                size="xs"
                variant="text"
                onClick={() => setHistoryShown((shown) => shown + HISTORY_STEP)}
              >
                Mostrar mais
              </Action>
            </Group>
          )}
        </Stack>
      )}

      {/* Destrutiva confirmada: "Desfazer" em vermelho cheio; "Manter" é o cancelar (FR-009). */}
      <AppDialog
        opened={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Desfazer ${removing?.kind === 'proof' ? 'o comprovante' : 'a tratativa'}?`}
        onCancel={() => setRemoving(null)}
        cancelLabel="Manter"
        actions={
          <Action variant="danger" size="sm" onClick={() => removing && void remove(removing)}>
            Desfazer
          </Action>
        }
      >
        <Text size="sm">
          {removing?.fileName ?? 'O documento'} deixa de valer para esta reserva. Ele fica guardado
          por 30 dias e pode ser revertido nesse prazo.
        </Text>
      </AppDialog>

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
    </Card>
  );
}

/**
 * Resumo de um documento na linha (tela 4.7): o arquivo e o tamanho, quem anexou e quando e, para os
 * que deixaram de valer, quando e por quem, e até quando podem ser revertidos.
 */
function DocumentSummary({ document }: { document: TreatmentDocument }) {
  return (
    <>
      {document.fileName ?? <i>arquivo apagado</i>} · {formatFileSize(document.sizeBytes)}
      <Text span size="xs" c="dimmed" display="block">
        Anexado em {formatDateTime(document.attachedAt)} por{' '}
        {document.fromLegacy ? LEGACY_ORIGIN_NAME : document.attachedBy}
      </Text>
      {document.state === 'purged' && (
        <Text span size="xs" c="dimmed" display="block">
          {DOCUMENT_STATE_LABELS.purged.name}
        </Text>
      )}
      {document.endedAt && document.state !== 'purged' && (
        <Text span size="xs" c="dimmed" display="block">
          {DOCUMENT_STATE_LABELS[document.state].name} em {formatDateTime(document.endedAt)}
          {document.endedBy ? ` por ${document.endedBy}` : ''}
          {document.revertibleUntil &&
            ` · pode ser revertido até ${formatDate(document.revertibleUntil)}`}
        </Text>
      )}
    </>
  );
}
