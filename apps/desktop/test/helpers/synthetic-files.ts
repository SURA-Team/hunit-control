/**
 * Arquivos sintéticos para os testes das tratativas (specs/003, research R-11): PDF, imagens,
 * e-mails `.eml` e `.msg` montados aqui, **sem nenhum dado real** de hóspede, hotel ou empresa.
 */
import * as CFB from 'cfb';

export const text = (value: string): Buffer => Buffer.from(value, 'utf8');

/** PDF de uma página com um texto, válido o bastante para o pdf.js desenhar. */
export function pdfFile(label = 'Comprovante de teste'): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 14 Tf 20 120 Td (${label.replace(/[()\\]/g, '')}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object ?? ''}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** PNG 1×1 válido (um ponto vermelho). */
export function pngFile(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

export interface SyntheticEmail {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  text?: string;
  html?: string;
  attachment?: { name: string; content: string };
}

/** E-mail `.eml` (RFC 5322), em texto, HTML ou os dois, com ou sem anexo. */
export function emlFile(email: SyntheticEmail = {}): Buffer {
  const headers = [
    `From: ${email.from ?? 'Financeiro Teste <financeiro@exemplo.test>'}`,
    `To: ${email.to ?? 'Comercial Teste <comercial@exemplo.test>'}`,
    ...(email.cc ? [`Cc: ${email.cc}`] : []),
    `Subject: ${email.subject ?? 'Pedido de cobranca de teste'}`,
    `Date: ${email.date ?? 'Fri, 13 Nov 2026 10:00:00 -0300'}`,
    'MIME-Version: 1.0',
  ];

  const parts: string[] = [];
  if (email.text !== undefined || email.html === undefined) {
    parts.push(
      `Content-Type: text/plain; charset=utf-8\r\n\r\n${email.text ?? 'Segue o pedido de cobranca.'}`,
    );
  }
  if (email.html !== undefined) {
    parts.push(`Content-Type: text/html; charset=utf-8\r\n\r\n${email.html}`);
  }
  if (email.attachment) {
    parts.push(
      `Content-Type: text/plain; name="${email.attachment.name}"\r\n` +
        `Content-Disposition: attachment; filename="${email.attachment.name}"\r\n\r\n` +
        email.attachment.content,
    );
  }

  if (parts.length === 1) return text(`${headers.join('\r\n')}\r\n${parts[0] ?? ''}\r\n`);

  const boundary = 'limite-de-teste-123';
  const body = parts.map((part) => `--${boundary}\r\n${part}\r\n`).join('');
  return text(
    `${headers.join('\r\n')}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
      `${body}--${boundary}--\r\n`,
  );
}

const utf16 = (value: string): Buffer => Buffer.from(value, 'utf16le');

/**
 * Mensagem `.msg` do Outlook mínima: um arquivo composto (CFB) com os campos de texto que a
 * pré-visualização lê — assunto, remetente, destinatário e corpo.
 */
export function msgFile(
  message: {
    subject?: string;
    senderName?: string;
    senderEmail?: string;
    body?: string;
    to?: string;
  } = {},
): Buffer {
  const cfb = CFB.utils.cfb_new();
  const add = (name: string, content: Buffer) => CFB.utils.cfb_add(cfb, name, content);

  // Cabeçalho do fluxo de propriedades do nível superior (32 bytes), sem propriedades fixas.
  add('/__properties_version1.0', Buffer.alloc(32));
  add('/__substg1.0_0037001F', utf16(message.subject ?? 'Pedido de cobranca de teste'));
  add('/__substg1.0_0C1A001F', utf16(message.senderName ?? 'Financeiro Teste'));
  add('/__substg1.0_5D01001F', utf16(message.senderEmail ?? 'financeiro@exemplo.test'));
  add('/__substg1.0_1000001F', utf16(message.body ?? 'Segue o pedido de cobranca.'));

  const recipient = '/__recip_version1.0_#00000000';
  add(`${recipient}/__properties_version1.0`, Buffer.alloc(8));
  add(`${recipient}/__substg1.0_3001001F`, utf16('Comercial Teste'));
  add(`${recipient}/__substg1.0_39FE001F`, utf16(message.to ?? 'comercial@exemplo.test'));

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }) as Uint8Array);
}

/** Arquivo composto válido que não é uma mensagem (só para o teste de arquivo ilegível). */
export function corruptedMsgFile(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(200, 0x7f),
  ]);
}
