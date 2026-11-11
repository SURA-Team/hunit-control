import type { HotelRunStatus } from '../persistence/schema.js';

/**
 * Medição de tempo e estimativa do tempo restante de uma execução (FR-021a, research R-08a).
 *
 * Funções puras: recebem o andamento dos hotéis (gravado em `execution_hotels`) e o relógio, e
 * não acessam banco nem rede.
 */

/** O que a medição precisa de cada hotel da execução. */
export interface HotelTiming {
  status: HotelRunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Reservas que o Hunit informou para o hotel (soma dos blocos do período já consultados). */
  reservationsTotal: number;
  /** Reservas já processadas (abertas ou não). */
  reservationsSeen: number;
  /** Reservas efetivamente abertas: as "258-" não são abertas e não entram na média. */
  reservationsOpened: number;
}

/** Médias das execuções anteriores, usadas enquanto a execução ainda não mediu nada. */
export interface TimingHistory {
  secondsPerReservation: number | null;
  secondsPerHotel: number | null;
}

export interface TimingInput {
  hotels: readonly HotelTiming[];
  /** A execução ainda está ativa; só então existe tempo restante a estimar. */
  active: boolean;
  history: TimingHistory;
  /** Hotéis processados ao mesmo tempo (HOTEL_CONCURRENCY, research R-08). */
  concurrency: number;
  now: Date;
}

export interface ExecutionTiming {
  /** Média da própria execução (FR-021a: consultável por execução). */
  avgSecondsPerReservation: number | null;
  /** Média da própria execução, só com hotéis concluídos. */
  avgSecondsPerHotel: number | null;
  estimatedRemainingSeconds: number | null;
}

function seconds(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Segundos por reserva aberta: tempo dos hotéis que abriram reservas dividido pelas reservas
 * abertas. O hotel em andamento conta até agora (média móvel); hotéis com falha ou cancelados
 * também contam, porque o tempo gasto neles foi real.
 */
export function averageSecondsPerReservation(
  hotels: readonly HotelTiming[],
  now: Date,
): number | null {
  let totalSeconds = 0;
  let opened = 0;
  for (const hotel of hotels) {
    if (!hotel.startedAt || hotel.reservationsOpened === 0) continue;
    const end = hotel.finishedAt ?? (hotel.status === 'running' ? now : null);
    if (!end) continue;
    totalSeconds += seconds(hotel.startedAt, end);
    opened += hotel.reservationsOpened;
  }
  return opened === 0 ? null : round2(totalSeconds / opened);
}

/** Duração média dos hotéis concluídos. */
export function averageSecondsPerHotel(hotels: readonly HotelTiming[]): number | null {
  const durations = hotels.flatMap((hotel) =>
    hotel.status === 'completed' && hotel.startedAt && hotel.finishedAt
      ? [seconds(hotel.startedAt, hotel.finishedAt)]
      : [],
  );
  if (durations.length === 0) return null;
  return round2(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

/**
 * Tempo restante estimado (R-08a): média por reserva × reservas ainda não processadas dos hotéis
 * em andamento + média por hotel × hotéis ainda não iniciados, dividido pelos hotéis processados
 * ao mesmo tempo. As médias são as da própria execução; enquanto ela não mediu nada, valem as das
 * execuções anteriores.
 *
 * @returns `null` se a execução não está ativa, se os hotéis ainda não foram definidos (antes do
 *   acesso ao Hunit) ou se falta medição para alguma parte do cálculo.
 */
export function estimateRemainingSeconds(input: TimingInput): number | null {
  const { hotels, now } = input;
  if (!input.active || hotels.length === 0) return null;

  const perReservation =
    averageSecondsPerReservation(hotels, now) ?? input.history.secondsPerReservation;
  const perHotel = averageSecondsPerHotel(hotels) ?? input.history.secondsPerHotel;

  const running = hotels.filter((hotel) => hotel.status === 'running');
  const pending = hotels.filter((hotel) => hotel.status === 'pending').length;

  let work = 0;
  for (const hotel of running) {
    if (hotel.reservationsTotal > 0) {
      if (perReservation === null) return null;
      work += perReservation * Math.max(0, hotel.reservationsTotal - hotel.reservationsSeen);
    } else {
      // A listagem ainda não respondeu: resta o que falta para a duração média de um hotel.
      if (perHotel === null) return null;
      const elapsed = hotel.startedAt ? seconds(hotel.startedAt, now) : 0;
      work += Math.max(0, perHotel - elapsed);
    }
  }
  if (pending > 0) {
    if (perHotel === null) return null;
    work += perHotel * pending;
  }

  const workers = Math.max(1, Math.min(input.concurrency, running.length + pending));
  return Math.round(work / workers);
}

export function executionTiming(input: TimingInput): ExecutionTiming {
  return {
    avgSecondsPerReservation: averageSecondsPerReservation(input.hotels, input.now),
    avgSecondsPerHotel: averageSecondsPerHotel(input.hotels),
    estimatedRemainingSeconds: estimateRemainingSeconds(input),
  };
}
