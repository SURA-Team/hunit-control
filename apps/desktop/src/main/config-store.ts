/**
 * Configuração gravada na máquina (specs/002, FR-001 a FR-003, research R-04, data-model §1).
 *
 * O app grava somente `config.json` na pasta de dados do usuário: endereço do servidor,
 * certificado raiz (público), a chave da API **cifrada** pelo `safeStorage` (DPAPI no Windows: só o
 * mesmo usuário do Windows decifra) e as preferências. Se a cifra não estiver disponível, a chave
 * não é gravada — não existe gravação em texto puro.
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { idleHoursSchema, serverUrlSchema } from '../shared/ipc-schemas.js';
import type { Preferences, PreferencesInput } from '../shared/ipc-types.js';

/** O que o app precisa do `safeStorage` do Electron (simulado nos testes). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface StoredConfig {
  serverUrl: string;
  certificatePem: string;
  caFingerprint256: string;
  /** Chave da API cifrada, em base64. */
  apiKeyCiphertext: string;
  preferences: Preferences;
}

export type LoadResult =
  | { status: 'ok'; config: StoredConfig }
  | { status: 'missing' }
  /** Arquivo ilegível ou fora do formato: o app é tratado como não configurado. */
  | { status: 'invalid' };

export interface SaveConfigInput {
  serverUrl: string;
  certificatePem: string;
  caFingerprint256: string;
  /** Omitida = mantém a chave já guardada. */
  apiKey?: string | undefined;
}

export type ConfigStoreErrorCode =
  'key_storage_unavailable' | 'missing_api_key' | 'invalid_preferences' | 'not_configured';

export class ConfigStoreError extends Error {
  constructor(
    readonly code: ConfigStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigStoreError';
  }
}

export const DEFAULT_PREFERENCES: Preferences = { soundEnabled: true, idleHours: 8 };

const fileSchema = z.object({
  version: z.literal(1),
  server: z.object({
    url: serverUrlSchema,
    caCertificatePem: z.string().includes('-----BEGIN CERTIFICATE-----'),
    caFingerprint256: z.string().min(1),
  }),
  apiKey: z.object({ ciphertext: z.string().min(1) }),
  preferences: z.object({ soundEnabled: z.boolean(), idleHours: idleHoursSchema }),
});

type ConfigFile = z.input<typeof fileSchema>;

export interface ConfigStoreOptions {
  /** Caminho do `config.json` (pasta de dados do app). */
  filePath: string;
  safeStorage: SafeStorageLike;
}

export class ConfigStore {
  constructor(private readonly options: ConfigStoreOptions) {}

  async load(): Promise<LoadResult> {
    let raw: string;
    try {
      raw = await readFile(this.options.filePath, 'utf8');
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') return { status: 'missing' };
      return { status: 'invalid' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'invalid' };
    }
    const file = fileSchema.safeParse(parsed);
    if (!file.success) return { status: 'invalid' };

    const { server, apiKey, preferences } = file.data;
    return {
      status: 'ok',
      config: {
        serverUrl: server.url,
        certificatePem: server.caCertificatePem,
        caFingerprint256: server.caFingerprint256,
        apiKeyCiphertext: apiKey.ciphertext,
        preferences,
      },
    };
  }

  /**
   * Grava a configuração da conexão. Sem `apiKey`, mantém a chave já guardada.
   *
   * @throws ConfigStoreError `key_storage_unavailable` (sem cifra) ou `missing_api_key`.
   */
  async save(input: SaveConfigInput): Promise<StoredConfig> {
    const current = await this.load();
    const previous = current.status === 'ok' ? current.config : null;

    let apiKeyCiphertext: string;
    if (input.apiKey !== undefined) {
      apiKeyCiphertext = this.encrypt(input.apiKey);
    } else if (previous) {
      apiKeyCiphertext = previous.apiKeyCiphertext;
    } else {
      throw new ConfigStoreError('missing_api_key', 'Informe a chave de acesso do servidor.');
    }

    const config: StoredConfig = {
      serverUrl: input.serverUrl,
      certificatePem: input.certificatePem,
      caFingerprint256: input.caFingerprint256,
      apiKeyCiphertext,
      preferences: previous?.preferences ?? DEFAULT_PREFERENCES,
    };
    await this.write(config);
    return config;
  }

  /** @throws ConfigStoreError `not_configured` ou `invalid_preferences`. */
  async setPreferences(input: PreferencesInput): Promise<Preferences> {
    const current = await this.load();
    if (current.status !== 'ok') {
      throw new ConfigStoreError('not_configured', 'Configure a conexão com o servidor.');
    }
    const preferences: Preferences = {
      soundEnabled: input.soundEnabled ?? current.config.preferences.soundEnabled,
      idleHours: input.idleHours ?? current.config.preferences.idleHours,
    };
    if (!idleHoursSchema.safeParse(preferences.idleHours).success) {
      throw new ConfigStoreError(
        'invalid_preferences',
        'O prazo de inatividade deve ser de 1 a 24 horas.',
      );
    }
    await this.write({ ...current.config, preferences });
    return preferences;
  }

  /** A chave da API em texto puro; só o processo principal a usa, e só em memória. */
  decryptApiKey(config: StoredConfig): string {
    return this.options.safeStorage.decryptString(Buffer.from(config.apiKeyCiphertext, 'base64'));
  }

  async remove(): Promise<void> {
    await rm(this.options.filePath, { force: true });
  }

  private encrypt(apiKey: string): string {
    const { safeStorage } = this.options;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ConfigStoreError(
        'key_storage_unavailable',
        'O Windows não permitiu guardar a chave protegida; ela não foi salva.',
      );
    }
    return safeStorage.encryptString(apiKey).toString('base64');
  }

  /** Escrita atômica: arquivo temporário na mesma pasta e renomeação por cima do anterior. */
  private async write(config: StoredConfig): Promise<void> {
    const file: ConfigFile = {
      version: 1,
      server: {
        url: config.serverUrl,
        caCertificatePem: config.certificatePem,
        caFingerprint256: config.caFingerprint256,
      },
      apiKey: { ciphertext: config.apiKeyCiphertext },
      preferences: config.preferences,
    };
    const temporary = `${this.options.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.options.filePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
