import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from '../persistence/db.js';
import { evidence, type EvidenceKind } from '../persistence/schema.js';
import type { SecretRegistry } from '../secrets.js';
import { hasEvidenceMaterial, type EvidenceMaterial } from './material.js';
import { sanitizeHtml } from './sanitize.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewEvidence {
  executionId: string;
  hotelCode?: string | null;
  reservationNumber?: string | null;
  kind: EvidenceKind;
  /** Por que a evidência foi gerada. Não pode conter credenciais nem nome de hóspede. */
  reason: string;
  material: EvidenceMaterial;
}

export interface StoredEvidence {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  /** Caminhos relativos à pasta de evidências, com "/" como separador. */
  screenshotPath: string | null;
  htmlPath: string | null;
  responsePath: string | null;
}

export interface EvidenceStoreOptions {
  db: Database;
  /** Pasta das evidências (EVIDENCE_DIR). */
  dir: string;
  /** Dias que uma evidência fica guardada (EVIDENCE_RETENTION_DAYS). */
  retentionDays: number;
  /** Segredos em uso: apagados de todo texto antes de gravar (FR-025). */
  secrets: SecretRegistry;
  /** Relógio; os testes informam um fixo. */
  now?: () => Date;
}

/**
 * Grava evidências de falha (FR-024): os arquivos vão para `<dir>/<execução>/` e o registro
 * para a tabela `evidence`, com a data em que a rotina de manutenção deve removê-la (FR-025).
 */
export class EvidenceStore {
  private readonly now: () => Date;

  constructor(private readonly options: EvidenceStoreOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Grava a evidência. Devolve `null` quando não há nada para gravar (a captura não obteve
   * nem a tela nem a resposta).
   */
  async save(input: NewEvidence): Promise<StoredEvidence | null> {
    if (!hasEvidenceMaterial(input.material)) return null;

    const { db, secrets, retentionDays } = this.options;
    const { screenshot, html, response } = input.material;
    const id = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + retentionDays * DAY_MS);

    const files: Array<{ relativePath: string; content: Buffer | string }> = [];
    const fileFor = (extension: string, content: Buffer | string | undefined): string | null => {
      if (content === undefined || content.length === 0) return null;
      const relativePath = `${input.executionId}/${id}.${extension}`;
      files.push({ relativePath, content });
      return relativePath;
    };

    const stored: StoredEvidence = {
      id,
      createdAt,
      expiresAt,
      screenshotPath: fileFor('png', screenshot),
      // O HTML é sanitizado de novo aqui: a gravação não depende de quem capturou.
      htmlPath: fileFor('html', html === undefined ? undefined : secrets.scrub(sanitizeHtml(html))),
      responsePath: fileFor('json', response === undefined ? undefined : secrets.scrub(response)),
    };

    await mkdir(this.resolve(input.executionId), { recursive: true });
    const written: string[] = [];
    try {
      for (const file of files) {
        const absolutePath = this.resolve(file.relativePath);
        await writeFile(absolutePath, file.content);
        written.push(absolutePath);
      }

      await db.insert(evidence).values({
        id,
        executionId: input.executionId,
        hotelCode: input.hotelCode ?? null,
        reservationNumber: input.reservationNumber ?? null,
        kind: input.kind,
        reason: secrets.scrub(input.reason),
        screenshotPath: stored.screenshotPath,
        htmlPath: stored.htmlPath,
        responsePath: stored.responsePath,
        createdAt,
        expiresAt,
      });
    } catch (error) {
      // Sem o registro no banco, a rotina de limpeza nunca acharia estes arquivos.
      await Promise.all(written.map((file) => rm(file, { force: true })));
      throw error;
    }

    return stored;
  }

  /**
   * Caminho absoluto de um arquivo de evidência. Recusa qualquer caminho que saia da pasta
   * de evidências.
   */
  resolve(relativePath: string): string {
    const root = path.resolve(this.options.dir);
    const absolutePath = path.resolve(root, relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
      throw new Error('Caminho de evidência fora da pasta de evidências.');
    }
    return absolutePath;
  }
}
