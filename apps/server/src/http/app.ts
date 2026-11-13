import type { operations } from '@hunit/contracts';
import { MAX_TREATMENT_FILE_BYTES } from '@hunit/domain';
import fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type RouteOptions,
} from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import type { EvidenceStore } from '../evidence/store.js';
import type { ExecutionEventBus } from '../executions/events.js';
import type { ExecutionRunner } from '../executions/runner.js';
import type { Logger } from '../logging.js';
import { findActiveClientByKeyHash } from '../persistence/clients-repo.js';
import type { Database } from '../persistence/db.js';
import { createAuthHook } from './auth.js';
import { loadContract, type Contract } from './contract.js';
import { createClientHandlers } from './handlers/clients.js';
import { createEvidenceHandlers } from './handlers/evidence.js';
import { createExecutionEventsHandlers } from './handlers/execution-events.js';
import { createExecutionHandlers } from './handlers/executions.js';
import { createHealthHandlers } from './handlers/health.js';
import { createHotelHandlers } from './handlers/hotels.js';
import { createReservationHandlers } from './handlers/reservations.js';
import { createTreatmentHandlers } from './handlers/treatments.js';
import { ProblemError, sendProblem } from './problem.js';

/** Prefixo das rotas; corresponde a `servers.url` do contrato. */
const API_PREFIX = 'v1';

/** Formato de corpo que o servidor aceita em todas as operações, menos uma. */
const JSON_CONTENT_TYPE = 'application/json';

/**
 * Corpo binário: aceito **somente** no envio do arquivo de uma tratativa, com limite próprio de
 * tamanho (specs/003, research R-03). As demais operações continuam lendo só JSON, até 1 MiB.
 */
const BINARY_CONTENT_TYPE = 'application/octet-stream';
const BINARY_UPLOAD_OPERATION: OperationId = 'uploadTreatmentFile';

export type OperationId = keyof operations;
export type OperationHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export type OperationHandlers = Partial<Record<OperationId, OperationHandler>>;

export interface AppDependencies {
  db: Database;
  logger: Logger;
  events: ExecutionEventBus;
  runner: ExecutionRunner;
  /** Arquivos de evidência, para o download (FR-024). */
  evidence: EvidenceStore;
  /** Relógio das respostas e dos registros; os testes informam um fixo. */
  now?: () => Date;
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

/** Handler das operações do contrato ainda sem implementação: responde 501. */
export function notImplemented(operationId: string): OperationHandler {
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

function bodyRequired(contentType: string = JSON_CONTENT_TYPE): ProblemError {
  return new ProblemError(
    'validation_error',
    `O corpo da requisição é obrigatório e deve ser enviado como ${contentType}.`,
  );
}

function isBinaryUpload(request: FastifyRequest): boolean {
  return request.routeOptions.config.operationId === BINARY_UPLOAD_OPERATION;
}

/**
 * O servidor só lê corpo em JSON — e o arquivo puro no envio de documentos. O Fastify também
 * leria `text/plain` (sem validar contra o contrato), então esse leitor é removido; e os tipos
 * que o contrato cita só em respostas ganham um leitor que recusa, para que nenhum deles seja
 * aceito como corpo por engano.
 */
function acceptOnlyContractBodies(app: FastifyInstance, contract: Contract): void {
  app.removeContentTypeParser('text/plain');

  for (const contentType of contract.contentTypes) {
    if (contentType === JSON_CONTENT_TYPE || contentType === BINARY_CONTENT_TYPE) continue;
    app.addContentTypeParser(contentType, (_request, _payload, done) => {
      done(bodyRequired());
    });
  }

  // Corpo binário fora da operação de envio é recusado antes de ser lido.
  app.addHook('preParsing', (request, _reply, _payload, done) => {
    if (mediaTypeOf(request) === BINARY_CONTENT_TYPE && !isBinaryUpload(request)) {
      done(bodyRequired());
      return;
    }
    done();
  });
  // O limite de tamanho vem da rota (ver `buildApp`); aqui o corpo só vira um `Buffer`.
  app.addContentTypeParser(
    BINARY_CONTENT_TYPE,
    { parseAs: 'buffer' },
    (_request, body: Buffer, done) => {
      done(null, body);
    },
  );
}

/** Handlers de todas as operações implementadas, por `operationId`. */
export function createOperationHandlers(dependencies: AppDependencies): {
  handlers: OperationHandlers;
  /** Encerra os streams de eventos abertos (o servidor está desligando). */
  closeStreams: () => void;
} {
  const executionEvents = createExecutionEventsHandlers(dependencies);
  return {
    handlers: {
      ...createHealthHandlers(dependencies),
      ...createClientHandlers(),
      ...createHotelHandlers(dependencies),
      ...createExecutionHandlers(dependencies),
      ...createReservationHandlers(dependencies),
      ...createEvidenceHandlers(dependencies),
      ...createTreatmentHandlers(dependencies),
      ...executionEvents.handlers,
    },
    closeStreams: () => executionEvents.closeAll(),
  };
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
  const { handlers, closeStreams } = createOperationHandlers(dependencies);

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
  acceptOnlyContractBodies(app, contract);

  // Streams de eventos ficam abertos indefinidamente; sem isto o servidor não conseguiria desligar.
  app.addHook('preClose', (done) => {
    closeStreams();
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    // Arquivo acima do limite no envio de documentos: código próprio, para o app explicar (FR-008).
    const tooLarge =
      isFastifyError(error) &&
      error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' &&
      isBinaryUpload(request);
    const problem = tooLarge ? new ProblemError('file_too_large') : toProblemError(error);
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
      done(bodyRequired(requestBodyTypes[0]));
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
        // Só o envio de documentos aceita corpo maior que o padrão de 1 MiB do Fastify (R-03).
        ...(operationId === BINARY_UPLOAD_OPERATION && { bodyLimit: MAX_TREATMENT_FILE_BYTES }),
      } as unknown as RouteOptions;
    },
  });

  return app;
}
