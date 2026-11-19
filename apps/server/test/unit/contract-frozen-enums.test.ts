/**
 * Enumerações do contrato que o app desktop em uso (até a API 1.6.0) usa como chave de rótulos
 * (specs/005, T005, research R-09). O app faz `SITUATION_LABELS[treatment.situation]` e quebra a
 * tela com um valor que não conhece; por isso a 1.7.0 só acrescenta valores em campos novos
 * (`detailedSituation`, histórico do Comercial em lista própria), nunca nestes. A 1.8.0 (specs/006)
 * também só acrescenta (enums novos `ReservationQuickFilter` e `ReservationOrder`), e o app 0.2, que
 * usa `detailedSituation` como chave, continua conhecendo todos os valores.
 */
import { describe, expect, it } from 'vitest';
import { contractDocument } from '../helpers/contract.js';

type SchemaMap = Record<
  string,
  { enum?: string[]; properties?: Record<string, { enum?: string[] }> }
>;

const schemas = contractDocument.components?.['schemas'] as SchemaMap;

/** `ReservationSituation` como a 1.6.0 entregou. */
const SITUATIONS_1_6_0 = [
  'proof_sent',
  'treatment_sent',
  'ignored_hotelbeds_258',
  'invoiced',
  'charge_at_terminal',
  'cancelled_no_charge',
  'not_virtual_card',
  'virtual_card_charge_error',
  'virtual_card_already_charged',
  'virtual_card_validated_only',
  'virtual_card_pending_charge',
  'analysis_error',
];

/** `TreatmentEvent.type` como a 1.6.0 entregou. */
const TREATMENT_EVENT_TYPES_1_6_0 = [
  'attached',
  'replaced',
  'removed',
  'reverted',
  'amount_set',
  'amount_cleared',
  'review_confirmed',
];

/** `TreatmentStatus` como a 1.6.0 entregou. */
const TREATMENT_STATUSES_1_6_0 = ['none', 'sent', 'charged'];

describe('enumerações usadas pelo app atual não ganham valores (specs/005, R-09)', () => {
  it('ReservationSituation continua igual à 1.6.0', () => {
    expect(schemas['ReservationSituation']?.enum).toEqual(SITUATIONS_1_6_0);
  });

  it('TreatmentEvent.type continua igual à 1.6.0', () => {
    expect(schemas['TreatmentEvent']?.properties?.['type']?.enum).toEqual(
      TREATMENT_EVENT_TYPES_1_6_0,
    );
  });

  it('TreatmentStatus continua igual à 1.6.0', () => {
    expect(schemas['TreatmentStatus']?.enum).toEqual(TREATMENT_STATUSES_1_6_0);
  });

  it('ReservationDetailedSituation = ReservationSituation + return_pending', () => {
    expect(schemas['ReservationDetailedSituation']?.enum).toEqual([
      'return_pending',
      ...SITUATIONS_1_6_0,
    ]);
  });

  it('a versão do contrato é a 1.8.0', () => {
    expect((contractDocument['info'] as { version?: string } | undefined)?.version).toBe('1.8.0');
  });
});
