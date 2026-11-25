/**
 * Textos e ordem dos hotéis do módulo de Relatórios (specs/007, T011 e T023): percentuais, frases
 * do topo, "X de Y", recorte no singular, busca sem acento e as ordenações da gaveta. Dados fictícios.
 */
import { describe, expect, it } from 'vitest';
import {
  formatShare,
  formatWholeShare,
  hotelsWithData,
  lastVerificationText,
  localToday,
  periodRange,
  rankingHotels,
  rankingPosition,
  reservationsInRange,
  searchHotels,
  sortHotels,
  valueDistribution,
} from '../../src/renderer/src/presentation/report';
import { HOTEL_ROWS, hotelRow, overview } from './report-fixtures';

const names = (rows: { hotelName: string }[]) => rows.map((row) => row.hotelName);

describe('textos', () => {
  it('percentuais da distribuição e do card escuro', () => {
    expect(formatShare({ percent: 96.6, belowMinimum: false })).toBe('96,6%');
    expect(formatShare({ percent: 1, belowMinimum: false })).toBe('1,0%');
    expect(formatShare({ percent: 0, belowMinimum: true })).toBe('<0,1%');
    expect(formatWholeShare(35, 100)).toBe('35%');
    expect(formatWholeShare(0.5, 100)).toBe('<1%');
    expect(formatWholeShare(0, 0)).toBe('0%');
  });

  it('recorte, "X de Y" e o período', () => {
    expect(reservationsInRange(34526)).toBe('34.526 reservas no recorte');
    expect(reservationsInRange(1)).toBe('1 reserva no recorte');
    expect(reservationsInRange(0)).toBe('0 reservas no recorte');
    expect(hotelsWithData(overview())).toBe('79 de 83');
    expect(periodRange('2026-11-01', '2026-11-30')).toBe('01/11 a 30/11/2026');
    expect(periodRange('2026-12-20', '2027-01-05')).toBe('20/12/2026 a 05/01/2027');
    expect(lastVerificationText(null)).toBeNull();
    expect(lastVerificationText('2026-11-10T13:23:00.000Z')).toMatch(
      /^Última verificação das reservas: 10\/11\/2026 às \d{2}:23$/,
    );
  });

  it('hoje na máquina, no formato da API', () => {
    expect(localToday(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
  });

  it('distribuição na ordem do design, somando 100', () => {
    const items = valueDistribution(overview());
    expect(items.map((item) => item.tone)).toEqual([
      'previous',
      'recovered',
      'pending',
      'requested',
    ]);
    expect(items.reduce((sum, item) => sum + Math.round(item.share.percent * 10), 0)).toBe(1000);
  });
});

describe('hotéis', () => {
  it('ranking: só com valor em aberto, do maior para o menor', () => {
    expect(names(rankingHotels(HOTEL_ROWS))).toEqual(['Hotel Praia Azul', 'Pousada Serra Verde']);
    expect(rankingPosition(HOTEL_ROWS, '32')).toBe(2);
    expect(rankingPosition(HOTEL_ROWS, '33')).toBeNull();
  });

  it('ordenações: maior valor, mais pendente e nome; empate pelo nome; R$ 0,00 no fim', () => {
    const rows = [
      ...HOTEL_ROWS,
      hotelRow({
        hotelCode: '34',
        hotelName: 'Alto da Colina',
        openAmount: '24807.17',
        pending: '1.00',
      }),
    ];
    expect(names(sortHotels(rows, 'open'))).toEqual([
      'Hotel Praia Azul',
      'Alto da Colina',
      'Pousada Serra Verde',
      'Hotel Centro Histórico',
    ]);
    expect(names(sortHotels(rows, 'pending'))).toEqual([
      'Pousada Serra Verde',
      'Hotel Praia Azul',
      'Alto da Colina',
      'Hotel Centro Histórico',
    ]);
    expect(names(sortHotels(rows, 'name'))).toEqual([
      'Alto da Colina',
      'Hotel Centro Histórico',
      'Hotel Praia Azul',
      'Pousada Serra Verde',
    ]);
  });

  it('busca pelo nome sem acento e sem maiúsculas', () => {
    expect(names(searchHotels(HOTEL_ROWS, '  HISTORICO '))).toEqual(['Hotel Centro Histórico']);
    expect(names(searchHotels(HOTEL_ROWS, 'praia'))).toEqual(['Hotel Praia Azul']);
    expect(searchHotels(HOTEL_ROWS, '')).toHaveLength(3);
    expect(searchHotels(HOTEL_ROWS, 'xyz')).toHaveLength(0);
  });
});
