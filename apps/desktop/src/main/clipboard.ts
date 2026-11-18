/**
 * "Copiar para e-mail" (specs/005, US5, FR-027; research R-12).
 *
 * A tabela é montada aqui, no processo principal, com os mesmos nomes de coluna e de situação da
 * planilha do Comercial (`@hunit/domain`, `copyTable`), e vai para a área de transferência em dois
 * formatos: HTML com estilos embutidos (o Outlook e o Gmail colam como tabela) e texto com
 * tabulação (o Excel e o bloco de notas colam em colunas).
 *
 * Nunca há nome de hóspede: as linhas só têm as colunas da cópia (`CopySource`), e nada é gravado
 * em disco.
 */
import {
  CLASSIFICATION_NAMES,
  DETAILED_SITUATION_NAMES,
  RESERVATION_STATUS_NAMES,
  copyTable,
  formatBrDateTime,
  type CopySource,
} from '@hunit/domain';
import type { CopyRow } from '../shared/ipc-types.js';

export interface CopyContent {
  html: string;
  text: string;
}

export interface CopyMeta {
  /** O que foi copiado, em português (ex.: "Reservas selecionadas" ou os filtros). */
  description: string;
  /** Momento dos dados. */
  at: Date;
  /** Quantas o filtro encontrou, quando passou do limite e só as primeiras foram copiadas. */
  totalFound?: number | undefined;
}

/** Linha recebida da interface com códigos que a planilha conhece; `null` = código desconhecido. */
export function toCopySource(row: {
  hotelName: string;
  reservationNumber: string;
  checkIn: string | null;
  channel: string | null;
  totalAmount: string | null;
  classification: string;
  reservationStatus: string;
  detailedSituation: string;
}): CopySource | null {
  if (
    !Object.hasOwn(CLASSIFICATION_NAMES, row.classification) ||
    !Object.hasOwn(RESERVATION_STATUS_NAMES, row.reservationStatus) ||
    !Object.hasOwn(DETAILED_SITUATION_NAMES, row.detailedSituation)
  ) {
    return null;
  }
  // Só os campos da cópia: um objeto com mais campos não leva nada a mais adiante.
  return {
    hotelName: row.hotelName,
    reservationNumber: row.reservationNumber,
    checkIn: row.checkIn,
    channel: row.channel,
    totalAmount: row.totalAmount,
    classification: row.classification as CopyRow['classification'],
    reservationStatus: row.reservationStatus as CopyRow['reservationStatus'],
    detailedSituation: row.detailedSituation as CopyRow['detailedSituation'],
  };
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Tabulação e quebra de linha dentro de uma célula estragariam as colunas do texto. */
function plainCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ');
}

const CELL =
  'border:1px solid #c8c8c8;padding:4px 8px;font-family:Arial,sans-serif;font-size:13px;';
const HEAD = `${CELL}background:#f1f3f5;font-weight:bold;text-align:left;`;
const AMOUNT_COLUMN = 4;

/** Monta o HTML e o texto da cópia. */
export function buildCopy(sources: readonly CopySource[], meta: CopyMeta): CopyContent {
  const table = copyTable(sources);
  const count = sources.length;
  const summary = [
    `${meta.description} — ${count} ${count === 1 ? 'reserva' : 'reservas'}`,
    meta.totalFound !== undefined && meta.totalFound > count
      ? `(as ${count} primeiras de ${meta.totalFound})`
      : null,
    `— dados de ${formatBrDateTime(meta.at)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');

  const align = (index: number) => (index === AMOUNT_COLUMN ? 'text-align:right;' : '');
  const head = table.headers
    .map((header, index) => `<th style="${HEAD}${align(index)}">${escapeHtml(header)}</th>`)
    .join('');
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td style="${CELL}${align(index)}">${escapeHtml(cell)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const totalRow =
    `<tr><td style="${HEAD}" colspan="${AMOUNT_COLUMN}">Total</td>` +
    `<td style="${HEAD}text-align:right;">${escapeHtml(table.total)}</td>` +
    `<td style="${HEAD}" colspan="${table.headers.length - AMOUNT_COLUMN - 1}"></td></tr>`;
  const html =
    `<p style="font-family:Arial,sans-serif;font-size:13px;">${escapeHtml(summary)}</p>` +
    `<table style="border-collapse:collapse;"><thead><tr>${head}</tr></thead>` +
    `<tbody>${body}${totalRow}</tbody></table>`;

  const lines = [
    plainCell(summary),
    table.headers.map(plainCell).join('\t'),
    ...table.rows.map((row) => row.map(plainCell).join('\t')),
    ['Total', '', '', '', table.total, '', '', ''].join('\t'),
  ];
  return { html, text: `${lines.join('\r\n')}\r\n` };
}
