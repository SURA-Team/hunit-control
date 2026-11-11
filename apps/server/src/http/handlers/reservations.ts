import type { operations } from '@hunit/contracts';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../persistence/db.js';
import { InvalidCursorError } from '../../persistence/executions-repo.js';
import { findReservation, listReservations } from '../../persistence/reservations-repo.js';
import { ProblemError } from '../problem.js';
import { toReservationView } from '../views.js';

type ListReservationsQuery = NonNullable<operations['listReservations']['parameters']['query']>;
type ReservationParams = operations['getReservation']['parameters']['path'];

const DEFAULT_PAGE_SIZE = 50;

export function createReservationHandlers(dependencies: { db: Database }) {
  const { db } = dependencies;

  return {
    /** GET /v1/reservations — reservas com filtros combináveis (FR-020). */
    async listReservations(request: FastifyRequest) {
      const query = request.query as ListReservationsQuery;
      if (query.checkInFrom && query.checkInTo && query.checkInFrom > query.checkInTo) {
        throw new ProblemError(
          'validation_error',
          'O início do filtro de check-in (checkInFrom) não pode ser depois do fim (checkInTo).',
        );
      }

      try {
        const page = await listReservations(db, {
          executionId: query.executionId,
          hotelCodes: query.hotelCode,
          classifications: query.classification,
          reservationStatuses: query.reservationStatus,
          notFound: query.notFound,
          checkInFrom: query.checkInFrom,
          checkInTo: query.checkInTo,
          limit: query.limit ?? DEFAULT_PAGE_SIZE,
          cursor: query.cursor,
        });
        return { items: page.items.map(toReservationView), nextCursor: page.nextCursor };
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          throw new ProblemError('validation_error', 'O parâmetro "cursor" é inválido.');
        }
        throw error;
      }
    },

    /** GET /v1/reservations/{hotelCode}/{reservationNumber} — uma reserva (FR-016 a FR-018a). */
    async getReservation(request: FastifyRequest) {
      const { hotelCode, reservationNumber } = request.params as ReservationParams;
      const row = await findReservation(db, hotelCode, reservationNumber);
      if (!row) throw new ProblemError('not_found', 'Reserva não encontrada.');
      return toReservationView(row);
    },
  };
}
