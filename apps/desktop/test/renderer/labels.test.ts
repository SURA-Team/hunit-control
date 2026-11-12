/**
 * Tabela de apresentação (specs/002, T029, FR-023, data-model §6): todo valor dos enums da API tem
 * nome (ou mensagem) em português e tom. Lê os enums do próprio contrato: se o servidor ganhar um
 * valor novo, este teste falha até o app dar nome e tom a ele.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import contractSource from '../../../../packages/contracts/openapi.yaml?raw';
import {
  CLASSIFICATION_LABELS,
  END_REASON_MESSAGES,
  ERROR_MESSAGES,
  EXECUTION_STATUS_LABELS,
  HOTEL_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
  TONES,
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
  ] as const)('%s', (name, labels) => {
    const table = labels as Record<string, { name: string; tone: string }>;
    for (const value of enumOf(name)) {
      expect(table[value]?.name, value).toBeTruthy();
      expect(TONES, value).toContain(table[value]?.tone);
    }
    expect(Object.keys(table).sort()).toEqual([...enumOf(name)].sort());
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
      not_virtual_card: 'Não é cartão virtual (situação antiga)',
    });
  });

  it('pendentes em atenção, cobradas em sucesso, erros em erro', () => {
    expect(CLASSIFICATION_LABELS.virtual_card_pending_charge.tone).toBe('warning');
    expect(CLASSIFICATION_LABELS.virtual_card_already_charged.tone).toBe('success');
    expect(CLASSIFICATION_LABELS.analysis_error.tone).toBe('error');
  });
});
