/**
 * Canais da ponte da fundação (specs/002, T020, research R-02, contracts/ipc.md): toda entrada da
 * interface é validada antes de qualquer efeito, e nada sensível volta para ela — nem a chave da
 * API nem a senha do Hunit.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredConfig } from '../../src/main/config-store.js';
import type { ConnectionApi } from '../../src/main/connection.js';
import { CredentialsVault } from '../../src/main/credentials-vault.js';
import { createInvokeHandlers, type IpcServices } from '../../src/main/ipc-handlers.js';
import { INVOKE } from '../../src/shared/ipc-channels.js';
import type { ConnectionState, Result } from '../../src/shared/ipc-types.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';

const API_KEY = 'hunit_CHAVE-MARCADOR-IPC-9999';
const PASSWORD = 'SENHA-MARCADOR-IPC-1234';

let certificates: TestCertificates;
let stored: StoredConfig | null;
let vault: CredentialsVault;
let services: IpcServices;
let handlers: ReturnType<typeof createInvokeHandlers>;
let api: ConnectionApi;

/** As funções simuladas, guardadas à parte para as conferências. */
const mocks = {
  load: vi.fn(),
  save: vi.fn(),
  setPreferences: vi.fn(),
  remove: vi.fn(),
  reconnect: vi.fn(),
  attentionTest: vi.fn(),
  pickCertificateFile: vi.fn(),
  createApi: vi.fn(),
  getMe: vi.fn(),
  close: vi.fn(),
};

beforeAll(async () => {
  certificates = await createTestCertificates();
});

function storedConfig(): StoredConfig {
  return {
    serverUrl: 'https://192.168.0.50',
    certificatePem: certificates.authority.certificatePem,
    caFingerprint256: 'AA:BB',
    apiKeyCiphertext: 'cifrado',
    preferences: { soundEnabled: true, idleHours: 8 },
  };
}

beforeEach(() => {
  stored = storedConfig();
  vault = new CredentialsVault({ idleHours: 8, onCleared: () => undefined });
  vi.clearAllMocks();
  mocks.getMe.mockResolvedValue({
    ok: true,
    data: { name: 'desktop-financeiro', role: 'operator' },
  });
  mocks.close.mockResolvedValue(undefined);
  api = {
    getHealth: () => Promise.resolve({ ok: true as const, data: { status: 'ok' as const } }),
    getMe: mocks.getMe,
    close: mocks.close,
  };
  mocks.load.mockImplementation(() =>
    Promise.resolve(
      stored ? { status: 'ok' as const, config: stored } : { status: 'missing' as const },
    ),
  );
  mocks.save.mockImplementation(
    (input: { serverUrl: string; certificatePem: string; caFingerprint256: string }) => {
      stored = { ...storedConfig(), ...input };
      return Promise.resolve(stored);
    },
  );
  mocks.setPreferences.mockImplementation((input: { soundEnabled?: boolean; idleHours?: number }) =>
    Promise.resolve({ soundEnabled: input.soundEnabled ?? true, idleHours: input.idleHours ?? 8 }),
  );
  mocks.remove.mockResolvedValue(undefined);
  mocks.reconnect.mockResolvedValue(undefined);
  mocks.pickCertificateFile.mockResolvedValue(null);
  mocks.createApi.mockImplementation(() => api);
  const state: ConnectionState = {
    status: 'online',
    client: { name: 'desktop-financeiro', role: 'operator' },
    checkedAt: new Date().toISOString(),
  };
  services = {
    appVersion: '0.1.0',
    config: {
      load: mocks.load,
      save: mocks.save,
      setPreferences: mocks.setPreferences,
      decryptApiKey: () => API_KEY,
      remove: mocks.remove,
    },
    connection: {
      getState: () => state,
      reconnect: mocks.reconnect,
    },
    vault,
    attention: { test: mocks.attentionTest },
    dialogs: { pickCertificateFile: mocks.pickCertificateFile },
    createApi: mocks.createApi,
  };
  handlers = createInvokeHandlers(services);
});

async function invoke(channel: string, input?: unknown): Promise<Result<unknown>> {
  const handler = handlers[channel as keyof typeof handlers];
  if (!handler) throw new Error(`canal sem manipulador: ${channel}`);
  return handler(input);
}

function codeOf(result: Result<unknown>) {
  return result.ok ? null : result.error.code;
}

describe('entrada inválida → invalid_input, sem efeito', () => {
  it.each([
    [
      'endereço sem https',
      { serverUrl: 'http://192.168.0.50', certificatePem: '-----BEGIN CERTIFICATE-----' },
    ],
    [
      'endereço com caminho',
      { serverUrl: 'https://192.168.0.50/v1', certificatePem: '-----BEGIN CERTIFICATE-----' },
    ],
    ['sem certificado', { serverUrl: 'https://192.168.0.50' }],
    [
      'campo a mais',
      {
        serverUrl: 'https://192.168.0.50',
        certificatePem: '-----BEGIN CERTIFICATE-----',
        extra: 1,
      },
    ],
    ['não é objeto', 'https://192.168.0.50'],
  ])('connection.test com %s', async (_caso, input) => {
    expect(codeOf(await invoke(INVOKE.connectionTest, input))).toBe('invalid_input');
    expect(mocks.createApi).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('connection.save com certificado inválido não grava', async () => {
    const result = await invoke(INVOKE.connectionSave, {
      serverUrl: 'https://192.168.0.50',
      certificatePem: 'lixo',
      apiKey: API_KEY,
    });

    expect(codeOf(result)).toBe('invalid_input');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([{ idleHours: 0 }, { idleHours: 25 }, { idleHours: 2.5 }, { soundEnabled: 'sim' }])(
    'preferences.set com %o',
    async (input) => {
      expect(codeOf(await invoke(INVOKE.preferencesSet, input))).toBe('invalid_input');
      expect(mocks.setPreferences).not.toHaveBeenCalled();
    },
  );

  it.each([
    { username: '', password: PASSWORD },
    { username: 'op@hotel.test', password: '' },
    { username: 'op@hotel.test' },
    { username: 'op@hotel.test', password: PASSWORD, outro: true },
  ])('credentials.set com %o', async (input) => {
    expect(codeOf(await invoke(INVOKE.credentialsSet, input))).toBe('invalid_input');
    expect(vault.status().hasPassword).toBe(false);
  });

  it('a mensagem de entrada inválida não repete a senha', async () => {
    const result = await invoke(INVOKE.credentialsSet, { username: '', password: PASSWORD });

    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });
});

describe('conexão: testar antes de salvar (FR-001)', () => {
  const input = () => ({
    serverUrl: 'https://192.168.0.60/',
    certificatePem: certificates.authority.certificatePem,
    apiKey: API_KEY,
  });

  it('testar chama health e /me com os dados informados e devolve o cliente', async () => {
    const result = await invoke(INVOKE.connectionTest, input());

    expect(result).toEqual({ ok: true, data: { name: 'desktop-financeiro', role: 'operator' } });
    expect(mocks.createApi).toHaveBeenCalledWith({
      serverUrl: 'https://192.168.0.60',
      caCertificatePem: certificates.authority.certificatePem,
      apiKey: API_KEY,
    });
    expect(mocks.close).toHaveBeenCalled();
  });

  it('testar sem chave usa a chave guardada', async () => {
    const withoutKey = {
      serverUrl: input().serverUrl,
      certificatePem: input().certificatePem,
    };

    expect((await invoke(INVOKE.connectionTest, withoutKey)).ok).toBe(true);
    expect(mocks.createApi).toHaveBeenCalledWith(expect.objectContaining({ apiKey: API_KEY }));
  });

  it('salvar sem testar é recusado', async () => {
    expect(codeOf(await invoke(INVOKE.connectionSave, input()))).toBe('invalid_input');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('salvar com dados diferentes dos testados é recusado', async () => {
    await invoke(INVOKE.connectionTest, input());

    const result = await invoke(INVOKE.connectionSave, {
      ...input(),
      serverUrl: 'https://10.0.0.1',
    });

    expect(codeOf(result)).toBe('invalid_input');
  });

  it('testar e salvar grava, reconecta e devolve a configuração pública', async () => {
    await invoke(INVOKE.connectionTest, input());

    const result = await invoke(INVOKE.connectionSave, input());

    expect(result.ok).toBe(true);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'https://192.168.0.60', apiKey: API_KEY }),
    );
    expect(mocks.reconnect).toHaveBeenCalled();
    if (result.ok) {
      expect(result.data).toMatchObject({
        serverUrl: 'https://192.168.0.60',
        hasApiKey: true,
        certificate: { isCertificateAuthority: true },
      });
    }
  });

  it('teste que falha não libera o salvar', async () => {
    mocks.getMe.mockResolvedValue({ ok: false, error: { code: 'unauthorized' } });

    expect(codeOf(await invoke(INVOKE.connectionTest, input()))).toBe('unauthorized');
    expect(codeOf(await invoke(INVOKE.connectionSave, input()))).toBe('invalid_input');
  });

  it('remover apaga a configuração e reconecta (fica não configurado)', async () => {
    expect((await invoke(INVOKE.connectionRemove)).ok).toBe(true);
    expect(mocks.remove).toHaveBeenCalled();
    expect(mocks.reconnect).toHaveBeenCalled();
  });
});

describe('nada sensível volta para a interface', () => {
  it('nenhum resultado contém a chave da API nem a senha do Hunit', async () => {
    const results = [
      await invoke(INVOKE.appInfo),
      await invoke(INVOKE.connectionGetState),
      await invoke(INVOKE.connectionGetConfig),
      await invoke(INVOKE.connectionTest, {
        serverUrl: 'https://192.168.0.60',
        certificatePem: certificates.authority.certificatePem,
        apiKey: API_KEY,
      }),
      await invoke(INVOKE.connectionSave, {
        serverUrl: 'https://192.168.0.60',
        certificatePem: certificates.authority.certificatePem,
        apiKey: API_KEY,
      }),
      await invoke(INVOKE.credentialsSet, { username: 'op@hotel.test', password: PASSWORD }),
      await invoke(INVOKE.credentialsStatus),
      await invoke(INVOKE.credentialsClear),
      await invoke(INVOKE.preferencesSet, { idleHours: 4 }),
    ];

    expect(results.every((result) => result.ok)).toBe(true);
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(PASSWORD);
  });

  it('getConfig mostra que há chave, sem mostrá-la', async () => {
    const result = await invoke(INVOKE.connectionGetConfig);

    expect(result).toMatchObject({
      ok: true,
      data: { serverUrl: 'https://192.168.0.50', hasApiKey: true },
    });
  });

  it('getConfig sem configuração → null', async () => {
    stored = null;

    expect(await invoke(INVOKE.connectionGetConfig)).toEqual({ ok: true, data: null });
  });
});

describe('outros canais da fundação', () => {
  it('app.info devolve a versão (FR-025)', async () => {
    expect(await invoke(INVOKE.appInfo)).toEqual({ ok: true, data: { version: '0.1.0' } });
  });

  it('preferences.set grava e aplica o novo prazo ao cofre', async () => {
    const setIdleHours = vi.spyOn(vault, 'setIdleHours');

    const result = await invoke(INVOKE.preferencesSet, { idleHours: 4 });

    expect(result).toEqual({ ok: true, data: { soundEnabled: true, idleHours: 4 } });
    expect(setIdleHours).toHaveBeenCalledWith(4);
  });

  it('preferences.set sem configuração → not_configured', async () => {
    stored = null;

    expect(codeOf(await invoke(INVOKE.preferencesSet, { idleHours: 4 }))).toBe('not_configured');
  });

  it('attention.test dispara o aviso completo', async () => {
    expect((await invoke(INVOKE.attentionTest)).ok).toBe(true);
    expect(mocks.attentionTest).toHaveBeenCalled();
  });

  it('pickCertificate cancelado → null; arquivo que não é autoridade → invalid_input', async () => {
    expect(await invoke(INVOKE.connectionPickCertificate)).toEqual({ ok: true, data: null });

    mocks.pickCertificateFile.mockResolvedValue({ content: certificates.leafOnly });
    expect(codeOf(await invoke(INVOKE.connectionPickCertificate))).toBe('invalid_input');

    mocks.pickCertificateFile.mockResolvedValue({ content: certificates.authority.certificatePem });
    const picked = await invoke(INVOKE.connectionPickCertificate);
    expect(picked).toMatchObject({ ok: true, data: { info: { isCertificateAuthority: true } } });
  });
});
