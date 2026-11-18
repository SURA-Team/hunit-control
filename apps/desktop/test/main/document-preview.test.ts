/**
 * Pré-visualização montada no processo principal (specs/003, T016, FR-018, FR-018a, research
 * R-08): dos e-mails saem cabeçalhos, texto e a lista de anexos; PDF e imagem saem como bytes;
 * arquivo ilegível vira aviso. Todos os arquivos são sintéticos.
 */
import { describe, expect, it } from 'vitest';
import { buildDocumentPreview } from '../../src/main/document-preview.js';
import {
  corruptedMsgFile,
  emlFile,
  msgFile,
  pdfFile,
  pngFile,
  text,
} from '../helpers/synthetic-files.js';

describe('PDF e imagem', () => {
  it('devolvem os bytes para a interface desenhar', async () => {
    const pdf = pdfFile();
    const png = pngFile();

    const pdfPreview = await buildDocumentPreview({ mediaType: 'application/pdf', bytes: pdf });
    const pngPreview = await buildDocumentPreview({ mediaType: 'image/png', bytes: png });

    expect(pdfPreview).toEqual({ type: 'pdf', bytes: Uint8Array.from(pdf) });
    expect(pngPreview).toEqual({
      type: 'image',
      bytes: Uint8Array.from(png),
      mediaType: 'image/png',
    });
    // Uma cópia simples, que atravessa a ponte entre os processos.
    expect(Buffer.isBuffer((pdfPreview as { bytes: Uint8Array }).bytes)).toBe(false);
  });
});

describe('e-mail .eml', () => {
  it('mostra remetente, destinatários, cópia, assunto, data e texto', async () => {
    const preview = await buildDocumentPreview({
      mediaType: 'message/rfc822',
      bytes: emlFile({
        cc: 'controladoria@exemplo.test',
        text: 'Favor cobrar a reserva de teste.',
      }),
    });

    expect(preview).toEqual({
      type: 'email',
      from: 'Financeiro Teste <financeiro@exemplo.test>',
      to: ['Comercial Teste <comercial@exemplo.test>'],
      cc: ['controladoria@exemplo.test'],
      subject: 'Pedido de cobranca de teste',
      date: '2026-11-13T13:00:00.000Z',
      text: 'Favor cobrar a reserva de teste.',
      html: null,
      attachments: [],
    });
  });

  it('lista os anexos (nome, tipo e tamanho) sem devolver o conteúdo deles', async () => {
    const preview = await buildDocumentPreview({
      mediaType: 'message/rfc822',
      bytes: emlFile({ attachment: { name: 'boleto.txt', content: 'CONTEUDO-DO-ANEXO' } }),
    });

    expect(preview).toMatchObject({
      type: 'email',
      attachments: [{ name: 'boleto.txt', mediaType: 'text/plain' }],
    });
    const { attachments } = preview as { attachments: Array<{ sizeBytes: number | null }> };
    expect(attachments[0]?.sizeBytes).toBeGreaterThan(0);
    expect(JSON.stringify(preview)).not.toContain('CONTEUDO-DO-ANEXO');
  });

  it('mensagem só em HTML nunca devolve texto e HTML ao mesmo tempo', async () => {
    const preview = await buildDocumentPreview({
      mediaType: 'message/rfc822',
      bytes: emlFile({ html: '<p>Favor <b>cobrar</b> a reserva.</p>' }),
    });

    expect(preview.type).toBe('email');
    const email = preview as { text: string | null; html: string | null };
    expect(email.text === null || email.html === null).toBe(true);
    expect(`${email.text ?? ''}${email.html ?? ''}`).toContain('cobrar');
  });

  it('data inválida vira nula, sem derrubar a leitura', async () => {
    const preview = await buildDocumentPreview({
      mediaType: 'message/rfc822',
      bytes: emlFile({ date: 'ontem de tarde' }),
    });

    expect(preview).toMatchObject({ type: 'email', date: null });
  });
});

describe('e-mail .msg', () => {
  it('mostra remetente, destinatário, assunto e texto', async () => {
    const preview = await buildDocumentPreview({
      mediaType: 'application/vnd.ms-outlook',
      bytes: msgFile({ subject: 'Cobranca de teste', body: 'Texto da mensagem de teste.' }),
    });

    expect(preview).toMatchObject({
      type: 'email',
      from: 'Financeiro Teste <financeiro@exemplo.test>',
      to: ['Comercial Teste <comercial@exemplo.test>'],
      subject: 'Cobranca de teste',
      text: 'Texto da mensagem de teste.',
      html: null,
      attachments: [],
    });
  });

  it.each([
    ['arquivo composto corrompido', corruptedMsgFile()],
    ['arquivo que não é do Outlook', text('isto não é uma mensagem')],
  ])('%s vira "não foi possível pré-visualizar"', async (_case, bytes) => {
    expect(await buildDocumentPreview({ mediaType: 'application/vnd.ms-outlook', bytes })).toEqual({
      type: 'unavailable',
      reason: 'unreadable',
    });
  });
});

describe('tipo desconhecido', () => {
  it('vira "não foi possível pré-visualizar"', async () => {
    expect(await buildDocumentPreview({ mediaType: 'application/zip', bytes: text('PK') })).toEqual(
      {
        type: 'unavailable',
        reason: 'unreadable',
      },
    );
  });
});
