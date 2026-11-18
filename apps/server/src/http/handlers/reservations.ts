import type { operations } from '@hunit/contracts';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../persistence/db.js';
import { InvalidCursorError } from '../../persistence/executions-repo.js';
import {
  findReservation,
  listChannels,
  listReservations,
  selectReservations,
  type ReservationFilters,
} from '../../persistence/reservations-repo.js';
import { loadLegacyOrigins } from '../../persistence/legacy-import-repo.js';
import {
  EMPTY_TREATMENT,
  loadTreatmentSummaries,
  reservationKeyOf,
} from '../../persistence/treatments-repo.js';
import { ProblemError } from '../problem.js';
import {
  toCommercialSummaryView,
  toReservationTreatmentView,
  toReservationView,
} from '../views.js';

type ListReservationsQuery = NonNullable<operations['listReservations']['parameters']['query']>;
type SelectQuery = NonNullable<operations['selectReservations']['parameters']['query']>;

/** Limite da seleção do filtro (specs/005, FR-030; o mesmo da seleção da 003, FR-006a). */
export const MAX_SELECTION = 2000;
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

/** Os filtros da consulta (FR-020), comuns à lista e à seleção do filtro. */
function filtersOf(query: SelectQuery): ReservationFilters {
  if (query.checkInFrom && query.checkInTo && query.checkInFrom > query.checkInTo) {
    throw new ProblemError(
      'validation_error',
      'O início do filtro de check-in (checkInFrom) não pode ser depois do fim (checkInTo).',
    );
  }
  return {
    executionId: query.executionId,
    hotelCodes: query.hotelCode,
    classifications: query.classification,
    reservationStatuses: query.reservationStatus,
    notFound: query.notFound,
    checkInFrom: query.checkInFrom,
    checkInTo: query.checkInTo,
    q: freeText(query.q),
    channel: query.channel,
    amount: query.amount,
    treatmentStatuses: query.treatmentStatus,
    pendingCharge: query.pendingCharge,
    situations: query.situation,
    needsReview: query.needsReview,
    fromLegacy: query.fromLegacy,
    detailedSituations: query.detailedSituation,
  };
}

export function createReservationHandlers(dependencies: { db: Database; now?: () => Date }) {
  const { db } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  return {
    /** GET /v1/reservations — reservas com filtros combináveis (FR-020). */
    async listReservations(request: FastifyRequest) {
      const query = request.query as ListReservationsQuery;
      const filters = filtersOf(query);
      try {
        const page = await listReservations(db, {
          ...filters,
          limit: query.limit ?? DEFAULT_PAGE_SIZE,
          cursor: query.cursor,
        });
        // Tratativas da página inteira de uma vez, sem consulta por reserva (specs/003).
        const treatments = await loadTreatmentSummaries(db, page.items);
        const origins = await loadLegacyOrigins(db, page.items);
        const at = now();
        return {
          items: page.items.map((row) =>
            toReservationView(
              row,
              treatments.get(reservationKeyOf(row)),
              at,
              origins.get(reservationKeyOf(row)) ?? null,
            ),
          ),
          nextCursor: page.nextCursor,
        };
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          throw new ProblemError('validation_error', 'O parâmetro "cursor" é inválido.');
        }
        throw error;
      }
    },

    /**
     * GET /v1/reservations/selection — todas as reservas do filtro, até 2 000, com só o que a
     * seleção e a cópia para e-mail usam (specs/005, FR-027, FR-030).
     */
    async selectReservations(request: FastifyRequest) {
      const filters = filtersOf(request.query as SelectQuery);
      const { rows, total } = await selectReservations(db, filters, MAX_SELECTION);
      const treatments = await loadTreatmentSummaries(db, rows);
      const at = now();
      return {
        total,
        truncated: total > rows.length,
        items: rows.map((row) => {
          const summary = treatments.get(reservationKeyOf(row)) ?? EMPTY_TREATMENT;
          const treatment = toReservationTreatmentView(row, summary, at);
          return {
            hotelCode: row.hotelCode,
            hotelName: row.hotelName,
            reservationNumber: row.reservationNumber,
            guestName: row.anonymizedAt ? null : row.guestName,
            channel: row.channel,
            checkIn: row.checkIn,
            totalAmount: row.totalAmount,
            reservationStatus: row.reservationStatus,
            classification: row.classification,
            treatmentStatus: treatment.status,
            situation: treatment.situation,
            detailedSituation: treatment.detailedSituation,
            needsReview: treatment.needsReview,
            effectiveChargedAmount: treatment.effectiveChargedAmount,
            chargedAmountOrigin: treatment.chargedAmountOrigin,
            // O retorno atual, para a lista de revisão da confirmação em lote (FR-016a).
            currentReturn:
              toCommercialSummaryView(summary.commercial, row.totalAmount)?.currentReturn ?? null,
          };
        }),
      };
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
      const treatments = await loadTreatmentSummaries(db, [row]);
      const origins = await loadLegacyOrigins(db, [row]);
      return toReservationView(
        row,
        treatments.get(reservationKeyOf(row)),
        now(),
        origins.get(reservationKeyOf(row)) ?? null,
      );
    },
  };
}
