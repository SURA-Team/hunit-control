/**
 * Regras da importação do histórico do sistema anterior (specs/004; research R-04, R-06, R-07,
 * R-10; data-model §3 a §5). Funções puras, sem I/O: o servidor lê a planilha e os arquivos e grava
 * no banco; aqui só se decide o que cada linha vira.
 *
 * Nada aqui devolve o conteúdo de uma célula num motivo de recusa: só códigos e nomes de coluna
 * (FR-018).
 */
import {
  parseLegacyBoolean,
  parseLegacyDate,
  parseLegacyDateTime,
  parseLegacyInteger,
  parseLegacyMoney,
  parseLegacyText,
  type LegacyCellValue,
} from './legacy-values.js';
import type { TreatmentDocumentKind } from './treatment.js';
import type { Classification, IsoDate, Money } from './types.js';
import type { ReservationData, ReservationRecord } from './verification.js';

// ---------------------------------------------------------------------------
// Colunas (spec, "Colunas da planilha de origem")
// ---------------------------------------------------------------------------

export const LEGACY_RESERVATIONS_SHEET = 'Reservas';
export const LEGACY_TREATMENTS_SHEET = 'Tratativas';

export const LEGACY_RESERVATION_COLUMNS = [
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

export const LEGACY_REQUIRED_RESERVATION_COLUMNS = [
  'Codigo hotel',
  'Hotel',
  'Reserva',
  'Entrada',
  'Saida',
  'Total da reserva',
  'Codigo status',
  'Primeira verificacao',
  'Ultima verificacao',
  'Quantidade de verificacoes',
] as const satisfies readonly LegacyReservationColumn[];

export const LEGACY_TREATMENT_COLUMNS = [
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

export const LEGACY_REQUIRED_TREATMENT_COLUMNS = [
  'Codigo hotel',
  'Reserva',
] as const satisfies readonly LegacyTreatmentColumn[];

export type LegacyReservationColumn = (typeof LEGACY_RESERVATION_COLUMNS)[number];
export type LegacyTreatmentColumn = (typeof LEGACY_TREATMENT_COLUMNS)[number];

/** Linha lida da planilha: valor de cada coluna pelo nome do cabeçalho. Coluna ausente = vazia. */
export type LegacyRow = Readonly<Record<string, LegacyCellValue>>;

/** Colunas obrigatórias que faltam no cabeçalho (FR-003). A ordem não importa. */
export function missingColumns(headers: readonly unknown[], required: readonly string[]): string[] {
  const present = new Set(
    headers.map((header) => (typeof header === 'string' ? header.trim() : '')),
  );
  return required.filter((column) => !present.has(column));
}

// ---------------------------------------------------------------------------
// Motivos e avisos (data-model §4)
// ---------------------------------------------------------------------------

export const LEGACY_IMPORT_REASONS = [
  'hotel_not_mapped',
  'missing_value',
  'unreadable_date',
  'unreadable_amount',
  'unreadable_number',
  'inconsistent_dates',
  'duplicated_in_sheet',
  'unchanged',
  'reservation_rejected',
  'reservation_not_in_sheet',
  'file_not_found',
  'empty_file',
  'unsupported_file_type',
  'file_type_mismatch',
  'file_too_large',
  'kept_hunit_control',
  'already_imported',
  'superseded_in_legacy',
  'manual_amount_without_proof',
] as const;
export type LegacyImportReason = (typeof LEGACY_IMPORT_REASONS)[number];

export const LEGACY_IMPORT_WARNINGS = [
  'original_date_missing',
  'anonymized_on_import',
  'unreferenced_files',
  'obsolete_classification_in_use',
  'previous_import_incomplete',
] as const;
export type LegacyImportWarning = (typeof LEGACY_IMPORT_WARNINGS)[number];

/** Recusa de uma linha: o motivo e, quando ajuda, a coluna (nunca o valor). */
export interface LegacyRejection {
  reason: LegacyImportReason;
  column?: string;
}

// ---------------------------------------------------------------------------
// Classificação (FR-007, research R-04)
// ---------------------------------------------------------------------------

/** "Codigo status" e o rótulo da coluna "Status" de cada classificação do sistema anterior. */
export const LEGACY_CLASSIFICATIONS = {
  ignored_hotelbeds_258: {
    label: 'Ignorada - prefixo 258',
    classification: 'ignored_hotelbeds_258',
  },
  virtual_card_already_charged: {
    label: 'Pre-pagamento cobrado',
    classification: 'virtual_card_already_charged',
  },
  virtual_card_pending_charge: {
    label: 'Pre-pagamento pendente',
    classification: 'virtual_card_pending_charge',
  },
  virtual_card_charge_error: {
    label: 'Erro na cobranca',
    classification: 'virtual_card_charge_error',
  },
  analysis_error: { label: 'Erro de analise', classification: 'analysis_error' },
  not_virtual_card: { label: 'Sem cartao virtual', classification: 'not_virtual_card' },
} as const satisfies Record<string, { label: string; classification: Classification }>;

/** Texto comparável: sem acentos, minúsculas, espaços únicos. */
function comparable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converte o código (ou o rótulo) do sistema anterior. Sem correspondência → `not_virtual_card`,
 * "A revisar (sistema anterior)", com `known: false`.
 */
export function convertLegacyClassification(value: string): {
  classification: Classification;
  known: boolean;
} {
  const wanted = comparable(value);
  for (const [code, entry] of Object.entries(LEGACY_CLASSIFICATIONS)) {
    if (comparable(code) === wanted || comparable(entry.label) === wanted) {
      return { classification: entry.classification, known: code !== 'not_virtual_card' };
    }
  }
  return { classification: 'not_virtual_card', known: false };
}

// ---------------------------------------------------------------------------
// Linha da aba "Reservas" → reserva (data-model §3.1)
// ---------------------------------------------------------------------------

/** O que o sistema anterior registrou (vai para `legacy_reservations`). */
export interface LegacyOrigin {
  legacyHotelKey: string;
  originalClassification: string;
  originalPreviousClassification: string | null;
  firstVerifiedAt: Date;
  lastVerifiedAt: Date;
  verificationCount: number;
}

export interface ParsedLegacyReservation {
  /** Linha da planilha (para o relatório). */
  row: number;
  legacyHotelKey: string;
  legacyHotelName: string;
  reservationNumber: string;
  /** Dados da reserva, sem o hotel do catálogo (vem da associação). */
  data: Omit<ReservationData, 'hotelCode'>;
  origin: LegacyOrigin;
  statusChanged: boolean;
  previousClassification: Classification | null;
  statusChangedAt: Date | null;
  /** Check-in antes do prazo de retenção: gravar já anonimizada (FR-022). */
  anonymize: boolean;
  /** Valores normalizados, para o resumo (hash) que detecta mudança na reimportação (FR-010a). */
  canonical: string;
}

export type LegacyParseResult<T> =
  { ok: true; value: T } | { ok: false; rejection: LegacyRejection };

const reject = (
  reason: LegacyImportReason,
  column?: string,
): { ok: false; rejection: LegacyRejection } => ({
  ok: false,
  rejection: column === undefined ? { reason } : { reason, column },
});

/** Leitor das colunas de uma linha que guarda o primeiro motivo de recusa. */
class RowReader {
  rejection: LegacyRejection | null = null;
  constructor(private readonly row: LegacyRow) {}

  private fail(reason: LegacyImportReason, column: string): null {
    this.rejection ??= { reason, column };
    return null;
  }

  text(column: string): string | null {
    return parseLegacyText(this.row[column]);
  }

  requiredText(column: string): string {
    return this.text(column) ?? this.fail('missing_value', column) ?? '';
  }

  dateTime(column: string, required = false): Date | null {
    const parsed = parseLegacyDateTime(this.row[column]);
    if (!parsed.ok) return this.fail(parsed.code, column);
    if (required && parsed.value === null) return this.fail('missing_value', column);
    return parsed.value;
  }

  date(column: string): IsoDate | null {
    const parsed = parseLegacyDate(this.row[column]);
    if (!parsed.ok) return this.fail(parsed.code, column);
    if (parsed.value === null) return this.fail('missing_value', column);
    return parsed.value;
  }

  money(column: string, required = false): Money | null {
    const parsed = parseLegacyMoney(this.row[column]);
    if (!parsed.ok) return this.fail(parsed.code, column);
    if (required && parsed.value === null) return this.fail('missing_value', column);
    return parsed.value;
  }

  integer(column: string, required = false): number | null {
    const parsed = parseLegacyInteger(this.row[column]);
    if (!parsed.ok) return this.fail(parsed.code, column);
    if (required && parsed.value === null) return this.fail('missing_value', column);
    return parsed.value;
  }

  boolean(column: string): boolean | null {
    return parseLegacyBoolean(this.row[column]);
  }
}

/**
 * Data de corte da retenção: reservas com check-in **antes** dela são anonimizadas (specs/001,
 * FR-026; mesma regra da rotina diária: no aniversário de N anos o nome ainda fica).
 */
export function anonymizationCutoff(today: IsoDate, retentionYears: number): IsoDate {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year - retentionYears, month - 1, day));
  // 29/02 num ano não bissexto vira 28/02, como no PostgreSQL.
  if (target.getUTCMonth() !== month - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/** Motivo gravado na reserva importada (specs/001, FR-014). */
function legacyReason(code: string, known: boolean, motivo: string | null): string {
  if (!known) {
    return `Sistema anterior: classificação "${code}" sem correspondência; a revisar na próxima verificação no Hunit`;
  }
  return `Sistema anterior: ${motivo ?? code}`;
}

/**
 * Converte uma linha da aba "Reservas" (FR-007, FR-008; data-model §3.1). `anonymizeBefore` vem
 * de `anonymizationCutoff`.
 */
export function parseLegacyReservationRow(
  row: LegacyRow,
  rowNumber: number,
  anonymizeBefore: IsoDate,
): LegacyParseResult<ParsedLegacyReservation> {
  const read = new RowReader(row);
  const legacyHotelKey = read.requiredText('Codigo hotel');
  const legacyHotelName = read.requiredText('Hotel');
  const reservationNumber = read.requiredText('Reserva');
  const checkIn = read.date('Entrada');
  const checkOut = read.date('Saida');
  const totalAmount = read.money('Total da reserva', true);
  const code = read.requiredText('Codigo status');
  const firstVerifiedAt = read.dateTime('Primeira verificacao', true);
  const lastVerifiedAt = read.dateTime('Ultima verificacao', true);
  const verificationCount = read.integer('Quantidade de verificacoes', true);
  const chargedAt = read.dateTime('Cobrado em');
  const chargedAmount = read.money('Valor cobrado');
  const installmentCount = read.integer('Numero de parcelas');
  const installmentAmount = read.money('Valor da parcela');
  const statusChangedAt = read.dateTime('Ultima alteracao de status');
  if (read.rejection) return { ok: false, rejection: read.rejection };

  // Daqui para baixo os obrigatórios estão preenchidos e legíveis.
  if (verificationCount === 0) return reject('unreadable_number', 'Quantidade de verificacoes');
  if (checkOut! < checkIn!) return reject('inconsistent_dates');
  if (firstVerifiedAt!.getTime() > lastVerifiedAt!.getTime()) return reject('inconsistent_dates');

  const converted = convertLegacyClassification(code);
  const previousCode = read.text('Status anterior');
  const anonymize = checkIn! < anonymizeBefore;

  const data: Omit<ReservationData, 'hotelCode'> = {
    reservationNumber,
    guestName: anonymize ? null : read.text('Hospede'),
    channel: read.text('Canal') ?? '',
    checkIn: checkIn!,
    checkOut: checkOut!,
    stayPeriod: read.text('Periodo da hospedagem') ?? '',
    totalAmount: totalAmount!,
    reservationStatus: 'unknown',
    classification: converted.classification,
    reason: legacyReason(code, converted.known, read.text('Motivo')),
    prePaymentFound: read.boolean('Pre-pagamento encontrado') ?? false,
    chargedAt: chargedAt?.toISOString() ?? null,
    chargedBy: read.text('Cobrado por'),
    chargedAmount,
    transactionId: read.text('ID da transacao'),
    authorizationCode: read.text('Codigo de autorizacao'),
    processorReference: read.text('Referencia do processador'),
    isInstallment: read.boolean('Parcelado'),
    installmentCount,
    installmentAmount,
    prePaymentState: read.text('Estado do pre-pagamento'),
    prePaymentMessage: read.text('Mensagem do pre-pagamento'),
    chargeActionVisible: read.boolean('Acao de cobranca visivel') ?? false,
    paymentForm: null,
  };

  const origin: LegacyOrigin = {
    legacyHotelKey,
    originalClassification: code,
    originalPreviousClassification: previousCode,
    firstVerifiedAt: firstVerifiedAt!,
    lastVerifiedAt: lastVerifiedAt!,
    verificationCount: verificationCount!,
  };

  const statusChanged = read.boolean('Status alterado na ultima verificacao') ?? false;
  const previousClassification =
    previousCode === null ? null : convertLegacyClassification(previousCode).classification;

  const canonical = JSON.stringify({
    data: { ...data, guestName: read.text('Hospede') },
    origin: {
      ...origin,
      firstVerifiedAt: origin.firstVerifiedAt.toISOString(),
      lastVerifiedAt: origin.lastVerifiedAt.toISOString(),
    },
    statusChanged,
    previousClassification,
    statusChangedAt: statusChangedAt?.toISOString() ?? null,
  });

  return {
    ok: true,
    value: {
      row: rowNumber,
      legacyHotelKey,
      legacyHotelName,
      reservationNumber,
      data,
      origin,
      statusChanged,
      previousClassification,
      statusChangedAt,
      anonymize,
      canonical,
    },
  };
}

/**
 * Linhas repetidas da mesma reserva na planilha: vale a de última verificação mais recente (empate:
 * a primeira); as outras são `duplicated_in_sheet`.
 */
export function selectLegacyDuplicates<T extends ParsedLegacyReservation>(
  items: readonly T[],
): { kept: T[]; duplicates: T[] } {
  const best = new Map<string, T>();
  for (const item of items) {
    const key = `${item.legacyHotelKey}\u0000${item.reservationNumber}`;
    const current = best.get(key);
    if (
      !current ||
      item.origin.lastVerifiedAt.getTime() > current.origin.lastVerifiedAt.getTime()
    ) {
      best.set(key, item);
    }
  }
  const keptSet = new Set(best.values());
  return {
    kept: items.filter((item) => keptSet.has(item)),
    duplicates: items.filter((item) => !keptSet.has(item)),
  };
}

// ---------------------------------------------------------------------------
// Precedência e reimportação (FR-009, FR-010, FR-010a; research R-06)
// ---------------------------------------------------------------------------

/** Linha de `legacy_reservations` já gravada para a reserva. */
export interface LegacyOriginRecord {
  rowHash: string;
  appliedCount: number;
}

/** Reserva já gravada no HUNIT Control. */
export interface ExistingReservation extends ReservationRecord {
  /** `true` = alguma execução já a verificou (`last_execution_id` preenchido). */
  verifiedByHunitControl: boolean;
}

export type LegacyReservationDecision =
  /** Reserva nova, ou importada ainda não verificada cuja linha mudou: grava os dados da planilha. */
  | { action: 'create' | 'update'; record: ReservationRecord; appliedCount: number; merged: false }
  /** Já verificada pelo HUNIT Control: só a primeira verificação e a contagem mudam (FR-010). */
  | {
      action: 'merge';
      firstVerifiedAt: Date;
      verificationCount: number;
      appliedCount: number;
      merged: true;
    }
  /** Já importada e a linha não mudou. */
  | { action: 'unchanged' };

function legacyRecord(
  parsed: ParsedLegacyReservation,
  hotelCode: string,
  now: Date,
  existing: ExistingReservation | null,
): ReservationRecord {
  const anonymizedAt = existing?.anonymizedAt ?? (parsed.anonymize ? now : null);
  return {
    ...parsed.data,
    hotelCode,
    guestName: anonymizedAt ? null : parsed.data.guestName,
    firstVerifiedAt: parsed.origin.firstVerifiedAt,
    lastVerifiedAt: parsed.origin.lastVerifiedAt,
    verificationCount: parsed.origin.verificationCount,
    changedFields: [],
    statusChanged: parsed.statusChanged,
    previousClassification: parsed.previousClassification,
    previousReservationStatus: null,
    statusChangedAt: parsed.statusChangedAt,
    notFoundSince: existing?.notFoundSince ?? null,
    anonymizedAt,
  };
}

/**
 * O que fazer com uma reserva da planilha diante do que já está gravado. A ordem entre importação
 * e verificação pelo HUNIT Control não muda o resultado (research R-06).
 */
export function decideLegacyReservation(input: {
  parsed: ParsedLegacyReservation;
  hotelCode: string;
  rowHash: string;
  existing: ExistingReservation | null;
  origin: LegacyOriginRecord | null;
  now: Date;
}): LegacyReservationDecision {
  const { parsed, hotelCode, rowHash, existing, origin, now } = input;
  const legacyCount = parsed.origin.verificationCount;

  if (!existing) {
    return {
      action: 'create',
      record: legacyRecord(parsed, hotelCode, now, null),
      appliedCount: legacyCount,
      merged: false,
    };
  }
  if (origin && origin.rowHash === rowHash) return { action: 'unchanged' };

  if (!existing.verifiedByHunitControl) {
    return {
      action: 'update',
      record: legacyRecord(parsed, hotelCode, now, existing),
      appliedCount: legacyCount,
      merged: false,
    };
  }

  const alreadyApplied = origin?.appliedCount ?? 0;
  const firstVerifiedAt =
    parsed.origin.firstVerifiedAt.getTime() < existing.firstVerifiedAt.getTime()
      ? parsed.origin.firstVerifiedAt
      : existing.firstVerifiedAt;
  return {
    action: 'merge',
    firstVerifiedAt,
    verificationCount: Math.max(1, existing.verificationCount - alreadyApplied + legacyCount),
    appliedCount: legacyCount,
    merged: true,
  };
}

// ---------------------------------------------------------------------------
// Linha da aba "Tratativas" → documentos e valor manual (data-model §3.3; research R-07)
// ---------------------------------------------------------------------------

/** Anexo antigo: comprovante se a reserva estava pendente de cobrança, senão tratativa. */
export function legacyAttachmentKind(originalClassification: string | null): TreatmentDocumentKind {
  return originalClassification !== null &&
    convertLegacyClassification(originalClassification).classification ===
      'virtual_card_pending_charge'
    ? 'proof'
    : 'request';
}

/**
 * Data original de um registro: a coluna própria; vazia → "Atualizado em"; as duas vazias → a
 * última verificação, com o aviso `original_date_missing`. Preenchida e ilegível → recusa.
 */
export function legacyOriginalDate(
  own: LegacyCellValue,
  updatedAt: LegacyCellValue,
  fallback: Date,
): { ok: true; date: Date; missing: boolean } | { ok: false; reason: 'unreadable_date' } {
  for (const value of [own, updatedAt]) {
    const parsed = parseLegacyDateTime(value);
    if (!parsed.ok) return { ok: false, reason: 'unreadable_date' };
    if (parsed.value) return { ok: true, date: parsed.value, missing: false };
  }
  return { ok: true, date: fallback, missing: true };
}

export interface LegacyDocumentPlan {
  kind: TreatmentDocumentKind;
  /** De onde veio na linha (para o relatório). */
  source: 'request' | 'proof' | 'old';
  storedPath: string;
  originalName: string | null;
  attachedAt: Date;
  dateMissing: boolean;
}

export type LegacyDocumentEntry =
  | { ok: true; plan: LegacyDocumentPlan }
  | {
      ok: false;
      kind: TreatmentDocumentKind;
      source: LegacyDocumentPlan['source'];
      reason: LegacyImportReason;
      column?: string;
    };

export interface ParsedLegacyTreatment {
  row: number;
  legacyHotelKey: string;
  reservationNumber: string;
  documents: LegacyDocumentEntry[];
  manualAmount:
    | null
    | { ok: true; amount: Money; setAt: Date; dateMissing: boolean }
    | { ok: false; reason: LegacyImportReason; column?: string };
}

const DOCUMENT_COLUMNS = {
  request: {
    path: 'Tratativa - arquivo no Dropbox',
    name: 'Tratativa - nome original',
    date: 'Tratativa anexada em',
  },
  proof: {
    path: 'Comprovante - arquivo no Dropbox',
    name: 'Comprovante - nome original',
    date: 'Comprovante anexado em',
  },
  old: {
    path: 'Anexo antigo - arquivo no Dropbox',
    name: 'Anexo antigo - nome original',
    date: 'Anexo antigo em',
  },
} as const;

/**
 * Converte uma linha da aba "Tratativas". `originalClassification` é o código do sistema anterior
 * da reserva (decide o tipo do anexo antigo); `fallbackDate`, a última verificação dela.
 */
export function parseLegacyTreatmentRow(
  row: LegacyRow,
  rowNumber: number,
  originalClassification: string | null,
  fallbackDate: Date,
): LegacyParseResult<ParsedLegacyTreatment> {
  const legacyHotelKey = parseLegacyText(row['Codigo hotel']);
  if (legacyHotelKey === null) return reject('missing_value', 'Codigo hotel');
  const reservationNumber = parseLegacyText(row.Reserva);
  if (reservationNumber === null) return reject('missing_value', 'Reserva');

  const documents: LegacyDocumentEntry[] = [];
  const typedKinds = new Set<TreatmentDocumentKind>();
  for (const source of ['request', 'proof', 'old'] as const) {
    const columns = DOCUMENT_COLUMNS[source];
    const storedPath = parseLegacyText(row[columns.path]);
    if (storedPath === null) continue;
    const kind = source === 'old' ? legacyAttachmentKind(originalClassification) : source;
    if (source === 'old' && typedKinds.has(kind)) {
      documents.push({ ok: false, kind, source, reason: 'superseded_in_legacy' });
      continue;
    }
    if (source !== 'old') typedKinds.add(kind);
    const date = legacyOriginalDate(row[columns.date], row['Atualizado em'], fallbackDate);
    if (!date.ok) {
      documents.push({ ok: false, kind, source, reason: date.reason, column: columns.date });
      continue;
    }
    documents.push({
      ok: true,
      plan: {
        kind,
        source,
        storedPath,
        originalName: parseLegacyText(row[columns.name]),
        attachedAt: date.date,
        dateMissing: date.missing,
      },
    });
  }

  let manualAmount: ParsedLegacyTreatment['manualAmount'] = null;
  const amount = parseLegacyMoney(row['Valor manual']);
  if (!amount.ok) {
    manualAmount = { ok: false, reason: amount.code, column: 'Valor manual' };
  } else if (amount.value !== null) {
    const date = legacyOriginalDate(
      row['Valor manual alterado em'],
      row['Atualizado em'],
      fallbackDate,
    );
    manualAmount = date.ok
      ? { ok: true, amount: amount.value, setAt: date.date, dateMissing: date.missing }
      : { ok: false, reason: date.reason, column: 'Valor manual alterado em' };
  }

  return {
    ok: true,
    value: { row: rowNumber, legacyHotelKey, reservationNumber, documents, manualAmount },
  };
}

/** Documento atual do mesmo tipo já gravado na reserva. */
export interface CurrentDocument {
  /** `true` = veio de uma importação (`legacy_import_id` preenchido). */
  fromLegacy: boolean;
  /** `null` = purgado pela retenção. */
  sha256: string | null;
}

/**
 * Precedência dos documentos (FR-014): o do HUNIT Control prevalece; importado igual é ignorado.
 * `importedBefore` = esse mesmo arquivo já foi importado para a reserva e o tipo, em qualquer estado
 * (ex.: o operador o desfez depois): a reimportação não o traz de volta.
 */
export function decideLegacyDocument(
  current: CurrentDocument | null,
  incomingSha256: string,
  importedBefore = false,
): 'create' | 'replace' | { ignore: 'kept_hunit_control' | 'already_imported' } {
  if (importedBefore) return { ignore: 'already_imported' };
  if (!current) return 'create';
  if (!current.fromLegacy) return { ignore: 'kept_hunit_control' };
  if (current.sha256 === null || current.sha256 === incomingSha256) {
    return { ignore: 'already_imported' };
  }
  return 'replace';
}

/** Valor manual (FR-015): só com comprovante; o do HUNIT Control prevalece. */
export function decideLegacyManualAmount(input: {
  hasProof: boolean;
  current: { fromLegacy: boolean; amount: Money } | null;
  amount: Money;
}):
  | 'create'
  | 'update'
  | { ignore: 'kept_hunit_control' | 'already_imported' }
  | { reject: 'manual_amount_without_proof' } {
  if (!input.hasProof) return { reject: 'manual_amount_without_proof' };
  if (!input.current) return 'create';
  if (!input.current.fromLegacy) return { ignore: 'kept_hunit_control' };
  return input.current.amount === input.amount ? { ignore: 'already_imported' } : 'update';
}

// ---------------------------------------------------------------------------
// Hotéis (FR-006a, research R-10)
// ---------------------------------------------------------------------------

/** Nome comparável: sem acentos, minúsculas, `_` e espaços como separador único, sem pontuação. */
export function normalizeHotelName(value: string): string {
  return comparable(value.replace(/_/g, ' '))
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hotel do catálogo proposto para um hotel do sistema anterior: o único cujo nome normalizado é
 * igual ao do "Hotel" ou ao do código. Nenhum ou mais de um → sem proposta.
 */
export function proposeHotel(
  legacy: { key: string; name: string },
  catalog: readonly { code: string; name: string }[],
): string | null {
  const wanted = new Set([normalizeHotelName(legacy.name), normalizeHotelName(legacy.key)]);
  wanted.delete('');
  const candidates = catalog.filter((hotel) => wanted.has(normalizeHotelName(hotel.name)));
  return candidates.length === 1 ? candidates[0]!.code : null;
}
