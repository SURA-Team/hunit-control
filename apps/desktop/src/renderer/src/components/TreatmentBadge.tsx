/**
 * Situação da tratativa de uma reserva (specs/003, FR-002): "Enviada" (pedido de cobrança feito,
 * ainda pendente) ou "Cobrada" (com comprovante). Reserva sem tratativa não ganha marcação. A
 * situação vem pronta do servidor.
 */
import type { TreatmentStatus } from '../../../shared/ipc-types';
import { TREATMENT_STATUS_LABELS } from '../presentation/labels';
import { StatusBadge } from './StatusBadge';

export function TreatmentBadge({
  status,
  size = 'sm',
}: {
  status: TreatmentStatus | undefined;
  size?: 'xs' | 'sm' | 'md';
}) {
  if (status === undefined || status === 'none') return null;
  return <StatusBadge label={TREATMENT_STATUS_LABELS[status]} size={size} />;
}
