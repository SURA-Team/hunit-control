/**
 * Medição de tempo e estimativa do tempo restante (T052, research R-08a, FR-021a).
 */
import { describe, expect, it } from 'vitest';
import {
  averageSecondsPerHotel,
  averageSecondsPerReservation,
  estimateRemainingSeconds,
  executionTiming,
  type HotelTiming,
  type TimingInput,
} from '../../src/executions/timing.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');

/** Instante `seconds` segundos antes de NOW. */
function ago(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

function hotel(overrides: Partial<HotelTiming> = {}): HotelTiming {
  return {
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    reservationsTotal: 0,
    reservationsSeen: 0,
    reservationsOpened: 0,
    ...overrides,
  };
}

/** Hotel concluído que levou `seconds` segundos e abriu `opened` reservas. */
function completed(seconds: number, opened: number, seen = opened): HotelTiming {
  return hotel({
    status: 'completed',
    startedAt: ago(seconds + 1000),
    finishedAt: ago(1000),
    reservationsTotal: seen,
    reservationsSeen: seen,
    reservationsOpened: opened,
  });
}

function input(overrides: Partial<TimingInput> = {}): TimingInput {
  return {
    hotels: [],
    active: true,
    history: { secondsPerReservation: null, secondsPerHotel: null },
    concurrency: 1,
    now: NOW,
    ...overrides,
  };
}

describe('média por reserva (R-08a)', () => {
  it('divide o tempo dos hotéis pelas reservas abertas', () => {
    expect(averageSecondsPerReservation([completed(100, 10), completed(50, 15)], NOW)).toBe(6);
  });

  it('não conta as reservas "258-", que não são abertas', () => {
    // 20 reservas vistas, 10 abertas: 100 s / 10 = 10 s por reserva aberta.
    expect(averageSecondsPerReservation([completed(100, 10, 20)], NOW)).toBe(10);
  });

  it('inclui o hotel em andamento, medido até agora', () => {
    const running = hotel({ status: 'running', startedAt: ago(30), reservationsOpened: 3 });

    expect(averageSecondsPerReservation([completed(100, 10), running], NOW)).toBe(10);
  });

  it('inclui hotéis com falha ou cancelados que chegaram a abrir reservas', () => {
    const failed = { ...completed(40, 4), status: 'failed' as const };

    expect(averageSecondsPerReservation([failed], NOW)).toBe(10);
  });

  it('ignora hotéis sem reserva aberta e hotéis não iniciados', () => {
    expect(averageSecondsPerReservation([completed(80, 0), hotel()], NOW)).toBeNull();
  });

  it('arredonda para centésimos', () => {
    expect(averageSecondsPerReservation([completed(10, 3)], NOW)).toBe(3.33);
  });
});

describe('média por hotel', () => {
  it('usa só os hotéis concluídos', () => {
    const failed = { ...completed(500, 1), status: 'failed' as const };
    const running = hotel({ status: 'running', startedAt: ago(900) });

    expect(averageSecondsPerHotel([completed(100, 1), completed(60, 0), failed, running])).toBe(80);
  });

  it('sem hotel concluído, não há média', () => {
    expect(averageSecondsPerHotel([hotel({ status: 'running', startedAt: ago(5) })])).toBeNull();
  });
});

describe('estimativa do tempo restante (R-08a)', () => {
  it('média por reserva × reservas ainda não processadas + média por hotel × hotéis pendentes', () => {
    const hotels = [
      completed(100, 10), // 10 s por reserva, 100 s por hotel
      hotel({
        status: 'running',
        startedAt: ago(0),
        reservationsTotal: 8,
        reservationsSeen: 3,
      }),
      hotel(),
      hotel(),
    ];

    // 5 reservas restantes × 10 s + 2 hotéis × 100 s.
    expect(estimateRemainingSeconds(input({ hotels }))).toBe(250);
  });

  it('no início, sem medição na própria execução, usa a média das execuções anteriores', () => {
    const hotels = [hotel({ status: 'running', startedAt: ago(0), reservationsTotal: 4 }), hotel()];

    const estimate = estimateRemainingSeconds(
      input({ hotels, history: { secondsPerReservation: 2, secondsPerHotel: 30 } }),
    );

    expect(estimate).toBe(4 * 2 + 30);
  });

  it('a média da própria execução prevalece sobre a histórica', () => {
    const hotels = [completed(100, 10), hotel()];

    const estimate = estimateRemainingSeconds(
      input({ hotels, history: { secondsPerReservation: 1, secondsPerHotel: 999 } }),
    );

    expect(estimate).toBe(100);
  });

  it('hotel em andamento que ainda não listou reservas: média por hotel menos o tempo já gasto', () => {
    const hotels = [completed(100, 10), hotel({ status: 'running', startedAt: ago(40) })];

    expect(estimateRemainingSeconds(input({ hotels }))).toBe(60);
  });

  it('nunca fica negativa', () => {
    const hotels = [
      completed(100, 10),
      hotel({ status: 'running', startedAt: ago(400) }),
      hotel({ status: 'running', startedAt: ago(1), reservationsTotal: 2, reservationsSeen: 5 }),
    ];

    expect(estimateRemainingSeconds(input({ hotels, concurrency: 2 }))).toBe(0);
  });

  it('divide o trabalho restante pelos hotéis processados ao mesmo tempo (HOTEL_CONCURRENCY)', () => {
    const hotels = [completed(100, 10), hotel(), hotel(), hotel(), hotel()];

    expect(estimateRemainingSeconds(input({ hotels, concurrency: 2 }))).toBe(200);
    // Mais trabalhadores que hotéis restantes não acelera além de um hotel por trabalhador.
    expect(estimateRemainingSeconds(input({ hotels, concurrency: 10 }))).toBe(100);
  });

  it('desconsidera hotéis concluídos, com falha ou cancelados', () => {
    const hotels = [
      completed(100, 10),
      { ...completed(30, 3), status: 'failed' as const },
      { ...completed(30, 3), status: 'cancelled' as const },
    ];

    expect(estimateRemainingSeconds(input({ hotels }))).toBe(0);
  });

  it('sem medição nenhuma (nem histórica), não há estimativa', () => {
    const hotels = [hotel({ status: 'running', startedAt: ago(5), reservationsTotal: 3 }), hotel()];

    expect(estimateRemainingSeconds(input({ hotels }))).toBeNull();
  });

  it('hotel em andamento sem listagem e sem média por hotel: sem estimativa (e não zero)', () => {
    const hotels = [hotel({ status: 'running', startedAt: ago(1) })];

    expect(estimateRemainingSeconds(input({ hotels }))).toBeNull();
  });

  it('sem média por hotel, os hotéis pendentes impedem a estimativa', () => {
    const hotels = [hotel({ status: 'running', startedAt: ago(5), reservationsTotal: 3 }), hotel()];

    const estimate = estimateRemainingSeconds(
      input({ hotels, history: { secondsPerReservation: 2, secondsPerHotel: null } }),
    );

    expect(estimate).toBeNull();
  });

  it('execução encerrada ou sem hotéis definidos ainda: sem estimativa', () => {
    expect(estimateRemainingSeconds(input({ hotels: [hotel()], active: false }))).toBeNull();
    expect(
      estimateRemainingSeconds(
        input({ hotels: [], history: { secondsPerReservation: 2, secondsPerHotel: 30 } }),
      ),
    ).toBeNull();
  });
});

describe('executionTiming', () => {
  it('reúne as médias da própria execução e a estimativa', () => {
    const hotels = [completed(100, 10), hotel()];

    expect(
      executionTiming(input({ hotels, history: { secondsPerReservation: 1, secondsPerHotel: 1 } })),
    ).toEqual({
      avgSecondsPerReservation: 10,
      avgSecondsPerHotel: 100,
      estimatedRemainingSeconds: 100,
    });
  });

  it('as médias consultáveis são só as da própria execução, nunca as históricas', () => {
    expect(
      executionTiming(
        input({ hotels: [hotel()], history: { secondsPerReservation: 2, secondsPerHotel: 30 } }),
      ),
    ).toEqual({
      avgSecondsPerReservation: null,
      avgSecondsPerHotel: null,
      estimatedRemainingSeconds: 30,
    });
  });
});
