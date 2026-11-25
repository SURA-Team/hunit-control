/**
 * Dados fictícios das tratativas para os testes da interface (specs/003). Nenhum nome, número ou
 * arquivo é real.
 */
import type {
  PickedFile,
  Reservation,
  ReservationOutcome,
  ReservationTreatment,
  TreatmentCheck,
  TreatmentDetail,
  TreatmentDocument,
} from '../../src/shared/ipc-types';

export const NO_TREATMENT: ReservationTreatment = {
  status: 'none',
  situation: 'virtual_card_pending_charge',
  detailedSituation: 'virtual_card_pending_charge',
  needsReview: false,
  request: null,
  proof: null,
  manualChargedAmount: null,
  commercialChargedAmount: null,
  effectiveChargedAmount: null,
  chargedAmountOrigin: null,
  acceptsDocuments: true,
  noChargeHistory: [],
};

export function document(overrides: Partial<TreatmentDocument> = {}): TreatmentDocument {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'proof',
    state: 'current',
    fileName: 'comprovante.pdf',
    sizeBytes: 12_345,
    mediaType: 'application/pdf',
    attachedAt: new Date(2026, 10, 13, 10, 30).toISOString(),
    attachedBy: 'desktop-financeiro',
    endedAt: null,
    endedBy: null,
    revertibleUntil: null,
    ...overrides,
  };
}

/** Situação que o servidor devolveria para uma reserva pendente com esses documentos. */
const SITUATION_OF: Record<ReservationTreatment['status'], ReservationTreatment['situation']> = {
  none: 'virtual_card_pending_charge',
  sent: 'treatment_sent',
  charged: 'proof_sent',
};

export function treatment(overrides: Partial<ReservationTreatment> = {}): ReservationTreatment {
  const status = overrides.status ?? NO_TREATMENT.status;
  const situation = overrides.situation ?? SITUATION_OF[status];
  return { ...NO_TREATMENT, situation, detailedSituation: situation, ...overrides };
}

export function detail(overrides: Partial<TreatmentDetail> = {}): TreatmentDetail {
  return { treatment: NO_TREATMENT, documents: [], events: [], ...overrides };
}

/** Reserva pendente de cobrança, sem tratativa. */
export function pendingReservation(
  number: string,
  overrides: Partial<Reservation> = {},
): Reservation {
  return {
    hotelCode: '31',
    reservationNumber: number,
    guestName: 'Hóspede Fictício',
    channel: 'Booking.com',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    totalAmount: '100.00',
    reservationStatus: 'active',
    classification: 'virtual_card_pending_charge',
    reason: 'pré-pagamento sem cobrança',
    firstVerifiedAt: '2026-11-12T12:00:00.000Z',
    lastVerifiedAt: '2026-11-12T12:00:00.000Z',
    verificationCount: 1,
    treatment: NO_TREATMENT,
    amountToCharge: '100.00',
    noCharge: null,
    ...overrides,
  };
}

export function pickedFile(overrides: Partial<PickedFile> = {}): PickedFile {
  return {
    selectionId: '33333333-3333-4333-8333-333333333333',
    fileName: 'comprovante.png',
    sizeBytes: 2048,
    mediaType: 'image/png',
    preview: { type: 'image', bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
    ...overrides,
  };
}

export function outcome(
  number: string,
  overrides: Partial<ReservationOutcome> = {},
): ReservationOutcome {
  return {
    hotelCode: '31',
    reservationNumber: number,
    outcome: 'registered',
    reason: null,
    classification: 'virtual_card_pending_charge',
    totalAmount: '100.00',
    documentId: null,
    ...overrides,
  };
}

export function check(items: ReservationOutcome[], total = '0.00'): TreatmentCheck {
  const accepted = items.filter((item) => item.outcome !== 'ignored');
  return {
    items,
    acceptedCount: accepted.length,
    replacingCount: accepted.filter((item) => item.outcome === 'replaced').length,
    ignoredCount: items.length - accepted.length,
    acceptedTotalAmount: total,
  };
}
