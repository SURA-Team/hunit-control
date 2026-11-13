/**
 * Evidências de falha de uma execução (ou de um hotel dela), com "Salvar" para cada arquivo
 * (specs/002, FR-024, US3 cenário 6). O processo principal baixa e grava onde o operador escolher;
 * a interface só recebe o caminho gravado. Evidência vencida é avisada como indisponível.
 */
import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { EvidenceFile, EvidenceSummary } from '../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../hunit';
import { formatDateTime } from '../presentation/format';

const KIND_NAMES: Record<EvidenceSummary['kind'], string> = {
  navigation_failure: 'Falha de navegação',
  classification_failure: 'Falha ao classificar',
  screen_not_recognized: 'Tela ou resposta do Hunit não reconhecida',
  reservation_status_unknown: 'Situação da reserva não identificada',
};

const FILE_NAMES: Record<EvidenceFile, string> = {
  screenshot: 'Salvar captura',
  html: 'Salvar HTML',
  response: 'Salvar resposta',
};

interface Props {
  executionId: string;
  hotelCode?: string;
}

export function EvidenceList({ executionId, hotelCode }: Props) {
  const hunit = useHunit();
  const evidence = useQuery({
    queryKey: ['evidence', executionId],
    queryFn: () => unwrap(hunit.evidence.list(executionId)),
  });
  const [messages, setMessages] = useState<Record<string, { text: string; error: boolean }>>({});

  const save = useMutation({
    mutationFn: (input: { item: EvidenceSummary; file: EvidenceFile }) =>
      unwrap(
        hunit.evidence.save({
          evidenceId: input.item.id,
          file: input.file,
          label: input.item.hotelCode ?? executionId.slice(0, 8),
        }),
      ),
    onSuccess: (result, input) => {
      if (result) {
        setMessages((previous) => ({
          ...previous,
          [input.item.id]: { text: `Salvo em ${result.savedTo}`, error: false },
        }));
      }
    },
    onError: (error, input) =>
      setMessages((previous) => ({
        ...previous,
        [input.item.id]: { text: messageOf(error), error: true },
      })),
  });

  const items = (evidence.data ?? []).filter(
    (item) => hotelCode === undefined || item.hotelCode === hotelCode,
  );
  if (items.length === 0) return null;

  return (
    <Paper withBorder p="sm" radius="sm" data-testid="evidence-list">
      <Title order={5} mb="xs">
        Evidências de falha
      </Title>
      <Stack gap="sm">
        {items.map((item) => (
          <Stack key={item.id} gap={4}>
            <Text size="sm" fw={600}>
              {KIND_NAMES[item.kind]}
              {item.hotelCode ? ` — hotel ${item.hotelCode}` : ''}
              {item.reservationNumber ? `, reserva ${item.reservationNumber}` : ''}
            </Text>
            <Text size="sm">{item.reason}</Text>
            <Text size="xs" c="dimmed">
              Registrada em {formatDateTime(item.createdAt)}; disponível até{' '}
              {formatDateTime(item.expiresAt)}
            </Text>
            <Group gap="xs">
              {item.files.map((file) => (
                <Button
                  key={file}
                  size="xs"
                  variant="default"
                  onClick={() => save.mutate({ item, file })}
                  loading={
                    save.isPending &&
                    save.variables.item.id === item.id &&
                    save.variables.file === file
                  }
                >
                  {FILE_NAMES[file]}
                </Button>
              ))}
            </Group>
            {messages[item.id] && (
              <Text size="sm" c={messages[item.id]?.error ? 'red' : 'green.8'} role="status">
                {messages[item.id]?.text}
              </Text>
            )}
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
