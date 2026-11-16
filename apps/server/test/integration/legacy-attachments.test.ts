/**
 * Anexos do sistema anterior (specs/004, research R-07) — tasks.md, T012. Arquivos sintéticos.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LegacyAttachments } from '../../src/legacy-import/attachments.js';
import {
  legacyAttachmentPath,
  legacyFile,
  writeLegacyAttachments,
} from '../helpers/legacy-fixtures.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const base = mkdtempSync(path.join(tmpdir(), 'legacy-attachments-'));
const root = path.join(base, 'anexos');
let attachments: LegacyAttachments;

beforeAll(async () => {
  writeLegacyAttachments(root, {
    [legacyAttachmentPath('hml_900001_proof_a.pdf')]: legacyFile.pdf('a'),
    [legacyAttachmentPath('hml_900002_request_b.png')]: legacyFile.png('b'),
    [legacyAttachmentPath('hml_900003_request_c.eml')]: legacyFile.eml('c'),
    [legacyAttachmentPath('renomeado.pdf')]: legacyFile.executable(),
    [legacyAttachmentPath('vazio.pdf')]: legacyFile.empty(),
    [legacyAttachmentPath('grande.pdf')]: legacyFile.tooLarge(),
    [legacyAttachmentPath('planilha.xlsx')]: Buffer.from('PK'),
    'outra/repetido.pdf': legacyFile.pdf('r1'),
    'mais-uma/repetido.pdf': legacyFile.pdf('r2'),
    'sobra.pdf': legacyFile.pdf('sobra'),
  });
  // Arquivo fora da pasta e um link para ele dentro dela.
  writeFileSync(path.join(base, 'fora.pdf'), legacyFile.pdf('fora'));
  mkdirSync(path.join(root, 'links'), { recursive: true });
  try {
    symlinkSync(path.join(base, 'fora.pdf'), path.join(root, 'links', 'link.pdf'));
  } catch {
    // Sem permissão para criar links (Windows sem modo de desenvolvedor): o caso fica sem o link.
  }
  attachments = await LegacyAttachments.open(root);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('LegacyAttachments', () => {
  it('acha pelo caminho da planilha e confere o conteúdo', async () => {
    const result = await attachments.inspect(
      legacyAttachmentPath('hml_900001_proof_a.pdf'),
      'Comprovante 900001.pdf',
    );
    expect(result).toMatchObject({
      ok: true,
      attachment: {
        mediaType: 'application/pdf',
        fileName: 'Comprovante 900001.pdf',
        relative: legacyAttachmentPath('hml_900001_proof_a.pdf'),
      },
    });
    if (result.ok) expect(result.attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('caminho de outro nível: acha pelo nome do arquivo', async () => {
    const result = await attachments.inspect('C/Dropbox/hml_900002_request_b.png', null);
    expect(result).toMatchObject({ ok: true, attachment: { mediaType: 'image/png' } });
  });

  it('nome original ausente, inválido ou de outro tipo → nome do arquivo na pasta', async () => {
    const path900003 = legacyAttachmentPath('hml_900003_request_c.eml');
    for (const name of [null, 'a/b.eml', 'pedido.pdf']) {
      const result = await attachments.inspect(path900003, name);
      expect(result.ok && result.attachment.fileName).toBe('hml_900003_request_c.eml');
    }
  });

  it.each([
    [legacyAttachmentPath('nao-existe.pdf'), 'file_not_found'],
    ['repetido.pdf', 'file_not_found'],
    ['../fora.pdf', 'file_not_found'],
    [path.join(base, 'fora.pdf'), 'file_not_found'],
    ['C:/qualquer/coisa.pdf', 'file_not_found'],
    [legacyAttachmentPath('renomeado.pdf'), 'file_type_mismatch'],
    [legacyAttachmentPath('vazio.pdf'), 'empty_file'],
    [legacyAttachmentPath('planilha.xlsx'), 'unsupported_file_type'],
  ])('%s → %s', async (stored, reason) => {
    expect(await attachments.inspect(stored, null)).toEqual({ ok: false, reason });
  });

  it('link simbólico para fora da pasta não é aberto', async () => {
    expect(await attachments.inspect('links/link.pdf', null)).toEqual({
      ok: false,
      reason: 'file_not_found',
    });
  });

  it('acima de 25 MiB é recusado sem ser lido', async () => {
    const readFile = vi.mocked(fsPromises.readFile);
    readFile.mockClear();
    expect(await attachments.inspect(legacyAttachmentPath('grande.pdf'), null)).toEqual({
      ok: false,
      reason: 'file_too_large',
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('conta os arquivos que nenhuma linha usou', async () => {
    const fresh = await LegacyAttachments.open(root);
    await fresh.inspect(legacyAttachmentPath('hml_900001_proof_a.pdf'), null);
    // 10 arquivos na pasta (o link não conta), 1 usado.
    expect(fresh.unreferencedCount()).toBe(9);
  });
});
