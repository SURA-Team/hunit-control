/**
 * Regras de classificação (FR-013, FR-014, FR-014a, FR-015) — tasks.md, T036.
 */
import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATION_REASONS,
  classifyReservation,
  isHotelbeds258,
} from '../src/classification.js';
import type { ReservationSnapshot } from '../src/types.js';

/** Detalhe de uma reserva pendente de cobrança; cada teste muda só o que importa. */
function snapshot(overrides: Partial<ReservationSnapshot> = {}): ReservationSnapshot {
  return {
    reservationNumber: '1001',
    structureRecognized: true,
    prePaymentPresent: true,
    chargeRecordPresent: false,
    chargeActionVisible: true,
    chargeFailed: false,
    validationOnly: false,
    reservationStatus: 'active',
    paymentForm: null,
    payment: {
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
    },
    listing: {
      guestName: 'Hóspede',
      channel: 'Canal',
      checkIn: '2026-11-03',
      checkOut: '2026-11-05',
      stayPeriod: '03/11/2026 a 05/11/2026',
      totalAmount: '500.00',
    },
    ...overrides,
  };
}

const charged = { chargeRecordPresent: true, chargeActionVisible: false } as const;
const invoicedForm = { kind: 'invoiced', label: 'Faturado' } as const;
const creditCardForm = { kind: 'credit_card', label: 'cartão de crédito' } as const;
const validated = { validationOnly: true, chargeActionVisible: false } as const;

describe('regra 1 — Hotelbeds "258-"', () => {
  it.each(['258-123', '258-ABC', ' 258-9 '])(
    '"%s" é ignorada sem precisar do detalhe',
    (number) => {
      expect(classifyReservation(number, null, 'active')).toMatchObject({
        classification: 'ignored_hotelbeds_258',
        reservationStatus: 'active',
      });
    },
  );

  it('vence qualquer detalhe, mesmo pendente', () => {
    expect(classifyReservation('258-1', snapshot()).classification).toBe('ignored_hotelbeds_258');
  });

  it.each(['2581-1', '1258-1', '258', '25-8'])('"%s" não é Hotelbeds 258', (number) => {
    expect(isHotelbeds258(number)).toBe(false);
  });
});

describe('ordem das regras 2 a 7', () => {
  it('2 — sem pré-pagamento, a forma de pagamento decide, mesmo com os outros sinais', () => {
    const result = classifyReservation(
      '1001',
      snapshot({
        prePaymentPresent: false,
        chargeFailed: true,
        chargeRecordPresent: true,
        paymentForm: creditCardForm,
      }),
    );
    expect(result.classification).toBe('charge_at_terminal');
  });

  it('3 — falha de cobrança vence o registro de cobrança e a ação de cobrar', () => {
    const result = classifyReservation(
      '1001',
      snapshot({ chargeFailed: true, chargeRecordPresent: true, chargeActionVisible: true }),
    );
    expect(result.classification).toBe('virtual_card_charge_error');
  });

  it('4 — registro "Cobrado em" → já cobrada', () => {
    expect(classifyReservation('1001', snapshot(charged)).classification).toBe(
      'virtual_card_already_charged',
    );
  });

  it('4 — registro de cobrança vence a ação de cobrar visível', () => {
    const result = classifyReservation(
      '1001',
      snapshot({ chargeRecordPresent: true, chargeActionVisible: true }),
    );
    expect(result.classification).toBe('virtual_card_already_charged');
  });

  it('5 — só "Validado em" (justValidate) → cartão validado, não cobrado', () => {
    expect(classifyReservation('1001', snapshot(validated)).classification).toBe(
      'virtual_card_validated_only',
    );
  });

  it('6 — sem cobrança e com a ação de cobrar → pendente', () => {
    expect(classifyReservation('1001', snapshot()).classification).toBe(
      'virtual_card_pending_charge',
    );
  });

  it('7 — pré-pagamento sem cobrança e sem a ação de cobrar → erro de análise', () => {
    expect(
      classifyReservation('1001', snapshot({ chargeActionVisible: false })).classification,
    ).toBe('analysis_error');
  });

  it('7 — cobrança e validação ao mesmo tempo é contraditório → erro de análise', () => {
    const result = classifyReservation(
      '1001',
      snapshot({ chargeRecordPresent: true, validationOnly: true }),
    );
    expect(result.classification).toBe('analysis_error');
  });

  it('7 — detalhe não reconhecido → erro de análise', () => {
    expect(
      classifyReservation('1001', snapshot({ structureRecognized: false })).classification,
    ).toBe('analysis_error');
  });

  it('7 — detalhe que não pôde ser lido (sem snapshot) → erro de análise', () => {
    expect(classifyReservation('1001', null, 'cancelled')).toMatchObject({
      classification: 'analysis_error',
      reservationStatus: 'cancelled',
    });
  });
});

describe('FR-015 — null em campo decisivo nunca presume cobrança', () => {
  it.each([
    ['prePaymentPresent', { prePaymentPresent: null }],
    ['chargeFailed', { chargeFailed: null }],
    ['chargeRecordPresent', { chargeRecordPresent: null }],
    ['validationOnly (com cobrança)', { chargeRecordPresent: true, validationOnly: null }],
    ['validationOnly (sem cobrança)', { validationOnly: null }],
    ['chargeActionVisible', { chargeActionVisible: null }],
  ] as const)('%s = null → erro de análise', (_, overrides) => {
    expect(classifyReservation('1001', snapshot(overrides)).classification).toBe('analysis_error');
  });

  it('null num campo que a regra aplicada não usa não muda o resultado', () => {
    const result = classifyReservation(
      '1001',
      snapshot({
        prePaymentPresent: false,
        chargeFailed: null,
        chargeActionVisible: null,
        paymentForm: invoicedForm,
      }),
    );
    expect(result.classification).toBe('invoiced');
  });
});

describe('regra 2 — reserva sem pré-pagamento, pela forma de pagamento (research R-22)', () => {
  const noCard = (paymentForm: ReservationSnapshot['paymentForm']) =>
    classifyReservation('1001', snapshot({ prePaymentPresent: false, paymentForm }));

  it('"faturado" → faturada, sem exigir ação', () => {
    expect(noCard(invoicedForm)).toMatchObject({
      classification: 'invoiced',
      reason: CLASSIFICATION_REASONS.invoiced,
    });
  });

  it('"cartão de crédito" → cobrar na maquininha', () => {
    expect(noCard(creditCardForm)).toMatchObject({
      classification: 'charge_at_terminal',
      reason: CLASSIFICATION_REASONS.chargeAtTerminal,
    });
  });

  it('forma não informada → erro de análise (FR-015)', () => {
    expect(noCard(null)).toMatchObject({
      classification: 'analysis_error',
      reason: CLASSIFICATION_REASONS.paymentFormMissing,
    });
  });

  it('forma desconhecida → erro de análise citando a forma', () => {
    const result = noCard({ kind: 'unrecognized', label: 'Pix' });

    expect(result.classification).toBe('analysis_error');
    expect(result.reason).toBe(`${CLASSIFICATION_REASONS.paymentFormUnknown} Pix.`);
  });

  it.each([invoicedForm, creditCardForm, null])(
    'com pré-pagamento, a forma de pagamento não muda nada (%j)',
    (paymentForm) => {
      expect(classifyReservation('1001', snapshot({ paymentForm })).classification).toBe(
        'virtual_card_pending_charge',
      );
      expect(
        classifyReservation('1001', snapshot({ ...charged, paymentForm })).classification,
      ).toBe('virtual_card_already_charged');
    },
  );

  it.each([
    ['faturada', invoicedForm, 'invoiced'],
    ['a cobrar na maquininha', creditCardForm, 'charge_at_terminal'],
  ] as const)(
    'cancelada e %s recebe a mesma classificação da ativa (FR-014a)',
    (_, form, expected) => {
      const cancelled = classifyReservation(
        '1001',
        snapshot({ prePaymentPresent: false, paymentForm: form, reservationStatus: 'cancelled' }),
      );
      expect(cancelled).toMatchObject({ classification: expected, reservationStatus: 'cancelled' });
    },
  );

  it('"não é cartão virtual" nunca é produzida', () => {
    for (const paymentForm of [invoicedForm, creditCardForm, null] as const) {
      expect(noCard(paymentForm).classification).not.toBe('not_virtual_card');
    }
  });
});

describe('FR-014a — situação da reserva independente da cobrança', () => {
  it.each([
    ['já cobrada', charged, 'virtual_card_already_charged'],
    ['pendente', {}, 'virtual_card_pending_charge'],
    ['validada', validated, 'virtual_card_validated_only'],
  ] as const)('cancelada e %s recebe a mesma classificação da ativa', (_, flags, expected) => {
    const active = classifyReservation('1001', snapshot({ ...flags }));
    const cancelled = classifyReservation(
      '1001',
      snapshot({ ...flags, reservationStatus: 'cancelled' }),
    );

    expect(active).toMatchObject({ classification: expected, reservationStatus: 'active' });
    expect(cancelled).toMatchObject({ classification: expected, reservationStatus: 'cancelled' });
  });

  it('situação não identificada no detalhe usa a da listagem', () => {
    const result = classifyReservation(
      '1001',
      snapshot({ reservationStatus: 'unknown' }),
      'cancelled',
    );
    expect(result.reservationStatus).toBe('cancelled');
  });

  it('situação não identificada em nenhum dos dois → unknown, sem impedir a classificação', () => {
    expect(classifyReservation('1001', snapshot({ reservationStatus: 'unknown' }))).toMatchObject({
      classification: 'virtual_card_pending_charge',
      reservationStatus: 'unknown',
    });
  });
});

describe('FR-014 — motivo sempre preenchido', () => {
  const cases: Array<[string, ReservationSnapshot | null]> = [
    ['258-1', null],
    ['1001', null],
    ['1001', snapshot({ structureRecognized: false })],
    ['1001', snapshot({ prePaymentPresent: false })],
    ['1001', snapshot({ prePaymentPresent: false, paymentForm: invoicedForm })],
    ['1001', snapshot({ prePaymentPresent: false, paymentForm: creditCardForm })],
    [
      '1001',
      snapshot({ prePaymentPresent: false, paymentForm: { kind: 'unrecognized', label: 'Pix' } }),
    ],
    ['1001', snapshot({ chargeFailed: true })],
    ['1001', snapshot(charged)],
    ['1001', snapshot(validated)],
    ['1001', snapshot()],
    ['1001', snapshot({ chargeActionVisible: false })],
    ['1001', snapshot({ prePaymentPresent: null })],
  ];

  it.each(cases)('%s → motivo não vazio', (number, detail) => {
    expect(classifyReservation(number, detail).reason.trim()).not.toBe('');
  });

  it('motivos diferentes para situações diferentes', () => {
    const reasons = new Set(
      cases.map(([number, detail]) => classifyReservation(number, detail).reason),
    );
    expect(reasons.size).toBe(cases.length);
  });
});
