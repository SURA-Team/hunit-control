import { sql } from 'drizzle-orm';
import type { Database } from '../../persistence/db.js';
import { ProblemError } from '../problem.js';

export function createHealthHandlers(dependencies: { db: Database }) {
  return {
    /** GET /v1/health — o serviço está no ar e o banco de dados responde. */
    async getHealth() {
      try {
        await dependencies.db.execute(sql`select 1`);
      } catch (error) {
        // O motivo técnico vai para o log pelo tratador de erros; o cliente só vê o resumo.
        throw new ProblemError('internal_error', 'O banco de dados não respondeu.', {
          status: 503,
          title: 'Serviço indisponível',
          cause: error,
        });
      }
      return { status: 'ok' as const };
    },
  };
}
