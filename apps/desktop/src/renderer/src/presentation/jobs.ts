/**
 * Selo da situação de uma execução ou de um envio ao Comercial (specs/006; telas 3.1, 3.2, 7.2 e
 * 7.4): "Em andamento" em lima, como no design (o lima é o destaque do que está acontecendo agora,
 * FR-013); as demais situações pelo tom do rótulo (verde concluído, vermelho falhou, âmbar aguardando
 * o token, cinza na fila ou cancelado).
 */
import type { ExecutionStatus } from '../../../shared/ipc-types';
import type { SituationBadgeItem } from '../ui';
import type { Label } from './labels';
import { badgeOf } from './reservations';

export function jobStatusBadge(label: Label, status: ExecutionStatus): SituationBadgeItem {
  return status === 'running' ? { label: label.name, tone: 'lime' } : badgeOf(label);
}
