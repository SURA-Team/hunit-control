/**
 * Peças comuns ao detalhe da execução (telas 3.2 e 3.4) e ao resultado em Executar (telas 2.6 e 2.7),
 * specs/006, T056 e T057:
 * - `ExecutionProgressStrip`: a faixa escura "N de M hotéis concluídos", enquanto a execução roda;
 * - `ExecutionHotels`: cada hotel numa linha simples (FR-020) com o nome, o resumo ("Código 101 · 6
 *   reservas · 42 s", "lendo reservas · página 1 de 5", "aguardando na fila"), o motivo da falha e
 *   o último aviso do servidor, e o selo da situação ("Em andamento" em lima).
 */
import { Text } from '@mantine/core';
import type { Execution, ExecutionEvent } from '../../../../shared/ipc-types';
import { formatDuration, formatTime } from '../../presentation/format';
import { HOTEL_STATUS_LABELS } from '../../presentation/labels';
import { badgeOf } from '../../presentation/reservations';
import { HotelRow, ProgressStrip, RowList, StatusBadge } from '../../ui';

/** Situações em que a execução ainda está rodando (o card escuro, a faixa de progresso). */
export const ACTIVE_EXECUTION = new Set<Execution['status']>(['queued', 'running', 'awaiting_2fa']);

type Hotel = Execution['hotels'][number];

/** Hotéis que já terminaram (concluídos, com falha ou cancelados) e o total. */
export function hotelProgress(execution: Pick<Execution, 'hotels'>): {
  done: number;
  total: number;
} {
  const total = execution.hotels.length;
  const done = execution.hotels.filter(
    (hotel) => hotel.status !== 'pending' && hotel.status !== 'running',
  ).length;
  return { done, total };
}

export function ExecutionProgressStrip({ execution }: { execution: Execution }) {
  const { done, total } = hotelProgress(execution);
  if (total === 0) return null;
  return (
    <ProgressStrip
      label={`${done} de ${total} ${total === 1 ? 'hotel concluído' : 'hotéis concluídos'}`}
      percent={(done / total) * 100}
    />
  );
}

const reservations = (count: number) => `${count} ${count === 1 ? 'reserva' : 'reservas'}`;

/** "Código 101 · 6 reservas · 42 s" e as variações de cada situação do hotel. */
export function hotelSummary(hotel: Hotel): string {
  const parts = [`Código ${hotel.hotelCode}`];
  if (hotel.status === 'pending') {
    parts.push('aguardando na fila');
  } else if (hotel.status === 'running') {
    parts.push('lendo reservas');
    if (hotel.pagesTotal) parts.push(`página ${hotel.pagesDone ?? 0} de ${hotel.pagesTotal}`);
  } else {
    parts.push(reservations(hotel.reservationsSeen ?? 0));
    if (hotel.durationSeconds !== null && hotel.durationSeconds !== undefined) {
      parts.push(formatDuration(hotel.durationSeconds));
    }
  }
  return parts.join(' · ');
}

export function ExecutionHotels({
  execution,
  warnings = [],
}: {
  execution: Execution;
  /** Avisos do servidor: o mais recente de cada hotel em andamento aparece na linha dele. */
  warnings?: readonly ExecutionEvent[];
}) {
  if (execution.hotels.length === 0) return null;
  const latestWarning = new Map<string, ExecutionEvent>();
  for (const warning of warnings) {
    if (warning.hotelCode && !latestWarning.has(warning.hotelCode)) {
      latestWarning.set(warning.hotelCode, warning);
    }
  }
  return (
    <RowList label="Hotéis da execução">
      {execution.hotels.map((hotel) => {
        const badge = badgeOf(HOTEL_STATUS_LABELS[hotel.status]);
        const warning = hotel.status === 'running' ? latestWarning.get(hotel.hotelCode) : undefined;
        return (
          <HotelRow
            key={hotel.hotelCode}
            data-testid={`hotel-${hotel.hotelCode}`}
            title={hotel.hotelName ?? hotel.hotelCode}
            summary={
              <>
                {hotelSummary(hotel)}
                {hotel.failureReason && (
                  <Text
                    span
                    display="block"
                    size="xs"
                    c={hotel.status === 'failed' ? 'var(--hc-vermelho-9)' : 'var(--hc-amarelo-9)'}
                  >
                    {hotel.failureReason}
                  </Text>
                )}
                {warning && (
                  <Text span display="block" size="xs" c="var(--hc-amarelo-9)">
                    {formatTime(warning.at)} — {warning.message}
                  </Text>
                )}
              </>
            }
            status={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
          />
        );
      })}
    </RowList>
  );
}
