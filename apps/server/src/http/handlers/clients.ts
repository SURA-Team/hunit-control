import type { components } from '@hunit/contracts';
import type { FastifyRequest } from 'fastify';
import { ProblemError } from '../problem.js';

type ClientIdentityView = components['schemas']['ClientIdentity'];

export function createClientHandlers() {
  return {
    /**
     * GET /v1/me — nome e perfil do cliente dono da chave (specs/002, FR-004 e FR-012). O app
     * desktop mostra só as ações do perfil e reconhece as execuções iniciadas na própria máquina
     * pelo nome, que é o mesmo de `requestedClient`. Disponível para os dois perfis.
     */
    getCurrentClient(request: FastifyRequest): Promise<ClientIdentityView> {
      const { client } = request;
      if (!client) return Promise.reject(new ProblemError('unauthorized'));
      return Promise.resolve({ name: client.name, role: client.role });
    },
  };
}
