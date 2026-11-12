/**
 * Manipuladores da ponte entre a interface e o processo principal (specs/002, contracts/ipc.md,
 * research R-02).
 *
 * Regras de todos os canais:
 * - a entrada é validada com os esquemas de `shared/ipc-schemas.ts` antes de qualquer efeito;
 *   entrada inválida devolve `invalid_input` sem chamar a API nem tocar no disco;
 * - toda resposta é um `Result`; erros inesperados viram `internal_error` sem a mensagem interna;
 * - nada sensível volta para a interface: nem a chave da API, nem a senha do Hunit.
 */
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import {
  connectionInputSchema,
  credentialsInputSchema,
  preferencesInputSchema,
} from '../shared/ipc-schemas.js';
import { INVOKE, type InvokeChannel } from '../shared/ipc-channels.js';
import type {
  AppError,
  ConnectionState,
  Preferences,
  PublicConfig,
  Result,
} from '../shared/ipc-types.js';
import { CertificateError, describeCertificate, readCertificate } from './certificate.js';
import {
  ConfigStoreError,
  type LoadResult,
  type SaveConfigInput,
  type StoredConfig,
} from './config-store.js';
import type { ConnectionApi } from './connection.js';
import type { CredentialsVault } from './credentials-vault.js';

export type InvokeHandler = (input: unknown) => Promise<Result<unknown>>;
export type InvokeHandlers = Partial<Record<InvokeChannel, InvokeHandler>>;

/** Serviços do processo principal usados pelos canais da fundação. */
export interface IpcServices {
  appVersion: string;
  config: {
    load(): Promise<LoadResult>;
    save(input: SaveConfigInput): Promise<StoredConfig>;
    setPreferences(input: { soundEnabled?: boolean; idleHours?: number }): Promise<Preferences>;
    decryptApiKey(config: StoredConfig): string;
    remove(): Promise<void>;
  };
  connection: {
    getState(): ConnectionState;
    reconnect(): Promise<void>;
  };
  vault: Pick<CredentialsVault, 'status' | 'set' | 'clear' | 'setIdleHours'>;
  attention: { test(): void };
  dialogs: {
    /** Abre "Abrir arquivo" para o certificado; devolve o conteúdo ou `null` (cancelado). */
    pickCertificateFile(): Promise<{ content: string } | null>;
  };
  /** Cliente da API para testar uma configuração antes de salvá-la. */
  createApi(input: { serverUrl: string; caCertificatePem: string; apiKey: string }): ConnectionApi;
  /** Preferências mudaram (o som do aviso é lido daqui). */
  onPreferences?(preferences: Preferences): void;
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(error: AppError): Result<never> {
  return { ok: false, error };
}

/**
 * Entrada inválida: diz qual campo e qual regra, nunca o valor (que pode ser a senha ou a chave).
 */
export function invalidInput(error: z.ZodError): Result<never> {
  const issue = error.issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.join('.') : 'entrada';
  return fail({ code: 'invalid_input', detail: `${field}: ${issue?.message ?? 'inválido'}` });
}

/** Valida a entrada e só então executa; qualquer erro inesperado vira `internal_error`. */
export function handle<S extends z.ZodType, T>(
  schema: S,
  run: (input: z.output<S>) => Promise<Result<T>>,
): InvokeHandler {
  return async (input) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    return guard(() => run(parsed.data));
  };
}

/** Canal sem entrada. */
export function handleNoInput<T>(run: () => Promise<Result<T>>): InvokeHandler {
  return () => guard(run);
}

async function guard<T>(run: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CertificateError) {
      return fail({ code: 'invalid_input', detail: error.message });
    }
    if (error instanceof ConfigStoreError) {
      switch (error.code) {
        case 'key_storage_unavailable':
          return fail({ code: 'key_storage_unavailable', detail: error.message });
        case 'not_configured':
          return fail({ code: 'not_configured', detail: error.message });
        default:
          return fail({ code: 'invalid_input', detail: error.message });
      }
    }
    return fail({ code: 'internal_error', detail: 'Erro inesperado no app.' });
  }
}

/** Identifica os dados testados sem guardá-los: endereço, certificado e chave. */
function testedKey(serverUrl: string, certificatePem: string, apiKey: string): string {
  return createHash('sha256')
    .update(JSON.stringify([serverUrl, certificatePem.trim(), apiKey]))
    .digest('hex');
}

function toPublicConfig(config: StoredConfig): PublicConfig {
  const certificate = describeCertificate(config.certificatePem) ?? {
    fingerprint256: config.caFingerprint256,
    subject: '',
    issuer: '',
    validTo: '',
    isCertificateAuthority: false,
  };
  return {
    serverUrl: config.serverUrl,
    certificate,
    hasApiKey: config.apiKeyCiphertext.length > 0,
    preferences: config.preferences,
  };
}

/** Canais da fundação: app, conexão, preferências, acesso ao Hunit e "Testar aviso". */
export function createInvokeHandlers(services: IpcServices): InvokeHandlers {
  /** Dados do último teste de conexão que deu certo; o "Salvar" exige os mesmos (FR-001). */
  let lastTested: string | null = null;

  async function storedConfig(): Promise<StoredConfig | null> {
    const loaded = await services.config.load();
    return loaded.status === 'ok' ? loaded.config : null;
  }

  /** A chave informada ou, se omitida, a já guardada. */
  async function resolveApiKey(apiKey: string | undefined): Promise<Result<string>> {
    if (apiKey !== undefined) return ok(apiKey);
    const stored = await storedConfig();
    if (!stored) return fail({ code: 'invalid_input', detail: 'Informe a chave de acesso.' });
    return ok(services.config.decryptApiKey(stored));
  }

  return {
    [INVOKE.appInfo]: handleNoInput(() => Promise.resolve(ok({ version: services.appVersion }))),

    [INVOKE.connectionGetState]: handleNoInput(() =>
      Promise.resolve(ok(services.connection.getState())),
    ),

    [INVOKE.connectionGetConfig]: handleNoInput(async () => {
      const stored = await storedConfig();
      return ok(stored ? toPublicConfig(stored) : null);
    }),

    [INVOKE.connectionPickCertificate]: handleNoInput(async () => {
      const picked = await services.dialogs.pickCertificateFile();
      if (!picked) return ok(null);
      const certificate = readCertificate(picked.content);
      return ok({ pem: certificate.pem, info: certificate.info });
    }),

    [INVOKE.connectionTest]: handle(connectionInputSchema, async (input) => {
      readCertificate(input.certificatePem);
      const apiKey = await resolveApiKey(input.apiKey);
      if (!apiKey.ok) return apiKey;

      const api = services.createApi({
        serverUrl: input.serverUrl,
        caCertificatePem: input.certificatePem,
        apiKey: apiKey.data,
      });
      try {
        const health = await api.getHealth();
        if (!health.ok) return health;
        const me = await api.getMe();
        if (!me.ok) return me;
        lastTested = testedKey(input.serverUrl, input.certificatePem, apiKey.data);
        return ok(me.data);
      } finally {
        await api.close();
      }
    }),

    [INVOKE.connectionSave]: handle(connectionInputSchema, async (input) => {
      const certificate = readCertificate(input.certificatePem);
      const apiKey = await resolveApiKey(input.apiKey);
      if (!apiKey.ok) return apiKey;
      if (lastTested !== testedKey(input.serverUrl, input.certificatePem, apiKey.data)) {
        return fail({
          code: 'invalid_input',
          detail: 'Teste a conexão com estes dados antes de salvar.',
        });
      }

      const saved = await services.config.save({
        serverUrl: input.serverUrl,
        certificatePem: input.certificatePem,
        caFingerprint256: certificate.info.fingerprint256,
        apiKey: input.apiKey,
      });
      lastTested = null;
      await services.connection.reconnect();
      return ok(toPublicConfig(saved));
    }),

    [INVOKE.connectionRemove]: handleNoInput(async () => {
      await services.config.remove();
      lastTested = null;
      await services.connection.reconnect();
      return ok(undefined);
    }),

    [INVOKE.preferencesSet]: handle(preferencesInputSchema, async (input) => {
      if (!(await storedConfig())) {
        return fail({ code: 'not_configured', detail: 'Configure a conexão com o servidor.' });
      }
      const preferences = await services.config.setPreferences(input);
      if (input.idleHours !== undefined) services.vault.setIdleHours(preferences.idleHours);
      services.onPreferences?.(preferences);
      return ok(preferences);
    }),

    [INVOKE.attentionTest]: handleNoInput(() => {
      services.attention.test();
      return Promise.resolve(ok(undefined));
    }),

    [INVOKE.credentialsStatus]: handleNoInput(() => Promise.resolve(ok(services.vault.status()))),

    [INVOKE.credentialsSet]: handle(credentialsInputSchema, (input) =>
      Promise.resolve(ok(services.vault.set(input))),
    ),

    [INVOKE.credentialsClear]: handleNoInput(() => Promise.resolve(ok(services.vault.clear()))),
  };
}
