/**
 * Conteúdo dos arquivos das tratativas (specs/003, research R-01): guardado no banco, uma vez por
 * conteúdo (a chave é o SHA-256). Assim os documentos entram nas cópias de segurança e são
 * gravados na mesma transação do registro (FR-010, FR-011).
 */
import { eq } from 'drizzle-orm';
import type { Database } from './db.js';
import { treatmentFiles } from './schema.js';

export interface TreatmentFileMeta {
  /** SHA-256 do conteúdo, em hexadecimal minúsculo; é o `fileId` da API. */
  sha256: string;
  sizeBytes: number;
  mediaType: string;
}

export interface NewTreatmentFile {
  sha256: string;
  content: Buffer;
  /** Decidido pelo servidor a partir do conteúdo (research R-03). */
  mediaType: string;
  clientId: string;
  now: Date;
}

const META = {
  sha256: treatmentFiles.sha256,
  sizeBytes: treatmentFiles.sizeBytes,
  mediaType: treatmentFiles.mediaType,
};

/** Dados do arquivo, sem o conteúdo. */
export async function findTreatmentFile(
  db: Database,
  sha256: string,
): Promise<TreatmentFileMeta | null> {
  const [row] = await db.select(META).from(treatmentFiles).where(eq(treatmentFiles.sha256, sha256));
  return row ?? null;
}

/**
 * Grava o arquivo. Um conteúdo que já existe não é gravado de novo: devolve o mesmo registro
 * (deduplicação — o mesmo documento aplicado a várias reservas ocupa espaço uma vez só).
 */
export async function saveTreatmentFile(
  db: Database,
  file: NewTreatmentFile,
): Promise<TreatmentFileMeta> {
  await db
    .insert(treatmentFiles)
    .values({
      sha256: file.sha256,
      content: file.content,
      sizeBytes: file.content.length,
      mediaType: file.mediaType,
      createdAt: file.now,
      uploadedByClientId: file.clientId,
    })
    .onConflictDoNothing({ target: treatmentFiles.sha256 });

  const saved = await findTreatmentFile(db, file.sha256);
  if (!saved) throw new Error('O banco não devolveu o arquivo gravado.');
  return saved;
}

/** Conteúdo do arquivo, idêntico ao enviado (FR-009); `null` se o arquivo não existe. */
export async function findTreatmentFileContent(
  db: Database,
  sha256: string,
): Promise<Buffer | null> {
  const [row] = await db
    .select({ content: treatmentFiles.content })
    .from(treatmentFiles)
    .where(eq(treatmentFiles.sha256, sha256));
  return row?.content ?? null;
}
