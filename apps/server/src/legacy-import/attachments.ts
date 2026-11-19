/**
 * Anexos do sistema anterior, lidos da pasta montada só para leitura (specs/004, research R-07).
 *
 * - O caminho gravado na planilha é relativo à pasta que o sistema anterior usava: procura-se
 *   primeiro o caminho dentro da pasta e, se não existir, o nome do arquivo em toda a pasta.
 * - Nada fora da pasta é aberto: caminho absoluto, com `..` ou que sai da pasta por link simbólico
 *   vira `file_not_found`.
 * - O conteúdo passa pela mesma conferência da 003 (`detectTreatmentFile`); arquivo acima do limite
 *   é recusado sem ser lido.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ACCEPTED_TREATMENT_EXTENSIONS,
  MAX_TREATMENT_FILE_BYTES,
  detectTreatmentFile,
  fileNameMatchesMediaType,
  isValidTreatmentFileName,
  type TreatmentMediaType,
} from '@hunit/domain';

export type AttachmentRejection =
  | 'file_not_found'
  | 'empty_file'
  | 'unsupported_file_type'
  | 'file_type_mismatch'
  | 'file_too_large';

export interface InspectedAttachment {
  /** Caminho relativo à pasta (chave da impressão digital, research R-08). */
  relative: string;
  sha256: string;
  sizeBytes: number;
  mediaType: TreatmentMediaType;
  /** Nome a gravar: o original da planilha, se válido e do mesmo tipo; senão o do arquivo. */
  fileName: string;
  content: Buffer;
}

export type AttachmentResult =
  { ok: true; attachment: InspectedAttachment } | { ok: false; reason: AttachmentRejection };

/** Comparação de caminhos sem diferença de maiúsculas no Windows. */
const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function hasAcceptedExtension(name: string): boolean {
  const extension = path.extname(name).slice(1).toLowerCase();
  return (ACCEPTED_TREATMENT_EXTENSIONS as readonly string[]).includes(extension);
}

export class LegacyAttachments {
  private readonly used = new Set<string>();

  private constructor(
    private readonly root: string,
    /** Caminho relativo (com `/`) de cada arquivo da pasta. */
    private readonly files: readonly string[],
    /** Nome do arquivo (minúsculas) → caminhos relativos. */
    private readonly byName: ReadonlyMap<string, readonly string[]>,
  ) {}

  /** Indexa a pasta uma vez. Pasta inexistente → erro. */
  static async open(folder: string): Promise<LegacyAttachments> {
    const root = await realpath(folder);
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const files: string[] = [];
    const byName = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      files.push(relative);
      const key = entry.name.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), relative]);
    }
    return new LegacyAttachments(root, files, byName);
  }

  /** Acha o arquivo de um caminho gravado na planilha (relativo à pasta). */
  async resolve(storedPath: string): Promise<{ relative: string; absolute: string } | null> {
    const cleaned = storedPath.trim().replaceAll('\\', '/');
    if (!cleaned || path.posix.isAbsolute(cleaned) || /^[a-z]:/i.test(cleaned)) return null;
    if (cleaned.split('/').includes('..')) return null;

    const direct = this.files.find((file) => samePath(file, cleaned));
    const candidates = direct
      ? [direct]
      : (this.byName.get(path.posix.basename(cleaned).toLowerCase()) ?? []);
    if (candidates.length !== 1) return null;
    const relative = candidates[0]!;

    try {
      const absolute = await realpath(path.join(this.root, ...relative.split('/')));
      return isInside(this.root, absolute) ? { relative, absolute } : null;
    } catch {
      return null;
    }
  }

  /** Lê e confere um anexo. `originalName` é o nome da planilha (pode faltar). */
  async inspect(storedPath: string, originalName: string | null): Promise<AttachmentResult> {
    const found = await this.resolve(storedPath);
    if (!found) return { ok: false, reason: 'file_not_found' };
    this.used.add(found.relative);

    const diskName = path.posix.basename(found.relative);
    const info = await stat(found.absolute);
    if (info.size > MAX_TREATMENT_FILE_BYTES) return { ok: false, reason: 'file_too_large' };

    const content = await readFile(found.absolute);
    const check = detectTreatmentFile(diskName, content);
    if (!check.ok) {
      const reason =
        check.code === 'unsupported_file_type' && hasAcceptedExtension(diskName)
          ? 'file_type_mismatch'
          : check.code;
      return { ok: false, reason };
    }

    const fileName =
      originalName !== null &&
      isValidTreatmentFileName(originalName) &&
      fileNameMatchesMediaType(originalName, check.mediaType)
        ? originalName
        : diskName;

    return {
      ok: true,
      attachment: {
        relative: found.relative,
        sha256: createHash('sha256').update(content).digest('hex'),
        sizeBytes: content.length,
        mediaType: check.mediaType,
        fileName,
        content,
      },
    };
  }

  /** Arquivos da pasta que nenhuma linha usou (só a contagem vai para o relatório). */
  unreferencedCount(): number {
    return this.files.filter((file) => !this.used.has(file)).length;
  }
}
