/**
 * Conferência do tipo e do tamanho dos documentos das tratativas (specs/003, FR-008, research
 * R-03) — tasks.md, T005. Todos os arquivos são montados aqui, sem dados reais.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_TREATMENT_EXTENSIONS,
  MAX_TREATMENT_FILE_BYTES,
  detectTreatmentFile,
  fileNameMatchesMediaType,
  isValidTreatmentFileName,
} from '../src/document-type.js';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function withPrefix(prefix: number[], size = 64): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(prefix);
  return bytes;
}

const PDF = text('%PDF-1.7\n1 0 obj\n<< >>\nendobj\n');
const PNG = withPrefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = withPrefix([0xff, 0xd8, 0xff, 0xe0]);
const MSG = withPrefix([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EML = text(
  'From: financeiro@exemplo.test\r\nTo: comercial@exemplo.test\r\nSubject: Pedido de cobranca\r\n' +
    'Date: Fri, 13 Nov 2026 10:00:00 -0300\r\n\r\nSegue o pedido.\r\n',
);
const EXECUTABLE = withPrefix([0x4d, 0x5a, 0x90, 0x00]);

describe('detectTreatmentFile', () => {
  it.each([
    ['comprovante.pdf', PDF, 'application/pdf'],
    ['tela.png', PNG, 'image/png'],
    ['foto.jpg', JPEG, 'image/jpeg'],
    ['foto.jpeg', JPEG, 'image/jpeg'],
    ['pedido.msg', MSG, 'application/vnd.ms-outlook'],
    ['pedido.eml', EML, 'message/rfc822'],
  ])('aceita %s pelo conteúdo', (name, bytes, mediaType) => {
    expect(detectTreatmentFile(name, bytes)).toEqual({ ok: true, mediaType });
  });

  it('aceita a extensão em maiúsculas', () => {
    expect(detectTreatmentFile('COMPROVANTE.PDF', PDF)).toEqual({
      ok: true,
      mediaType: 'application/pdf',
    });
  });

  it('recusa arquivo vazio', () => {
    expect(detectTreatmentFile('vazio.pdf', new Uint8Array(0))).toEqual({
      ok: false,
      code: 'empty_file',
    });
  });

  it('aceita exatamente 26 214 400 bytes e recusa 1 byte a mais', () => {
    const atLimit = new Uint8Array(MAX_TREATMENT_FILE_BYTES).fill(0x20);
    atLimit.set(PDF);
    expect(MAX_TREATMENT_FILE_BYTES).toBe(26_214_400);
    expect(detectTreatmentFile('grande.pdf', atLimit)).toEqual({
      ok: true,
      mediaType: 'application/pdf',
    });

    const overLimit = new Uint8Array(MAX_TREATMENT_FILE_BYTES + 1).fill(0x20);
    overLimit.set(PDF);
    expect(detectTreatmentFile('grande.pdf', overLimit)).toEqual({
      ok: false,
      code: 'file_too_large',
    });
  });

  it.each([
    ['planilha.xlsx', PDF],
    ['sem-extensao', PDF],
    ['script.exe', EXECUTABLE],
    ['termina-em-ponto.', PDF],
  ])('recusa a extensão fora da lista: %s', (name, bytes) => {
    expect(detectTreatmentFile(name, bytes)).toEqual({ ok: false, code: 'unsupported_file_type' });
  });

  it.each([
    ['executável renomeado para .pdf', 'boleto.pdf', EXECUTABLE],
    ['PNG com extensão .jpg', 'foto.jpg', PNG],
    ['PDF com extensão .msg', 'pedido.msg', PDF],
    ['texto comum com extensão .png', 'tela.png', text('apenas texto')],
  ])('recusa conteúdo que não corresponde à extensão: %s', (_case, name, bytes) => {
    expect(detectTreatmentFile(name, bytes)).toEqual({ ok: false, code: 'unsupported_file_type' });
  });

  describe('.eml', () => {
    it('aceita cabeçalhos com continuação de linha e só um dos campos esperados', () => {
      const eml = text('Received: from a\r\n\tby b\r\nSubject: Teste\r\n\r\ncorpo');
      expect(detectTreatmentFile('a.eml', eml)).toEqual({ ok: true, mediaType: 'message/rfc822' });
    });

    it('aceita finais de linha só com LF e marca de ordem de bytes no início', () => {
      const eml = new Uint8Array([0xef, 0xbb, 0xbf, ...text('date: hoje\nx-outro: 1\n\ncorpo')]);
      expect(detectTreatmentFile('a.eml', eml)).toEqual({ ok: true, mediaType: 'message/rfc822' });
    });

    it.each([
      ['byte nulo no conteúdo', new Uint8Array([...text('From: a@b.test\r\n\r\n'), 0x00, 0x41])],
      ['sem bloco de cabeçalhos', text('apenas um texto qualquer\r\n\r\nsem cabeçalho')],
      ['cabeçalhos sem From, Date nem Subject', text('X-Um: 1\r\nX-Dois: 2\r\n\r\ncorpo')],
      ['começa com linha em branco', text('\r\nFrom: a@b.test\r\n\r\ncorpo')],
    ])('recusa %s', (_case, bytes) => {
      expect(detectTreatmentFile('a.eml', bytes)).toEqual({
        ok: false,
        code: 'unsupported_file_type',
      });
    });
  });
});

describe('isValidTreatmentFileName', () => {
  it.each(['a.pdf', 'Comprovante de cobrança (1).pdf', `${'a'.repeat(251)}.pdf`])(
    'aceita %s',
    (name) => {
      expect(isValidTreatmentFileName(name)).toBe(true);
    },
  );

  it.each([
    ['vazio', ''],
    ['mais de 255 caracteres', `${'a'.repeat(252)}.pdf`],
    ['com barra', 'pasta/arquivo.pdf'],
    ['com barra invertida', 'pasta\\arquivo.pdf'],
    ['com caractere de controle', 'arquivo\n.pdf'],
    ['com DEL', 'arquivo\u007f.pdf'],
  ])('recusa nome %s', (_case, name) => {
    expect(isValidTreatmentFileName(name)).toBe(false);
  });
});

describe('fileNameMatchesMediaType', () => {
  it('confere a extensão do nome contra o tipo do arquivo', () => {
    expect(fileNameMatchesMediaType('a.jpeg', 'image/jpeg')).toBe(true);
    expect(fileNameMatchesMediaType('a.JPG', 'image/jpeg')).toBe(true);
    expect(fileNameMatchesMediaType('a.pdf', 'image/jpeg')).toBe(false);
    expect(fileNameMatchesMediaType('a', 'application/pdf')).toBe(false);
  });
});

describe('ACCEPTED_TREATMENT_EXTENSIONS', () => {
  it('são os tipos da FR-008', () => {
    expect([...ACCEPTED_TREATMENT_EXTENSIONS].sort()).toEqual(
      ['eml', 'jpeg', 'jpg', 'msg', 'pdf', 'png'].sort(),
    );
  });
});
