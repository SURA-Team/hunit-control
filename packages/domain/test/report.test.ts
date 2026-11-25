/**
 * Relatórios do período (specs/007, T004; data-model §1): faixas de cada situação com e sem
 * tratativa, valor de cada faixa, percentuais da distribuição e atalhos do período.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_EXCLUDED_SITUATIONS,
  distributionPercentages,
  reportAmount,
  reportBucket,
  reportMissingAmount,
  reportPeriod,
  reportShortcutOf,
  type ReportBucket,
} from '../src/report.js';
import {
  detailedSituation,
  effectiveClassification,
  isPendingCharge,
  type ReservationDetailedSituation,
  type TreatmentStatus,
} from '../src/treatment.js';
import { CLASSIFICATIONS, type Classification } from '../src/types.js';

/** Monta a entrada como o servidor: a situação e "Falta cobrar" saem das regras que já existem. */
function bucketOf(input: {
  classification: Classification;
  status: TreatmentStatus;
  hasRequest: boolean;
  hasReturnAwaiting?: boolean;
  noChargeMarked?: boolean;
}): { situation: ReservationDetailedSituation; bucket: ReportBucket } {
  const classification = effectiveClassification(
    input.classification,
    input.noChargeMarked ?? false,
  );
  const situation = detailedSituation(
    classification,
    input.status,
    input.hasReturnAwaiting ?? false,
  );
  const bucket = reportBucket({
    detailedSituation: situation,
    pendingCharge: isPendingCharge(classification, input.status),
    hasRequest: input.hasRequest,
  });
  return { situation, bucket };
}

describe('reportBucket (FR-008a, FR-012, FR-014)', () => {
  const pendingClassifications: Classification[] = [
    'virtual_card_pending_charge',
    'charge_at_terminal',
    'virtual_card_validated_only',
    'virtual_card_charge_error',
    'analysis_error',
  ];

  it.each(pendingClassifications)('%s sem tratativa → pendente', (classification) => {
    expect(bucketOf({ classification, status: 'none', hasRequest: false })).toEqual({
      situation: classification,
      bucket: 'pending',
    });
  });

  it.each(pendingClassifications)(
    '%s com tratativa → solicitado (Tratativa enviada)',
    (classification) => {
      expect(bucketOf({ classification, status: 'sent', hasRequest: true })).toEqual({
        situation: 'treatment_sent',
        bucket: 'requested',
      });
    },
  );

  it('"Validar comprovante" → solicitado', () => {
    expect(
      bucketOf({
        classification: 'virtual_card_pending_charge',
        status: 'sent',
        hasRequest: true,
        hasReturnAwaiting: true,
      }),
    ).toEqual({ situation: 'return_pending', bucket: 'requested' });
  });

  it('"Comprovante enviado" com tratativa → recuperado; sem tratativa → cobrado anteriormente', () => {
    expect(
      bucketOf({
        classification: 'virtual_card_pending_charge',
        status: 'charged',
        hasRequest: true,
      }),
    ).toEqual({ situation: 'proof_sent', bucket: 'recovered' });
    expect(
      bucketOf({
        classification: 'virtual_card_charge_error',
        status: 'charged',
        hasRequest: false,
      }),
    ).toEqual({ situation: 'proof_sent', bucket: 'previous_charged' });
  });

  it('"Já cobrada" sem tratativa → cobrado anteriormente; o Hunit mostrou depois da tratativa → recuperado', () => {
    expect(
      bucketOf({
        classification: 'virtual_card_already_charged',
        status: 'none',
        hasRequest: false,
      }),
    ).toEqual({ situation: 'virtual_card_already_charged', bucket: 'previous_charged' });
    expect(
      bucketOf({
        classification: 'virtual_card_already_charged',
        status: 'sent',
        hasRequest: true,
      }),
    ).toEqual({ situation: 'virtual_card_already_charged', bucket: 'recovered' });
  });

  it('"Cancelada sem cobrança" (do Hunit ou marcada) → conta, sem valor', () => {
    expect(
      bucketOf({ classification: 'cancelled_no_charge', status: 'none', hasRequest: false }).bucket,
    ).toBe('none');
    expect(
      bucketOf({
        classification: 'virtual_card_pending_charge',
        status: 'sent',
        hasRequest: true,
        noChargeMarked: true,
      }),
    ).toEqual({ situation: 'cancelled_no_charge', bucket: 'none' });
  });

  it.each(['ignored_hotelbeds_258', 'invoiced', 'not_virtual_card'] as const)(
    '%s fica fora do relatório, com ou sem tratativa',
    (classification) => {
      expect(bucketOf({ classification, status: 'none', hasRequest: false }).bucket).toBe(
        'excluded',
      );
      expect(bucketOf({ classification, status: 'sent', hasRequest: true }).bucket).toBe(
        'excluded',
      );
    },
  );

  it('"A revisar (sistema anterior)" com comprovante passa a "Comprovante enviado" e entra', () => {
    expect(
      bucketOf({ classification: 'not_virtual_card', status: 'charged', hasRequest: false }),
    ).toEqual({ situation: 'proof_sent', bucket: 'previous_charged' });
  });

  it('as excluídas são exatamente as três do FR-008a', () => {
    expect([...REPORT_EXCLUDED_SITUATIONS].sort()).toEqual([
      'ignored_hotelbeds_258',
      'invoiced',
      'not_virtual_card',
    ]);
  });

  it('toda classificação × situação da tratativa cai numa faixa definida', () => {
    const statuses: TreatmentStatus[] = ['none', 'sent', 'charged'];
    for (const classification of CLASSIFICATIONS) {
      for (const status of statuses) {
        const { bucket } = bucketOf({ classification, status, hasRequest: status !== 'none' });
        expect([
          'previous_charged',
          'recovered',
          'pending',
          'requested',
          'none',
          'excluded',
        ]).toContain(bucket);
      }
    }
  });
});

describe('reportAmount (data-model §1.3)', () => {
  const amounts = { amountToCharge: '655.00', chargedAmount: '650.00', totalAmount: '655.00' };

  it('em aberto vale o valor a cobrar', () => {
    expect(reportAmount('pending', amounts)).toBe('655.00');
    expect(reportAmount('requested', { ...amounts, amountToCharge: null })).toBeNull();
  });

  it('cobrada vale o valor cobrado exibido; sem ele, o total', () => {
    expect(reportAmount('recovered', amounts)).toBe('650.00');
    expect(reportAmount('previous_charged', { ...amounts, chargedAmount: null })).toBe('655.00');
    expect(
      reportAmount('previous_charged', {
        amountToCharge: null,
        chargedAmount: null,
        totalAmount: null,
      }),
    ).toBeNull();
  });

  it('sem faixa de valor, nada', () => {
    expect(reportAmount('none', amounts)).toBeNull();
    expect(reportAmount('excluded', amounts)).toBeNull();
  });

  it('"sem valor" só conta nas quatro faixas', () => {
    expect(reportMissingAmount('pending', null)).toBe(true);
    expect(reportMissingAmount('pending', '1.00')).toBe(false);
    expect(reportMissingAmount('none', null)).toBe(false);
  });
});

describe('distributionPercentages (FR-016)', () => {
  it('uma casa, somando 100 pelo maior resto', () => {
    // Valores do design (8.1): 96,6 %, 1,9 %, 1,0 %, 0,5 %.
    const shares = distributionPercentages([13_323_685.89, 257_257.99, 137_232.32, 73_888.15]);
    expect(shares.map((share) => share.percent)).toEqual([96.6, 1.9, 1, 0.5]);
    expect(shares.reduce((sum, share) => sum + share.percent * 10, 0)).toBe(1000);
  });

  it('três partes iguais somam 100', () => {
    const shares = distributionPercentages([1, 1, 1]);
    expect(shares.map((share) => share.percent)).toEqual([33.4, 33.3, 33.3]);
  });

  it('fatia menor que 0,1 % fica marcada (exibida "<0,1%")', () => {
    const shares = distributionPercentages([999_999, 1, 0]);
    expect(shares[1]?.belowMinimum).toBe(true);
    expect(shares[2]).toEqual({ percent: 0, belowMinimum: false });
    expect(shares.reduce((sum, share) => sum + Math.round(share.percent * 10), 0)).toBe(1000);
  });

  it('base zero → todos 0', () => {
    expect(distributionPercentages([0, 0])).toEqual([
      { percent: 0, belowMinimum: false },
      { percent: 0, belowMinimum: false },
    ]);
  });
});

describe('reportPeriod e reportShortcutOf (data-model §1.5)', () => {
  it('últimos 7 e 30 dias contam hoje', () => {
    expect(reportPeriod('last_7_days', '2026-11-25')).toEqual({
      from: '2026-11-19',
      to: '2026-11-25',
    });
    expect(reportPeriod('last_30_days', '2026-11-25')).toEqual({
      from: '2026-10-27',
      to: '2026-11-25',
    });
  });

  it('virada de ano', () => {
    expect(reportPeriod('last_7_days', '2027-01-03')).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    });
  });

  it('este mês vai do dia 1 ao último dia, inclusive fevereiro bissexto', () => {
    expect(reportPeriod('this_month', '2026-11-25')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(reportPeriod('this_month', '2028-02-10')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(reportPeriod('this_month', '2026-12-31')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('reconhece o atalho igual ao período; o resto é personalizado', () => {
    expect(reportShortcutOf({ from: '2026-10-27', to: '2026-11-25' }, '2026-11-25')).toBe(
      'last_30_days',
    );
    expect(reportShortcutOf({ from: '2026-11-01', to: '2026-11-30' }, '2026-11-25')).toBe(
      'this_month',
    );
    expect(reportShortcutOf({ from: '2026-11-13', to: '2026-11-19' }, '2026-11-25')).toBe('custom');
  });
});
