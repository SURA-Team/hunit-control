/**
 * Conferência dos documentos das tratativas (specs/003, FR-008, research R-03): tamanho, nome e
 * tipo. O tipo é decidido pelo **conteúdo** e precisa bater com a extensão do nome — um executável
 * renomeado para `.pdf` é recusado.
 *
 * Funções puras, sem I/O: o servidor as usa ao receber o arquivo; o app, só para avisar antes de
 * enviar (quem decide é o servidor).
 */

/** Tamanho máximo de um documento: 25 MiB (FR-008). */
export const MAX_TREATMENT_FILE_BYTES = 26_214_400;

/** Tamanho máximo do nome do arquivo, em caracteres. */
export const MAX_TREATMENT_FILE_NAME_LENGTH = 255;

export const TREATMENT_MEDIA_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'message/rfc822',
  'application/vnd.ms-outlook',
] as const;

export type TreatmentMediaType = (typeof TREATMENT_MEDIA_TYPES)[number];

/** Tipo de conteúdo de cada extensão aceita (FR-008). */
const MEDIA_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
} as const satisfies Record<string, TreatmentMediaType>;

export type TreatmentFileExtension = keyof typeof MEDIA_TYPE_BY_EXTENSION;

/** Extensões aceitas, em minúsculas e sem o ponto. */
export const ACCEPTED_TREATMENT_EXTENSIONS = Object.keys(
  MEDIA_TYPE_BY_EXTENSION,
) as TreatmentFileExtension[];

export type TreatmentFileRejection = 'empty_file' | 'file_too_large' | 'unsupported_file_type';

export type TreatmentFileCheck =
  { ok: true; mediaType: TreatmentMediaType } | { ok: false; code: TreatmentFileRejection };

/** Quanto do início de um `.eml` é lido para achar o bloco de cabeçalhos. */
const EML_HEADER_SCAN_BYTES = 64 * 1024;

/** Um `.eml` precisa ter pelo menos um destes cabeçalhos para ser reconhecido como e-mail. */
const EML_EXPECTED_HEADERS = new Set(['from', 'date', 'subject']);

const SIGNATURES: Readonly<
  Record<Exclude<TreatmentMediaType, 'message/rfc822'>, readonly number[]>
> = {
  // "%PDF-"
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  // Arquivo composto da Microsoft (OLE/CFB), o formato do `.msg` do Outlook.
  'application/vnd.ms-outlook': [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

/** Extensão do nome, em minúsculas, se for uma das aceitas. */
function acceptedExtension(name: string): TreatmentFileExtension | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(MEDIA_TYPE_BY_EXTENSION, extension)
    ? (extension as TreatmentFileExtension)
    : null;
}

/**
 * E-mail em texto (RFC 5322): sem bytes nulos e começando por um bloco de cabeçalhos — linhas
 * `Nome: valor` (ou continuações, que começam com espaço ou tabulação) até a primeira linha em
 * branco — com pelo menos `From`, `Date` ou `Subject`.
 */
function looksLikeEml(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;

  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const head = bytes.subarray(hasBom ? 3 : 0, EML_HEADER_SCAN_BYTES);
  // Cada byte vira um caractere: basta para ler os nomes dos cabeçalhos, que são ASCII.
  let text = '';
  for (const byte of head) text += String.fromCharCode(byte);

  const names = new Set<string>();
  let lines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line === '') break;
    lines += 1;
    if (line.startsWith(' ') || line.startsWith('\t')) {
      // Continuação só existe depois de um cabeçalho.
      if (lines === 1) return false;
      continue;
    }
    const match = /^([\x21-\x39\x3b-\x7e]+):/.exec(line);
    if (!match?.[1]) return false;
    names.add(match[1].toLowerCase());
  }

  return [...names].some((name) => EML_EXPECTED_HEADERS.has(name));
}

function contentMatches(mediaType: TreatmentMediaType, bytes: Uint8Array): boolean {
  return mediaType === 'message/rfc822'
    ? looksLikeEml(bytes)
    : startsWith(bytes, SIGNATURES[mediaType]);
}

/**
 * Nome de arquivo aceito: 1 a 255 caracteres, sem `/`, `\` nem caracteres de controle. O nome é
 * só um rótulo — o servidor nunca o usa como caminho.
 */
export function isValidTreatmentFileName(name: string): boolean {
  if (name.length < 1 || name.length > MAX_TREATMENT_FILE_NAME_LENGTH) return false;
  // eslint-disable-next-line no-control-regex -- recusar caracteres de controle é o objetivo.
  return !/[/\\\u0000-\u001f\u007f]/.test(name);
}

/** O nome tem uma extensão aceita para esse tipo de conteúdo? */
export function fileNameMatchesMediaType(name: string, mediaType: string): boolean {
  const extension = acceptedExtension(name);
  return extension !== null && MEDIA_TYPE_BY_EXTENSION[extension] === mediaType;
}

/**
 * Confere um documento: tamanho (1 byte a 25 MiB), extensão aceita e conteúdo correspondente à
 * extensão. Devolve o tipo de conteúdo decidido pelo conteúdo, nunca o informado por quem enviou.
 */
export function detectTreatmentFile(name: string, bytes: Uint8Array): TreatmentFileCheck {
  if (bytes.length === 0) return { ok: false, code: 'empty_file' };
  if (bytes.length > MAX_TREATMENT_FILE_BYTES) return { ok: false, code: 'file_too_large' };

  const extension = acceptedExtension(name);
  if (extension === null) return { ok: false, code: 'unsupported_file_type' };

  const mediaType = MEDIA_TYPE_BY_EXTENSION[extension];
  if (!contentMatches(mediaType, bytes)) return { ok: false, code: 'unsupported_file_type' };

  return { ok: true, mediaType };
}
