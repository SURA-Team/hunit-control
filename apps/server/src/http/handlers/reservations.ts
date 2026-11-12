import type { operations } from '@hunit/contracts';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../persistence/db.js';
import { InvalidCursorError } from '../../persistence/executions-repo.js';
import {
  findReservation,
  listChannels,
  listReservations,
} from '../../persistence/reservations-repo.js';
import { ProblemError } from '../problem.js';
import { toReservationView } from '../views.js';

type ListReservationsQuery = NonNullable<operations['listReservations']['parameters']['query']>;
type ReservationParams = operations['getReservation']['parameters']['path'];

const DEFAULT_PAGE_SIZE = 50;
/** Tamanho mínimo da busca livre depois de tirar os espaços das pontas (contrato: `q`). */
const MIN_FREE_TEXT = 2;

/** Busca livre sem espaços nas pontas; curta demais depois disso é recusada. */
function freeText(q: string | undefined): string | undefined {
  if (q === undefined) return undefined;
  const text = q.trim();
  if (text.length < MIN_FREE_TEXT) {
    throw new ProblemError(
      'validation_error',
      `A busca (q) precisa de pelo menos ${MIN_FREE_TEXT} caracteres além dos espaços.`,
    );
  }
  return text;
}

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

      const q = freeText(query.q);
      try {
        const page = await listReservations(db, {
          executionId: query.executionId,
          hotelCodes: query.hotelCode,
          classifications: query.classification,
          reservationStatuses: query.reservationStatus,
          notFound: query.notFound,
          checkInFrom: query.checkInFrom,
          checkInTo: query.checkInTo,
          q,
          channel: query.channel,
          amount: query.amount,
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

    /** GET /v1/channels — canais das reservas gravadas, para o filtro (specs/002, FR-020). */
    async listChannels() {
      return { items: await listChannels(db) };
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
