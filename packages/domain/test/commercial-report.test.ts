/**
 * Fila "Cobradas no Hunit" (specs/008, US3; research R-07; data-model §3.4) — tasks.md, T020.
 */
import { describe, expect, it } from 'vitest';
import {
  HUNIT_QUEUE_CONFIRMED_DAYS,
  hunitChargeStatus,
  hunitCheckTargets,
  inHunitQueue,
  isHunitCheckTarget,
  type HunitChargeStatus,
} from '../src/commercial-report.js';
import { hunitCheckResult } from '../src/commercial-dispatch.js';
import { CLASSIFICATIONS } from '../src/types.js';

const READ_AT = new Date('2026-11-18T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('hunitChargeStatus', () => {
  it('não lida no Hunit depois do relato: aguardando (mesmo instante também)', () => {
    for (const lastVerifiedAt of [new Date(READ_AT.getTime() - DAY), READ_AT]) {
      expect(
        hunitChargeStatus({
          readAt: READ_AT,
          lastVerifiedAt,
          hunitClassification: 'virtual_card_already_charged',
        }),
      ).toBe('awaiting');
    }
  });

  it('lida depois e o Hunit mostra a cobrança: confirmada', () => {
    expect(
      hunitChargeStatus({
        readAt: READ_AT,
        lastVerifiedAt: new Date(READ_AT.getTime() + 1),
        hunitClassification: 'virtual_card_already_charged',
      }),
    ).toBe('confirmed');
  });

  it('lida depois e o Hunit não mostra a cobrança: não encontrada, qualquer que seja a classificação', () => {
    for (const hunitClassification of CLASSIFICATIONS.filter(
      (classification) => classification !== 'virtual_card_already_charged',
    )) {
      expect(
        hunitChargeStatus({
          readAt: READ_AT,
          lastVerifiedAt: new Date(READ_AT.getTime() + DAY),
          hunitClassification,
        }),
        hunitClassification,
      ).toBe('not_found');
    }
  });
});

describe('inHunitQueue (FR-013)', () => {
  const now = new Date('2026-11-30T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

  it('aguardando fica sempre', () => {
    expect(
      inHunitQueue({ status: 'awaiting', requiresChargeNow: false, settledAt: daysAgo(90), now }),
    ).toBe(true);
  });

  it('não encontrada que ainda exige cobrança fica sempre', () => {
    expect(
      inHunitQueue({ status: 'not_found', requiresChargeNow: true, settledAt: daysAgo(90), now }),
    ).toBe(true);
  });

  it(`confirmada e não encontrada que não exige mais cobrança saem ${HUNIT_QUEUE_CONFIRMED_DAYS} dias depois`, () => {
    for (const status of ['confirmed', 'not_found'] as const) {
      expect(inHunitQueue({ status, requiresChargeNow: false, settledAt: daysAgo(7), now })).toBe(
        true,
      );
      expect(
        inHunitQueue({
          status,
          requiresChargeNow: false,
          settledAt: new Date(daysAgo(7).getTime() - 1),
          now,
        }),
      ).toBe(false);
    }
  });
});

describe('"Verificar agora": quem é conferido (FR-014)', () => {
  it('aguardando e não encontradas que ainda exigem cobrança; as outras, não', () => {
    const items: Array<{ id: number; status: HunitChargeStatus; requiresChargeNow: boolean }> = [
      { id: 1, status: 'awaiting', requiresChargeNow: true },
      { id: 2, status: 'awaiting', requiresChargeNow: false },
      { id: 3, status: 'not_found', requiresChargeNow: true },
      { id: 4, status: 'not_found', requiresChargeNow: false },
      { id: 5, status: 'confirmed', requiresChargeNow: false },
    ];
    expect(hunitCheckTargets(items).map((item) => item.id)).toEqual([1, 2, 3]);
    expect(isHunitCheckTarget({ status: 'confirmed', requiresChargeNow: true })).toBe(false);
  });
});

describe('hunitCheckResult (research R-07, regra do usuário)', () => {
  it('só confirma quando o Hunit mostra a cobrança', () => {
    expect(hunitCheckResult('virtual_card_already_charged')).toBe('confirmed');
    for (const classification of [
      'virtual_card_pending_charge',
      'cancelled_no_charge',
      'invoiced',
      'virtual_card_charge_error',
    ] as const) {
      expect(hunitCheckResult(classification)).toBe('not_found');
    }
  });
});
