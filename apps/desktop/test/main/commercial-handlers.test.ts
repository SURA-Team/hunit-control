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
    listHunitCharges: vi.fn(() =>
      ok({ items: [], counts: { awaiting: 0, notFound: 0, confirmed: 0 } }),
    ),
    checkHunitCharges: vi.fn(() => ok(dispatchFixture({ purpose: 'hunit_check' }))),
    confirmCommercialCancellation: vi.fn((key: ReservationKey) => ok(key)),
    rejectCommercialCancellation: vi.fn((key: ReservationKey) => ok(key)),
    confirmCommercialSituationReturn: vi.fn(() => ok({})),
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

describe('fila "Cobradas no Hunit" (specs/008, contracts/ipc.md)', () => {
  it('lista a fila pela API', async () => {
    const { api, call } = setup();
    const result = await call(INVOKE.commercialHunitCharges);
    expect(result).toEqual({
      ok: true,
      data: { items: [], counts: { awaiting: 0, notFound: 0, confirmed: 0 } },
    });
    expect(api.listHunitCharges).toHaveBeenCalled();
  });

  it('"Verificar agora" usa o cofre, acompanha a verificação e não devolve a senha', async () => {
    const { api, watcher, call } = setup();
    const result = await call(INVOKE.commercialCheckHunitCharges);
    expect(result.ok).toBe(true);
    expect(api.checkHunitCharges).toHaveBeenCalledWith({
      credentials: { username: 'operador@hotel.test', password: SECRET_PASSWORD },
    });
    expect(watcher.track).toHaveBeenCalledWith({ kind: 'dispatch', id: DISPATCH }, { own: true });
    expect(JSON.stringify(result)).not.toContain(SECRET_PASSWORD);
  });

  it('sem acesso no cofre, o mesmo erro do envio e a API não é chamada', async () => {
    const { api, call } = setup({ ok: false, error: { code: 'credentials_missing' } });
    expect(await call(INVOKE.commercialCheckHunitCharges)).toMatchObject({
      ok: false,
      error: { code: 'credentials_missing' },
    });
    expect(api.checkHunitCharges).not.toHaveBeenCalled();
  });

  it('a lista de envios repassa o propósito e recusa um valor desconhecido', async () => {
    const { api, call } = setup();
    await call(INVOKE.dispatchesList, { active: true, purpose: 'all' });
    expect(api.listCommercialDispatches).toHaveBeenCalledWith({ active: true, purpose: 'all' });
    expect(await call(INVOKE.dispatchesList, { purpose: 'tudo' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  });
});

describe('"Cancelada" do Comercial (homologação da 008, R-19)', () => {
  const KEY = { hotelCode: '31', reservationNumber: '7020' };

  it('confirmar repassa a reserva; chave inválida não chega à API', async () => {
    const { api, call } = setup();
    expect(await call(INVOKE.commercialConfirmCancellation, KEY)).toEqual({ ok: true, data: KEY });
    expect(api.confirmCommercialCancellation).toHaveBeenCalledWith(KEY);
    expect(await call(INVOKE.commercialConfirmCancellation, { hotelCode: '31' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(api.confirmCommercialCancellation).toHaveBeenCalledTimes(1);
  });

  it('recusar: motivo obrigatório, até 500 caracteres, sem espaços nas pontas', async () => {
    const { api, call } = setup();
    const reject = api.rejectCommercialCancellation;
    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      expect(await call(INVOKE.commercialRejectCancellation, { key: KEY, reason })).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
    expect(reject).not.toHaveBeenCalled();

    await call(INVOKE.commercialRejectCancellation, {
      key: KEY,
      reason: '  Hóspede fez check-in ',
    });
    expect(reject).toHaveBeenCalledWith(KEY, 'Hóspede fez check-in');
  });

  it('o lote repassa includeCancellations só quando pedido', async () => {
    const { api, call } = setup();
    await call(INVOKE.commercialConfirmReturns, { reservations: [KEY] });
    await call(INVOKE.commercialConfirmReturns, {
      reservations: [KEY],
      includeCancellations: true,
    });
    expect(api.confirmCommercialReturns).toHaveBeenNthCalledWith(1, [KEY], false);
    expect(api.confirmCommercialReturns).toHaveBeenNthCalledWith(2, [KEY], true);
    expect(
      await call(INVOKE.commercialConfirmReturns, {
        reservations: [KEY],
        includeCancellations: 'sim',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

describe('situação livre do Comercial (specs/009, contracts/ipc.md)', () => {
  const RETURN = '55555555-5555-4555-8555-555555555555';

  it('como cobrada: repassa o valor só quando informado; valor inválido não chega à API', async () => {
    const { api, call } = setup();
    const confirm = api.confirmCommercialSituationReturn;
    await call(INVOKE.commercialConfirmSituationReturn, { returnId: RETURN, as: 'charged' });
    await call(INVOKE.commercialConfirmSituationReturn, {
      returnId: RETURN,
      as: 'charged',
      chargedAmount: '321.00',
    });
    expect(confirm).toHaveBeenNthCalledWith(1, RETURN, { as: 'charged', chargedAmount: undefined });
    expect(confirm).toHaveBeenNthCalledWith(2, RETURN, { as: 'charged', chargedAmount: '321.00' });
    for (const chargedAmount of ['0.00', '12,30', 'abc']) {
      expect(
        await call(INVOKE.commercialConfirmSituationReturn, {
          returnId: RETURN,
          as: 'charged',
          chargedAmount,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('como cancelada sem cobrança: observação opcional, sem valor; id inválido não chega à API', async () => {
    const { api, call } = setup();
    const confirm = api.confirmCommercialSituationReturn;
    await call(INVOKE.commercialConfirmSituationReturn, {
      returnId: RETURN,
      as: 'no_charge',
      note: ' Conferido com o hotel ',
    });
    expect(confirm).toHaveBeenCalledWith(RETURN, {
      as: 'no_charge',
      note: 'Conferido com o hotel',
    });
    for (const input of [
      { returnId: RETURN, as: 'no_charge', chargedAmount: '1.00' },
      { returnId: 'x', as: 'charged' },
      { returnId: RETURN, as: 'outra' },
    ]) {
      expect(await call(INVOKE.commercialConfirmSituationReturn, input)).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      });
    }
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
