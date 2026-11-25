/**
 * Canal do resumo do módulo de Relatórios no processo principal (specs/007, T008; contracts/ipc.md):
 * o período é validado antes de chamar a API (datas AAAA-MM-DD existentes, início até o fim), e a
 * falha da API chega à interface e ao estado da conexão como nos outros canais. Dados fictícios.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStoryHandlers, type StoryServices } from '../../src/main/story-handlers.js';
import { INVOKE } from '../../src/shared/ipc-channels.js';
import type { AppError, ReportOverview, Result } from '../../src/shared/ipc-types.js';

const OVERVIEW: ReportOverview = {
  period: { from: '2026-11-01', to: '2026-11-30' },
  generatedAt: '2026-11-16T13:58:00.000Z',
  lastVerifiedAt: '2026-11-10T13:23:00.000Z',
  reservations: 3,
  treatmentsSent: 1,
  withoutAmount: 0,
  hotels: { withData: 1, total: 2 },
  open: { amount: '300.00', count: 2, requested: '100.00', pending: '200.00' },
  charged: { amount: '50.00', previous: '50.00', recovered: '0.00' },
  hotelRows: [],
};

function setup(response: Result<ReportOverview> = { ok: true, data: OVERVIEW }) {
  const api = { getReportOverview: vi.fn(() => Promise.resolve(response)) };
  const reportFailure = vi.fn<(error: AppError) => void>();
  const handlers = createStoryHandlers({
    getApi: () => api as unknown as ReturnType<StoryServices['getApi']>,
    vault: { take: vi.fn() },
    watcher: { track: vi.fn(), watch: vi.fn(), unwatch: vi.fn(), noteTokenSent: vi.fn() },
    reportFailure,
  });
  const handler = handlers[INVOKE.reportsOverview];
  if (!handler) throw new Error('sem handler para o resumo dos relatórios');
  return { api, reportFailure, call: (input?: unknown) => handler(input) };
}

describe('reports.overview', () => {
  it('repassa o período e devolve o resumo', async () => {
    const { api, call } = setup();
    const input = { checkInFrom: '2026-11-01', checkInTo: '2026-11-30' };
    expect(await call(input)).toEqual({ ok: true, data: OVERVIEW });
    expect(api.getReportOverview).toHaveBeenCalledWith(input);
  });

  it('um dia só vale', async () => {
    const { api, call } = setup();
    await call({ checkInFrom: '2026-11-10', checkInTo: '2026-11-10' });
    expect(api.getReportOverview).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sem o fim', { checkInFrom: '2026-11-01' }],
    ['data inexistente', { checkInFrom: '2026-02-30', checkInTo: '2026-03-10' }],
    ['formato errado', { checkInFrom: '01/11/2026', checkInTo: '30/11/2026' }],
    ['início depois do fim', { checkInFrom: '2026-11-30', checkInTo: '2026-11-01' }],
    [
      'campo desconhecido',
      // `hotelCode` e os outros filtros do painel valem desde a 1.11.0 (FR-005a); a busca, não.
      { checkInFrom: '2026-11-01', checkInTo: '2026-11-30', q: 'Ana' },
    ],
    ['não é objeto', 'mês'],
  ])('%s → invalid_input, sem chamar a API', async (_, input) => {
    const { api, call } = setup();
    expect(await call(input)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.getReportOverview).not.toHaveBeenCalled();
  });

  it('falha da API: chega à interface e ao estado da conexão', async () => {
    const error: AppError = { code: 'offline' };
    const { call, reportFailure } = setup({ ok: false, error });
    expect(await call({ checkInFrom: '2026-11-01', checkInTo: '2026-11-30' })).toEqual({
      ok: false,
      error,
    });
    expect(reportFailure).toHaveBeenCalledWith(error);
  });
});
