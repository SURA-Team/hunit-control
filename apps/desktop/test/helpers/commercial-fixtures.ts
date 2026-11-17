/**
 * Dados fictícios do envio ao Comercial para os testes do app (specs/005).
 */
import type { CommercialDispatch } from '../../src/shared/ipc-types.js';

export const DISPATCH_ID = '44444444-4444-4444-8444-444444444444';

export function dispatchFixture(overrides: Partial<CommercialDispatch> = {}): CommercialDispatch {
  return {
    id: DISPATCH_ID,
    requestedClient: 'desktop-financeiro',
    parentDispatchId: null,
    resumedByDispatchId: null,
    status: 'queued',
    endReason: null,
    endMessage: null,
    createdAt: '2026-11-17T12:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    twoFactorDeadline: null,
    counts: { total: 2, pending: 2, sent: 0, withdrawn: 0, notVerified: 0, ignored: 0 },
    current: null,
    items: [],
    lastEventId: null,
    ...overrides,
  };
}
