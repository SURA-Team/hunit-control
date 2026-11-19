/**
 * Estado e resultado de uma execução iniciada na tela Executar (specs/002, US1 cenários 2, 5 e 7,
 * FR-013, data-model §6): situação, contagens por situação de cobrança, hotéis concluídos e com
 * falha (com o motivo) e a mensagem do motivo de término. Depois de prazo do token esgotado ou
 * token recusado, oferece "Iniciar de novo" com os mesmos dados.
 *
 * Desde a 006 (T057; telas 2.6, 2.7, 2.8 e 2.10): card com "Execução em andamento" ou "Resultado da
 * execução", o selo ("Em andamento" em lima) e o período à direita; o motivo de término num aviso
 * (vermelho, ou âmbar se cancelada) com "Iniciar de novo" como principal; enquanto roda, a faixa
 * escura "N de M hotéis concluídos"; as contagens em caixas e os hotéis em linhas simples.
 */
import { Group, Text } from '@mantine/core';
import type { Execution, ExecutionEndReason } from '../../../../shared/ipc-types';
import { ClassificationCountsGrid } from '../../components/ClassificationCountsGrid';
import { EvidenceList } from '../../components/EvidenceList';
import { formatDate } from '../../presentation/format';
import { END_REASON_MESSAGES, EXECUTION_STATUS_LABELS } from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { Action, Card, Notice, SectionTitle, StatusBadge } from '../../ui';
import {
  ACTIVE_EXECUTION,
  ExecutionHotels,
  ExecutionProgressStrip,
} from '../executions/ExecutionParts';

/** Motivos em que basta iniciar de novo com os mesmos dados (US1, cenário 5). */
const RESTARTABLE: ReadonlySet<ExecutionEndReason> = new Set([
  'two_factor_timeout',
  'invalid_token',
]);

interface Props {
  execution: Execution;
  onRestart?: () => void;
  restarting?: boolean;
}

export function ExecutionResult({ execution, onRestart, restarting = false }: Props) {
  const { status, endReason } = execution;
  const active = ACTIVE_EXECUTION.has(status);
  const title = active ? 'Execução em andamento' : 'Resultado da execução';
  const badge = badgeOf(EXECUTION_STATUS_LABELS[status]);

  return (
    <Card block={title} data-testid="execution-result">
      <Group justify="space-between" gap={8}>
        <Group gap={8}>
          <SectionTitle>{title}</SectionTitle>
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </Group>
        <Text size="sm" c="dimmed">
          Check-in de {formatDate(execution.period.from)} a {formatDate(execution.period.to)}
        </Text>
      </Group>

      {endReason && (
        <Notice
          tone={status === 'cancelled' ? 'amber' : 'red'}
          role="status"
          action={
            onRestart &&
            RESTARTABLE.has(endReason) && (
              <Action variant="primary" size="xs" onClick={onRestart} loading={restarting}>
                Iniciar de novo
              </Action>
            )
          }
        >
          {END_REASON_MESSAGES[endReason]}
        </Notice>
      )}

      {active && <ExecutionProgressStrip execution={execution} />}
      <ClassificationCountsGrid counts={execution.counts} />
      <ExecutionHotels execution={execution} />
      <EvidenceList executionId={execution.id} />
    </Card>
  );
}
