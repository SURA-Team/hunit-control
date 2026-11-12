/**
 * Cofre do acesso ao Hunit em memória do processo principal (specs/002, T019, FR-006 a FR-008,
 * research R-05, data-model §4.3): a interface nunca recebe a senha; o cofre se esvazia por
 * "Limpar acesso" ou depois do prazo sem ação do operador.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialsVault } from '../../src/main/credentials-vault.js';
import type { CredentialsClearReason } from '../../src/shared/ipc-types.js';

const HOUR = 60 * 60 * 1000;
const PASSWORD = 'SENHA-MARCADOR-COFRE-77';

let cleared: CredentialsClearReason[];
let vault: CredentialsVault;

beforeEach(() => {
  vi.useFakeTimers();
  cleared = [];
  vault = new CredentialsVault({ idleHours: 8, onCleared: (reason) => cleared.push(reason) });
});

afterEach(() => {
  vault.dispose();
  vi.useRealTimers();
});

describe('CredentialsVault', () => {
  it('status mostra o usuário e se há senha, nunca a senha', () => {
    expect(vault.status()).toEqual({ username: null, hasPassword: false });

    const status = vault.set({ username: 'op@hotel.test', password: PASSWORD });

    expect(status).toEqual({ username: 'op@hotel.test', hasPassword: true });
    expect(JSON.stringify(vault.status())).not.toContain(PASSWORD);
  });

  it('take devolve as credenciais guardadas, e elas continuam lá (FR-006)', () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });

    expect(vault.take()).toEqual({
      ok: true,
      data: { username: 'op@hotel.test', password: PASSWORD },
    });
    expect(vault.status().hasPassword).toBe(true);
  });

  it('cofre vazio → credentials_missing', () => {
    expect(vault.take()).toEqual({ ok: false, error: { code: 'credentials_missing' } });
  });

  it('"Limpar acesso" esvazia e avisa com o motivo manual (FR-008)', () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });

    expect(vault.clear()).toEqual({ username: null, hasPassword: false });
    expect(cleared).toEqual(['manual']);
    expect(vault.take()).toEqual({ ok: false, error: { code: 'credentials_missing' } });
  });

  it('depois do prazo sem ação, esvazia e avisa com o motivo idle', async () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });

    await vi.advanceTimersByTimeAsync(8 * HOUR - 1);
    expect(vault.status().hasPassword).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(vault.status()).toEqual({ username: null, hasPassword: false });
    expect(cleared).toEqual(['idle']);
  });

  it('depois de esvaziar por inatividade, take → credentials_expired até informar de novo', async () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });
    await vi.advanceTimersByTimeAsync(8 * HOUR);

    expect(vault.take()).toEqual({ ok: false, error: { code: 'credentials_expired' } });

    vault.set({ username: 'op@hotel.test', password: PASSWORD });
    expect(vault.take().ok).toBe(true);
  });

  it('ação do operador renova o prazo', async () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });

    await vi.advanceTimersByTimeAsync(7 * HOUR);
    vault.activity();
    await vi.advanceTimersByTimeAsync(7 * HOUR);

    expect(vault.status().hasPassword).toBe(true);
    await vi.advanceTimersByTimeAsync(1 * HOUR);
    expect(vault.status().hasPassword).toBe(false);
  });

  it('consultas em segundo plano não renovam o prazo', async () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });

    for (let hour = 0; hour < 8; hour += 1) {
      await vi.advanceTimersByTimeAsync(HOUR);
      vault.status();
    }

    expect(vault.status().hasPassword).toBe(false);
    expect(cleared).toEqual(['idle']);
  });

  it('mudar o prazo vale a partir da última ação', async () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });
    await vi.advanceTimersByTimeAsync(2 * HOUR);

    vault.setIdleHours(3);
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(vault.status().hasPassword).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(vault.status().hasPassword).toBe(false);
  });

  it('limpar sem nada guardado não avisa', () => {
    vault.clear();

    expect(cleared).toEqual([]);
  });

  it('dispose esvazia sem avisar (o app está fechando)', () => {
    vault.set({ username: 'op@hotel.test', password: PASSWORD });

    vault.dispose();

    expect(vault.status()).toEqual({ username: null, hasPassword: false });
    expect(cleared).toEqual([]);
  });
});
