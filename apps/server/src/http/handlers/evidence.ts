import { readFile } from 'node:fs/promises';
import type { operations } from '@hunit/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EvidenceStore } from '../../evidence/store.js';
import type { Database } from '../../persistence/db.js';
import { evidence } from '../../persistence/schema.js';
import { ProblemError } from '../problem.js';

type EvidenceParams = operations['getEvidenceFile']['parameters']['path'];
type EvidenceFile = EvidenceParams['file'];

/** Coluna e tipo de conteúdo de cada arquivo de uma evidência. */
const FILES: Readonly<
  Record<EvidenceFile, { column: 'screenshotPath' | 'htmlPath' | 'responsePath'; type: string }>
> = {
  screenshot: { column: 'screenshotPath', type: 'image/png' },
  html: { column: 'htmlPath', type: 'text/html; charset=utf-8' },
  response: { column: 'responsePath', type: 'application/json; charset=utf-8' },
};

export interface EvidenceHandlerDependencies {
  db: Database;
  evidence: EvidenceStore;
  /** Relógio; os testes podem informar um fixo. */
  now?: () => Date;
}

function isMissingFile(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

export function createEvidenceHandlers(dependencies: EvidenceHandlerDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    /** GET /v1/evidence/{evidenceId}/{file} — baixa um arquivo de evidência (FR-024, FR-025). */
    async getEvidenceFile(request: FastifyRequest, reply: FastifyReply) {
      const { evidenceId, file } = request.params as EvidenceParams;
      const [row] = await dependencies.db
        .select()
        .from(evidence)
        .where(eq(evidence.id, evidenceId));
      if (!row) throw new ProblemError('not_found', 'Evidência não encontrada.');

      if (row.expiresAt.getTime() <= now().getTime()) {
        throw new ProblemError(
          'evidence_expired',
          'A evidência passou do prazo de retenção e foi ou será removida.',
        );
      }

      const { column, type } = FILES[file];
      const relativePath = row[column];
      if (!relativePath) throw new ProblemError('not_found', 'A evidência não tem este arquivo.');

      let content: Buffer;
      try {
        content = await readFile(dependencies.evidence.resolve(relativePath));
      } catch (error) {
        if (isMissingFile(error)) {
          throw new ProblemError('not_found', 'O arquivo da evidência não existe mais.');
        }
        throw error;
      }

      // O conteúdo veio do Hunit: o navegador não deve executar nem reinterpretar nada dele.
      return reply
        .type(type)
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-security-policy',
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        )
        .header('content-disposition', `inline; filename="${row.id}-${file}"`)
        .send(content);
    },
  };
}
