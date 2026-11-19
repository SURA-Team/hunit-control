/**
 * Canal das contagens dos filtros rápidos no processo principal (specs/006, T032; contracts/ipc.md):
 * a entrada é validada antes de chamar a API (sem paginação, filtro rápido e ordem), e a falha da
 * API chega à interface e ao estado da conexão como nos outros canais. Dados fictícios.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStoryHandlers, type StoryServices } from '../../src/main/story-handlers.js';
import { INVOKE } from '../../src/shared/ipc-channels.js';
import type { AppError, Result } from '../../src/shared/ipc-types.js';

const COUNTS = { all: 12, pendingCharge: 5, toReview: 0, withError: 3, done: 4 };

function setup(response: Result<typeof COUNTS> = { ok: true, data: COUNTS }) {
  const api = { countReservationQuickFilters: vi.fn(() => Promise.resolve(response)) };
  const reportFailure = vi.fn<(error: AppError) => void>();
  const handlers = createStoryHandlers({
    getApi: () => api as unknown as ReturnType<StoryServices['getApi']>,
    vault: { take: vi.fn() },
    watcher: { track: vi.fn(), watch: vi.fn(), unwatch: vi.fn(), noteTokenSent: vi.fn() },
    reportFailure,
  });
  const handler = handlers[INVOKE.reservationsQuickFilterCounts];
  if (!handler) throw new Error('sem handler para as contagens dos filtros rápidos');
  return { api, reportFailure, call: (input?: unknown) => handler(input) };
}

describe('reservations.quickFilterCounts', () => {
  it('repassa os filtros da lista e devolve as contagens', async () => {
    const { api, call } = setup();
    const filters = { hotelCode: ['31'], q: 'Ana', fromLegacy: false };

    expect(await call(filters)).toEqual({ ok: true, data: COUNTS });
    expect(api.countReservationQuickFilters).toHaveBeenCalledWith(filters);
  });

  it.each([
    ['filtro rápido', { quickFilter: 'done' }],
    ['ordem', { order: 'hotel_check_in' }],
    ['paginação', { limit: 10 }],
    ['campo desconhecido', { hotelCodes: ['31'] }],
    ['não é objeto', 'tudo'],
  ])('%s → invalid_input, sem chamar a API', async (_, input) => {
    const { api, call } = setup();
    expect(await call(input)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.countReservationQuickFilters).not.toHaveBeenCalled();
  });

  it('falha da API: chega à interface e ao estado da conexão', async () => {
    const error: AppError = { code: 'offline' };
    const { call, reportFailure } = setup({ ok: false, error });
    expect(await call({})).toEqual({ ok: false, error });
    expect(reportFailure).toHaveBeenCalledWith(error);
  });
});
