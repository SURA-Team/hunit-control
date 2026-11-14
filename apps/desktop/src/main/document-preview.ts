/**
 * Pré-visualização do documento escolhido (specs/003, FR-018, FR-018a, research R-08).
 *
 * O arquivo é interpretado aqui, no processo principal, só em memória; a interface recebe um
 * modelo pronto para mostrar. Dos e-mails saem os cabeçalhos, o texto e a **lista** de anexos —
 * os anexos nunca são abertos nem repassados. Qualquer falha de leitura vira "indisponível": o
 * operador é avisado e pode confirmar mesmo assim (quem confere o arquivo é o servidor).
 */
import MsgReaderModule, { type FieldsData } from '@kenjiuno/msgreader';
import PostalMime, { type Address } from 'postal-mime';
import type { DocumentPreview, EmailAttachmentInfo } from '../shared/ipc-types.js';

type EmailPreview = Extract<DocumentPreview, { type: 'email' }>;

const UNAVAILABLE: DocumentPreview = { type: 'unavailable', reason: 'unreadable' };

// O pacote é CommonJS: conforme quem carrega (Node ou o empacotador), a classe vem direto ou
// dentro de `default`.
type MsgReaderClass = new (data: ArrayBuffer | DataView) => { getFileData(): FieldsData };
const loadedMsgReader = MsgReaderModule as unknown as MsgReaderClass | { default: MsgReaderClass };
const MsgReader: MsgReaderClass =
  typeof loadedMsgReader === 'function' ? loadedMsgReader : loadedMsgReader.default;

function nonEmpty(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** "Nome <endereço>", só o endereço ou só o nome, conforme o que existir. */
function formatMailbox(name: string | null | undefined, address: string | null | undefined) {
  const cleanName = nonEmpty(name);
  const cleanAddress = nonEmpty(address);
  if (cleanName && cleanAddress && cleanName !== cleanAddress) {
    return `${cleanName} <${cleanAddress}>`;
  }
  return cleanAddress ?? cleanName;
}

function formatAddresses(addresses: readonly Address[] | undefined): string[] {
  const formatted: string[] = [];
  for (const address of addresses ?? []) {
    // Um grupo ("Equipe: a@x, b@y;") vira os endereços dos membros.
    const mailboxes = address.group ?? [address];
    for (const mailbox of mailboxes) {
      const text = formatMailbox(mailbox.name, mailbox.address);
      if (text) formatted.push(text);
    }
  }
  return formatted;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Texto quando existe; HTML só quando não há texto (exibido isolado pela interface). */
function body(text: string | null | undefined, html: string | null | undefined) {
  const cleanText = nonEmpty(text);
  return { text: cleanText, html: cleanText ? null : nonEmpty(html) };
}

function sizeOf(content: ArrayBuffer | Uint8Array | string): number {
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
}

async function previewEml(bytes: Uint8Array): Promise<EmailPreview> {
  const email = await PostalMime.parse(bytes);
  const attachments: EmailAttachmentInfo[] = email.attachments.map((attachment) => ({
    name: nonEmpty(attachment.filename),
    mediaType: nonEmpty(attachment.mimeType),
    sizeBytes: sizeOf(attachment.content),
  }));
  return {
    type: 'email',
    from: formatAddresses(email.from ? [email.from] : [])[0] ?? null,
    to: formatAddresses(email.to),
    cc: formatAddresses(email.cc),
    subject: nonEmpty(email.subject),
    date: isoDate(email.date),
    ...body(email.text, email.html),
    attachments,
  };
}

function previewMsg(bytes: Uint8Array): EmailPreview {
  // Cópia para um ArrayBuffer próprio: o Buffer do Node pode ser uma fatia de um bloco maior.
  const reader = new MsgReader(Uint8Array.from(bytes).buffer);
  const message = reader.getFileData();
  if (message.error) throw new Error(message.error);

  const recipients = message.recipients ?? [];
  const recipientsOf = (type: 'to' | 'cc') =>
    recipients
      .filter((recipient) => (recipient.recipType ?? 'to') === type)
      .map((recipient) => formatMailbox(recipient.name, recipient.smtpAddress ?? recipient.email))
      .filter((text): text is string => text !== null);

  const html =
    message.bodyHtml ?? (message.html ? Buffer.from(message.html).toString('utf8') : undefined);
  const preview: EmailPreview = {
    type: 'email',
    from: formatMailbox(message.senderName, message.senderSmtpAddress ?? message.senderEmail),
    to: recipientsOf('to'),
    cc: recipientsOf('cc'),
    subject: nonEmpty(message.subject),
    date: isoDate(message.messageDeliveryTime ?? message.clientSubmitTime ?? message.creationTime),
    ...body(message.body, html),
    attachments: (message.attachments ?? []).map((attachment) => ({
      name: nonEmpty(attachment.fileName) ?? nonEmpty(attachment.fileNameShort),
      mediaType: nonEmpty(attachment.attachMimeTag),
      sizeBytes: attachment.contentLength ?? null,
    })),
  };

  // Um arquivo composto que não é uma mensagem do Outlook é lido "vazio": não é um e-mail.
  const empty =
    preview.from === null &&
    preview.subject === null &&
    preview.text === null &&
    preview.html === null &&
    preview.to.length === 0;
  if (empty) throw new Error('mensagem sem conteúdo');
  return preview;
}

/** Monta o que a interface mostra do arquivo antes da confirmação. Nunca lança. */
export async function buildDocumentPreview(file: {
  mediaType: string;
  bytes: Uint8Array;
}): Promise<DocumentPreview> {
  try {
    switch (file.mediaType) {
      case 'application/pdf':
        return { type: 'pdf', bytes: Uint8Array.from(file.bytes) };
      case 'image/png':
      case 'image/jpeg':
        return { type: 'image', bytes: Uint8Array.from(file.bytes), mediaType: file.mediaType };
      case 'message/rfc822':
        return await previewEml(file.bytes);
      case 'application/vnd.ms-outlook':
        return previewMsg(file.bytes);
      default:
        return UNAVAILABLE;
    }
  } catch {
    return UNAVAILABLE;
  }
}
