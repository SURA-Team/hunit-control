/**
 * Regras das tratativas manuais (specs/003, FR-002, FR-003, FR-005, FR-013a; research R-04;
 * data-model §3 e §4) — tasks.md, T006.
 */
import { describe, expect, it } from 'vitest';
import {
  TREATMENT_DOCUMENT_KINDS,
  TREATMENT_DOCUMENT_STATES,
  TREATMENT_REVERT_DAYS,
  TREATMENT_STATUSES,
  acceptsTreatment,
  chargedAmountWithOrigin,
  detailedSituation,
  effectiveChargedAmount,
  lineState,
  CLASSIFICATIONS_REQUIRING_CHARGE,
  isPendingCharge,
  isRevertible,
  needsReview,
  reservationSituation,
  requiresCharge,
  revertDeadline,
  treatmentStatus,
} from '../src/treatment.js';
import { CLASSIFICATIONS, type Classification } from '../src/types.js';

/** Uma linha por classificação: o teste abaixo falha se uma classificação nova ficar de fora. */
const ELIGIBILITY: Record<Classification, boolean> = {
  virtual_card_pending_charge: true,
  virtual_card_charge_error: true,
  virtual_card_validated_only: true,
  analysis_error: true,
  charge_at_terminal: true,
  ignored_hotelbeds_258: false,
  invoiced: false,
  cancelled_no_charge: false,
  virtual_card_already_charged: false,
  // "A revisar (sistema anterior)": aceita tratativa e comprovante (specs/004, FR-007a).
  not_virtual_card: true,
};

/** Exige cobrança ("Falta cobrar", "Tratativa enviada"): as que aceitam, menos "A revisar". */
const REQUIRES_CHARGE: Record<Classification, boolean> = {
  ...ELIGIBILITY,
  not_virtual_card: false,
};

describe('listas', () => {
  it('têm os valores do contrato', () => {
    expect(TREATMENT_DOCUMENT_KINDS).toEqual(['request', 'proof']);
    expect(TREATMENT_STATUSES).toEqual(['none', 'sent', 'charged']);
    expect(TREATMENT_DOCUMENT_STATES).toEqual(['current', 'replaced', 'removed', 'purged']);
    expect(TREATMENT_REVERT_DAYS).toBe(30);
  });
});

describe('acceptsTreatment', () => {
  it('cobre todas as classificações', () => {
    expect(Object.keys(ELIGIBILITY).sort()).toEqual([...CLASSIFICATIONS].sort());
  });

  it.each(CLASSIFICATIONS.map((classification) => [classification, ELIGIBILITY[classification]]))(
    '%s → %s',
    (classification, expected) => {
      expect(acceptsTreatment(classification)).toBe(expected);
    },
  );
});

describe('requiresCharge (specs/004, R-04)', () => {
  it.each(
    CLASSIFICATIONS.map((classification) => [classification, REQUIRES_CHARGE[classification]]),
  )('%s → %s', (classification, expected) => {
    expect(requiresCharge(classification)).toBe(expected);
  });

  it('a lista para os filtros não tem "A revisar (sistema anterior)"', () => {
    expect([...CLASSIFICATIONS_REQUIRING_CHARGE].sort()).toEqual(
      CLASSIFICATIONS.filter((classification) => REQUIRES_CHARGE[classification]).sort(),
    );
    expect(CLASSIFICATIONS_REQUIRING_CHARGE).not.toContain('not_virtual_card');
  });
});

describe('treatmentStatus', () => {
  it.each([
    [{ hasCurrentRequest: false, hasCurrentProof: false }, 'none'],
    [{ hasCurrentRequest: true, hasCurrentProof: false }, 'sent'],
    [{ hasCurrentRequest: false, hasCurrentProof: true }, 'charged'],
    [{ hasCurrentRequest: true, hasCurrentProof: true }, 'charged'],
  ] as const)('%o → %s', (documents, expected) => {
    expect(treatmentStatus(documents)).toBe(expected);
  });
});

describe('reservationSituation (FR-002, R-14)', () => {
  it('comprovante sempre prevalece, qualquer que seja o status do Hunit', () => {
    for (const classification of CLASSIFICATIONS) {
      expect(reservationSituation(classification, 'charged')).toBe('proof_sent');
    }
  });

  it('tratativa só aparece enquanto a classificação exige cobrança', () => {
    for (const classification of CLASSIFICATIONS) {
      expect(reservationSituation(classification, 'sent')).toBe(
        REQUIRES_CHARGE[classification] ? 'treatment_sent' : classification,
      );
    }
  });

  it('sem documentos, vale a classificação', () => {
    for (const classification of CLASSIFICATIONS) {
      expect(reservationSituation(classification, 'none')).toBe(classification);
    }
  });
});

describe('needsReview — alerta "Verificar" (FR-002a, R-14)', () => {
  const changed = new Date('2026-11-16T12:00:00Z');
  const before = new Date('2026-11-16T11:00:00Z');
  const after = new Date('2026-11-16T13:00:00Z');
  const base = {
    classification: 'virtual_card_already_charged' as Classification,
    status: 'sent' as const,
    statusChangedAt: changed,
    lastReviewAt: null,
  };

  it('tratativa e classificação que deixou de exigir cobrança, sem confirmação → alerta', () => {
    expect(needsReview(base)).toBe(true);
    expect(needsReview({ ...base, classification: 'cancelled_no_charge' })).toBe(true);
  });

  it('confirmação depois da última mudança tira o alerta; anterior, não', () => {
    expect(needsReview({ ...base, lastReviewAt: after })).toBe(false);
    expect(needsReview({ ...base, lastReviewAt: changed })).toBe(false);
    expect(needsReview({ ...base, lastReviewAt: before })).toBe(true);
  });

  it('sem mudança registrada, qualquer confirmação vale', () => {
    expect(needsReview({ ...base, statusChangedAt: null })).toBe(true);
    expect(needsReview({ ...base, statusChangedAt: null, lastReviewAt: before })).toBe(false);
  });

  it('sem alerta com comprovante, sem documentos ou com classificação que exige cobrança', () => {
    expect(needsReview({ ...base, status: 'charged' })).toBe(false);
    expect(needsReview({ ...base, status: 'none' })).toBe(false);
    expect(needsReview({ ...base, classification: 'virtual_card_pending_charge' })).toBe(false);
  });

  it('"A revisar (sistema anterior)" com tratativa não tem alerta (specs/004, FR-007a)', () => {
    expect(needsReview({ ...base, classification: 'not_virtual_card' })).toBe(false);
    expect(reservationSituation('not_virtual_card', 'sent')).toBe('not_virtual_card');
    expect(reservationSituation('not_virtual_card', 'charged')).toBe('proof_sent');
  });
});

describe('isPendingCharge ("Falta cobrar")', () => {
  it('vale para classificação que exige cobrança sem comprovante', () => {
    expect(isPendingCharge('virtual_card_pending_charge', 'none')).toBe(true);
    expect(isPendingCharge('virtual_card_pending_charge', 'sent')).toBe(true);
    expect(isPendingCharge('charge_at_terminal', 'none')).toBe(true);
  });

  it('não vale com comprovante nem para classificação que não exige cobrança', () => {
    expect(isPendingCharge('virtual_card_pending_charge', 'charged')).toBe(false);
    expect(isPendingCharge('invoiced', 'none')).toBe(false);
    expect(isPendingCharge('virtual_card_already_charged', 'sent')).toBe(false);
    expect(isPendingCharge('not_virtual_card', 'none')).toBe(false);
    expect(isPendingCharge('not_virtual_card', 'sent')).toBe(false);
  });
});

describe('prazo de reversão', () => {
  const endedAt = new Date('2026-11-13T15:00:00.000Z');
  const deadline = new Date('2026-12-13T15:00:00.000Z');

  it('é o fim do documento mais 30 dias', () => {
    expect(revertDeadline(endedAt)).toEqual(deadline);
  });

  it('vale até o instante anterior ao prazo', () => {
    const document = { state: 'replaced', endedAt } as const;
    expect(isRevertible(document, new Date(deadline.getTime() - 1))).toBe(true);
    expect(isRevertible(document, deadline)).toBe(false);
    expect(isRevertible(document, new Date(deadline.getTime() + 1))).toBe(false);
  });

  it('vale para substituído e desfeito, não para atual nem purgado', () => {
    const now = new Date('2026-11-14T00:00:00.000Z');
    expect(isRevertible({ state: 'removed', endedAt }, now)).toBe(true);
    expect(isRevertible({ state: 'current', endedAt: null }, now)).toBe(false);
    expect(isRevertible({ state: 'purged', endedAt }, now)).toBe(false);
  });
});

describe('effectiveChargedAmount', () => {
  it('prefere o valor do Hunit', () => {
    expect(effectiveChargedAmount('100.00', '90.00', true)).toBe('100.00');
    expect(effectiveChargedAmount('100.00', null, false)).toBe('100.00');
  });

  it('usa o valor manual só com comprovante atual', () => {
    expect(effectiveChargedAmount(null, '90.00', true)).toBe('90.00');
    expect(effectiveChargedAmount(null, '90.00', false)).toBeNull();
    expect(effectiveChargedAmount(null, null, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feature 005 — envio ao Comercial (research R-09, R-10; data-model §3.3) — tasks.md, T008
// ---------------------------------------------------------------------------

describe('treatmentStatus com o envio ao Comercial (specs/005, R-09)', () => {
  it('linha aberta ou concluída conta como tratativa; retorno confirmado, como comprovante', () => {
    // Quem chama já junta o documento e a planilha (data-model §3.3).
    expect(treatmentStatus({ hasCurrentRequest: true, hasCurrentProof: false })).toBe('sent');
    expect(treatmentStatus({ hasCurrentRequest: true, hasCurrentProof: true })).toBe('charged');
  });

  it('linha concluída porque o Hunit diz "já cobrada", sem comprovante → alerta "Verificar"', () => {
    expect(
      needsReview({
        classification: 'virtual_card_already_charged',
        status: treatmentStatus({ hasCurrentRequest: true, hasCurrentProof: false }),
        statusChangedAt: new Date('2026-11-17T10:00:00Z'),
        lastReviewAt: null,
      }),
    ).toBe(true);
  });
});

describe('detailedSituation (specs/005, R-09)', () => {
  it('"Validar comprovante" só onde a situação seria "Tratativa enviada"', () => {
    expect(detailedSituation('virtual_card_pending_charge', 'sent', true)).toBe('return_pending');
    expect(detailedSituation('virtual_card_pending_charge', 'sent', false)).toBe('treatment_sent');
  });

  it('segue a ordem da spec: comprovante → Hunit sem cobrança → Validar → Tratativa → Hunit', () => {
    expect(detailedSituation('virtual_card_pending_charge', 'charged', true)).toBe('proof_sent');
    expect(detailedSituation('virtual_card_already_charged', 'sent', true)).toBe(
      'virtual_card_already_charged',
    );
    expect(detailedSituation('virtual_card_pending_charge', 'none', false)).toBe(
      'virtual_card_pending_charge',
    );
  });

  it('é igual a reservationSituation sem retorno aguardando', () => {
    for (const classification of CLASSIFICATIONS) {
      for (const status of TREATMENT_STATUSES) {
        expect(detailedSituation(classification, status, false)).toBe(
          reservationSituation(classification, status),
        );
      }
    }
  });

  it('"Validar comprovante" continua em "Falta cobrar" (clarify Q1)', () => {
    expect(isPendingCharge('virtual_card_pending_charge', 'sent')).toBe(true);
  });
});

describe('chargedAmountWithOrigin (specs/005, FR-024, R-10)', () => {
  const none = { hunitAmount: null, manualAmount: null, commercialAmount: null };

  it('ordem: Hunit → manual (com comprovante) → Comercial', () => {
    expect(
      chargedAmountWithOrigin({
        hunitAmount: '100.00',
        manualAmount: '90.00',
        commercialAmount: '80.00',
        hasCurrentProof: true,
      }),
    ).toEqual({ amount: '100.00', origin: 'hunit' });
    expect(
      chargedAmountWithOrigin({
        ...none,
        manualAmount: '90.00',
        commercialAmount: '80.00',
        hasCurrentProof: true,
      }),
    ).toEqual({ amount: '90.00', origin: 'manual' });
    expect(
      chargedAmountWithOrigin({ ...none, commercialAmount: '80.00', hasCurrentProof: true }),
    ).toEqual({ amount: '80.00', origin: 'commercial' });
  });

  it('manual sem comprovante não vale; sem nenhum valor, nada', () => {
    expect(
      chargedAmountWithOrigin({ ...none, manualAmount: '90.00', hasCurrentProof: false }),
    ).toEqual({ amount: null, origin: null });
    expect(chargedAmountWithOrigin({ ...none, hasCurrentProof: true })).toEqual({
      amount: null,
      origin: null,
    });
  });

  it('zero do Hunit (cartão só validado) não é valor cobrado: vale o manual ou o do Comercial', () => {
    expect(
      chargedAmountWithOrigin({
        ...none,
        hunitAmount: '0.00',
        commercialAmount: '80.00',
        hasCurrentProof: true,
      }),
    ).toEqual({ amount: '80.00', origin: 'commercial' });
    expect(
      chargedAmountWithOrigin({
        ...none,
        hunitAmount: '0.00',
        manualAmount: '90.00',
        hasCurrentProof: true,
      }),
    ).toEqual({ amount: '90.00', origin: 'manual' });
    expect(
      chargedAmountWithOrigin({ ...none, hunitAmount: '0.00', hasCurrentProof: true }),
    ).toEqual({
      amount: null,
      origin: null,
    });
    expect(effectiveChargedAmount('0.00', '90.00', true)).toBe('90.00');
    expect(effectiveChargedAmount('0.01', '90.00', true)).toBe('0.01');
  });

  it('o valor é o mesmo de effectiveChargedAmount quando não há valor do Comercial', () => {
    expect(
      chargedAmountWithOrigin({ ...none, manualAmount: '90.00', hasCurrentProof: true }).amount,
    ).toBe(effectiveChargedAmount(null, '90.00', true));
  });
});

describe('lineState (specs/005, FR-009, data-model §3.3)', () => {
  it('cancelada continua cancelada', () => {
    expect(
      lineState({
        cancelled: true,
        classification: 'virtual_card_pending_charge',
        hasCurrentProof: false,
      }),
    ).toBe('cancelled');
  });

  it('concluída com comprovante ou quando a classificação não aceita mais tratativa', () => {
    expect(
      lineState({
        cancelled: false,
        classification: 'virtual_card_pending_charge',
        hasCurrentProof: true,
      }),
    ).toBe('concluded');
    for (const classification of CLASSIFICATIONS) {
      expect(
        lineState({ cancelled: false, classification, hasCurrentProof: false }),
        classification,
      ).toBe(acceptsTreatment(classification) ? 'open' : 'concluded');
    }
  });

  it('volta a aberta quando o Hunit volta a exigir cobrança ou a confirmação é desfeita', () => {
    expect(
      lineState({
        cancelled: false,
        classification: 'virtual_card_charge_error',
        hasCurrentProof: false,
      }),
    ).toBe('open');
  });
});
