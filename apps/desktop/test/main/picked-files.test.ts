/**
 * Arquivos escolhidos para as tratativas (specs/003, T016, FR-018a, research R-08): lidos uma vez
 * para a memória, com tamanho e extensão conferidos antes da leitura, descartados ao confirmar,
 * cancelar ou depois de 15 minutos sem uso. Nada é gravado em disco.
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ACCEPTED_TREATMENT_EXTENSIONS, MAX_TREATMENT_FILE_BYTES } from '@hunit/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PICKED_FILE_BYTES,
  PICKABLE_EXTENSIONS,
  PickedFiles,
  type OpenDialog,
} from '../../src/main/picked-files.js';
import { pdfFile, pngFile } from '../helpers/synthetic-files.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hunit-picked-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

async function fileOnDisk(name: string, content: Buffer): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

const choosing = (file: string | null): OpenDialog =>
  vi.fn(() => Promise.resolve({ canceled: file === null, filePaths: file === null ? [] : [file] }));

describe('limites', () => {
  it('são os mesmos do servidor (FR-008)', () => {
    expect(MAX_PICKED_FILE_BYTES).toBe(MAX_TREATMENT_FILE_BYTES);
    expect([...PICKABLE_EXTENSIONS].sort()).toEqual([...ACCEPTED_TREATMENT_EXTENSIONS].sort());
  });
});

describe('escolher', () => {
  it('abre o diálogo só com as extensões aceitas e guarda o arquivo na memória', async () => {
    const content = pdfFile();
    const showOpenDialog = choosing(await fileOnDisk('Comprovante.PDF', content));
    const files = new PickedFiles({ showOpenDialog });

    const picked = await files.pick('Escolher o comprovante');

    expect(showOpenDialog).toHaveBeenCalledWith({
      title: 'Escolher o comprovante',
      properties: ['openFile'],
      filters: [{ name: 'E-mail, PDF ou imagem', extensions: PICKABLE_EXTENSIONS }],
    });
    expect(picked).toEqual({
      ok: true,
      data: {
        selectionId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        fileName: 'Comprovante.PDF',
        bytes: content,
        sizeBytes: content.length,
        mediaType: 'application/pdf',
      },
    });
    expect(files.size).toBe(1);
  });

  it('diálogo cancelado não guarda nada', async () => {
    const files = new PickedFiles({ showOpenDialog: choosing(null) });

    expect(await files.pick('Escolher')).toEqual({ ok: true, data: null });
    expect(files.size).toBe(0);
  });

  it('arquivo acima de 25 MB é recusado sem ser lido', async () => {
    const readFile = vi.fn(() => Promise.resolve(Buffer.alloc(1)));
    const files = new PickedFiles({
      showOpenDialog: choosing(path.join(dir, 'grande.pdf')),
      stat: () => Promise.resolve({ size: MAX_PICKED_FILE_BYTES + 1 }),
      readFile,
    });

    expect(await files.pick('Escolher')).toEqual({
      ok: false,
      error: { code: 'file_too_large' },
    });
    expect(readFile).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
  });

  it('aceita exatamente 25 MiB', async () => {
    const content = Buffer.alloc(MAX_PICKED_FILE_BYTES, 0x20);
    const files = new PickedFiles({
      showOpenDialog: choosing(path.join(dir, 'limite.pdf')),
      stat: () => Promise.resolve({ size: content.length }),
      readFile: () => Promise.resolve(content),
    });

    expect(await files.pick('Escolher')).toMatchObject({
      ok: true,
      data: { sizeBytes: 26_214_400 },
    });
  });

  it.each([
    ['extensão fora da lista', 'planilha.xlsx', pdfFile(), 'unsupported_file_type'],
    ['arquivo sem extensão', 'comprovante', pdfFile(), 'unsupported_file_type'],
    ['arquivo vazio', 'vazio.pdf', Buffer.alloc(0), 'empty_file'],
  ])('recusa %s', async (_case, name, content, code) => {
    const files = new PickedFiles({ showOpenDialog: choosing(await fileOnDisk(name, content)) });

    expect(await files.pick('Escolher')).toEqual({ ok: false, error: { code } });
    expect(files.size).toBe(0);
  });

  it('não grava nenhuma cópia: a pasta do arquivo continua só com o original', async () => {
    const files = new PickedFiles({
      showOpenDialog: choosing(await fileOnDisk('tela.png', pngFile())),
    });

    const picked = await files.pick('Escolher');
    if (picked.ok && picked.data) files.get(picked.data.selectionId);

    expect(await readdir(dir)).toEqual(['tela.png']);
  });
});

describe('guardar e descartar', () => {
  async function pickOne(files: PickedFiles): Promise<string> {
    const picked = await files.pick('Escolher');
    if (!picked.ok || !picked.data) throw new Error('o arquivo deveria ter sido escolhido');
    return picked.data.selectionId;
  }

  it('devolve o arquivo pelo id e o esquece ao descartar', async () => {
    const files = new PickedFiles({
      showOpenDialog: choosing(await fileOnDisk('tela.png', pngFile())),
    });
    const selectionId = await pickOne(files);

    expect(files.get(selectionId)?.fileName).toBe('tela.png');
    files.discard(selectionId);

    expect(files.get(selectionId)).toBeNull();
    expect(files.size).toBe(0);
    // Descartar de novo, ou um id desconhecido, não é erro.
    files.discard(selectionId);
    expect(files.get('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('descarta sozinho depois de 15 minutos sem uso; cada uso renova o prazo', async () => {
    const file = await fileOnDisk('tela.png', pngFile());
    vi.useFakeTimers();
    const files = new PickedFiles({
      showOpenDialog: choosing(file),
      stat: () => Promise.resolve({ size: 4 }),
      readFile: () => Promise.resolve(Buffer.from('%PDF')),
    });
    const selectionId = await pickOne(files);

    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(files.get(selectionId)).not.toBeNull();

    // O uso acima renovou o prazo: 14 minutos depois o arquivo ainda está lá.
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(files.size).toBe(1);

    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(files.size).toBe(0);
    expect(files.get(selectionId)).toBeNull();
  });

  it('clear libera tudo (o app está fechando)', async () => {
    const files = new PickedFiles({
      showOpenDialog: choosing(await fileOnDisk('tela.png', pngFile())),
    });
    await pickOne(files);
    await pickOne(files);

    files.clear();

    expect(files.size).toBe(0);
  });
});
