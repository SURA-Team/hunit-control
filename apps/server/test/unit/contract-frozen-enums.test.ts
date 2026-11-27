/**
 * Enumerações do contrato que o app desktop em uso (até a API 1.6.0) usa como chave de rótulos
 * (specs/005, T005, research R-09). O app faz `SITUATION_LABELS[treatment.situation]` e quebra a
 * tela com um valor que não conhece; por isso a 1.7.0 só acrescenta valores em campos novos
 * (`detailedSituation`, histórico do Comercial em lista própria), nunca nestes. A 1.8.0 (specs/006)
 * também só acrescenta (enums novos `ReservationQuickFilter` e `ReservationOrder`), e o app 0.2, que
 * usa `detailedSituation` como chave, continua conhecendo todos os valores.
 *
 * A 1.9.0 (specs/008, research R-02) congela também, como a 1.8.0 entregou, as enumerações que o
 * app 0.3 usa como chave: `ReservationDetailedSituation` (`DETAILED_SITUATION_LABELS`),
 * `CommercialEvent.type` (`COMMERCIAL_EVENT_NAMES`), `CommercialReturnState`
 * (`RETURN_STATE_LABELS`) e `CommercialSheetProblem.kind` (`SHEET_PROBLEM_NAMES`). Os valores novos
 * da 008 vão em campos novos (`CommercialDetail.history`, `CommercialSheetStatus.reports`…). A única
 * exceção, `CommercialDispatchItem.outcome` + `checked`, só aparece em verificações, que a lista de
 * envios deixa de fora por padrão (teste em commercial-hunit-charges.test.ts).
 *
 * A 1.10.0 (specs/007, research R-01) só acrescenta a rota `/reports/overview` e o valor
 * `amount_desc` em `ReservationOrder`, parâmetro de entrada que o app 0.4 não manda; nenhuma das
 * enumerações congeladas muda. A 1.11.0 (R-14) só acrescenta filtros opcionais ao resumo.
 *
 * A 1.12.0 (specs/009, research R-01 e R-03) acrescenta o retorno com situação livre em campos
 * novos (`situationReturn`, `situationReturns`, `sheetTab`) e uma rota; nenhuma das enumerações
 * congeladas muda.
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

  it('a versão do contrato é a 1.12.0', () => {
    expect((contractDocument['info'] as { version?: string } | undefined)?.version).toBe('1.12.0');
  });
});

/** `CommercialEvent.type` como a 1.8.0 entregou. */
const COMMERCIAL_EVENT_TYPES_1_8_0 = [
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
];

describe('enumerações usadas pelo app 0.3 não ganham valores (specs/008, R-02)', () => {
  it('ReservationDetailedSituation continua igual à 1.8.0', () => {
    expect(schemas['ReservationDetailedSituation']?.enum).toEqual([
      'return_pending',
      ...SITUATIONS_1_6_0,
    ]);
  });

  it('CommercialEvent.type continua igual à 1.8.0', () => {
    expect(schemas['CommercialEvent']?.properties?.['type']?.enum).toEqual(
      COMMERCIAL_EVENT_TYPES_1_8_0,
    );
  });

  it('CommercialReturnState continua igual à 1.8.0', () => {
    expect(schemas['CommercialReturnState']?.enum).toEqual([
      'awaiting_validation',
      'confirmed',
      'rejected',
      'superseded',
      'closed',
    ]);
  });

  it('CommercialSheetProblem.kind continua igual à 1.8.0', () => {
    expect(schemas['CommercialSheetProblem']?.properties?.['kind']?.enum).toEqual([
      'incomplete',
      'illegible',
      'orphan_line',
      'duplicate_line',
      'restored_line',
    ]);
  });

  it('o histórico novo (CommercialHistoryEvent) só acrescenta tipos ao CommercialEvent', () => {
    const history = schemas['CommercialHistoryEvent']?.properties?.['type']?.enum ?? [];
    expect(history.slice(0, COMMERCIAL_EVENT_TYPES_1_8_0.length)).toEqual(
      COMMERCIAL_EVENT_TYPES_1_8_0,
    );
    expect(history.slice(COMMERCIAL_EVENT_TYPES_1_8_0.length)).toEqual([
      'report_received',
      'report_changed',
      'report_cleared',
      'hunit_checked',
      // A "Cancelada" confirmada ou recusada pelo Financeiro (homologação, R-19).
      'cancellation_confirmed',
      'cancellation_rejected',
    ]);
  });
});
