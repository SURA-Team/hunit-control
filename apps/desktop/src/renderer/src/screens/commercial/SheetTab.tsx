/**
 * Aba "Planilha" da área Comercial (specs/005, FR-013, FR-022): a situação da integração, as
 * atualizações pendentes e desde quando, a última rodada e a última leitura, a falha atual (sempre
 * com mensagem genérica, nunca o identificador da planilha nem a chave) e "Ler retornos agora".
 */
import { Alert, Button, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { SheetReadResult } from '../../../../shared/ipc-types';
import { StatusBadge } from '../../components/StatusBadge';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime } from '../../presentation/format';
import { SHEET_STATUS_LABELS } from '../../presentation/labels';
import { useConnection } from '../../state/connection';

export const sheetStatusKey = ['commercial-sheet'] as const;

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

  if (status.isError) {
    return (
      <Alert color="red" role="alert">
        {messageOf(status.error)}
      </Alert>
    );
  }
  if (!sheet) return <Text size="sm">Carregando…</Text>;
  if (!sheet.configured) {
    return (
      <Alert color="gray" title="Planilha do Comercial não configurada">
        O servidor não tem a planilha do Comercial configurada; o envio ao Comercial está desligado.
        Quem administra o servidor configura a planilha (README, &quot;Planilha do Comercial&quot;).
      </Alert>
    );
  }

  return (
    <Stack gap="md" data-testid="sheet-status">
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Group gap="xs">
              <Text fw={600}>Situação</Text>
              <StatusBadge label={SHEET_STATUS_LABELS[sheet.status]} />
            </Group>
            {isOperator && (
              <Button
                size="xs"
                loading={reading}
                disabled={state?.status === 'offline'}
                onClick={() => void readNow()}
              >
                Ler retornos agora
              </Button>
            )}
          </Group>
          {sheet.lastError && (
            <Alert color="red" role="alert" title="Falha atual">
              {sheet.lastError.message} ({formatDateTime(sheet.lastError.at)})
              {sheet.nextAttemptAt &&
                ` O servidor tenta de novo sozinho às ${formatDateTime(sheet.nextAttemptAt)}; nada se perde enquanto isso.`}
            </Alert>
          )}
          {sheet.status === 'layout_invalid' && (
            <Text size="sm" c="red">
              O formato da planilha foi alterado. Quem administra o servidor precisa rodar o comando
              de preparação da planilha de novo.
            </Text>
          )}
          {message && (
            <Alert color={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
              {message.text}
            </Alert>
          )}
          <SimpleGrid cols={3} spacing="sm">
            <Field label="Atualizações pendentes">
              {sheet.pending.count}
              {sheet.pending.oldestChangeAt && (
                <Text size="xs" c="dimmed">
                  desde {formatDateTime(sheet.pending.oldestChangeAt)}
                </Text>
              )}
            </Field>
            <Field label="Retornos aguardando validação">{sheet.awaitingValidation}</Field>
            <Field label="Retornos com problema">{sheet.problems.length}</Field>
            <Field label="Última rodada completa">{formatDateTime(sheet.lastRoundOkAt)}</Field>
            <Field label="Última leitura dos retornos">{formatDateTime(sheet.lastReadOkAt)}</Field>
          </SimpleGrid>
        </Stack>
      </Paper>
    </Stack>
  );
}
