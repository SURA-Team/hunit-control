/**
 * Situação da reserva (specs/003, FR-002, FR-002a, FR-017): o nome da situação e, quando o Hunit
 * mudou a situação depois da tratativa, o alerta "Verificar". A situação e o alerta vêm prontos do
 * servidor. Desde a 005, o nome é o da situação detalhada ("Validar comprovante" quando há retorno
 * do Comercial aguardando validação).
 */
import { Badge, Group } from '@mantine/core';
import type { ReservationTreatment } from '../../../shared/ipc-types';
import { DETAILED_SITUATION_LABELS, REVIEW_LABEL, TONE_COLORS } from '../presentation/labels';
import { StatusBadge } from './StatusBadge';

export function SituationBadge({
  treatment,
  size = 'sm',
}: {
  treatment: Pick<ReservationTreatment, 'detailedSituation' | 'needsReview'>;
  size?: 'xs' | 'sm' | 'md';
}) {
  return (
    <Group gap={4} wrap="nowrap">
      <StatusBadge label={DETAILED_SITUATION_LABELS[treatment.detailedSituation]} size={size} />
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
