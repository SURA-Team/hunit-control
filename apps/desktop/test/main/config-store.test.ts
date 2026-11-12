/**
 * Configuração gravada na máquina (specs/002, T016, FR-001 a FR-003, research R-04, data-model §1):
 * só o `config.json`, com a chave da API sempre cifrada pelo `safeStorage` (DPAPI no Windows).
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigStore,
  ConfigStoreError,
  type SafeStorageLike,
} from '../../src/main/config-store.js';

const API_KEY = 'hunit_CHAVE-DE-TESTE-MARCADOR-0001';
const PEM = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
const FINGERPRINT = 'AA:BB:CC';

/** Cifra simulada: inverte o texto e marca o começo, para o teste saber que passou por ela. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`cifrado:${[...plain].reverse().join('')}`, 'utf8'),
    decryptString: (encrypted) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('cifrado:')) throw new Error('não foi cifrado por mim');
      return [...text.slice('cifrado:'.length)].reverse().join('');
    },
  };
}

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hunit-desktop-config-'));
  filePath = path.join(dir, 'config.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function newStore(safeStorage = fakeSafeStorage()) {
  return new ConfigStore({ filePath, safeStorage });
}

const connection = {
  serverUrl: 'https://192.168.0.50',
  certificatePem: PEM,
  caFingerprint256: FINGERPRINT,
  apiKey: API_KEY,
};

describe('ConfigStore', () => {
  it('sem arquivo, o app não está configurado', async () => {
    expect(await newStore().load()).toEqual({ status: 'missing' });
  });

  it('grava no formato do data-model, com a chave só cifrada', async () => {
    await newStore().save(connection);

    const raw = await readFile(filePath, 'utf8');
    expect(raw).not.toContain(API_KEY);
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      server: { url: 'https://192.168.0.50', caCertificatePem: PEM, caFingerprint256: FINGERPRINT },
      apiKey: { ciphertext: expect.any(String) as string },
      preferences: { soundEnabled: true, idleHours: 8 },
    });
  });

  it('lê o que gravou e decifra a chave', async () => {
    const store = newStore();
    await store.save(connection);

    const loaded = await newStore().load();

    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.config.serverUrl).toBe('https://192.168.0.50');
    expect(store.decryptApiKey(loaded.config)).toBe(API_KEY);
  });

  it('salvar sem chave mantém a chave já guardada', async () => {
    const store = newStore();
    await store.save(connection);
    await store.save({ ...connection, serverUrl: 'https://10.0.0.9', apiKey: undefined });

    const loaded = await store.load();
    if (loaded.status !== 'ok') throw new Error('esperava configuração');
    expect(loaded.config.serverUrl).toBe('https://10.0.0.9');
    expect(store.decryptApiKey(loaded.config)).toBe(API_KEY);
  });

  it('salvar sem chave e sem chave anterior é recusado', async () => {
    await expect(newStore().save({ ...connection, apiKey: undefined })).rejects.toThrow(
      ConfigStoreError,
    );
  });

  it('recusa salvar quando o Windows não oferece a cifra, sem gravar nada', async () => {
    const store = newStore(fakeSafeStorage(false));

    await expect(store.save(connection)).rejects.toThrow(
      expect.objectContaining({ code: 'key_storage_unavailable' }) as Error,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([
    ['JSON quebrado', '{ isto não é json'],
    ['versão desconhecida', JSON.stringify({ version: 2 })],
    ['campo faltando', JSON.stringify({ version: 1, server: { url: 'https://x' } })],
    [
      'endereço sem https',
      JSON.stringify({
        version: 1,
        server: { url: 'http://x', caCertificatePem: PEM, caFingerprint256: FINGERPRINT },
        apiKey: { ciphertext: 'abc' },
        preferences: { soundEnabled: true, idleHours: 8 },
      }),
    ],
  ])('arquivo inválido (%s) → não configurado', async (_caso, content) => {
    await writeFile(filePath, content);

    expect(await newStore().load()).toEqual({ status: 'invalid' });
  });

  it('a escrita é atômica: não sobra arquivo temporário', async () => {
    const store = newStore();
    await store.save(connection);
    await store.setPreferences({ soundEnabled: false });

    expect(await readdir(dir)).toEqual(['config.json']);
  });

  it('muda as preferências sem mexer no resto', async () => {
    const store = newStore();
    await store.save(connection);

    expect(await store.setPreferences({ idleHours: 12 })).toEqual({
      soundEnabled: true,
      idleHours: 12,
    });
    const loaded = await store.load();
    if (loaded.status !== 'ok') throw new Error('esperava configuração');
    expect(loaded.config.preferences).toEqual({ soundEnabled: true, idleHours: 12 });
    expect(store.decryptApiKey(loaded.config)).toBe(API_KEY);
  });

  it.each([0, 25, 1.5])(
    'recusa prazo de inatividade fora de 1 a 24 horas (%s)',
    async (idleHours) => {
      const store = newStore();
      await store.save(connection);

      await expect(store.setPreferences({ idleHours })).rejects.toThrow(ConfigStoreError);
    },
  );

  it('remove apaga o arquivo', async () => {
    const store = newStore();
    await store.save(connection);

    await store.remove();

    expect(await readdir(dir)).toEqual([]);
    expect(await store.load()).toEqual({ status: 'missing' });
  });
});
