/**
 * Plano da importação do histórico (specs/004, research R-08): o que cada linha e cada documento da
 * planilha vira. A simulação e a importação usam este mesmo código — a simulação só não grava —, o
 * que garante o mesmo resultado (FR-005).
 *
 * Duas etapas:
 * 1. `prepareImport` (sem banco): lê as linhas, aplica as regras do domínio, a associação de hotéis
 *    e confere os anexos. Dá as recusas que não dependem do que já está gravado.
 * 2. `planEntry` (por reserva, com o estado gravado dela): decide criar, atualizar, ignorar ou
 *    recusar a reserva, os documentos e o valor manual.
 *
 * Nada aqui guarda ou devolve o conteúdo de uma célula num motivo (FR-018).
 */
import { createHash } from 'node:crypto';
import {
  anonymizationCutoff,
  decideLegacyDocument,
  decideLegacyManualAmount,
  decideLegacyReservation,
  parseLegacyReservationRow,
  parseLegacyText,
  parseLegacyTreatmentRow,
  selectLegacyDuplicates,
  type CurrentDocument,
  type ExistingReservation,
  type IsoDate,
  type LegacyDocumentPlan,
  type LegacyOriginRecord,
  type LegacyReservationDecision,
  type LegacyRow,
  type Money,
  type ParsedLegacyReservation,
  type TreatmentDocumentKind,
  type TreatmentMediaType,
} from '@hunit/domain';
import type {
  LegacyImportCounts,
  LegacyImportEntity,
  LegacyImportIssue,
  LegacyImportWarningEntry,
  LegacyOutcomeCounts,
} from '../persistence/schema.js';
import type { AttachmentRejection, LegacyAttachments } from './attachments.js';
import type { LegacySheetRow, LegacyWorkbook } from './workbook.js';

export type Outcome = 'created' | 'updated' | 'ignored' | 'rejected';

/** Anexo conferido, sem o conteúdo (que é lido de novo só na gravação). */
export interface FileInfo {
  relative: string;
  sha256: string;
  sizeBytes: number;
  mediaType: TreatmentMediaType;
  fileName: string;
}

export type FileCheck = { ok: true; file: FileInfo } | { ok: false; reason: AttachmentRejection };

/** Reserva da aba "Reservas" válida, sem repetição e com hotel associado. */
export interface PreparedReservation {
  key: string;
  parsed: ParsedLegacyReservation;
  hotelCode: string;
  rowHash: string;
}

/** Linha da aba "Tratativas" de uma reserva (a primeira, se houver repetição). */
export interface PreparedTreatment {
  key: string;
  row: number;
  legacyHotel: string;
  reservationNumber: string;
  /** `null` = o hotel não tem associação confirmada. */
  hotelCode: string | null;
  cells: LegacyRow;
}

export interface PreparedImport {
  /** Por chave `código do hotel do sistema anterior|reserva`, na ordem da planilha. */
  reservations: Map<string, PreparedReservation>;
  treatments: Map<string, PreparedTreatment>;
  /** Conferência de cada anexo, por caminho na planilha + nome original. */
  files: Map<string, FileCheck>;
  /** Recusas e repetições que não dependem do banco. */
  tally: Tally;
  /** Arquivos encontrados e conferidos, para a impressão digital (research R-08). */
  referencedFiles: { relative: string; sha256: string }[];
  unreferencedFiles: number;
  /** Linhas recusadas por hotel sem associação, por código do sistema anterior. */
  unmappedHotels: Map<string, { name: string; rows: number }>;
}

export const reservationKey = (legacyHotel: string, reservationNumber: string): string =>
  `${legacyHotel}|${reservationNumber}`;

const fileKey = (storedPath: string, originalName: string | null): string =>
  `${storedPath}\u0000${originalName ?? ''}`;

const DOCUMENT_SOURCES = {
  request: { path: 'Tratativa - arquivo no Dropbox', name: 'Tratativa - nome original' },
  proof: { path: 'Comprovante - arquivo no Dropbox', name: 'Comprovante - nome original' },
  old: { path: 'Anexo antigo - arquivo no Dropbox', name: 'Anexo antigo - nome original' },
} as const;

// ---------------------------------------------------------------------------
// Contagens, recusas e desfechos
// ---------------------------------------------------------------------------

const emptyCounts = (): LegacyOutcomeCounts => ({
  created: 0,
  updated: 0,
  ignored: 0,
  rejected: 0,
});

const COUNT_FIELD: Record<
  LegacyImportEntity,
  Exclude<keyof LegacyImportCounts, 'unreferencedFiles'>
> = {
  reservation: 'reservations',
  request: 'requests',
  proof: 'proofs',
  manual_amount: 'manualAmounts',
};

/** Acumula contagens, ignorados e recusados, desfechos por chave e avisos. */
export class Tally {
  readonly counts: Omit<LegacyImportCounts, 'unreferencedFiles'> = {
    reservations: emptyCounts(),
    requests: emptyCounts(),
    proofs: emptyCounts(),
    manualAmounts: emptyCounts(),
  };
  readonly issues: LegacyImportIssue[] = [];
  readonly outcomes: Record<string, string> = {};
  readonly warnings = new Map<string, number>();

  record(input: {
    sheet: LegacyImportIssue['sheet'];
    row: number;
    legacyHotel: string;
    reservationNumber: string;
    entity: LegacyImportEntity;
    /** Chave do desfecho: a entidade ou, nos documentos, a coluna de origem. */
    slot: string;
    outcome: Outcome;
    reason?: string;
    column?: string;
  }): void {
    this.counts[COUNT_FIELD[input.entity]][input.outcome] += 1;
    const key = `${reservationKey(input.legacyHotel, input.reservationNumber)}|${input.slot}`;
    this.outcomes[key] = input.reason ? `${input.outcome}:${input.reason}` : input.outcome;
    if (input.outcome === 'ignored' || input.outcome === 'rejected') {
      this.issues.push({
        sheet: input.sheet,
        row: input.row,
        legacyHotel: input.legacyHotel,
        reservationNumber: input.reservationNumber,
        entity: input.entity,
        outcome: input.outcome,
        reason: input.reason ?? 'unknown',
        ...(input.column ? { column: input.column } : {}),
      });
    }
  }

  warn(code: string, count = 1): void {
    if (count > 0) this.warnings.set(code, (this.warnings.get(code) ?? 0) + count);
  }

  warningList(): LegacyImportWarningEntry[] {
    return [...this.warnings].map(([code, count]) => ({ code, count }));
  }

  /** Junta outra contagem (a da etapa sem banco) nesta. */
  absorb(other: Tally): void {
    for (const field of Object.keys(this.counts) as (keyof typeof this.counts)[]) {
      for (const outcome of Object.keys(emptyCounts()) as Outcome[]) {
        this.counts[field][outcome] += other.counts[field][outcome];
      }
    }
    this.issues.push(...other.issues);
    Object.assign(this.outcomes, other.outcomes);
    for (const [code, count] of other.warnings) this.warn(code, count);
  }
}

// ---------------------------------------------------------------------------
// Etapa 1: sem banco
// ---------------------------------------------------------------------------

export interface PrepareOptions {
  /** Hoje, no fuso de São Paulo (AAAA-MM-DD), para o corte da retenção. */
  today: IsoDate;
  retentionYears: number;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function keyCells(cells: LegacyRow): { legacyHotel: string; reservationNumber: string } {
  return {
    legacyHotel: parseLegacyText(cells['Codigo hotel']) ?? '',
    reservationNumber: parseLegacyText(cells.Reserva) ?? '',
  };
}

export async function prepareImport(
  workbook: LegacyWorkbook,
  attachments: LegacyAttachments,
  mappings: ReadonlyMap<string, string>,
  options: PrepareOptions,
): Promise<PreparedImport> {
  const tally = new Tally();
  const cutoff = anonymizationCutoff(options.today, options.retentionYears);
  const rejectedKeys = new Set<string>();
  const unmappedHotels = new Map<string, { name: string; rows: number }>();

  // Aba "Reservas".
  const parsed: ParsedLegacyReservation[] = [];
  for (const { row, cells } of workbook.reservations) {
    const result = parseLegacyReservationRow(cells, row, cutoff);
    if (result.ok) {
      parsed.push(result.value);
      continue;
    }
    const ids = keyCells(cells);
    rejectedKeys.add(reservationKey(ids.legacyHotel, ids.reservationNumber));
    tally.record({
      sheet: 'Reservas',
      row,
      ...ids,
      entity: 'reservation',
      slot: `reservation@${row}`,
      outcome: 'rejected',
      reason: result.rejection.reason,
      ...(result.rejection.column ? { column: result.rejection.column } : {}),
    });
  }

  const { kept, duplicates } = selectLegacyDuplicates(parsed);
  for (const item of duplicates) {
    tally.record({
      sheet: 'Reservas',
      row: item.row,
      legacyHotel: item.legacyHotelKey,
      reservationNumber: item.reservationNumber,
      entity: 'reservation',
      slot: `reservation@${item.row}`,
      outcome: 'ignored',
      reason: 'duplicated_in_sheet',
    });
  }

  const reservations = new Map<string, PreparedReservation>();
  for (const item of kept) {
    const key = reservationKey(item.legacyHotelKey, item.reservationNumber);
    const hotelCode = mappings.get(item.legacyHotelKey);
    if (!hotelCode) {
      rejectedKeys.add(key);
      const hotel = unmappedHotels.get(item.legacyHotelKey);
      unmappedHotels.set(item.legacyHotelKey, {
        name: item.legacyHotelName,
        rows: (hotel?.rows ?? 0) + 1,
      });
      tally.record({
        sheet: 'Reservas',
        row: item.row,
        legacyHotel: item.legacyHotelKey,
        reservationNumber: item.reservationNumber,
        entity: 'reservation',
        slot: 'reservation',
        outcome: 'rejected',
        reason: 'hotel_not_mapped',
      });
      continue;
    }
    // Uma linha recusada e outra válida da mesma reserva: vale a válida.
    rejectedKeys.delete(key);
    if (item.anonymize) tally.warn('anonymized_on_import');
    reservations.set(key, { key, parsed: item, hotelCode, rowHash: sha256(item.canonical) });
  }

  // Aba "Tratativas".
  const treatments = new Map<string, PreparedTreatment>();
  const pending: LegacySheetRow[] = [];
  for (const sheetRow of workbook.treatments) {
    const { row, cells } = sheetRow;
    const ids = keyCells(cells);
    const key = reservationKey(ids.legacyHotel, ids.reservationNumber);
    const reject = (reason: string, column?: string) =>
      tally.record({
        sheet: 'Tratativas',
        row,
        ...ids,
        entity: 'request',
        slot: `treatment@${row}`,
        outcome: reason === 'duplicated_in_sheet' ? 'ignored' : 'rejected',
        reason,
        ...(column ? { column } : {}),
      });

    if (!ids.legacyHotel) {
      reject('missing_value', 'Codigo hotel');
      continue;
    }
    if (!ids.reservationNumber) {
      reject('missing_value', 'Reserva');
      continue;
    }
    if (treatments.has(key)) {
      reject('duplicated_in_sheet');
      continue;
    }
    if (rejectedKeys.has(key) && !reservations.has(key)) {
      reject('reservation_rejected');
      continue;
    }
    const hotelCode = reservations.get(key)?.hotelCode ?? mappings.get(ids.legacyHotel) ?? null;
    if (hotelCode === null) {
      reject('hotel_not_mapped');
      continue;
    }
    treatments.set(key, { key, row, ...ids, hotelCode, cells });
    pending.push(sheetRow);
  }

  // Anexos: conferidos uma vez cada, sem guardar o conteúdo.
  const files = new Map<string, FileCheck>();
  const referenced = new Map<string, string>();
  for (const { cells } of pending) {
    for (const source of Object.values(DOCUMENT_SOURCES)) {
      const storedPath = parseLegacyText(cells[source.path]);
      if (storedPath === null) continue;
      const originalName = parseLegacyText(cells[source.name]);
      const key = fileKey(storedPath, originalName);
      if (files.has(key)) continue;
      const result = await attachments.inspect(storedPath, originalName);
      if (result.ok) {
        const { relative, sha256: fileSha, sizeBytes, mediaType, fileName } = result.attachment;
        const file = { relative, sha256: fileSha, sizeBytes, mediaType, fileName };
        files.set(key, { ok: true, file });
        referenced.set(file.relative, file.sha256);
      } else {
        files.set(key, { ok: false, reason: result.reason });
      }
    }
  }

  const unreferencedFiles = attachments.unreferencedCount();
  tally.warn('unreferenced_files', unreferencedFiles);

  return {
    reservations,
    treatments,
    files,
    tally,
    referencedFiles: [...referenced].map(([relative, sha]) => ({ relative, sha256: sha })),
    unreferencedFiles,
    unmappedHotels,
  };
}

// ---------------------------------------------------------------------------
// Etapa 2: por reserva, com o estado gravado
// ---------------------------------------------------------------------------

/** O que já está gravado sobre a reserva. */
export interface ReservationState {
  existing: ExistingReservation | null;
  origin: LegacyOriginRecord | null;
  documents: Partial<Record<TreatmentDocumentKind, CurrentDocument & { id: string }>>;
  /** Arquivos já importados para a reserva, por tipo, em qualquer estado (FR-014). */
  importedFiles: Partial<Record<TreatmentDocumentKind, ReadonlySet<string>>>;
  manual: { fromLegacy: boolean; amount: Money } | null;
}

export interface DocumentAction {
  type: 'create' | 'replace';
  plan: LegacyDocumentPlan;
  file: FileInfo;
  /** Documento atual que será substituído (`replace`). */
  replaceId: string | null;
  /** Reserva anonimizada: grava o registro sem o arquivo e sem o nome (FR-022). */
  purged: boolean;
}

export interface EntryPlan {
  key: string;
  hotelCode: string;
  reservationNumber: string;
  reservation: LegacyReservationDecision | null;
  documents: DocumentAction[];
  manual: { type: 'create' | 'update'; amount: Money; setAt: Date } | null;
}

/** Decide uma reserva e registra os desfechos em `tally`. Não grava nada. */
export function planEntry(input: {
  key: string;
  reservation: PreparedReservation | undefined;
  treatment: PreparedTreatment | undefined;
  files: ReadonlyMap<string, FileCheck>;
  state: ReservationState;
  now: Date;
  tally: Tally;
}): EntryPlan | null {
  const { key, reservation, treatment, files, state, now, tally } = input;
  const legacyHotel = reservation?.parsed.legacyHotelKey ?? treatment!.legacyHotel;
  const reservationNumber = reservation?.parsed.reservationNumber ?? treatment!.reservationNumber;
  const hotelCode = reservation?.hotelCode ?? treatment!.hotelCode!;
  const ids = { legacyHotel, reservationNumber };

  let decision: LegacyReservationDecision | null = null;
  if (reservation) {
    decision = decideLegacyReservation({
      parsed: reservation.parsed,
      hotelCode,
      rowHash: reservation.rowHash,
      existing: state.existing,
      origin: state.origin,
      now,
    });
    const outcome: Outcome =
      decision.action === 'create'
        ? 'created'
        : decision.action === 'unchanged'
          ? 'ignored'
          : 'updated';
    tally.record({
      sheet: 'Reservas',
      row: reservation.parsed.row,
      ...ids,
      entity: 'reservation',
      slot: 'reservation',
      outcome,
      ...(outcome === 'ignored' ? { reason: 'unchanged' } : {}),
    });
  }

  const plan: EntryPlan = {
    key,
    hotelCode,
    reservationNumber,
    reservation: decision,
    documents: [],
    manual: null,
  };
  if (!treatment) return plan;

  const recordTreatment = (
    entity: LegacyImportEntity,
    slot: string,
    outcome: Outcome,
    reason?: string,
    column?: string,
  ) =>
    tally.record({
      sheet: 'Tratativas',
      row: treatment.row,
      ...ids,
      entity,
      slot,
      outcome,
      ...(reason ? { reason } : {}),
      ...(column ? { column } : {}),
    });

  // Sem linha na aba de reservas e sem a reserva no banco: não há onde registrar.
  const reservationExists = reservation !== undefined || state.existing !== null;
  const parsedTreatment = parseLegacyTreatmentRow(
    treatment.cells,
    treatment.row,
    reservation?.parsed.origin.originalClassification ?? state.existing?.classification ?? null,
    reservation?.parsed.origin.lastVerifiedAt ?? state.existing?.lastVerifiedAt ?? now,
  );
  if (!parsedTreatment.ok) {
    recordTreatment('request', 'treatment', 'rejected', parsedTreatment.rejection.reason);
    return plan;
  }
  const { documents, manualAmount } = parsedTreatment.value;

  const anonymized =
    (decision && 'record' in decision && decision.record.anonymizedAt !== null) ||
    state.existing?.anonymizedAt != null;

  let proofAfterImport = state.documents.proof !== undefined;
  for (const entry of documents) {
    const entity = entry.ok ? entry.plan.kind : entry.kind;
    const slot = entry.ok ? entry.plan.source : entry.source;
    if (!reservationExists) {
      recordTreatment(entity, slot, 'rejected', 'reservation_not_in_sheet');
      continue;
    }
    if (!entry.ok) {
      const outcome = entry.reason === 'superseded_in_legacy' ? 'ignored' : 'rejected';
      recordTreatment(entity, slot, outcome, entry.reason, entry.column);
      continue;
    }
    const columns = DOCUMENT_SOURCES[entry.plan.source];
    const check = files.get(fileKey(entry.plan.storedPath, entry.plan.originalName));
    if (!check?.ok) {
      recordTreatment(entity, slot, 'rejected', check?.reason ?? 'file_not_found', columns.path);
      continue;
    }
    if (entry.plan.dateMissing) tally.warn('original_date_missing');
    const current = state.documents[entry.plan.kind] ?? null;
    const choice = decideLegacyDocument(
      current,
      check.file.sha256,
      state.importedFiles[entry.plan.kind]?.has(check.file.sha256) ?? false,
    );
    if (typeof choice === 'object') {
      recordTreatment(entity, slot, 'ignored', choice.ignore);
      if (entry.plan.kind === 'proof') proofAfterImport = true;
      continue;
    }
    plan.documents.push({
      type: choice,
      plan: entry.plan,
      file: check.file,
      replaceId: choice === 'replace' ? (current?.id ?? null) : null,
      purged: anonymized,
    });
    if (entry.plan.kind === 'proof') proofAfterImport = true;
    recordTreatment(entity, slot, choice === 'create' ? 'created' : 'updated');
  }

  if (manualAmount) {
    if (!reservationExists) {
      recordTreatment('manual_amount', 'manual_amount', 'rejected', 'reservation_not_in_sheet');
    } else if (!manualAmount.ok) {
      recordTreatment(
        'manual_amount',
        'manual_amount',
        'rejected',
        manualAmount.reason,
        manualAmount.column,
      );
    } else {
      if (manualAmount.dateMissing) tally.warn('original_date_missing');
      const choice = decideLegacyManualAmount({
        hasProof: proofAfterImport,
        current: state.manual,
        amount: manualAmount.amount,
      });
      if (choice === 'create' || choice === 'update') {
        plan.manual = { type: choice, amount: manualAmount.amount, setAt: manualAmount.setAt };
        recordTreatment(
          'manual_amount',
          'manual_amount',
          choice === 'create' ? 'created' : 'updated',
        );
      } else if ('ignore' in choice) {
        recordTreatment('manual_amount', 'manual_amount', 'ignored', choice.ignore);
      } else {
        recordTreatment('manual_amount', 'manual_amount', 'rejected', choice.reject);
      }
    }
  }

  return plan;
}

/** Chaves a decidir, na ordem: as da aba "Reservas", depois as tratativas sem linha lá. */
export function entryKeys(prepared: PreparedImport): string[] {
  const keys = [...prepared.reservations.keys()];
  for (const key of prepared.treatments.keys()) {
    if (!prepared.reservations.has(key)) keys.push(key);
  }
  return keys;
}

/** Contagens finais, com os arquivos sem referência. */
export function finalCounts(tally: Tally, unreferencedFiles: number): LegacyImportCounts {
  return { ...structuredClone(tally.counts), unreferencedFiles };
}
