/**
 * Elegibilidade do envio ao Comercial, desfecho da verificação e desfazer/reverter a linha
 * (specs/005, FR-003, FR-005, research R-11; data-model §3.1) — tasks.md, T007.
 */
import { describe, expect, it } from 'vitest';
import {
  canCancelLine,
  canRestoreLine,
  dispatchEligibility,
  dispatchOutcome,
  lineRestoreDeadline,
} from '../src/commercial-dispatch.js';
import { acceptsTreatment, requiresCharge, TREATMENT_REVERT_DAYS } from '../src/treatment.js';
import { CLASSIFICATIONS } from '../src/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const base = {
  classification: 'virtual_card_pending_charge' as const,
  hasCurrentProof: false,
  hasReturnAwaiting: false,
  lineState: null,
};

describe('dispatchEligibility (FR-003)', () => {
  it('aceita as classificações que aceitam tratativa, inclusive "A revisar (sistema anterior)"', () => {
    for (const classification of CLASSIFICATIONS) {
      const result = dispatchEligibility({ ...base, classification });
      expect(result.eligible, classification).toBe(acceptsTreatment(classification));
    }
    expect(dispatchEligibility({ ...base, classification: 'not_virtual_card' }).eligible).toBe(
      true,
    );
  });

  it('recusa com o motivo', () => {
    expect(dispatchEligibility({ ...base, classification: null })).toEqual({
      eligible: false,
      reason: 'not_found',
    });
    expect(
      dispatchEligibility({ ...base, classification: 'virtual_card_already_charged' }),
    ).toEqual({ eligible: false, reason: 'not_accepting' });
    expect(dispatchEligibility({ ...base, hasCurrentProof: true })).toEqual({
      eligible: false,
      reason: 'has_proof',
    });
    expect(dispatchEligibility({ ...base, hasReturnAwaiting: true })).toEqual({
      eligible: false,
      reason: 'return_awaiting_validation',
    });
  });

  it('marcada como cancelada sem cobrança não vai ao Comercial (specs/008)', () => {
    expect(dispatchEligibility({ ...base, noChargeMarked: true })).toEqual({
      eligible: false,
      reason: 'not_accepting',
    });
  });

  it('reserva já na planilha é um reenvio; nunca enviada, não', () => {
    expect(dispatchEligibility(base)).toEqual({ eligible: true, resend: false });
    expect(dispatchEligibility({ ...base, lineState: 'open' })).toEqual({
      eligible: true,
      resend: true,
    });
    expect(dispatchEligibility({ ...base, lineState: 'cancelled' })).toEqual({
      eligible: true,
      resend: true,
    });
  });
});

describe('dispatchOutcome (FR-005)', () => {
  it('enviada se a classificação lida ainda exige cobrança; senão retirada com a classificação', () => {
    for (const classification of CLASSIFICATIONS) {
      const expected = requiresCharge(classification)
        ? { outcome: 'sent' }
        : { outcome: 'withdrawn', classification };
      expect(dispatchOutcome(classification), classification).toEqual(expected);
    }
  });

  it('"faturada" e "cancelada sem cobrança" são retiradas, como "já cobrada"', () => {
    expect(dispatchOutcome('invoiced').outcome).toBe('withdrawn');
    expect(dispatchOutcome('cancelled_no_charge').outcome).toBe('withdrawn');
    expect(dispatchOutcome('virtual_card_already_charged').outcome).toBe('withdrawn');
  });
});

describe('desfazer e reverter o envio (research R-11, clarify Q2)', () => {
  const cancelledAt = new Date('2026-11-17T12:00:00Z');

  it('desfazer só com linha aberta e sem retorno aguardando validação', () => {
    expect(canCancelLine({ state: 'open', hasReturnAwaiting: false })).toBe('ok');
    expect(canCancelLine({ state: 'open', hasReturnAwaiting: true })).toBe(
      'return_awaiting_validation',
    );
    expect(canCancelLine({ state: 'concluded', hasReturnAwaiting: false })).toBe('not_open');
    expect(canCancelLine({ state: 'cancelled', hasReturnAwaiting: false })).toBe('not_open');
    expect(canCancelLine({ state: null, hasReturnAwaiting: false })).toBe('not_open');
  });

  it(`reverter só linha cancelada, até ${TREATMENT_REVERT_DAYS} dias, e com a reserva ainda elegível`, () => {
    const deadline = lineRestoreDeadline(cancelledAt);
    expect(deadline.getTime() - cancelledAt.getTime()).toBe(TREATMENT_REVERT_DAYS * DAY_MS);

    const line = { state: 'cancelled' as const, cancelledAt };
    const before = new Date(deadline.getTime() - 1);
    expect(canRestoreLine(line, 'virtual_card_pending_charge', before)).toBe('ok');
    expect(canRestoreLine(line, 'virtual_card_pending_charge', deadline)).toBe('expired');
    expect(canRestoreLine(line, 'virtual_card_already_charged', before)).toBe('not_eligible');
    expect(
      canRestoreLine({ state: 'open', cancelledAt: null }, 'virtual_card_pending_charge', before),
    ).toBe('not_cancelled');
  });
});
