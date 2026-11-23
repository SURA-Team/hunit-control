import type { operations } from '@hunit/contracts';
import type { NoChargeIneligibility } from '@hunit/domain';
import type { FastifyRequest } from 'fastify';
import type { CommercialSheetSync } from '../../commercial-sheet/sync.js';
import type { Database } from '../../persistence/db.js';
import { markNoCharge, undoNoCharge } from '../../persistence/no-charge-repo.js';
import {
  confirmCancellation,
  rejectCancellation,
} from '../../persistence/commercial-reports-repo.js';
import { InvalidCursorError } from '../../persistence/executions-repo.js';
import {
  countQuickFilters,
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
type CountQuery = NonNullable<operations['countReservationQuickFilters']['parameters']['query']>;
/** Filtros comuns às três rotas; `quickFilter` só na lista e na seleção (specs/006). */
type FilterQuery = CountQuery & Pick<SelectQuery, 'quickFilter'>;

/** Limite da seleção do filtro (specs/005, FR-030; o mesmo da seleção da 003, FR-006a). */
export const MAX_SELECTION = 2000;
type ReservationParams = operations['getReservation']['parameters']['path'];
type NoChargeBody =
  operations['markReservationNoCharge']['requestBody']['content']['application/json'];
type UndoNoChargeBody =
  operations['undoReservationNoCharge']['requestBody']['content']['application/json'];
type CancellationRejectBody =
  operations['rejectCommercialCancellation']['requestBody']['content']['application/json'];

/** Por que a reserva não aceita a marcação "Cancelada sem cobrança" (specs/008, FR-022). */
const NO_CHARGE_REASONS: Readonly<Record<NoChargeIneligibility, string>> = {
  already_marked: 'A reserva já está marcada como cancelada sem cobrança.',
  not_accepting: 'A reserva já está concluída: a situação dela não exige cobrança.',
  has_proof: 'A reserva já tem comprovante.',
  return_awaiting_validation:
    'Há retorno do Comercial aguardando validação: confirme ou recuse o retorno antes.',
};

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

/** Os filtros da consulta (FR-020), comuns à lista, à seleção do filtro e às contagens. */
function filtersOf(query: FilterQuery): ReservationFilters {
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
    quickFilter: query.quickFilter,
  };
}

export function createReservationHandlers(dependencies: {
  db: Database;
  now?: () => Date;
  commercialSheet?: CommercialSheetSync | null | undefined;
}) {
  const { db } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /** A reserva no formato do contrato, lida de novo depois de uma mudança. */
  async function reservationView(hotelCode: string, reservationNumber: string) {
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
  }

  function clientIdOf(request: FastifyRequest): string {
    if (!request.client) throw new ProblemError('unauthorized');
    return request.client.id;
  }

  return {
    /**
     * POST .../no-charge — marca a reserva como cancelada sem cobrança (specs/008, FR-018 a
     * FR-022). Só operador; não acessa o Hunit.
     */
    async markReservationNoCharge(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const body = request.body as NoChargeBody;
      const note = body.note?.trim() ?? '';
      const result = await markNoCharge(db, {
        key,
        expectedSituation: body.expectedSituation,
        note: note === '' ? null : note,
        clientId: clientIdOf(request),
        now: now(),
      });
      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new ProblemError('not_found', 'Reserva não encontrada.');
        }
        if (result.reason === 'reservation_changed') throw new ProblemError('reservation_changed');
        throw new ProblemError('no_charge_not_accepted', NO_CHARGE_REASONS[result.detail], {
          reason: result.detail,
        });
      }
      request.log.info('reserva marcada como cancelada sem cobrança');
      dependencies.commercialSheet?.requestRound();
      return reservationView(key.hotelCode, key.reservationNumber);
    },

    /**
     * POST .../commercial/cancellation/confirm — confirma a "Cancelada" do Comercial: a reserva é
     * marcada como cancelada sem cobrança (homologação da 008, R-19; spec FR-007c). Só operador.
     */
    async confirmCommercialCancellation(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const result = await confirmCancellation(db, {
        key,
        clientId: clientIdOf(request),
        now: now(),
      });
      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new ProblemError('not_found', 'Reserva não encontrada.');
        }
        if (result.reason === 'not_awaiting') {
          throw new ProblemError('no_cancellation_awaiting_validation');
        }
        if (result.reason === 'reservation_changed') throw new ProblemError('reservation_changed');
        throw new ProblemError('no_charge_not_accepted', NO_CHARGE_REASONS[result.detail], {
          reason: result.detail,
        });
      }
      request.log.info('"Cancelada" do Comercial confirmada');
      dependencies.commercialSheet?.requestRound();
      return reservationView(key.hotelCode, key.reservationNumber);
    },

    /** POST .../commercial/cancellation/reject — recusa a "Cancelada" com o motivo (R-19). */
    async rejectCommercialCancellation(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const body = request.body as CancellationRejectBody;
      const result = await rejectCancellation(db, {
        key,
        clientId: clientIdOf(request),
        reason: body.reason.trim(),
        now: now(),
      });
      if (!result.ok) throw new ProblemError('no_cancellation_awaiting_validation');
      request.log.info('"Cancelada" do Comercial recusada');
      dependencies.commercialSheet?.requestRound();
      return reservationView(key.hotelCode, key.reservationNumber);
    },

    /** POST .../no-charge/undo — desfaz a marcação (specs/008, FR-021). Só operador. */
    async undoReservationNoCharge(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const body = request.body as UndoNoChargeBody;
      const result = await undoNoCharge(db, {
        key,
        markId: body.markId,
        clientId: clientIdOf(request),
        now: now(),
      });
      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new ProblemError('not_found', 'Reserva não encontrada.');
        }
        throw new ProblemError('no_charge_not_active');
      }
      request.log.info('marcação "cancelada sem cobrança" desfeita');
      dependencies.commercialSheet?.requestRound();
      return reservationView(key.hotelCode, key.reservationNumber);
    },

    /** GET /v1/reservations — reservas com filtros combináveis (FR-020). */
    async listReservations(request: FastifyRequest) {
      const query = request.query as ListReservationsQuery;
      const filters = filtersOf(query);
      try {
        const page = await listReservations(db, {
          ...filters,
          limit: query.limit ?? DEFAULT_PAGE_SIZE,
          cursor: query.cursor,
          order: query.order,
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
      const query = request.query as SelectQuery;
      const { rows, total } = await selectReservations(
        db,
        filtersOf(query),
        MAX_SELECTION,
        query.order,
      );
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

    /**
     * GET /v1/reservations/quick-filter-counts — reservas de cada filtro rápido com os mesmos
     * filtros da lista (specs/006, FR-017).
     */
    async countReservationQuickFilters(request: FastifyRequest) {
      return countQuickFilters(db, filtersOf(request.query as CountQuery));
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
