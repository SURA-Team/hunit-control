/**
 * Conversão dos registros do envio ao Comercial para o formato do contrato da API (specs/005,
 * contracts/api-changes.md). Datas em ISO 8601; nenhum campo fora do contrato.
 */
import type { components } from '@hunit/contracts';
import { lineRestoreDeadline } from '@hunit/domain';
import type { DispatchEvent } from '../dispatches/events.js';
import type {
  CommercialEventRecord,
  CommercialLineDetail,
  CommercialReturnDetail,
} from '../persistence/commercial-repo.js';
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

export function toCommercialLineView(line: CommercialLineDetail, now: Date): CommercialLineView {
  const inSheet = line.removedFromSheetAt === null;
  const restorable =
    line.state === 'cancelled' &&
    line.cancelledAt !== null &&
    now.getTime() < lineRestoreDeadline(line.cancelledAt).getTime();
  return {
    state: line.state,
    inSheet,
    tab: inSheet ? (line.state === 'open' ? 'to_charge' : 'done') : null,
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

export function toCommercialReturnView(
  row: CommercialReturnDetail,
  expectedAmount: string | null,
): CommercialReturnView {
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
  };
}

/** Autor do evento: o cliente da API, o Comercial (retorno lido da planilha) ou o sistema. */
const COMMERCIAL_SHEET_EVENTS: ReadonlySet<CommercialEventRecord['type']> = new Set([
  'return_received',
  'return_changed',
  'return_ignored',
]);

export function toCommercialEventView(event: CommercialEventRecord): CommercialEventView {
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
