/**
 * Filtros rápidos da lista de reservas (specs/006, FR-016, research R-09, data-model §1) — tasks.md,
 * T025. Os exemplos partem das regras que já existem (`isPendingCharge`, `needsReview`,
 * `detailedSituation`), como o servidor faz ao montar a resposta.
 */
import { describe, expect, it } from 'vitest';
import {
  QUICK_FILTERS,
  QUICK_FILTER_SITUATIONS,
  quickFiltersOf,
  type QuickFilter,
} from '../src/quick-filters.js';
import {
  detailedSituation,
  isPendingCharge,
  needsReview,
  type TreatmentStatus,
} from '../src/treatment.js';
import { CLASSIFICATIONS, type Classification } from '../src/types.js';

interface Example {
  classification: Classification;
  status?: TreatmentStatus;
  /** Retorno do Comercial aguardando a validação do Financeiro (specs/005). */
  returnAwaiting?: boolean;
  /** Ninguém confirmou depois da mudança de situação no Hunit (alerta "Verificar"). */
  unreviewed?: boolean;
}

function groupsOf({
  classification,
  status = 'none',
  returnAwaiting = false,
  unreviewed = false,
}: Example): QuickFilter[] {
  return quickFiltersOf({
    pendingCharge: isPendingCharge(classification, status),
    needsReview: needsReview({
      classification,
      status,
      statusChangedAt: null,
      lastReviewAt: unreviewed ? null : new Date('2026-11-18T12:00:00Z'),
    }),
    detailedSituation: detailedSituation(classification, status, returnAwaiting),
  });
}

describe('quickFiltersOf (data-model §1)', () => {
  it.each<[string, Example, QuickFilter[]]>([
    [
      'pendente de cobrança, sem tratativa',
      { classification: 'virtual_card_pending_charge' },
      ['pending_charge'],
    ],
    [
      'tratativa enviada, sem retorno',
      { classification: 'virtual_card_pending_charge', status: 'sent' },
      ['pending_charge'],
    ],
    [
      '"Validar comprovante": retorno do Comercial aguardando',
      { classification: 'virtual_card_pending_charge', status: 'sent', returnAwaiting: true },
      ['pending_charge', 'to_review'],
    ],
    [
      'tratativa e o Hunit passou a "Já cobrada" (alerta "Verificar")',
      { classification: 'virtual_card_already_charged', status: 'sent', unreviewed: true },
      ['to_review', 'done'],
    ],
    [
      'tratativa e "Já cobrada", alerta já confirmado',
      { classification: 'virtual_card_already_charged', status: 'sent' },
      ['done'],
    ],
    ['"A revisar (sistema anterior)"', { classification: 'not_virtual_card' }, ['to_review']],
    [
      'erro na cobrança, sem comprovante',
      { classification: 'virtual_card_charge_error' },
      ['pending_charge', 'with_error'],
    ],
    [
      'erro de análise, sem comprovante',
      { classification: 'analysis_error' },
      ['pending_charge', 'with_error'],
    ],
    [
      'erro na cobrança com tratativa enviada (a situação passa a "Tratativa enviada")',
      { classification: 'virtual_card_charge_error', status: 'sent' },
      ['pending_charge'],
    ],
    [
      'cobrar na maquininha, sem comprovante',
      { classification: 'charge_at_terminal' },
      ['pending_charge'],
    ],
    [
      'cartão só validado, sem comprovante',
      { classification: 'virtual_card_validated_only' },
      ['pending_charge'],
    ],
    ['faturada, sem tratativa', { classification: 'invoiced' }, ['done']],
    [
      'já cobrada no Hunit, sem tratativa',
      { classification: 'virtual_card_already_charged' },
      ['done'],
    ],
    ['cancelada sem cobrança', { classification: 'cancelled_no_charge' }, ['done']],
    ['ignorada (Hotelbeds 258)', { classification: 'ignored_hotelbeds_258' }, ['done']],
    [
      'comprovante enviado',
      { classification: 'virtual_card_pending_charge', status: 'charged' },
      ['done'],
    ],
    [
      'comprovante enviado numa "A revisar (sistema anterior)"',
      { classification: 'not_virtual_card', status: 'charged' },
      ['done'],
    ],
  ])('%s', (_, example, expected) => {
    expect(groupsOf(example)).toEqual(expected);
  });

  it('pelas regras atuais, toda reserva cai em pelo menos um grupo', () => {
    for (const classification of CLASSIFICATIONS) {
      for (const status of ['none', 'sent', 'charged'] as const) {
        for (const returnAwaiting of [false, true]) {
          for (const unreviewed of [false, true]) {
            const groups = groupsOf({ classification, status, returnAwaiting, unreviewed });
            expect(groups.length, `${classification}/${status}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('os grupos saem sempre na ordem dos filtros rápidos, sem repetir', () => {
    const groups = quickFiltersOf({
      pendingCharge: true,
      needsReview: true,
      detailedSituation: 'return_pending',
    });
    expect(groups).toEqual(['pending_charge', 'to_review']);
    expect(QUICK_FILTERS).toEqual(['pending_charge', 'to_review', 'with_error', 'done']);
  });
});

describe('QUICK_FILTER_SITUATIONS (as listas que o servidor usa no SQL)', () => {
  it('cada situação está em no máximo um grupo, e as listas batem com quickFiltersOf', () => {
    const situations = Object.values(QUICK_FILTER_SITUATIONS).flat();
    expect(new Set(situations).size).toBe(situations.length);

    for (const [group, list] of Object.entries(QUICK_FILTER_SITUATIONS)) {
      for (const situation of list) {
        expect(
          quickFiltersOf({
            pendingCharge: false,
            needsReview: false,
            detailedSituation: situation,
          }),
        ).toEqual([group]);
      }
    }
  });

  it('as listas da spec', () => {
    expect(QUICK_FILTER_SITUATIONS).toEqual({
      to_review: ['return_pending', 'not_virtual_card'],
      with_error: ['virtual_card_charge_error', 'analysis_error'],
      done: [
        'proof_sent',
        'ignored_hotelbeds_258',
        'invoiced',
        'cancelled_no_charge',
        'virtual_card_already_charged',
      ],
    });
  });
});
