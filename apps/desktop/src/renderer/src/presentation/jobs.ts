/**
 * Textos das execuções e dos envios ao Comercial nas listas e nos cards (specs/006; telas 3.1, 7.2,
 * 7.4 e 7.7): quando, quem pediu e o resultado de um envio. O selo da situação vem do tom do rótulo
 * (`badgeOf`), com "Em andamento" em lima (tom `progress`, FR-005).
 */
import { formatDateTime } from './format';

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
  checked?: number;
}): string {
  const count = (value: number, one: string, many: string) =>
    `${value} ${value === 1 ? one : many}`;
  // Verificação da fila "Cobradas no Hunit" (specs/008): conferidas em vez de enviadas.
  if ((counts.checked ?? 0) > 0) {
    return [
      count(counts.checked ?? 0, 'conferida', 'conferidas'),
      count(counts.notVerified, 'não verificada', 'não verificadas'),
    ].join(' · ');
  }
  return [
    count(counts.sent, 'enviada', 'enviadas'),
    count(counts.withdrawn, 'retirada', 'retiradas'),
    count(counts.notVerified, 'não verificada', 'não verificadas'),
    ...(counts.ignored > 0 ? [`${counts.ignored} fora do envio`] : []),
  ].join(' · ');
}
