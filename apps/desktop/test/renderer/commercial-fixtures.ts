/**
 * Dados fictícios do envio ao Comercial para os testes da interface (specs/005). Nenhum nome,
 * número ou código é real.
 */
import type {
  CommercialDetail,
  CommercialEvent,
  CommercialLine,
  CommercialReturn,
  CommercialReturnBrief,
  CommercialSheetStatus,
  SelectionItem,
} from '../../src/shared/ipc-types';

export const RETURN_ID = '55555555-5555-4555-8555-555555555555';
export const DISPATCH_ID = '44444444-4444-4444-8444-444444444444';

export function line(overrides: Partial<CommercialLine> = {}): CommercialLine {
  return {
    state: 'open',
    inSheet: true,
    tab: 'to_charge',
    sheetTab: 'to_charge',
    firstSentAt: '2026-11-13T12:00:00.000Z',
    lastSentAt: '2026-11-14T12:00:00.000Z',
    lastDispatchId: DISPATCH_ID,
    lastSentBy: 'desktop-financeiro',
    concludedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    restorableUntil: null,
    returnProblem: null,
    sheetIssue: null,
    syncPending: false,
    ...overrides,
  };
}

export function commercialReturn(overrides: Partial<CommercialReturn> = {}): CommercialReturn {
  return {
    id: RETURN_ID,
    authorizationCode: 'AUT987',
    chargeHotel: 'Maquininha Centro',
    chargedAmount: '90.00',
    chargedBy: 'Comercial Fictício',
    readAt: '2026-11-15T12:00:00.000Z',
    state: 'awaiting_validation',
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    expectedAmount: '100.00',
    difference: '-10.00',
    chargeSituation: null,
    chargeDate: null,
    ...overrides,
  };
}

export function returnBrief(overrides: Partial<CommercialReturnBrief> = {}): CommercialReturnBrief {
  return {
    id: RETURN_ID,
    state: 'awaiting_validation',
    authorizationCode: 'AUT987',
    chargeHotel: 'Maquininha Centro',
    chargedAmount: '90.00',
    chargedBy: 'Comercial Fictício',
    readAt: '2026-11-15T12:00:00.000Z',
    difference: '-10.00',
    chargeSituation: null,
    chargeDate: null,
    ...overrides,
  };
}

export function commercialEvent(overrides: Partial<CommercialEvent> = {}): CommercialEvent {
  return {
    id: 1,
    type: 'dispatched',
    actor: { kind: 'client', name: 'desktop-financeiro' },
    at: '2026-11-14T12:00:00.000Z',
    dispatchId: DISPATCH_ID,
    returnId: null,
    classification: null,
    reason: null,
    batchId: null,
    ...overrides,
  };
}

export function detail(overrides: Partial<CommercialDetail> = {}): CommercialDetail {
  return {
    line: line(),
    returns: [commercialReturn()],
    events: [commercialEvent()],
    report: null,
    history: [commercialEvent()],
    situationReturns: [],
    ...overrides,
  };
}

export function selectionItem(
  number: string,
  overrides: Partial<SelectionItem> = {},
): SelectionItem {
  return {
    hotelCode: '31',
    hotelName: 'Hotel Praia',
    reservationNumber: number,
    guestName: 'Hóspede Fictício',
    channel: 'Booking.com',
    checkIn: '2026-11-03',
    totalAmount: '100.00',
    reservationStatus: 'active',
    classification: 'virtual_card_already_charged',
    treatmentStatus: 'sent',
    situation: 'treatment_sent',
    detailedSituation: 'treatment_sent',
    needsReview: true,
    effectiveChargedAmount: null,
    chargedAmountOrigin: null,
    currentReturn: null,
    ...overrides,
  };
}

export function sheetStatus(overrides: Partial<CommercialSheetStatus> = {}): CommercialSheetStatus {
  return {
    configured: true,
    status: 'ok',
    lastRoundOkAt: '2026-11-17T12:00:00.000Z',
    lastReadOkAt: '2026-11-17T12:00:00.000Z',
    lastError: null,
    nextAttemptAt: null,
    pending: { count: 0, oldestChangeAt: null },
    awaitingValidation: 2,
    problems: [],
    reports: [],
    hunitQueueCount: 0,
    ...overrides,
  };
}
