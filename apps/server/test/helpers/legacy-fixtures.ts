/**
 * Planilha e anexos fictícios do sistema anterior (specs/004, T002), gerados no próprio teste: nenhum
 * `.xlsx` nem anexo entra no repositório. Cabeçalhos exatamente como os da planilha real (spec,
 * "Colunas da planilha de origem"); dados inventados, sem hotéis, hóspedes ou empresa reais.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import writeXlsxFile, { type Cell, type Row } from 'write-excel-file/node';

export const RESERVATION_HEADERS = [
  'Codigo hotel',
  'Hotel',
  'Reserva',
  'Hospede',
  'Canal',
  'Entrada',
  'Saida',
  'Periodo da hospedagem',
  'Total da reserva',
  'Codigo status',
  'Status',
  'Motivo',
  'Pre-pagamento encontrado',
  'Cobranca registrada',
  'Cobrado em',
  'Cobrado por',
  'Valor cobrado',
  'ID da transacao',
  'Codigo de autorizacao',
  'Referencia do processador',
  'Parcelado',
  'Numero de parcelas',
  'Valor da parcela',
  'Estado do pre-pagamento',
  'Mensagem do pre-pagamento',
  'Acao de cobranca visivel',
  'Requer tratamento manual',
  'Primeira verificacao',
  'Ultima verificacao',
  'Quantidade de verificacoes',
  'Dados alterados na ultima verificacao',
  'Campos alterados',
  'Status alterado na ultima verificacao',
  'Status anterior',
  'Ultima alteracao de status',
] as const;

export const TREATMENT_HEADERS = [
  'Codigo hotel',
  'Reserva',
  'Tratativa - arquivo no Dropbox',
  'Tratativa - nome original',
  'Tratativa anexada em',
  'Comprovante - arquivo no Dropbox',
  'Comprovante - nome original',
  'Comprovante anexado em',
  'Anexo antigo - arquivo no Dropbox',
  'Anexo antigo - nome original',
  'Anexo antigo em',
  'Atualizado em',
  'Valor manual',
  'Valor manual alterado em',
] as const;

export type ReservationHeader = (typeof RESERVATION_HEADERS)[number];
export type TreatmentHeader = (typeof TREATMENT_HEADERS)[number];

/**
 * Valor de uma célula. `Date` vira célula com formato de data (lida de volta como `Date`);
 * `{ serial }` vira o número de série cru, como o sistema anterior gravava (research R-03).
 */
export type LegacyCell = string | number | boolean | Date | { serial: number } | null;

export type LegacyReservationRow = Partial<Record<ReservationHeader, LegacyCell>>;
export type LegacyTreatmentRow = Partial<Record<TreatmentHeader, LegacyCell>>;

/** Data e hora "de parede" (a do sistema anterior, hora de Brasília) como `Date` em UTC. */
export const wallClock = (iso: string): Date => new Date(`${iso}Z`);

/** Hotéis fictícios do sistema anterior: código em minúsculas com "_", como o sistema gravava. */
export const LEGACY_HOTELS = [
  { key: 'legacy_hml_um', name: 'Hotel Homologação Um' },
  { key: 'legacy_hml_dois', name: 'Hotel Homologação Dois' },
  { key: 'legacy_hml_tres', name: 'Hotel Homologação Três' },
  { key: 'legacy_hml_quatro', name: 'Hotel Homologação Quatro' },
] as const;

/** Linha válida da aba "Reservas" (pendente de cobrança), com os valores trocados por `overrides`. */
export function legacyReservationRow(
  overrides: LegacyReservationRow = {},
  index = 1,
): LegacyReservationRow {
  const hotel = LEGACY_HOTELS[0];
  return {
    'Codigo hotel': hotel.key,
    Hotel: hotel.name,
    Reserva: String(900_000 + index),
    Hospede: `Hóspede Fictício ${index}`,
    Canal: 'Canal Fictício',
    Entrada: wallClock('2026-05-10T00:00:00'),
    Saida: wallClock('2026-05-12T00:00:00'),
    'Periodo da hospedagem': '10/05/2026 - 12/05/2026',
    'Total da reserva': 1234.56,
    'Codigo status': 'virtual_card_pending_charge',
    Status: 'Pre-pagamento pendente',
    Motivo: 'pré-pagamento sem registro de cobrança',
    'Pre-pagamento encontrado': true,
    'Cobranca registrada': false,
    'Acao de cobranca visivel': true,
    'Requer tratamento manual': true,
    'Primeira verificacao': wallClock('2026-05-01T10:00:00'),
    'Ultima verificacao': wallClock('2026-05-08T10:00:00'),
    'Quantidade de verificacoes': 3,
    'Dados alterados na ultima verificacao': false,
    'Status alterado na ultima verificacao': false,
    ...overrides,
  };
}

/** Linha da aba "Tratativas" para a reserva `reservation` do hotel `hotelKey`. */
export function legacyTreatmentRow(
  reservation: string,
  overrides: LegacyTreatmentRow = {},
  hotelKey: string = LEGACY_HOTELS[0].key,
): LegacyTreatmentRow {
  return { 'Codigo hotel': hotelKey, Reserva: reservation, ...overrides };
}

function toCell(value: LegacyCell | undefined): Cell {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return { value, type: Date, format: 'dd/mm/yyyy hh:mm:ss' };
  if (typeof value === 'object') return { value: value.serial, type: Number };
  if (typeof value === 'number') return { value, type: Number };
  if (typeof value === 'boolean') return { value, type: Boolean };
  return { value, type: String };
}

function sheetData<H extends string>(
  headers: readonly H[],
  rows: readonly Partial<Record<H, LegacyCell>>[],
): Row[] {
  const header: Row = headers.map((name) => ({ value: name, type: String }));
  return [header, ...rows.map((row) => headers.map((name) => toCell(row[name])))];
}

export interface LegacyWorkbookOptions {
  reservations?: readonly LegacyReservationRow[];
  treatments?: readonly LegacyTreatmentRow[];
  /** Colunas a tirar do cabeçalho (para os testes de coluna obrigatória). */
  omitReservationColumns?: readonly ReservationHeader[];
  omitTreatmentColumns?: readonly TreatmentHeader[];
  /** Troca o nome das abas (para o teste de aba ausente). */
  reservationsSheet?: string;
  treatmentsSheet?: string;
}

/** Monta o `.xlsx` em memória, com as duas abas. */
export async function buildLegacyWorkbook(options: LegacyWorkbookOptions = {}): Promise<Buffer> {
  const reservationHeaders = RESERVATION_HEADERS.filter(
    (name) => !options.omitReservationColumns?.includes(name),
  );
  const treatmentHeaders = TREATMENT_HEADERS.filter(
    (name) => !options.omitTreatmentColumns?.includes(name),
  );
  return writeXlsxFile([
    {
      sheet: options.reservationsSheet ?? 'Reservas',
      data: sheetData(reservationHeaders, options.reservations ?? []),
    },
    {
      sheet: options.treatmentsSheet ?? 'Tratativas',
      data: sheetData(treatmentHeaders, options.treatments ?? []),
    },
  ]).toBuffer();
}

/** Grava a planilha em `filePath` e devolve o caminho. */
export async function writeLegacyWorkbook(
  filePath: string,
  options: LegacyWorkbookOptions = {},
): Promise<string> {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, await buildLegacyWorkbook(options));
  return filePath;
}

/** Pasta onde o sistema anterior guardava os anexos (caminho relativo gravado na planilha). */
export const LEGACY_ATTACHMENTS_DIR = 'virtual_cards/manual_treatments/attachments';

const text = (value: string): Buffer => Buffer.from(value, 'utf8');

/** Conteúdos sintéticos dos anexos; `marker` muda o conteúdo (e o SHA-256). */
export const legacyFile = {
  pdf: (marker = 'a'): Buffer => text(`%PDF-1.7\n% anexo ficticio ${marker}\n%%EOF\n`),
  png: (marker = 'a'): Buffer =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), text(marker)]),
  eml: (marker = 'a'): Buffer =>
    text(
      'From: financeiro@exemplo.test\r\nTo: comercial@exemplo.test\r\n' +
        `Subject: Pedido ficticio ${marker}\r\nDate: Fri, 01 May 2026 10:00:00 -0300\r\n\r\n` +
        'Texto ficticio.\r\n',
    ),
  /** Executável ("MZ") para o teste de arquivo renomeado. */
  executable: (): Buffer =>
    Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(60, 0x20)]),
  empty: (): Buffer => Buffer.alloc(0),
  /** 1 byte acima do limite de 25 MiB (FR-013; specs/003, FR-008). */
  tooLarge: (): Buffer => Buffer.alloc(26_214_401, 0x25),
};

/** Grava os anexos em `root`, nos caminhos relativos dados, e devolve `root`. */
export function writeLegacyAttachments(
  root: string,
  files: Readonly<Record<string, Buffer>>,
): string {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  mkdirSync(root, { recursive: true });
  return root;
}

/** Caminho relativo de um anexo, como o sistema anterior gravava na planilha. */
export const legacyAttachmentPath = (fileName: string): string =>
  `${LEGACY_ATTACHMENTS_DIR}/${fileName}`;
