import type { components, operations } from '@hunit/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ExecutionEventBus } from '../../executions/events.js';
import {
  ExecutionNotFoundError,
  ExecutionStillActiveError,
  NothingToResumeError,
  resumeExecution,
} from '../../executions/resume.js';
import type { ExecutionRunner } from '../../executions/runner.js';
import { executionTiming } from '../../executions/timing.js';
import type { Database } from '../../persistence/db.js';
import { loadTimingHistory } from '../../persistence/execution-hotels-repo.js';
import {
  ExecutionAlreadyActiveError,
  ExecutionAlreadyResumedError,
  findExecution,
  InvalidCursorError,
  listExecutionHotels,
  listExecutions,
  type ExecutionWithClient,
} from '../../persistence/executions-repo.js';
import { isActiveExecutionStatus as isActive } from '../../persistence/schema.js';
import { ProblemError } from '../problem.js';
import { toExecutionSummary, toExecutionView, type ExecutionView } from '../views.js';

type StartExecutionRequest = components['schemas']['StartExecutionRequest'];
type ExecutionParams = operations['getExecution']['parameters']['path'];
type ListExecutionsQuery = NonNullable<operations['listExecutions']['parameters']['query']>;
type TwoFactorBody = operations['sendTwoFactor']['requestBody']['content']['application/json'];
type ResumeBody = operations['resumeExecution']['requestBody']['content']['application/json'];

export interface ExecutionHandlerDependencies {
  db: Database;
  events: ExecutionEventBus;
  runner: ExecutionRunner;
}

/** Quantos eventos recentes acompanham o estado da execução (FR-021; limite do contrato). */
const RECENT_EVENTS = 50;
const DEFAULT_PAGE_SIZE = 50;

/** Cliente autenticado da requisição. As operações daqui sempre exigem autenticação. */
function clientOf(request: FastifyRequest) {
  if (!request.client) throw new ProblemError('unauthorized');
  return request.client;
}

export function createExecutionHandlers(dependencies: ExecutionHandlerDependencies) {
  const { db, events, runner } = dependencies;

  async function loadExecution(executionId: string): Promise<ExecutionWithClient> {
    const found = await findExecution(db, executionId);
    if (!found) throw new ProblemError('not_found', 'Execução não encontrada.');
    return found;
  }

  async function viewOf(found: ExecutionWithClient): Promise<ExecutionView> {
    const { execution } = found;
    const active = isActive(execution.status);
    const [hotels, recentEvents, history] = await Promise.all([
      listExecutionHotels(db, execution.id),
      events.listRecent(execution.id, RECENT_EVENTS),
      // A média histórica só serve para estimar o tempo restante de uma execução ativa.
      active
        ? loadTimingHistory(db, { excludeExecutionId: execution.id })
        : { secondsPerReservation: null, secondsPerHotel: null },
    ]);
    const timing = executionTiming({
      hotels,
      active,
      history,
      concurrency: runner.hotelConcurrency,
      now: new Date(),
    });
    return toExecutionView({ found, hotels, recentEvents, timing });
  }

  return {
    /** POST /v1/executions — inicia uma execução (FR-001). Somente operador. */
    async createExecution(request: FastifyRequest, reply: FastifyReply) {
      const client = clientOf(request);
      const body = request.body as StartExecutionRequest;
      const { period } = body;

      if (period.from > period.to) {
        throw new ProblemError(
          'validation_error',
          'O início do período (period.from) não pode ser depois do fim (period.to).',
        );
      }

      let executionId: string;
      try {
        const execution = await runner.start({
          clientId: client.id,
          credentials: body.credentials,
          period,
          hotelCodes: body.hotelCodes ? [...new Set(body.hotelCodes)] : null,
        });
        executionId = execution.id;
      } catch (error) {
        if (error instanceof ExecutionAlreadyActiveError) {
          throw new ProblemError(
            'execution_already_active',
            'Aguarde a execução em andamento desta conta terminar, ou cancele-a.',
          );
        }
        throw error;
      }

      request.log.info({ executionId }, 'execução iniciada');
      void reply.code(202);
      return viewOf(await loadExecution(executionId));
    },

    /** GET /v1/executions — execuções, das mais recentes para as mais antigas. */
    async listExecutions(request: FastifyRequest) {
      const query = request.query as ListExecutionsQuery;
      try {
        const page = await listExecutions(db, {
          status: query.status,
          limit: query.limit ?? DEFAULT_PAGE_SIZE,
          cursor: query.cursor,
        });
        return { items: page.items.map(toExecutionSummary), nextCursor: page.nextCursor };
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          throw new ProblemError('validation_error', 'O parâmetro "cursor" é inválido.');
        }
        throw error;
      }
    },

    /** GET /v1/executions/{executionId} — estado completo e andamento (FR-021). */
    async getExecution(request: FastifyRequest) {
      const { executionId } = request.params as ExecutionParams;
      return viewOf(await loadExecution(executionId));
    },

    /** POST /v1/executions/{executionId}/two-factor — entrega o token 2FA (FR-002). */
    async sendTwoFactor(request: FastifyRequest, reply: FastifyReply) {
      const { executionId } = request.params as ExecutionParams;
      const { token } = request.body as TwoFactorBody;
      const { execution } = await loadExecution(executionId);

      if (!runner.submitToken(executionId, token)) {
        throw new ProblemError(
          'not_awaiting_two_factor',
          execution.status === 'awaiting_2fa'
            ? 'O prazo para enviar o token terminou ou o token já foi enviado.'
            : `A execução está no estado "${execution.status}" e não espera um token.`,
        );
      }

      request.log.info({ executionId }, 'token entregue à execução');
      return reply.code(202).send();
    },

    /** POST /v1/executions/{executionId}/cancel — cancela a execução (FR-022). Somente operador. */
    async cancelExecution(request: FastifyRequest, reply: FastifyReply) {
      const client = clientOf(request);
      const { executionId } = request.params as ExecutionParams;
      const { execution } = await loadExecution(executionId);

      const outcome = isActive(execution.status)
        ? await runner.cancel(executionId, client.id)
        : 'already_finished';
      if (outcome === 'already_finished') {
        const { execution: current } = await loadExecution(executionId);
        throw new ProblemError(
          'execution_already_finished',
          `A execução já terminou no estado "${current.status}".`,
        );
      }

      request.log.info({ executionId }, 'cancelamento solicitado');
      void reply.code(202);
      return viewOf(await loadExecution(executionId));
    },

    /**
     * POST /v1/executions/{executionId}/resume — retoma a execução a partir dos hotéis não
     * concluídos, com novo acesso ao Hunit (FR-023). Somente operador.
     */
    async resumeExecution(request: FastifyRequest, reply: FastifyReply) {
      const client = clientOf(request);
      const { executionId } = request.params as ExecutionParams;
      const { credentials } = request.body as ResumeBody;

      let resumedId: string;
      try {
        const resumed = await resumeExecution(
          { db, runner },
          { executionId, clientId: client.id, credentials },
        );
        resumedId = resumed.id;
      } catch (error) {
        if (error instanceof ExecutionNotFoundError) {
          throw new ProblemError('not_found', 'Execução não encontrada.');
        }
        if (error instanceof ExecutionStillActiveError) {
          throw new ProblemError('execution_already_active', error.message);
        }
        if (error instanceof NothingToResumeError) {
          throw new ProblemError('nothing_to_resume', error.message);
        }
        if (error instanceof ExecutionAlreadyResumedError) {
          throw new ProblemError('execution_already_resumed', error.message);
        }
        if (error instanceof ExecutionAlreadyActiveError) {
          throw new ProblemError(
            'execution_already_active',
            'Já existe uma execução ativa para esta conta do Hunit; aguarde o fim dela ou cancele-a.',
          );
        }
        throw error;
      }

      request.log.info(
        { executionId: resumedId, parentExecutionId: executionId },
        'execução retomada',
      );
      void reply.code(202);
      return viewOf(await loadExecution(resumedId));
    },
  };
}
