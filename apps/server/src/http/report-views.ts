/**
 * Resumo do período no formato da API (specs/007, contracts/api-changes.md): datas ISO e valores
 * com duas casas. Sem dado de hóspede (FR-027).
 */
import type { components } from '@hunit/contracts';
import type { HotelReportRow, ReportOverview } from '../persistence/reports-repo.js';

type ReportOverviewView = components['schemas']['ReportOverview'];
type HotelReportRowView = components['schemas']['HotelReportRow'];

function toHotelReportRowView(row: HotelReportRow): HotelReportRowView {
  return {
    hotelCode: row.hotelCode,
    hotelName: row.hotelName,
    reservations: row.reservations,
    treatmentsSent: row.treatmentsSent,
    openCount: row.openCount,
    openAmount: row.openAmount,
    requested: row.requested,
    pending: row.pending,
    previousCharged: row.previousCharged,
    recovered: row.recovered,
  };
}

export function toReportOverviewView(report: ReportOverview): ReportOverviewView {
  return {
    period: { from: report.period.from, to: report.period.to },
    generatedAt: report.generatedAt.toISOString(),
    lastVerifiedAt: report.lastVerifiedAt?.toISOString() ?? null,
    reservations: report.reservations,
    treatmentsSent: report.treatmentsSent,
    withoutAmount: report.withoutAmount,
    hotels: { ...report.hotels },
    open: { ...report.open },
    charged: { ...report.charged },
    hotelRows: report.hotelRows.map(toHotelReportRowView),
  };
}
