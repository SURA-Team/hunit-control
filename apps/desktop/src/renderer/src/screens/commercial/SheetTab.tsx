/**
 * Aba "Planilha" da área Comercial (specs/005, FR-013, FR-022): a situação da integração, as
 * atualizações pendentes e desde quando, a última rodada e a última leitura, a falha atual (sempre
 * com mensagem genérica, nunca o identificador da planilha nem a chave) e "Ler retornos agora".
 *
 * Desde a 006 (T052; tela 7.10): o card "Situação da planilha" com o selo e "Ler retornos agora" como
 * principal, os avisos em `Notice` e os números em caixas cinza lado a lado (`DataTiles`).
 */
import { Group, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SheetReadResult } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime } from '../../presentation/format';
import { SHEET_STATUS_LABELS } from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { useConnection } from '../../state/connection';
import { Action, Card, DataTile, DataTiles, Notice, SectionTitle, StatusBadge } from '../../ui';

export const sheetStatusKey = ['commercial-sheet'] as const;

function roundSummary(read: SheetReadResult): string {
  if (read.round === null) {
    return 'A leitura passou de 50 segundos e continua no servidor. A situação abaixo se atualiza sozinha.';
  }
  const { returnsReceived, returnsChanged, problems, linesWritten } = read.round;
  return `Leitura concluída: ${returnsReceived} retorno(s) novo(s), ${returnsChanged} alterado(s), ${problems} com problema e ${linesWritten} linha(s) atualizada(s).`;
}

export function useSheetStatus() {
  const hunit = useHunit();
  return useQuery({
    queryKey: sheetStatusKey,
    queryFn: () => unwrap(hunit.commercial.sheetStatus()),
    refetchInterval: 30_000,
  });
}

export function SheetTab() {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const { isOperator, state } = useConnection();
  const status = useSheetStatus();
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const sheet = status.data;

  async function readNow() {
    setReading(true);
    setMessage(null);
    try {
      const read = await unwrap(hunit.commercial.readNow());
      queryClient.setQueryData(sheetStatusKey, read.sheet);
      setMessage({ tone: 'green', text: roundSummary(read) });
      for (const queryKey of [['reservations'], ['reservation'], ['commercial']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    } catch (caught) {
      setMessage({ tone: 'red', text: messageOf(caught) });
      void queryClient.invalidateQueries({ queryKey: sheetStatusKey });
    } finally {
      setReading(false);
    }
  }

  if (status.isError) return <Notice tone="red">{messageOf(status.error)}</Notice>;
  if (!sheet) return <Text size="sm">Carregando…</Text>;
  if (!sheet.configured) {
    return (
      <Notice tone="lime" role="status" title="Planilha do Comercial não configurada">
        O servidor não tem a planilha do Comercial configurada; o envio ao Comercial está desligado.
        Quem administra o servidor configura a planilha (README, &quot;Planilha do Comercial&quot;).
      </Notice>
    );
  }
  const badge = badgeOf(SHEET_STATUS_LABELS[sheet.status]);

  return (
    <Card padding={24} block="Situação da planilha" data-testid="sheet-status">
      <Group justify="space-between" gap={12}>
        <Group gap={8}>
          <SectionTitle>Situação da planilha</SectionTitle>
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </Group>
        {isOperator && (
          <Action
            variant="primary"
            size="sm"
            loading={reading}
            disabled={state?.status === 'offline'}
            onClick={() => void readNow()}
          >
            Ler retornos agora
          </Action>
        )}
      </Group>
      {sheet.lastError && (
        <Notice tone="red" title="Falha atual">
          {sheet.lastError.message} ({formatDateTime(sheet.lastError.at)})
          {sheet.nextAttemptAt &&
            ` O servidor tenta de novo sozinho às ${formatDateTime(sheet.nextAttemptAt)}; nada se perde enquanto isso.`}
        </Notice>
      )}
      {sheet.status === 'layout_invalid' && (
        <Notice tone="red" role="none">
          O formato da planilha foi alterado. Quem administra o servidor precisa rodar o comando de
          preparação da planilha de novo.
        </Notice>
      )}
      {message && (
        <Notice tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}
      <DataTiles label="Situação da planilha">
        <DataTile label="Atualizações pendentes">
          {sheet.pending.count}
          {sheet.pending.oldestChangeAt && (
            <Text size="xs" c="dimmed">
              desde {formatDateTime(sheet.pending.oldestChangeAt)}
            </Text>
          )}
        </DataTile>
        <DataTile label="Retornos aguardando validação">{sheet.awaitingValidation}</DataTile>
        <DataTile label="Retornos com problema">{sheet.problems.length}</DataTile>
        <DataTile label="Última rodada completa">{formatDateTime(sheet.lastRoundOkAt)}</DataTile>
        <DataTile label="Última leitura dos retornos">
          {formatDateTime(sheet.lastReadOkAt)}
        </DataTile>
      </DataTiles>
    </Card>
  );
}
