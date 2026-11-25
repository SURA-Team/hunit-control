/**
 * Resumos fictícios do módulo de Relatórios (specs/007), com os números do design (8.1) em três
 * hotéis de nome fictício.
 */
import type { HotelReportRow, ReportOverview } from '../../src/shared/ipc-types';

export function hotelRow(overrides: Partial<HotelReportRow> = {}): HotelReportRow {
  return {
    hotelCode: '31',
    hotelName: 'Hotel Praia Azul',
    reservations: 1204,
    treatmentsSent: 41,
    openCount: 37,
    openAmount: '25831.60',
    requested: '15004.10',
    pending: '10827.50',
    previousCharged: '1000.00',
    recovered: '4120.00',
    ...overrides,
  };
}

export const HOTEL_ROWS: HotelReportRow[] = [
  hotelRow(),
  hotelRow({
    hotelCode: '32',
    hotelName: 'Pousada Serra Verde',
    reservations: 900,
    treatmentsSent: 12,
    openCount: 20,
    openAmount: '24807.17',
    requested: '5000.00',
    pending: '19807.17',
    recovered: '100.00',
  }),
  hotelRow({
    hotelCode: '33',
    hotelName: 'Hotel Centro Histórico',
    reservations: 300,
    treatmentsSent: 0,
    openCount: 0,
    openAmount: '0.00',
    requested: '0.00',
    pending: '0.00',
    recovered: '0.00',
  }),
];

export function overview(overrides: Partial<ReportOverview> = {}): ReportOverview {
  return {
    period: { from: '2026-10-27', to: '2026-11-25' },
    generatedAt: '2026-11-16T13:58:00.000Z',
    lastVerifiedAt: '2026-11-10T13:23:00.000Z',
    reservations: 34526,
    treatmentsSent: 1161,
    withoutAmount: 0,
    hotels: { withData: 79, total: 83 },
    open: { amount: '211120.47', count: 57, requested: '73888.15', pending: '137232.32' },
    charged: { amount: '13580943.88', previous: '13323685.89', recovered: '257257.99' },
    hotelRows: HOTEL_ROWS,
    ...overrides,
  };
}
