/**
 * Arquivos escolhidos pelo operador para uma tratativa (specs/003, research R-08, FR-018a).
 *
 * O arquivo é lido uma vez para a memória do processo principal e fica num mapa, com um id que a
 * interface usa para confirmar ou cancelar. Nada é gravado em disco: a pré-visualização e o envio
 * ao servidor usam os mesmos bytes. A entrada sai do mapa ao ser descartada ou depois de 15
 * minutos sem uso.
 *
 * O tamanho e a extensão são conferidos aqui só para avisar cedo e não ler um arquivo grande à
 * toa; quem decide se o arquivo é aceito é o servidor, pelo conteúdo (research R-03).
 */
import { randomUUID } from 'node:crypto';
import { readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import path from 'node:path';
import type { Result } from '../shared/ipc-types.js';

/** Mesmos tipos e limite da FR-008 (um teste confere contra `@hunit/domain`). */
export const PICKABLE_MEDIA_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
} as const;

export const PICKABLE_EXTENSIONS = Object.keys(PICKABLE_MEDIA_TYPES);

/** 25 MiB. */
export const MAX_PICKED_FILE_BYTES = 26_214_400;

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export interface PickedFileEntry {
  selectionId: string;
  fileName: string;
  /** Conteúdo do arquivo; só existe na memória do processo principal. */
  bytes: Buffer;
  sizeBytes: number;
  mediaType: string;
}

export type OpenDialog = (options: {
  title: string;
  properties: ['openFile'];
  filters: Array<{ name: string; extensions: string[] }>;
}) => Promise<{ canceled: boolean; filePaths: string[] }>;

export interface PickedFilesOptions {
  showOpenDialog: OpenDialog;
  /** Tempo sem uso até a entrada ser descartada. Padrão: 15 min. */
  ttlMs?: number;
  // Acesso ao disco; os testes trocam para conferir que arquivo grande não é lido.
  stat?: (file: string) => Promise<{ size: number }>;
  readFile?: (file: string) => Promise<Buffer>;
}

function mediaTypeOf(fileName: string): string | null {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return Object.hasOwn(PICKABLE_MEDIA_TYPES, extension)
    ? PICKABLE_MEDIA_TYPES[extension as keyof typeof PICKABLE_MEDIA_TYPES]
    : null;
}

export class PickedFiles {
  private readonly entries = new Map<string, { entry: PickedFileEntry; timer: NodeJS.Timeout }>();
  private readonly ttlMs: number;
  private readonly stat: (file: string) => Promise<{ size: number }>;
  private readonly readFile: (file: string) => Promise<Buffer>;

  constructor(private readonly options: PickedFilesOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.stat = options.stat ?? fsStat;
    this.readFile = options.readFile ?? fsReadFile;
  }

  /** Abre "Abrir arquivo" e guarda o escolhido na memória. `null` = o operador cancelou. */
  async pick(title: string): Promise<Result<PickedFileEntry | null>> {
    const picked = await this.options.showOpenDialog({
      title,
      properties: ['openFile'],
      filters: [{ name: 'E-mail, PDF ou imagem', extensions: PICKABLE_EXTENSIONS }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return { ok: true, data: null };

    const fileName = path.basename(file);
    const mediaType = mediaTypeOf(fileName);
    if (mediaType === null) {
      return { ok: false, error: { code: 'unsupported_file_type' } };
    }

    // O tamanho é conferido antes da leitura: um arquivo grande demais nem entra na memória.
    const { size } = await this.stat(file);
    if (size === 0) return { ok: false, error: { code: 'empty_file' } };
    if (size > MAX_PICKED_FILE_BYTES) return { ok: false, error: { code: 'file_too_large' } };

    const bytes = await this.readFile(file);
    if (bytes.length === 0) return { ok: false, error: { code: 'empty_file' } };
    if (bytes.length > MAX_PICKED_FILE_BYTES) {
      return { ok: false, error: { code: 'file_too_large' } };
    }

    const entry: PickedFileEntry = {
      selectionId: randomUUID(),
      fileName,
      bytes,
      sizeBytes: bytes.length,
      mediaType,
    };
    this.entries.set(entry.selectionId, { entry, timer: this.expireLater(entry.selectionId) });
    return { ok: true, data: entry };
  }

  /** Arquivo ainda guardado; cada uso renova o prazo. `null` = descartado ou vencido. */
  get(selectionId: string): PickedFileEntry | null {
    const found = this.entries.get(selectionId);
    if (!found) return null;
    clearTimeout(found.timer);
    found.timer = this.expireLater(selectionId);
    return found.entry;
  }

  /** Libera a memória do arquivo (confirmado, cancelado ou vencido). */
  discard(selectionId: string): void {
    const found = this.entries.get(selectionId);
    if (!found) return;
    clearTimeout(found.timer);
    this.entries.delete(selectionId);
  }

  /** Libera tudo (o app está fechando). */
  clear(): void {
    for (const selectionId of [...this.entries.keys()]) this.discard(selectionId);
  }

  /** Quantos arquivos estão na memória; usado pelos testes. */
  get size(): number {
    return this.entries.size;
  }

  private expireLater(selectionId: string): NodeJS.Timeout {
    const timer = setTimeout(() => this.discard(selectionId), this.ttlMs);
    // Não segura o app aberto só por causa do prazo.
    timer.unref();
    return timer;
  }
}
