/**
 * Canais "Cancelada sem cobrança" no processo principal (specs/008, T030; contracts/ipc.md): a
 * entrada é validada antes de chamar a API (situação vista, observação até 500 caracteres e o id
 * da marcação), a observação vazia não vai ao servidor e a falha da API chega à interface e ao
 * estado da conexão como nos outros canais. Dados fictícios.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStoryHandlers, type StoryServices } from '../../src/main/story-handlers.js';
import { INVOKE } from '../../src/shared/ipc-channels.js';
import type { AppError, Result } from '../../src/shared/ipc-types.js';

const KEY = { hotelCode: '31', reservationNumber: '7001' };
const MARK_ID = '55555555-5555-4555-8555-555555555555';
const RESERVATION = { ...KEY, noCharge: { id: MARK_ID } };

function setup(response: Result<unknown> = { ok: true, data: RESERVATION }) {
  const api = {
    markNoCharge: vi.fn(() => Promise.resolve(response)),
    undoNoCharge: vi.fn(() => Promise.resolve(response)),
  };
  const reportFailure = vi.fn<(error: AppError) => void>();
  const handlers = createStoryHandlers({
    getApi: () => api as unknown as ReturnType<StoryServices['getApi']>,
    vault: { take: vi.fn() },
    watcher: { track: vi.fn(), watch: vi.fn(), unwatch: vi.fn(), noteTokenSent: vi.fn() },
    reportFailure,
  });
  const mark = handlers[INVOKE.reservationsMarkNoCharge];
  const undo = handlers[INVOKE.reservationsUndoNoCharge];
  if (!mark || !undo) throw new Error('sem handlers da marcação "Cancelada sem cobrança"');
  return {
    api,
    reportFailure,
    mark: (input?: unknown) => mark(input),
    undo: (input?: unknown) => undo(input),
  };
}

describe('reservations.markNoCharge', () => {
  it('repassa a situação vista e a observação e devolve a reserva atualizada', async () => {
    const { api, mark } = setup();
    const result = await mark({
      key: KEY,
      expectedSituation: 'virtual_card_pending_charge',
      note: '  Hóspede Fictício cancelou por telefone  ',
    });

    expect(result).toEqual({ ok: true, data: RESERVATION });
    expect(api.markNoCharge).toHaveBeenCalledWith(KEY, {
      expectedSituation: 'virtual_card_pending_charge',
      note: 'Hóspede Fictício cancelou por telefone',
    });
  });

  it('observação vazia ou só com espaços não vai ao servidor', async () => {
    const { api, mark } = setup();
    await mark({ key: KEY, expectedSituation: 'virtual_card_pending_charge', note: '   ' });
    await mark({ key: KEY, expectedSituation: 'treatment_sent' });

    expect(api.markNoCharge).toHaveBeenNthCalledWith(1, KEY, {
      expectedSituation: 'virtual_card_pending_charge',
    });
    expect(api.markNoCharge).toHaveBeenNthCalledWith(2, KEY, {
      expectedSituation: 'treatment_sent',
    });
  });

  it.each([
    ['observação com mais de 500 caracteres', { note: 'x'.repeat(501) }],
    ['sem a situação vista', { expectedSituation: undefined }],
    ['situação vazia', { expectedSituation: '  ' }],
    ['chave sem número', { key: { hotelCode: '31' } }],
    ['campo desconhecido', { amount: '0.00' }],
  ])('%s → invalid_input, sem chamar a API', async (_, change) => {
    const { api, mark } = setup();
    const input = { key: KEY, expectedSituation: 'virtual_card_pending_charge', ...change };
    expect(await mark(input)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.markNoCharge).not.toHaveBeenCalled();
  });

  it('observação com exatamente 500 caracteres é aceita', async () => {
    const { api, mark } = setup();
    const note = 'x'.repeat(500);
    expect(
      await mark({ key: KEY, expectedSituation: 'virtual_card_pending_charge', note }),
    ).toMatchObject({
      ok: true,
    });
    expect(api.markNoCharge).toHaveBeenCalledWith(KEY, {
      expectedSituation: 'virtual_card_pending_charge',
      note,
    });
  });

  it('recusa do servidor (situação mudou): chega à interface com o código', async () => {
    const error: AppError = { code: 'reservation_changed', detail: 'A situação mudou.' };
    const { mark } = setup({ ok: false, error });
    expect(await mark({ key: KEY, expectedSituation: 'virtual_card_pending_charge' })).toEqual({
      ok: false,
      error,
    });
  });

  it('falha da API: chega à interface e ao estado da conexão', async () => {
    const error: AppError = { code: 'offline' };
    const { mark, reportFailure } = setup({ ok: false, error });
    expect(await mark({ key: KEY, expectedSituation: 'virtual_card_pending_charge' })).toEqual({
      ok: false,
      error,
    });
    expect(reportFailure).toHaveBeenCalledWith(error);
  });
});

describe('reservations.undoNoCharge', () => {
  it('repassa a chave e o id da marcação', async () => {
    const { api, undo } = setup();
    expect(await undo({ key: KEY, markId: MARK_ID })).toEqual({ ok: true, data: RESERVATION });
    expect(api.undoNoCharge).toHaveBeenCalledWith(KEY, MARK_ID);
  });

  it.each([
    ['id que não é uuid', { key: KEY, markId: 'marca-1' }],
    ['sem o id', { key: KEY }],
    ['sem a chave', { markId: MARK_ID }],
    ['campo desconhecido', { key: KEY, markId: MARK_ID, note: 'x' }],
  ])('%s → invalid_input, sem chamar a API', async (_, input) => {
    const { api, undo } = setup();
    expect(await undo(input)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(api.undoNoCharge).not.toHaveBeenCalled();
  });
});
