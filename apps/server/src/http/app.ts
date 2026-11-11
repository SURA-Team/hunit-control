import type { operations } from '@hunit/contracts';
import fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type RouteOptions,
} from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import type { Logger } from '../logging.js';
import { findActiveClientByKeyHash } from '../persistence/clients-repo.js';
import type { Database } from '../persistence/db.js';
import { createAuthHook } from './auth.js';
import { loadContract, type Contract } from './contract.js';
import { createHealthHandlers } from './handlers/health.js';
import { ProblemError, sendProblem } from './problem.js';

/** Prefixo das rotas; corresponde a `servers.url` do contrato. */
const API_PREFIX = 'v1';

/** Único formato de corpo que o servidor aceita. */
const JSON_CONTENT_TYPE = 'application/json';

export type OperationId = keyof operations;
export type OperationHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export type OperationHandlers = Partial<Record<OperationId, OperationHandler>>;

export interface AppDependencies {
  db: Database;
  logger: Logger;
}

/** Erro gerado pelo próprio Fastify ao ler ou validar a requisição (código `FST_ERR_...`). */
function isFastifyError(error: unknown): error is FastifyError {
  if (!(error instanceof Error)) return false;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && code.startsWith('FST_ERR_');
}

/** Converte qualquer erro no problema (RFC 9457) que será devolvido ao cliente. */
function toProblemError(error: unknown): ProblemError {
  if (error instanceof ProblemError) return error;

  if (isFastifyError(error)) {
    const status = error.statusCode ?? 500;
    if (status === 404) return new ProblemError('not_found');
    // Requisição fora do contrato (campo inválido ou ausente) ou que o Fastify não conseguiu ler
    // (JSON malformado, tipo de conteúdo não aceito, corpo grande demais). As mensagens citam o
    // campo e a regra, nunca o valor enviado.
    if (status >= 400 && status < 500) return new ProblemError('validation_error', error.message);
  }

  // Erro inesperado: o cliente recebe só "Erro interno"; os detalhes ficam no log.
  return new ProblemError('internal_error', undefined, { cause: error });
}

function notImplemented(operationId: string): OperationHandler {
  return () =>
    Promise.reject(
      new ProblemError(
        'internal_error',
        `A operação "${operationId}" ainda não foi implementada.`,
        { status: 501, title: 'Operação não implementada' },
      ),
    );
}

function mediaTypeOf(request: FastifyRequest): string {
  return (request.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function jsonBodyRequired(): ProblemError {
  return new ProblemError(
    'validation_error',
    `O corpo da requisição é obrigatório e deve ser enviado como ${JSON_CONTENT_TYPE}.`,
  );
}

/**
 * O servidor só lê corpo em JSON. O Fastify também leria `text/plain` (sem validar contra o
 * contrato), então esse leitor é removido; e os tipos que o contrato cita só em respostas
 * ganham um leitor que recusa, para que nenhum deles seja aceito como corpo por engano.
 */
function acceptOnlyJsonBodies(app: FastifyInstance, contract: Contract): void {
  app.removeContentTypeParser('text/plain');

  for (const contentType of contract.contentTypes) {
    if (contentType === JSON_CONTENT_TYPE) continue;
    app.addContentTypeParser(contentType, (_request, _payload, done) => {
      done(jsonBodyRequired());
    });
  }
}

/**
 * Cria a aplicação HTTP a partir do contrato OpenAPI (constitution, princípio III).
 *
 * Rotas, validação das requisições e formato das respostas vêm de `openapi.yaml`:
 * - requisições são validadas contra o contrato antes de chegar ao handler;
 * - respostas são serializadas pelo schema do contrato, que descarta campos não previstos e
 *   falha se faltar um campo obrigatório.
 *
 * Operações do contrato ainda sem handler respondem 501.
 */
export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const contract = loadContract();

  const handlers: OperationHandlers = {
    ...createHealthHandlers(dependencies),
  };

  // Declarado com o tipo de logger do Fastify para a aplicação ter o tipo padrão.
  const loggerInstance: FastifyBaseLogger = dependencies.logger;

  const app: FastifyInstance = fastify({
    loggerInstance,
    ajv: {
      customOptions: {
        // Campo desconhecido é erro, e não algo a descartar em silêncio: um nome digitado errado
        // (ex.: "hotelCode" em vez de "hotelCodes") mudaria o significado do pedido.
        removeAdditional: false,
        // O contrato usa tipos como ["string", "null"] (OpenAPI 3.1).
        allowUnionTypes: true,
      },
    },
  });

  app.decorateRequest('client', null);
  acceptOnlyJsonBodies(app, contract);

  app.setErrorHandler((error, request, reply) => {
    const problem = toProblemError(error);
    if (problem.status >= 500) {
      request.log.error({ err: error }, 'erro ao atender a requisição');
    } else {
      request.log.info({ code: problem.code, status: problem.status }, 'requisição recusada');
    }
    return sendProblem(reply, problem);
  });

  app.setNotFoundHandler((_request, reply) =>
    sendProblem(reply, new ProblemError('not_found', 'Rota não encontrada.')),
  );

  // Autenticação antes de tudo: quem não se identifica não tem o corpo lido nem validado.
  app.addHook(
    'onRequest',
    createAuthHook({
      findActiveClientByKeyHash: (keyHash) => findActiveClientByKeyHash(dependencies.db, keyHash),
    }),
  );

  // Operação com corpo no contrato exige corpo em JSON. Sem esta checagem, uma requisição sem
  // corpo (ou com outro tipo de conteúdo) passaria direto pela validação do Fastify.
  app.addHook('preValidation', (request, _reply, done) => {
    const { requestBodyTypes } = request.routeOptions.config;
    if (requestBodyTypes && !requestBodyTypes.includes(mediaTypeOf(request))) {
      done(jsonBodyRequired());
      return;
    }
    done();
  });

  await app.register(openapiGlue, {
    specification: contract.document,
    prefix: API_PREFIX,
    operationResolver: (operationId) => {
      const operation = contract.operations.get(operationId);
      return {
        handler: handlers[operationId as OperationId] ?? notImplemented(operationId),
        config: {
          operationId,
          requiresAuth: operation?.requiresAuth ?? true,
          requestBodyTypes: operation?.requestBodyTypes ?? null,
        },
      } as unknown as RouteOptions;
    },
  });

  return app;
}
