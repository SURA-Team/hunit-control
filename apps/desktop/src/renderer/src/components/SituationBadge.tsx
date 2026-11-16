/**
 * Situação da reserva (specs/003, FR-002, FR-002a, FR-017): o nome da situação e, quando o Hunit
 * mudou a situação depois da tratativa, o alerta "Verificar". A situação e o alerta vêm prontos do
 * servidor.
 */
import { Badge, Group } from '@mantine/core';
import type { ReservationTreatment } from '../../../shared/ipc-types';
import { REVIEW_LABEL, SITUATION_LABELS, TONE_COLORS } from '../presentation/labels';
import { StatusBadge } from './StatusBadge';

export function SituationBadge({
  treatment,
  size = 'sm',
}: {
  treatment: Pick<ReservationTreatment, 'situation' | 'needsReview'>;
  size?: 'xs' | 'sm' | 'md';
}) {
  return (
    <Group gap={4} wrap="nowrap">
      <StatusBadge label={SITUATION_LABELS[treatment.situation]} size={size} />
      {treatment.needsReview && (
        <Badge
          color={TONE_COLORS[REVIEW_LABEL.tone]}
          variant="filled"
          size={size}
          radius="sm"
          title="O Hunit mudou a situação depois da tratativa. Confira e confirme no detalhe da reserva."
        >
          {REVIEW_LABEL.name}
        </Badge>
      )}
    </Group>
  );
}
