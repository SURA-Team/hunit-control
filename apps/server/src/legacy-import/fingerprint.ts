/**
 * Impressão digital de uma simulação (specs/004, FR-005a, research R-08): a importação só confirma
 * a simulação feita com a mesma planilha, os mesmos arquivos e a mesma associação de hotéis.
 */
import { createHash } from 'node:crypto';

export interface FingerprintInput {
  /** SHA-256 da planilha. */
  workbookSha256: string;
  /** Cada arquivo referenciado e encontrado: caminho relativo à pasta e SHA-256. */
  files: readonly { relative: string; sha256: string }[];
  /** Associações confirmadas: código do sistema anterior → hotel do catálogo. */
  mappings: ReadonlyMap<string, string>;
}

export function computeFingerprint(input: FingerprintInput): string {
  const files = [...new Map(input.files.map((file) => [file.relative, file.sha256]))].sort(
    ([a], [b]) => a.localeCompare(b),
  );
  const mappings = [...input.mappings].sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256')
    .update(JSON.stringify({ workbook: input.workbookSha256, files, mappings }))
    .digest('hex');
}
