import { createHash, randomBytes } from 'node:crypto';
import type { onRequestAsyncHookHandler } from 'fastify';
import type { ClientIdentity } from '../persistence/clients-repo.js';
import { ProblemError } from './problem.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Cliente autenticado; `null` nas rotas públicas e fora do contrato. */
    client: ClientIdentity | null;
  }

  interface FastifyContextConfig {
    /** Preenchidos para toda rota criada a partir do contrato (ver `app.ts`). */
    operationId?: string;
    requiresAuth?: boolean;
    requestBodyTypes?: readonly string[] | null;
  }
}

const API_KEY_PREFIX = 'hunit_';

/**
 * Operações que só o nível `operator` pode executar (FR-007). O nível `reader` apenas acompanha
 * execuções e consulta resultados. Um teste confere que toda operação do contrato que não é
 * de leitura (GET) está nesta lista.
 */
export const OPERATOR_ONLY_OPERATIONS: ReadonlySet<string> = new Set([
  'createExecution',
  'sendTwoFactor',
  'cancelExecution',
  'resumeExecution',
]);

/** Gera uma chave de API nova, com 256 bits aleatórios. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 da chave, em hexadecimal: é só isto que o banco guarda (research R-10). */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  return match?.[1] ?? null;
}

export interface AuthDependencies {
  findActiveClientByKeyHash(keyHash: string): Promise<ClientIdentity | null>;
}

/**
 * Autenticação por chave de API (`Authorization: Bearer <chave>`) e controle de nível.
 *
 * Roda no início da requisição (`onRequest`), antes de o corpo ser lido ou validado: quem não
 * se autentica recebe 401 sem que nada do que enviou seja processado.
 */
export function createAuthHook(dependencies: AuthDependencies): onRequestAsyncHookHandler {
  return async (request, reply) => {
    const { operationId, requiresAuth } = request.routeOptions.config;

    // Rota fora do contrato (vai responder 404) ou operação pública (ex.: /health).
    if (operationId === undefined || requiresAuth === false) return;

    const apiKey = readBearerToken(request.headers.authorization);
    if (apiKey === null) throw new ProblemError('unauthorized');

    const client = await dependencies.findActiveClientByKeyHash(hashApiKey(apiKey));
    if (client === null) throw new ProblemError('unauthorized');

    if (client.role !== 'operator' && OPERATOR_ONLY_OPERATIONS.has(operationId)) {
      throw new ProblemError(
        'forbidden_for_role',
        `O cliente "${client.name}" tem nível "${client.role}"; esta ação exige o nível "operator".`,
      );
    }

    request.client = client;

    // Toda linha de log desta requisição passa a dizer qual cliente a fez (auditoria, FR-007).
    // A resposta tem um logger próprio, usado na linha "request completed".
    const log = request.log.child({ client: client.name });
    request.log = log;
    reply.log = log;
  };
}
