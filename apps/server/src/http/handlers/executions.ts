import type { components, operations } from '@hunit/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ExecutionEventBus } from '../../executions/events.js';
import type { ExecutionRunner } from '../../executions/runner.js';
import type { Database } from '../../persistence/db.js';
import {
  ExecutionAlreadyActiveError,
  findExecution,
  InvalidCursorError,
  listExecutionHotels,
  listExecutions,
  type ExecutionWithClient,
} from '../../persistence/executions-repo.js';
import { ProblemError } from '../problem.js';
import { toExecutionSummary, toExecutionView, type ExecutionView } from '../views.js';

type StartExecutionRequest = components['schemas']['StartExecutionRequest'];
type ExecutionParams = operations['getExecution']['parameters']['path'];
type ListExecutionsQuery = NonNullable<operations['listExecutions']['parameters']['query']>;
type TwoFactorBody = operations['sendTwoFactor']['requestBody']['content']['application/json'];

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
    const [hotels, recentEvents] = await Promise.all([
      listExecutionHotels(db, found.execution.id),
      events.listRecent(found.execution.id, RECENT_EVENTS),
    ]);
    return toExecutionView({ found, hotels, recentEvents });
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
  };
}
