/**
 * Canais do envio ao Comercial no processo principal (specs/005, T036, T044, T049;
 * contracts/ipc.md): limites de 2 000 reservas validados antes de chamar a API, usuário e senha do
 * Hunit tirados do cofre e nunca devolvidos à interface, o envio acompanhado como as execuções
 * (pedido de token desta máquina) e o motivo da recusa de 1 a 500 caracteres. Dados fictícios.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createCommercialHandlers,
  type CommercialServices,
} from '../../src/main/commercial-handlers.js';
import { INVOKE, type InvokeChannel } from '../../src/shared/ipc-channels.js';
import type { AppError, ReservationKey, Result } from '../../src/shared/ipc-types.js';
import { DISPATCH_ID, dispatchFixture } from '../helpers/commercial-fixtures.js';

const DISPATCH = DISPATCH_ID;
const RETURN = '55555555-5555-4555-8555-555555555555';
const SECRET_PASSWORD = 'senha-ficticia-que-nunca-volta';

const ok = <T>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });

const keys = (count: number): ReservationKey[] =>
  Array.from({ length: count }, (_unused, index) => ({
    hotelCode: '31',
    reservationNumber: `R${String(index + 1).padStart(4, '0')}`,
  }));

function setup(vaultResult?: Result<{ username: string; password: string }>) {
  const api = {
    selectReservations: vi.fn(() => ok({ total: 0, truncated: false, items: [] })),
    confirmTreatmentReviews: vi.fn(() =>
      ok({ batchId: 'b', items: [], countsByClassification: {} }),
    ),
    checkCommercialDispatch: vi.fn(() => ok({ eligible: [], ignored: [], totalAmount: '0.00' })),
    startCommercialDispatch: vi.fn(() => ok(dispatchFixture())),
    listCommercialDispatches: vi.fn(() => ok({ items: [], nextCursor: null })),
    getCommercialDispatch: vi.fn(() => ok(dispatchFixture())),
    resumeCommercialDispatch: vi.fn(() => ok(dispatchFixture({ id: DISPATCH }))),
    cancelCommercialDispatch: vi.fn(() => ok(dispatchFixture({ status: 'cancelled' }))),
    sendDispatchToken: vi.fn(() => ok(undefined)),
    getReservationCommercial: vi.fn(() => ok({ line: null, returns: [], events: [] })),
    cancelCommercialLine: vi.fn(),
    restoreCommercialLine: vi.fn(),
    confirmCommercialReturn: vi.fn(),
    rejectCommercialReturn: vi.fn(() => ok({})),
    undoCommercialReturnConfirmation: vi.fn(),
    confirmCommercialReturns: vi.fn(() =>
      ok({ batchId: 'b', items: [], countsByClassification: {} }),
    ),
    getCommercialSheetStatus: vi.fn(),
    readCommercialSheet: vi.fn(),
  };
  const watcher = {
    track: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    noteTokenSent: vi.fn(),
  };
  const vault = {
    take: vi.fn(
      () =>
        vaultResult ??
        ({
          ok: true,
          data: { username: 'operador@hotel.test', password: SECRET_PASSWORD },
        } as const),
    ),
  };
  const reportFailure = vi.fn<(error: AppError) => void>();
  const writeClipboard = vi.fn(() => Promise.resolve());
  const handlers = createCommercialHandlers({
    getApi: () => api as unknown as ReturnType<CommercialServices['getApi']>,
    vault,
    watcher,
    reportFailure,
    writeClipboard,
  });
  const call = (channel: InvokeChannel, input?: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`sem handler para ${channel}`);
    return handler(input);
  };
  return { api, watcher, vault, call, writeClipboard };
}

describe('limites de 2 000 reservas (contracts/ipc.md)', () => {
  it.each([
    INVOKE.dispatchesCheck,
    INVOKE.dispatchesStart,
    INVOKE.commercialConfirmReturns,
    INVOKE.treatmentsConfirmReviews,
  ])('%s recusa 2 001 sem chamar a API e aceita 2 000', async (channel) => {
    const { api, call } = setup();
    const refused = await call(channel, { reservations: keys(2001) });
    expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(Object.values(api).every((fn) => fn.mock.calls.length === 0)).toBe(true);

    const accepted = await call(channel, { reservations: keys(2000) });
    expect(accepted.ok).toBe(true);
  });

  it('lista vazia e campo a mais também são recusados', async () => {
    const { call } = setup();
    expect(await call(INVOKE.dispatchesCheck, { reservations: [] })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(
      await call(INVOKE.dispatchesStart, { reservations: keys(1), password: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

describe('envio com as credenciais do cofre (FR-002)', () => {
  it('usa o cofre, acompanha o envio desta máquina e não devolve a senha', async () => {
    const { api, watcher, call } = setup();
    const result = await call(INVOKE.dispatchesStart, { reservations: keys(2) });

    expect(result.ok).toBe(true);
    expect(api.startCommercialDispatch).toHaveBeenCalledWith({
      credentials: { username: 'operador@hotel.test', password: SECRET_PASSWORD },
      reservations: keys(2),
    });
    expect(watcher.track).toHaveBeenCalledWith({ kind: 'dispatch', id: DISPATCH }, { own: true });
    expect(JSON.stringify(result)).not.toContain(SECRET_PASSWORD);
  });

  it('sem acesso no cofre, não chama a API', async () => {
    const { api, call } = setup({ ok: false, error: { code: 'credentials_missing' } });
    const result = await call(INVOKE.dispatchesStart, { reservations: keys(1) });
    expect(result).toMatchObject({ ok: false, error: { code: 'credentials_missing' } });
    expect(api.startCommercialDispatch).not.toHaveBeenCalled();
  });

  it('retomar também usa o cofre e passa a acompanhar o envio novo', async () => {
    const { api, watcher, call } = setup();
    await call(INVOKE.dispatchesResume, DISPATCH);
    expect(api.resumeCommercialDispatch).toHaveBeenCalledWith(DISPATCH, {
      username: 'operador@hotel.test',
      password: SECRET_PASSWORD,
    });
    expect(watcher.track).toHaveBeenCalledWith({ kind: 'dispatch', id: DISPATCH }, { own: true });
  });

  it('o token do envio é marcado como desta máquina antes de ir ao servidor', async () => {
    const { api, watcher, call } = setup();
    expect(
      await call(INVOKE.dispatchesSendToken, { dispatchId: DISPATCH, token: '12a' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });

    await call(INVOKE.dispatchesSendToken, { dispatchId: DISPATCH, token: '123456' });
    expect(watcher.noteTokenSent).toHaveBeenCalledWith({ kind: 'dispatch', id: DISPATCH });
    expect(api.sendDispatchToken).toHaveBeenCalledWith(DISPATCH, '123456');
  });
});

describe('recusa do retorno (FR-017)', () => {
  it('motivo obrigatório, até 500 caracteres, sem espaços nas pontas', async () => {
    const { api, call } = setup();
    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      expect(await call(INVOKE.commercialRejectReturn, { returnId: RETURN, reason })).toMatchObject(
        { ok: false, error: { code: 'invalid_input' } },
      );
    }
    expect(api.rejectCommercialReturn).not.toHaveBeenCalled();

    await call(INVOKE.commercialRejectReturn, { returnId: RETURN, reason: '  Valor diferente ' });
    expect(api.rejectCommercialReturn).toHaveBeenCalledWith(RETURN, 'Valor diferente');
  });
});

describe('"selecionar todas do filtro" (FR-030)', () => {
  it('repassa os filtros da lista, sem paginação', async () => {
    const { api, call } = setup();
    const filters = { detailedSituation: ['return_pending'], needsReview: true };
    await call(INVOKE.reservationsSelectAll, filters);
    expect(api.selectReservations).toHaveBeenCalledWith(filters);

    expect(await call(INVOKE.reservationsSelectAll, { limit: 10 })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  });
});
