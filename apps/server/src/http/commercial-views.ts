/**
 * Conversão dos registros do envio ao Comercial para o formato do contrato da API (specs/005,
 * contracts/api-changes.md). Datas em ISO 8601; nenhum campo fora do contrato.
 */
import type { components } from '@hunit/contracts';
import { amountToCharge, isSituationReturn, lineRestoreDeadline } from '@hunit/domain';
import type { DispatchEvent } from '../dispatches/events.js';
import type {
  CommercialEventRecord,
  CommercialLineDetail,
  CommercialReportRecord,
  CommercialReturnDetail,
} from '../persistence/commercial-repo.js';
import type {
  CancellationAwaitingRow,
  HunitQueueRow,
} from '../persistence/commercial-reports-repo.js';
import type {
  DispatchCounts,
  DispatchItemRow,
  DispatchRow,
} from '../persistence/dispatches-repo.js';

type Schemas = components['schemas'];
export type CommercialDispatchView = Schemas['CommercialDispatch'];
export type CommercialDispatchSummaryView = Schemas['CommercialDispatchSummary'];
export type CommercialLineView = Schemas['CommercialLine'];
export type CommercialReturnView = Schemas['CommercialReturn'];
export type CommercialEventView = Schemas['CommercialEvent'];
export type CommercialHistoryEventView = Schemas['CommercialHistoryEvent'];

function iso(date: Date): string;
function iso(date: Date | null): string | null;
function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** "1234.56" - "1000.00" = "234.56", sem erro de ponto flutuante. */
export function difference(charged: string, expected: string | null): string | null {
  if (expected === null) return null;
  const cents = (value: string) => {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
    return negative ? -result : result;
  };
  const diff = cents(charged) - cents(expected);
  const absolute = diff < 0n ? -diff : diff;
  return `${diff < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function toDispatchSummaryView(
  dispatch: DispatchRow,
  clientName: string,
  counts: DispatchCounts,
): CommercialDispatchSummaryView {
  return {
    id: dispatch.id,
    requestedClient: clientName,
    parentDispatchId: dispatch.parentDispatchId,
    status: dispatch.status,
    endReason: dispatch.endReason,
    createdAt: iso(dispatch.createdAt),
    finishedAt: iso(dispatch.finishedAt),
    counts,
    purpose: dispatch.purpose,
  };
}

export function toDispatchView(parts: {
  dispatch: DispatchRow;
  clientName: string;
  counts: DispatchCounts;
  items: readonly DispatchItemRow[];
  resumedByDispatchId: string | null;
  lastStatusEvent: DispatchEvent | null;
  lastEventId: number | null;
}): CommercialDispatchView {
  const { dispatch, items } = parts;
  const final = ['completed', 'failed', 'cancelled'].includes(dispatch.status);
  const next =
    dispatch.status === 'running' ? items.find((item) => item.outcome === 'pending') : undefined;
  return {
    ...toDispatchSummaryView(dispatch, parts.clientName, parts.counts),
    resumedByDispatchId: parts.resumedByDispatchId,
    endMessage: final ? (parts.lastStatusEvent?.message ?? null) : null,
    startedAt: iso(dispatch.startedAt),
    twoFactorDeadline: iso(dispatch.twoFactorDeadline),
    current: next ? { hotelCode: next.hotelCode, reservationNumber: next.reservationNumber } : null,
    items: items.map((item) => ({
      hotelCode: item.hotelCode,
      reservationNumber: item.reservationNumber,
      position: item.position,
      outcome: item.outcome,
      classificationBefore: item.classificationBefore,
      classificationAfter: item.classificationAfter,
      reason: item.reason,
      processedAt: iso(item.processedAt),
      checkResult: item.checkResult,
    })),
    lastEventId: parts.lastEventId === null ? null : String(parts.lastEventId),
  };
}

export function toDispatchEventView(event: DispatchEvent): Schemas['CommercialDispatchEvent'] {
  return {
    id: String(event.id),
    at: iso(event.at),
    type: event.type,
    ...(event.status && { status: event.status }),
    hotelCode: event.hotelCode,
    reservationNumber: event.reservationNumber,
    message: event.message,
  };
}

/** Aba da planilha no formato da API (specs/009). */
const SHEET_TAB_VIEW = {
  toCharge: 'to_charge',
  awaitingValidation: 'awaiting_validation',
  done: 'done',
} as const;

export function toCommercialLineView(
  line: CommercialLineDetail,
  now: Date,
  /** A aba calculada pela regra da rodada (specs/009); sem ela, a do estado da linha. */
  sheetTab?: keyof typeof SHEET_TAB_VIEW | null,
): CommercialLineView {
  const inSheet = line.removedFromSheetAt === null;
  const restorable =
    line.state === 'cancelled' &&
    line.cancelledAt !== null &&
    now.getTime() < lineRestoreDeadline(line.cancelledAt).getTime();
  return {
    state: line.state,
    inSheet,
    tab: inSheet ? (line.state === 'open' ? 'to_charge' : 'done') : null,
    sheetTab: !inSheet
      ? null
      : sheetTab
        ? SHEET_TAB_VIEW[sheetTab]
        : line.state === 'open'
          ? 'to_charge'
          : 'done',
    firstSentAt: iso(line.firstSentAt),
    lastSentAt: iso(line.lastSentAt),
    lastDispatchId: line.lastDispatchId,
    lastSentBy: line.lastSentBy,
    concludedAt: iso(line.concludedAt),
    cancelledAt: iso(line.cancelledAt),
    cancelledBy: line.cancelledBy,
    restorableUntil:
      restorable && line.cancelledAt ? iso(lineRestoreDeadline(line.cancelledAt)) : null,
    returnProblem: line.returnProblem,
    sheetIssue: line.sheetIssue,
    syncPending: line.syncedVersion < line.version,
  };
}

/** Situação da cobrança no formato da API (specs/008); `null` = não informada. */
export function toChargeSituationView(
  text: string | null,
  kind: Schemas['ChargeSituation']['kind'] | null,
): Schemas['ChargeSituation'] | null {
  return text === null || kind === null ? null : { kind, text };
}

/** Relato atual do Comercial (specs/008, `CommercialReportBrief`). */
export function toCommercialReportView(
  report: CommercialReportRecord | null,
): Schemas['CommercialReportBrief'] | null {
  if (report === null) return null;
  return {
    kind: report.kind,
    situationText: report.situationText,
    chargedBy: report.chargedBy,
    chargeDate: report.chargeDate,
    readAt: iso(report.readAt),
    hunitStatus: report.hunitStatus,
    // Validação da "Cancelada" pelo Financeiro (homologação, R-19).
    validation:
      report.validation === null
        ? null
        : {
            state: report.validation.state,
            decidedAt: report.validation.decidedAt ? iso(report.validation.decidedAt) : null,
            decidedBy: report.validation.decidedBy,
            rejectionReason: report.validation.rejectionReason,
          },
  };
}

/** Linha da fila "Cobradas no Hunit" (specs/008, tela 7.15). */
export function toHunitChargeItemView(row: HunitQueueRow): Schemas['HunitChargeItem'] {
  return {
    hotelCode: row.hotelCode,
    hotelName: row.hotelName,
    reservationNumber: row.reservationNumber,
    guestName: row.guestName,
    channel: row.channel,
    amountToCharge: amountToCharge(row.totalAmount, row.noChargeMarked),
    situationText: row.situationText,
    chargedBy: row.chargedBy,
    chargeDate: row.chargeDate,
    readAt: iso(row.readAt),
    status: row.status,
    checkedAt: row.status === 'awaiting' ? null : iso(row.lastVerifiedAt),
    classification: row.classification,
    requiresCharge: row.requiresChargeNow,
  };
}

/** A fila e as contagens (`GET /commercial-hunit-charges`). */
export function toHunitChargeQueueView(
  rows: readonly HunitQueueRow[],
): Schemas['HunitChargeQueue'] {
  const count = (status: HunitQueueRow['status']) =>
    rows.filter((row) => row.status === status).length;
  return {
    items: rows.map(toHunitChargeItemView),
    counts: {
      awaiting: count('awaiting'),
      notFound: count('not_found'),
      confirmed: count('confirmed'),
    },
  };
}

/** "Cancelada" aguardando validação, para "Retornos a validar" (homologação da 008, R-19). */
export function toReportProblemView(
  row: CancellationAwaitingRow,
): Schemas['CommercialReportProblem'] {
  return {
    hotelCode: row.hotelCode,
    reservationNumber: row.reservationNumber,
    situationText: row.situationText,
    chargedBy: row.chargedBy,
    chargeDate: row.chargeDate,
    readAt: iso(row.readAt),
    totalAmount: row.totalAmount,
  };
}

/**
 * Retorno do Comercial no formato da 1.7.0; `null` para o retorno de situação livre (specs/009,
 * research R-03), que vai em `situationReturns`.
 */
export function toCommercialReturnView(
  row: CommercialReturnDetail,
  expectedAmount: string | null,
): CommercialReturnView | null {
  if (
    isSituationReturn(row.chargeSituationKind) ||
    row.authorizationCode === null ||
    row.chargeHotel === null ||
    row.chargedAmount === null
  ) {
    return null;
  }
  return {
    id: row.id,
    authorizationCode: row.authorizationCode,
    chargeHotel: row.chargeHotel,
    chargedAmount: row.chargedAmount,
    chargedBy: row.chargedBy,
    readAt: iso(row.readAt),
    state: row.state,
    decidedAt: iso(row.decidedAt),
    decidedBy: row.decidedBy,
    rejectionReason: row.rejectionReason,
    expectedAmount,
    difference: difference(row.chargedAmount, expectedAmount),
    chargeSituation: toChargeSituationView(row.chargeSituationText, row.chargeSituationKind),
    chargeDate: row.chargeDate,
  };
}

/** Autor do evento: o cliente da API, o Comercial (retorno lido da planilha) ou o sistema. */
const COMMERCIAL_SHEET_EVENTS: ReadonlySet<CommercialEventRecord['type']> = new Set([
  'return_received',
  'return_changed',
  'return_ignored',
  'report_received',
  'report_changed',
  'report_cleared',
]);

/** Tipos do histórico da 1.8.0: os únicos que `CommercialDetail.events` traz (specs/008, R-02). */
const EVENT_TYPES_1_8_0: ReadonlySet<string> = new Set<CommercialEventView['type']>([
  'dispatched',
  'withdrawn',
  'line_cancelled',
  'line_restored',
  'line_concluded',
  'return_received',
  'return_changed',
  'return_ignored',
  'return_confirmed',
  'return_rejected',
  'return_confirmation_undone',
  'return_closed',
]);

/** Evento que o app 0.3 conhece (vai em `events`); os novos da 008 ficam só em `history`. */
export function isEventType1_8_0(
  event: CommercialEventRecord,
): event is CommercialEventRecord & { type: CommercialEventView['type'] } {
  return EVENT_TYPES_1_8_0.has(event.type);
}

export function toCommercialEventView(
  event: CommercialEventRecord & { type: CommercialEventView['type'] },
): CommercialEventView {
  return { ...toCommercialHistoryEventView(event), type: event.type };
}

/** Item do histórico completo (`CommercialDetail.history`, specs/008), com os tipos novos. */
export function toCommercialHistoryEventView(
  event: CommercialEventRecord,
): CommercialHistoryEventView {
  const actor =
    event.clientName !== null
      ? { kind: 'client' as const, name: event.clientName }
      : COMMERCIAL_SHEET_EVENTS.has(event.type)
        ? { kind: 'commercial_sheet' as const, name: 'Comercial (planilha)' }
        : { kind: 'system' as const, name: 'HUNIT Control' };
  return {
    id: event.id,
    type: event.type,
    actor,
    at: iso(event.at),
    dispatchId: event.dispatchId,
    returnId: event.returnId,
    classification: event.classification,
    reason: event.reason,
    batchId: event.batchId,
  };
}
