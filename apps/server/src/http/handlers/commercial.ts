/**
 * O Comercial por reserva (specs/005; contracts/api-changes.md): linha da planilha, retornos e
 * histórico; desfazer e reverter o envio (research R-11). Nada aqui acessa o Hunit. As escritas
 * são só do perfil operador.
 */
import { randomUUID } from 'node:crypto';
import type { components, operations } from '@hunit/contracts';
import { RETURN_PROBLEM_PREFIXES } from '@hunit/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SHEET_ERROR_MESSAGES, type SheetErrorCode } from '../../commercial-sheet/gateway.js';
import type { CommercialSheetSync } from '../../commercial-sheet/sync.js';
import { uniqueReservationKeys } from '../../dispatches/eligibility.js';
import {
  confirmReturn,
  confirmReturnsBatch,
  rejectReturn,
  undoReturnConfirmation,
  type BatchItemResult,
  type DecisionResult,
} from '../../persistence/commercial-returns-repo.js';
import {
  countHunitQueue,
  listHunitQueue,
  listCancellationsAwaiting,
} from '../../persistence/commercial-reports-repo.js';
import type { ClassificationCounts } from '../../persistence/schema.js';
import { loadTreatmentSummary } from '../../persistence/treatments-repo.js';
import { toReservationTreatmentView } from '../views.js';
import {
  cancelLine,
  countAwaitingReturns,
  getCommercialDetail,
  getSheetState,
  listLineProblems,
  pendingLines,
  restoreCancelledLine,
} from '../../persistence/commercial-repo.js';
import type { Database } from '../../persistence/db.js';
import { findReservation } from '../../persistence/reservations-repo.js';
import {
  isEventType1_8_0,
  toCommercialEventView,
  toCommercialHistoryEventView,
  toCommercialLineView,
  toCommercialReturnView,
  toCommercialReportView,
  toHunitChargeQueueView,
  toReportProblemView,
} from '../commercial-views.js';
import { ProblemError } from '../problem.js';

type ReservationParams = operations['getReservationCommercial']['parameters']['path'];
type ReturnParams = operations['confirmCommercialReturn']['parameters']['path'];
type RejectBody =
  operations['rejectCommercialReturn']['requestBody']['content']['application/json'];
type BatchBody =
  operations['confirmCommercialReturns']['requestBody']['content']['application/json'];
type BatchResultView = components['schemas']['ConfirmationBatchResult'];
type SheetStatusView = components['schemas']['CommercialSheetStatus'];

/** Até quanto "Ler retornos agora" espera a rodada antes de responder 202. */
const READ_TIMEOUT_MS = 50_000;

/** Resultado de uma confirmação em lote, com a contagem das confirmadas por status do Hunit. */
export function batchResult(batchId: string, results: readonly BatchItemResult[]): BatchResultView {
  const counts: ClassificationCounts = {};
  for (const result of results) {
    if (result.outcome !== 'confirmed' || result.classification === null) continue;
    counts[result.classification] = (counts[result.classification] ?? 0) + 1;
  }
  return {
    batchId,
    items: results.map((result) => ({
      hotelCode: result.hotelCode,
      reservationNumber: result.reservationNumber,
      outcome: result.outcome,
      reason: result.reason,
    })),
    countsByClassification: counts,
  };
}

export interface CommercialHandlerDependencies {
  db: Database;
  commercialSheet?: CommercialSheetSync | null | undefined;
  now?: () => Date;
  /** Testes: espera de "Ler retornos agora" antes do 202. */
  readTimeoutMs?: number;
}

function clientOf(request: FastifyRequest) {
  if (!request.client) throw new ProblemError('unauthorized');
  return request.client;
}

export function createCommercialHandlers(dependencies: CommercialHandlerDependencies) {
  const { db } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  async function requireReservation(key: ReservationParams) {
    const reservation = await findReservation(db, key.hotelCode, key.reservationNumber);
    if (!reservation) throw new ProblemError('not_found', 'Reserva não encontrada.');
    return reservation;
  }

  /** Tratativa atual da reserva, no formato do contrato (o que as validações devolvem). */
  async function treatmentOf(key: { hotelCode: string; reservationNumber: string }) {
    const reservation = await requireReservation(key);
    return toReservationTreatmentView(reservation, await loadTreatmentSummary(db, key), now());
  }

  async function decided(result: DecisionResult) {
    if (!result.ok) {
      if (result.reason === 'not_found')
        throw new ProblemError('not_found', 'Retorno não encontrado.');
      if (result.reason === 'not_confirmed') throw new ProblemError('return_not_confirmed');
      throw new ProblemError(
        'return_not_awaiting_validation',
        'O retorno não está mais aguardando validação (já foi decidido, substituído ou encerrado).',
      );
    }
    dependencies.commercialSheet?.requestRound();
    return treatmentOf(result.key);
  }

  /** Estado da integração com a planilha (FR-013); nunca o identificador nem a chave (FR-022). */
  async function sheetStatus(): Promise<SheetStatusView> {
    const [awaitingReturns, reports, hunitQueueCount] = await Promise.all([
      countAwaitingReturns(db),
      listCancellationsAwaiting(db),
      countHunitQueue(db, now()),
    ]);
    // "Retornos a validar" conta também as "Cancelada" aguardando validação (R-19).
    const awaitingValidation = awaitingReturns + reports.length;
    // "Cancelada" a validar e a contagem da fila "Cobradas no Hunit" (specs/008).
    const reportFields = { reports: reports.map(toReportProblemView), hunitQueueCount };
    const sync = dependencies.commercialSheet;
    if (!sync) {
      return {
        configured: false,
        status: 'not_configured',
        lastRoundOkAt: null,
        lastReadOkAt: null,
        lastError: null,
        nextAttemptAt: null,
        pending: { count: 0, oldestChangeAt: null },
        awaitingValidation,
        problems: [],
        ...reportFields,
      };
    }
    const [state, pending, lineProblems] = await Promise.all([
      getSheetState(db),
      pendingLines(db),
      listLineProblems(db),
    ]);
    const errorCode = state.lastErrorCode as SheetErrorCode | null;
    const problems: SheetStatusView['problems'] = [];
    for (const line of lineProblems) {
      if (line.returnProblem !== null) {
        problems.push({
          hotelCode: line.hotelCode,
          reservationNumber: line.reservationNumber,
          kind: line.returnProblem.startsWith(RETURN_PROBLEM_PREFIXES.incomplete)
            ? 'incomplete'
            : 'illegible',
          message: line.returnProblem,
          at: (line.returnProblemAt ?? new Date(0)).toISOString(),
        });
      }
      if (line.sheetIssue !== null) {
        problems.push({
          hotelCode: line.hotelCode,
          reservationNumber: line.reservationNumber,
          kind: 'restored_line',
          message: line.sheetIssue,
          at: (line.sheetIssueAt ?? new Date(0)).toISOString(),
        });
      }
    }
    problems.push(...state.roundProblems);
    return {
      configured: true,
      status:
        errorCode === 'sheet_layout_invalid'
          ? 'layout_invalid'
          : state.consecutiveFailures > 0
            ? 'failing'
            : 'ok',
      lastRoundOkAt: state.lastRoundOkAt?.toISOString() ?? null,
      lastReadOkAt: state.lastReadOkAt?.toISOString() ?? null,
      lastError:
        errorCode && state.lastErrorAt
          ? {
              code: errorCode,
              message: SHEET_ERROR_MESSAGES[errorCode],
              at: state.lastErrorAt.toISOString(),
            }
          : null,
      nextAttemptAt: state.nextAttemptAt?.toISOString() ?? null,
      pending: {
        count: pending.count,
        oldestChangeAt: pending.oldestChangeAt?.toISOString() ?? null,
      },
      awaitingValidation,
      problems,
      ...reportFields,
    };
  }

  async function lineView(key: ReservationParams) {
    const detail = await getCommercialDetail(db, key);
    if (!detail.line)
      throw new ProblemError('not_found', 'A reserva não foi enviada ao Comercial.');
    return toCommercialLineView(detail.line, now());
  }

  return {
    /** GET /v1/commercial-hunit-charges — fila "Cobradas no Hunit" (specs/008, FR-013). */
    async listCommercialHunitCharges() {
      return toHunitChargeQueueView(await listHunitQueue(db, now()));
    },

    /** GET .../commercial — linha, retornos e histórico do Comercial da reserva (FR-020, FR-023). */
    async getReservationCommercial(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const reservation = await requireReservation(key);
      const detail = await getCommercialDetail(db, key);
      const at = now();
      return {
        line: detail.line ? toCommercialLineView(detail.line, at) : null,
        returns: detail.returns.map((row) => toCommercialReturnView(row, reservation.totalAmount)),
        events: detail.events.filter(isEventType1_8_0).map(toCommercialEventView),
        history: detail.events.map(toCommercialHistoryEventView),
        report: toCommercialReportView(detail.report),
      };
    },

    /** POST .../commercial/cancel — desfaz o envio (research R-11, clarify Q2). */
    async cancelCommercialLine(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      await requireReservation(key);
      const result = await cancelLine(db, { key, clientId: clientOf(request).id, now: now() });
      if (!result.ok) {
        if (result.reason === 'return_awaiting_validation') {
          throw new ProblemError(
            'return_awaiting_validation',
            'Confirme ou recuse o retorno do Comercial antes de desfazer o envio.',
          );
        }
        throw new ProblemError(
          'not_in_commercial_sheet',
          'A reserva não está em "A cobrar" na planilha do Comercial.',
        );
      }
      dependencies.commercialSheet?.requestRound();
      return lineView(key);
    },

    /** GET /v1/commercial-sheet — pendências, última leitura, falha e problemas (FR-013). */
    async getCommercialSheetStatus() {
      return sheetStatus();
    },

    /**
     * POST /v1/commercial-sheet/read — "Ler retornos agora" (FR-014): uma rodada completa;
     * responde quando ela termina, ou 202 se passar de 50 s (a rodada continua).
     */
    async readCommercialSheet(_request: FastifyRequest, reply: FastifyReply) {
      const sync = dependencies.commercialSheet;
      if (!sync) throw new ProblemError('commercial_sheet_not_configured');
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), dependencies.readTimeoutMs ?? READ_TIMEOUT_MS);
      });
      const result = await Promise.race([sync.runRound(), timeout]);
      clearTimeout(timer);
      if (result === null) {
        void reply.code(202);
        return sheetStatus();
      }
      if (!result.ok) {
        const code = result.errorCode ?? 'sheet_unavailable';
        throw new ProblemError('commercial_sheet_unavailable', SHEET_ERROR_MESSAGES[code]);
      }
      return {
        sheet: await sheetStatus(),
        round: {
          returnsReceived: result.returnsReceived,
          returnsChanged: result.returnsChanged,
          problems: result.problems,
          linesWritten: result.linesWritten,
        },
      };
    },

    /** POST /v1/commercial-returns/{returnId}/confirm — confirma o retorno (FR-016). */
    async confirmCommercialReturn(request: FastifyRequest) {
      const { returnId } = request.params as ReturnParams;
      const result = await confirmReturn(db, {
        returnId,
        clientId: clientOf(request).id,
        now: now(),
      });
      return decided(result);
    },

    /** POST /v1/commercial-returns/{returnId}/reject — recusa o retorno com o motivo (FR-017). */
    async rejectCommercialReturn(request: FastifyRequest) {
      const { returnId } = request.params as ReturnParams;
      const reason = (request.body as RejectBody).reason.trim();
      if (reason.length === 0) {
        throw new ProblemError('validation_error', 'Informe o motivo da recusa (reason).');
      }
      const result = await rejectReturn(db, {
        returnId,
        reason,
        clientId: clientOf(request).id,
        now: now(),
      });
      return decided(result);
    },

    /** POST /v1/commercial-returns/{returnId}/undo-confirmation — desfaz a confirmação. */
    async undoCommercialReturnConfirmation(request: FastifyRequest) {
      const { returnId } = request.params as ReturnParams;
      const result = await undoReturnConfirmation(db, {
        returnId,
        clientId: clientOf(request).id,
        now: now(),
      });
      return decided(result);
    },

    /** POST /v1/commercial-returns/confirm — confirma vários retornos de uma vez (FR-016a). */
    async confirmCommercialReturns(request: FastifyRequest) {
      const { reservations, includeCancellations } = request.body as BatchBody;
      const batchId = randomUUID();
      const results = await confirmReturnsBatch(db, {
        keys: uniqueReservationKeys(reservations),
        clientId: clientOf(request).id,
        batchId,
        now: now(),
        // Só o app 0.4 manda (homologação da 008, R-19).
        includeCancellations: includeCancellations === true,
      });
      for (const result of results) {
        if (result.outcome !== 'failed') continue;
        request.log.error(
          {
            err: result.error,
            hotelCode: result.hotelCode,
            reservationNumber: result.reservationNumber,
            batchId,
          },
          'falha ao confirmar o retorno de uma reserva',
        );
      }
      dependencies.commercialSheet?.requestRound();
      return batchResult(batchId, results);
    },

    /** POST .../commercial/restore — reverte o envio desfeito, em até 30 dias (research R-11). */
    async restoreCommercialLine(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      await requireReservation(key);
      const result = await restoreCancelledLine(db, {
        key,
        clientId: clientOf(request).id,
        now: now(),
      });
      if (!result.ok) {
        if (result.reason === 'expired') throw new ProblemError('restore_expired');
        if (result.reason === 'not_eligible') {
          throw new ProblemError(
            'not_eligible_for_treatment',
            'A situação atual da reserva não exige cobrança; o envio não pode ser revertido.',
          );
        }
        throw new ProblemError(
          'not_in_commercial_sheet',
          'Só um envio desfeito pode ser revertido.',
        );
      }
      dependencies.commercialSheet?.requestRound();
      return lineView(key);
    },
  };
}
