/**
 * Selo da situação de uma execução ou de um envio ao Comercial (specs/006; telas 3.1, 3.2, 7.2 e
 * 7.4): "Em andamento" em lima, como no design (o lima é o destaque do que está acontecendo agora,
 * FR-013); as demais situações pelo tom do rótulo (verde concluído, vermelho falhou, âmbar aguardando
 * o token, cinza na fila ou cancelado).
 */
import type { ExecutionStatus } from '../../../shared/ipc-types';
import type { SituationBadgeItem } from '../ui';
import { formatDateTime } from './format';
import type { Label } from './labels';
import { badgeOf } from './reservations';

export function jobStatusBadge(label: Label, status: ExecutionStatus): SituationBadgeItem {
  return status === 'running' ? { label: label.name, tone: 'lime' } : badgeOf(label);
}

/** "18/11/2026 · 10:42": data e hora de uma execução ou de um envio, como nas listas do design. */
export function formatWhen(value: string | null | undefined): string {
  return formatDateTime(value).replace(' ', ' · ');
}

/** "Recepção — PC 1 (esta máquina)": quem pediu, marcando quando foi esta máquina. */
export function requesterName(requested: string, thisClient: string | null | undefined): string {
  return requested === thisClient ? `${requested} (esta máquina)` : requested;
}

/** "14 enviadas · 0 retiradas · 1 não verificada": o resultado de um envio ao Comercial. */
export function dispatchTally(counts: {
  sent: number;
  withdrawn: number;
  notVerified: number;
  ignored: number;
}): string {
  const count = (value: number, one: string, many: string) =>
    `${value} ${value === 1 ? one : many}`;
  return [
    count(counts.sent, 'enviada', 'enviadas'),
    count(counts.withdrawn, 'retirada', 'retiradas'),
    count(counts.notVerified, 'não verificada', 'não verificadas'),
    ...(counts.ignored > 0 ? [`${counts.ignored} fora do envio`] : []),
  ].join(' · ');
}
