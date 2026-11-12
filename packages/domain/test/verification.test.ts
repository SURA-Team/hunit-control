/**
 * Histórico de verificação (FR-016 a FR-018a; data-model, "Regras de atualização") — tasks.md,
 * T037.
 */
import { describe, expect, it } from 'vitest';
import { classifyReservation } from '../src/classification.js';
import {
  buildReservationData,
  markNotFound,
  mergeVerification,
  selectNotFound,
  type ReservationData,
  type ReservationRecord,
} from '../src/verification.js';
import type { ReservationSnapshot } from '../src/types.js';

const T1 = new Date('2026-11-08T10:00:00.000Z');
const T2 = new Date('2026-11-15T10:00:00.000Z');
const T3 = new Date('2026-11-22T10:00:00.000Z');

function data(overrides: Partial<ReservationData> = {}): ReservationData {
  return {
    hotelCode: '101',
    reservationNumber: '1001',
    guestName: 'Hóspede de Teste',
    channel: 'Canal',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    stayPeriod: '03/11/2026 a 05/11/2026',
    totalAmount: '500.00',
    reservationStatus: 'active',
    classification: 'virtual_card_pending_charge',
    reason: 'pendente',
    prePaymentFound: true,
    chargedAt: null,
    chargedBy: null,
    chargedAmount: null,
    transactionId: null,
    authorizationCode: null,
    processorReference: null,
    isInstallment: null,
    installmentCount: null,
    installmentAmount: null,
    prePaymentState: 'Unprocessed',
    prePaymentMessage: null,
    chargeActionVisible: true,
    paymentForm: null,
    ...overrides,
  };
}

function charged(): Partial<ReservationData> {
  return {
    classification: 'virtual_card_already_charged',
    reason: 'cobrada',
    chargedAt: '2026-11-10T14:30:00.000Z',
    chargedAmount: '500.00',
    prePaymentState: 'Success',
    chargeActionVisible: false,
  };
}

describe('FR-018b — "cobrar na maquininha" que ganha pré-pagamento depois', () => {
  const atTerminal = data({
    classification: 'charge_at_terminal',
    reason: 'cobrar na maquininha',
    prePaymentFound: false,
    prePaymentState: null,
    chargeActionVisible: false,
    paymentForm: 'cartão de crédito',
  });

  it('muda de situação, guarda a anterior e mantém a reserva e o histórico', () => {
    const first = mergeVerification(null, atTerminal, T1);
    const second = mergeVerification(first, data({ paymentForm: null }), T2);

    expect(second).toMatchObject({
      hotelCode: '101',
      reservationNumber: '1001',
      classification: 'virtual_card_pending_charge',
      statusChanged: true,
      previousClassification: 'charge_at_terminal',
      statusChangedAt: T2,
      firstVerifiedAt: T1,
      lastVerifiedAt: T2,
      verificationCount: 2,
    });
    expect(second.changedFields).toEqual(
      expect.arrayContaining(['classification', 'prePaymentFound', 'paymentForm']),
    );
  });

  it('a situação anterior continua registrada nas verificações seguintes sem mudança', () => {
    const first = mergeVerification(null, atTerminal, T1);
    const second = mergeVerification(first, data(), T2);
    const third = mergeVerification(second, data(), T3);

    expect(third).toMatchObject({
      statusChanged: false,
      previousClassification: 'charge_at_terminal',
      statusChangedAt: T2,
      verificationCount: 3,
    });
  });

  it('a forma de pagamento informada entra no registro', () => {
    expect(mergeVerification(null, atTerminal, T1).paymentForm).toBe('cartão de crédito');
  });
});

describe('mergeVerification — reserva nova', () => {
  it('primeira verificação = última = agora, contagem 1, sem mudanças', () => {
    const record = mergeVerification(null, data(), T1);

    expect(record).toEqual({
      ...data(),
      firstVerifiedAt: T1,
      lastVerifiedAt: T1,
      verificationCount: 1,
      changedFields: [],
      statusChanged: false,
      previousClassification: null,
      previousReservationStatus: null,
      statusChangedAt: null,
      notFoundSince: null,
      anonymizedAt: null,
    });
  });
});

describe('mergeVerification — reserva conhecida', () => {
  const first = mergeVerification(null, data(), T1);

  it('sem mudanças: mantém a primeira verificação, atualiza a última e conta mais uma', () => {
    const second = mergeVerification(first, data(), T2);

    expect(second).toMatchObject({
      firstVerifiedAt: T1,
      lastVerifiedAt: T2,
      verificationCount: 2,
      changedFields: [],
      statusChanged: false,
      previousClassification: null,
      statusChangedAt: null,
    });
  });

  it('cobrança detectada: campos alterados, classificação anterior e momento da mudança', () => {
    const second = mergeVerification(first, data(charged()), T2);

    expect(second).toMatchObject({
      ...charged(),
      verificationCount: 2,
      statusChanged: true,
      previousClassification: 'virtual_card_pending_charge',
      previousReservationStatus: 'active',
      statusChangedAt: T2,
    });
    expect(second.changedFields).toEqual([
      'classification',
      'reason',
      'chargedAt',
      'chargedAmount',
      'prePaymentState',
      'chargeActionVisible',
    ]);
  });

  it('ativa → cancelada conta como mudança de status (FR-018)', () => {
    const second = mergeVerification(first, data({ reservationStatus: 'cancelled' }), T2);

    expect(second).toMatchObject({
      reservationStatus: 'cancelled',
      changedFields: ['reservationStatus'],
      statusChanged: true,
      previousClassification: 'virtual_card_pending_charge',
      previousReservationStatus: 'active',
      statusChangedAt: T2,
    });
  });

  it('mudança só em outro campo não é mudança de status', () => {
    const second = mergeVerification(first, data({ totalAmount: '550.00' }), T2);
    expect(second).toMatchObject({ changedFields: ['totalAmount'], statusChanged: false });
  });

  it('a verificação seguinte sem mudança zera os sinais, mas guarda a última mudança', () => {
    const second = mergeVerification(first, data(charged()), T2);
    const third = mergeVerification(second, data(charged()), T3);

    expect(third).toMatchObject({
      verificationCount: 3,
      changedFields: [],
      statusChanged: false,
      previousClassification: 'virtual_card_pending_charge',
      previousReservationStatus: 'active',
      statusChangedAt: T2,
    });
  });

  it('reserva vista de novo deixa de estar "não encontrada" (FR-018a)', () => {
    const missing = markNotFound(first, T2);
    expect(mergeVerification(missing, data(), T3).notFoundSince).toBeNull();
  });

  it('reserva anonimizada continua sem nome do hóspede, e isso não conta como mudança', () => {
    const anonymized: ReservationRecord = { ...first, guestName: null, anonymizedAt: T2 };
    const next = mergeVerification(anonymized, data(), T3);

    expect(next).toMatchObject({ guestName: null, anonymizedAt: T2, changedFields: [] });
  });
});

describe('markNotFound e selectNotFound (FR-018a)', () => {
  const week = { from: '2026-11-01', to: '2026-11-07' };
  const inside = mergeVerification(
    null,
    data({ reservationNumber: 'A', checkIn: '2026-11-01' }),
    T1,
  );
  const lastDay = mergeVerification(
    null,
    data({ reservationNumber: 'B', checkIn: '2026-11-07' }),
    T1,
  );
  const outside = mergeVerification(
    null,
    data({ reservationNumber: 'C', checkIn: '2026-11-08' }),
    T1,
  );
  const seen = mergeVerification(null, data({ reservationNumber: 'D', checkIn: '2026-11-03' }), T1);

  it('só reservas não vistas e com check-in dentro do período', () => {
    const selected = selectNotFound([inside, lastDay, outside, seen], new Set(['D']), week);
    expect(selected.map((record) => record.reservationNumber)).toEqual(['A', 'B']);
  });

  it('marca o momento e não muda mais nada', () => {
    const marked = markNotFound(inside, T2);
    expect(marked).toEqual({ ...inside, notFoundSince: T2 });
  });

  it('mantém o momento da primeira marcação (coalesce)', () => {
    expect(markNotFound(markNotFound(inside, T2), T3).notFoundSince).toEqual(T2);
  });
});

describe('buildReservationData', () => {
  const listing = {
    guestName: 'Hóspede',
    channel: 'Canal',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    stayPeriod: '03/11/2026 a 05/11/2026',
    totalAmount: '500.00',
  };

  it('reserva "258-" (sem detalhe): dados da listagem, sem pré-pagamento', () => {
    const result = classifyReservation('258-1', null, 'active');
    const built = buildReservationData({
      hotelCode: '101',
      reservationNumber: '258-1',
      listing,
      snapshot: null,
      result,
    });

    expect(built).toMatchObject({
      ...listing,
      hotelCode: '101',
      reservationNumber: '258-1',
      classification: 'ignored_hotelbeds_258',
      reason: result.reason,
      reservationStatus: 'active',
      prePaymentFound: false,
      chargeActionVisible: false,
      chargedAt: null,
    });
  });

  it('reserva aberta: pagamento e sinais do detalhe', () => {
    const snapshot: ReservationSnapshot = {
      reservationNumber: '1001',
      structureRecognized: true,
      prePaymentPresent: true,
      chargeRecordPresent: true,
      chargeActionVisible: false,
      chargeFailed: false,
      validationOnly: false,
      reservationStatus: 'cancelled',
      paymentForm: { kind: 'credit_card', label: 'cartão de crédito' },
      payment: {
        chargedAt: '2026-11-02T14:30:00.000Z',
        chargedBy: 'Operador',
        chargedAmount: '500.00',
        transactionId: 'T1',
        authorizationCode: 'A1',
        processorReference: 'P1',
        isInstallment: true,
        installmentCount: 2,
        installmentAmount: '250.00',
        prePaymentState: 'Success',
        prePaymentMessage: null,
      },
      listing,
    };
    const result = classifyReservation('1001', snapshot);

    expect(
      buildReservationData({
        hotelCode: '101',
        reservationNumber: '1001',
        listing,
        snapshot,
        result,
      }),
    ).toEqual({
      ...listing,
      ...snapshot.payment,
      hotelCode: '101',
      reservationNumber: '1001',
      reservationStatus: 'cancelled',
      paymentForm: 'cartão de crédito',
      classification: 'virtual_card_already_charged',
      reason: result.reason,
      prePaymentFound: true,
      chargeActionVisible: false,
    });
  });
});
