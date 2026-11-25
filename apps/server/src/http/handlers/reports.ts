import { InvalidPeriodError, validatePeriod, type Period } from '@hunit/domain';
import type { operations } from '@hunit/contracts';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../persistence/db.js';
import { reportOverview, type ReportFilters } from '../../persistence/reports-repo.js';
import { ProblemError } from '../problem.js';
import { toReportOverviewView } from '../report-views.js';

type OverviewQuery = operations['getReportOverview']['parameters']['query'];

export function createReportHandlers(dependencies: { db: Database; now?: () => Date }) {
  return {
    /**
     * GET /v1/reports/overview — resumo do período de check-in, com uma linha por hotel
     * (specs/007, research R-02), com os filtros da lista, se vierem (R-14). Para os dois perfis; só
     * leitura; sem dado de hóspede.
     */
    async getReportOverview(request: FastifyRequest) {
      const query = request.query as OverviewQuery;
      const period: Period = { from: query.checkInFrom, to: query.checkInTo };
      try {
        validatePeriod(period);
      } catch (error) {
        if (error instanceof InvalidPeriodError) {
          throw new ProblemError('validation_error', error.message);
        }
        throw error;
      }
      // Os filtros da lista (1.11.0; FR-005a, research R-14).
      const filters: ReportFilters = {
        hotelCodes: query.hotelCode,
        detailedSituations: query.detailedSituation,
        reservationStatuses: query.reservationStatus,
        channel: query.channel,
        fromLegacy: query.fromLegacy,
        notFound: query.notFound,
      };
      const now = dependencies.now?.() ?? new Date();
      return toReportOverviewView(await reportOverview(dependencies.db, period, filters, now));
    },
  };
}
