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
  effectiveChargedAmount,
  isPendingCharge,
  isRevertible,
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
