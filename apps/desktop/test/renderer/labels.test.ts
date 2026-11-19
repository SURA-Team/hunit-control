/**
 * Tabela de apresentação (specs/002, T029, FR-023, data-model §6): todo valor dos enums da API tem
 * nome (ou mensagem) em português e tom. Lê os enums do próprio contrato: se o servidor ganhar um
 * valor novo, este teste falha até o app dar nome e tom a ele.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import contractSource from '../../../../packages/contracts/openapi.yaml?raw';
import { BADGE_TONES } from '../../src/renderer/src/presentation/reservations.js';
import {
  CLASSIFICATION_LABELS,
  DISPATCH_STATUS_LABELS,
  CLASSIFICATION_ORDER,
  DOCUMENT_STATE_LABELS,
  END_REASON_MESSAGES,
  ERROR_MESSAGES,
  EXECUTION_STATUS_LABELS,
  HOTEL_STATUS_LABELS,
  OUTCOME_NAMES,
  OUTCOME_REASON_MESSAGES,
  RESERVATION_STATUS_LABELS,
  REVIEW_LABEL,
  DETAILED_SITUATION_LABELS,
  LINE_STATE_LABELS,
  RETURN_STATE_LABELS,
  SITUATION_LABELS,
  SITUATION_ORDER,
  TONES,
  TREATMENT_EVENT_NAMES,
  TREATMENT_KIND_NAMES,
  TREATMENT_STATUS_LABELS,
} from '../../src/renderer/src/presentation/labels.js';

interface Schema {
  enum?: string[];
  properties?: Record<string, Schema>;
}
const contract = parse(contractSource) as { components: { schemas: Record<string, Schema> } };
const schemas = contract.components.schemas;

function enumOf(name: string): string[] {
  const values = schemas[name]?.enum;
  if (!values) throw new Error(`o contrato não tem o enum ${name}`);
  return values;
}

describe('todo valor dos enums da API tem nome e tom', () => {
  it.each([
    ['Classification', CLASSIFICATION_LABELS],
    ['ReservationStatus', RESERVATION_STATUS_LABELS],
    ['ExecutionStatus', EXECUTION_STATUS_LABELS],
    ['HotelRunStatus', HOTEL_STATUS_LABELS],
    // Tratativas manuais (specs/003, data-model §7).
    ['TreatmentStatus', TREATMENT_STATUS_LABELS],
    ['TreatmentDocumentState', DOCUMENT_STATE_LABELS],
    ['ReservationSituation', SITUATION_LABELS],
    ['ReservationDetailedSituation', DETAILED_SITUATION_LABELS],
    ['CommercialLineState', LINE_STATE_LABELS],
    ['CommercialReturnState', RETURN_STATE_LABELS],
  ] as const)('%s', (name, labels) => {
    const table = labels as Record<string, { name: string; tone: string }>;
    for (const value of enumOf(name)) {
      expect(table[value]?.name, value).toBeTruthy();
      expect(TONES, value).toContain(table[value]?.tone);
    }
    expect(Object.keys(table).sort()).toEqual([...enumOf(name)].sort());
  });

  it('os enums das tratativas têm nome (specs/003, data-model §7)', () => {
    const named = (table: Record<string, string>, values: Array<string | null>) => {
      const expected = values.filter((value): value is string => value !== null);
      for (const value of expected) expect(table[value], value).toBeTruthy();
      expect(Object.keys(table).sort()).toEqual([...expected].sort());
    };
    const property = (schema: string, name: string) =>
      (schemas[schema]?.properties?.[name]?.enum ?? []) as Array<string | null>;

    named(TREATMENT_KIND_NAMES, enumOf('TreatmentDocumentKind'));
    named(TREATMENT_EVENT_NAMES, property('TreatmentEvent', 'type'));
    named(OUTCOME_NAMES, property('ReservationOutcome', 'outcome'));
    named(OUTCOME_REASON_MESSAGES, property('ReservationOutcome', 'reason'));
  });

  it('as situações da tratativa têm os nomes da spec 003', () => {
    expect(TREATMENT_STATUS_LABELS.none.name).toBe('Sem tratativa');
    expect(TREATMENT_STATUS_LABELS.sent.name).toBe('Tratativa enviada');
    expect(TREATMENT_STATUS_LABELS.charged.name).toBe('Comprovante enviado');
    expect(TREATMENT_KIND_NAMES).toEqual({ request: 'Tratativa', proof: 'Comprovante' });
  });

  it('a situação da reserva tem os nomes da homologação (FR-002, FR-002a)', () => {
    expect(SITUATION_LABELS.treatment_sent.name).toBe('Tratativa enviada');
    expect(SITUATION_LABELS.proof_sent.name).toBe('Comprovante enviado');
    expect(SITUATION_LABELS.virtual_card_already_charged.name).toBe('Já cobrada');
    // Desde a 005, o filtro usa a situação detalhada: "Validar comprovante" depois de "Tratativa
    // enviada" (specs/005, FR-023).
    expect([...SITUATION_ORDER].sort()).toEqual([...enumOf('ReservationDetailedSituation')].sort());
    expect(SITUATION_ORDER.indexOf('return_pending')).toBe(
      SITUATION_ORDER.indexOf('treatment_sent') + 1,
    );
    expect(REVIEW_LABEL.name).toBe('Verificar');
    expect(TREATMENT_EVENT_NAMES.review_confirmed).toBe('Confirmou a verificação');
  });

  it('ExecutionEndReason tem mensagem', () => {
    const messages = END_REASON_MESSAGES as Record<string, string>;
    for (const value of enumOf('ExecutionEndReason')) {
      expect(messages[value], value).toBeTruthy();
    }
  });

  it('todo Problem.code da API tem mensagem', () => {
    const codes = schemas['Problem']?.properties?.['code']?.enum ?? [];
    const messages = ERROR_MESSAGES as Record<string, string>;
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(messages[code], code).toBeTruthy();
  });

  it('os códigos do próprio app também têm mensagem', () => {
    for (const code of [
      'offline',
      'untrusted_server',
      'not_configured',
      'credentials_missing',
      'credentials_expired',
      'key_storage_unavailable',
      'invalid_input',
    ] as const) {
      expect(ERROR_MESSAGES[code], code).toBeTruthy();
    }
  });
});

describe('situações de cobrança (data-model §6.1)', () => {
  it('têm exatamente os nomes da spec 001', () => {
    const names = Object.fromEntries(
      Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => [value, label.name]),
    );

    expect(names).toEqual({
      virtual_card_already_charged: 'Já cobrada',
      invoiced: 'Faturada',
      virtual_card_pending_charge: 'Pendente de cobrança',
      virtual_card_validated_only: 'Cartão validado (não cobrado)',
      charge_at_terminal: 'Cobrar na maquininha',
      virtual_card_charge_error: 'Erro na cobrança',
      analysis_error: 'Erro de análise',
      cancelled_no_charge: 'Cancelada sem cobrança',
      ignored_hotelbeds_258: 'Ignorada (Hotelbeds 258)',
      not_virtual_card: 'A revisar (sistema anterior)',
    });
  });

  it('"A revisar (sistema anterior)" pede atenção e vem logo depois das que pedem ação (specs/004)', () => {
    expect(CLASSIFICATION_LABELS.not_virtual_card.tone).toBe('warning');
    expect(CLASSIFICATION_ORDER.indexOf('not_virtual_card')).toBe(
      CLASSIFICATION_ORDER.indexOf('analysis_error') + 1,
    );
    expect(SITUATION_ORDER.indexOf('not_virtual_card')).toBe(
      SITUATION_ORDER.indexOf('analysis_error') + 1,
    );
  });

  it('pendentes em atenção, cobradas em sucesso, erros em erro', () => {
    expect(CLASSIFICATION_LABELS.virtual_card_pending_charge.tone).toBe('warning');
    expect(CLASSIFICATION_LABELS.virtual_card_already_charged.tone).toBe('success');
    expect(CLASSIFICATION_LABELS.analysis_error.tone).toBe('error');
  });
});

describe('tons de significado fixo (specs/006, T060, FR-005)', () => {
  it('cada tom vira a cor do design: verde, âmbar, vermelho, lima e cinza', () => {
    expect(BADGE_TONES).toEqual({
      success: 'green',
      warning: 'amber',
      error: 'red',
      progress: 'lime',
      info: 'gray',
      neutral: 'gray',
    });
  });

  it('"Em andamento" e "A cobrar" em lima; concluído em verde; falha em vermelho', () => {
    const tone = (label: { tone: string }) => BADGE_TONES[label.tone as keyof typeof BADGE_TONES];
    for (const label of [
      EXECUTION_STATUS_LABELS.running,
      HOTEL_STATUS_LABELS.running,
      DISPATCH_STATUS_LABELS.running,
      LINE_STATE_LABELS.open,
    ]) {
      expect(tone(label), label.name).toBe('lime');
    }
    for (const label of [
      EXECUTION_STATUS_LABELS.completed,
      HOTEL_STATUS_LABELS.completed,
      DISPATCH_STATUS_LABELS.completed,
      DOCUMENT_STATE_LABELS.current,
    ]) {
      expect(tone(label), label.name).toBe('green');
    }
    for (const label of [EXECUTION_STATUS_LABELS.failed, HOTEL_STATUS_LABELS.failed]) {
      expect(tone(label), label.name).toBe('red');
    }
    expect(tone(EXECUTION_STATUS_LABELS.awaiting_2fa)).toBe('amber');
    expect(tone(REVIEW_LABEL)).toBe('amber');
  });

  it('os nomes ficam como escritos: a caixa alta é do estilo do selo, não do texto', () => {
    for (const label of Object.values(DETAILED_SITUATION_LABELS)) {
      expect(label.name, label.name).not.toBe(label.name.toUpperCase());
    }
  });
});
