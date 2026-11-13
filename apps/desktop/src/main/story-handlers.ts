/**
 * Canais da ponte das histórias (specs/002, contracts/ipc.md): executar e responder ao token (US1),
 * acompanhar, cancelar e retomar (US2), consultar reservas e evidências (US3).
 *
 * Mesmas regras dos canais da fundação (ipc-handlers.ts): entrada validada antes de qualquer
 * efeito, `Result` em toda resposta, nada sensível de volta. Usuário e senha do Hunit saem do cofre
 * do processo principal, nunca da interface. Erros de rede, certificado ou chave atualizam o estado
 * da conexão.
 */
import { INVOKE } from '../shared/ipc-channels.js';
import {
  evidenceSaveInputSchema,
  executionIdSchema,
  executionListInputSchema,
  reservationKeySchema,
  reservationListInputSchema,
  sendTokenInputSchema,
  startExecutionInputSchema,
} from '../shared/ipc-schemas.js';
import type { AppError, EvidenceFile, Result } from '../shared/ipc-types.js';
import type { ApiClient } from './api-client.js';
import type { CredentialsVault } from './credentials-vault.js';
import type { ExecutionWatcher } from './execution-watcher.js';
import { fail, handle, handleNoInput, type InvokeHandlers } from './ipc-handlers.js';

export interface StoryServices {
  /** Cliente da API da configuração atual; `null` = não configurado. */
  getApi(): ApiClient | null;
  vault: Pick<CredentialsVault, 'take'>;
  watcher: Pick<ExecutionWatcher, 'track' | 'watch' | 'unwatch' | 'noteTokenSent'>;
  reportFailure(error: AppError): void;
  /** Baixa e grava uma evidência onde o operador escolher (US3). */
  saveEvidence?: (input: {
    api: ApiClient;
    evidenceId: string;
    file: EvidenceFile;
    label?: string | undefined;
  }) => Promise<Result<{ savedTo: string } | null>>;
}

const NOT_CONFIGURED: AppError = {
  code: 'not_configured',
  detail: 'Configure a conexão com o servidor.',
};

export function createStoryHandlers(services: StoryServices): InvokeHandlers {
  /** Chama a API da configuração atual e repassa ao estado da conexão as falhas de rede. */
  async function withApi<T>(call: (api: ApiClient) => Promise<Result<T>>): Promise<Result<T>> {
    const api = services.getApi();
    if (!api) return fail(NOT_CONFIGURED);
    const result = await call(api);
    if (!result.ok) services.reportFailure(result.error);
    return result;
  }

  return {
    // -------------------------------------------------------------------------- US1
    [INVOKE.hotelsList]: handleNoInput(() => withApi((api) => api.listHotels())),

    [INVOKE.executionsStart]: handle(startExecutionInputSchema, async (input) => {
      const credentials = services.vault.take();
      if (!credentials.ok) return credentials;
      const started = await withApi((api) =>
        api.startExecution({
          credentials: credentials.data,
          period: input.period,
          hotelCodes: input.hotelCodes,
        }),
      );
      if (started.ok) services.watcher.track(started.data.id, { own: true });
      return started;
    }),

    [INVOKE.executionsGet]: handle(executionIdSchema, (executionId) =>
      withApi((api) => api.getExecution(executionId)),
    ),

    [INVOKE.executionsSendToken]: handle(sendTokenInputSchema, async (input) => {
      // Marcado antes do envio: a saída da espera pode chegar antes da resposta do POST.
      services.watcher.noteTokenSent(input.executionId);
      return withApi((api) => api.sendToken(input.executionId, input.token));
    }),

    [INVOKE.executionsWatch]: handle(executionIdSchema, (executionId) => {
      services.watcher.watch(executionId);
      return Promise.resolve({ ok: true as const, data: undefined });
    }),

    [INVOKE.executionsUnwatch]: handle(executionIdSchema, (executionId) => {
      services.watcher.unwatch(executionId);
      return Promise.resolve({ ok: true as const, data: undefined });
    }),

    // -------------------------------------------------------------------------- US2
    [INVOKE.executionsList]: handle(executionListInputSchema, (input) =>
      withApi((api) => api.listExecutions(input)),
    ),

    [INVOKE.executionsCancel]: handle(executionIdSchema, (executionId) =>
      withApi((api) => api.cancelExecution(executionId)),
    ),

    [INVOKE.executionsResume]: handle(executionIdSchema, async (executionId) => {
      const credentials = services.vault.take();
      if (!credentials.ok) return credentials;
      const resumed = await withApi((api) => api.resumeExecution(executionId, credentials.data));
      if (resumed.ok) services.watcher.track(resumed.data.id, { own: true });
      return resumed;
    }),

    // -------------------------------------------------------------------------- US3
    [INVOKE.reservationsList]: handle(reservationListInputSchema, (input) =>
      withApi((api) =>
        api.listReservations({
          ...input,
          classification: input.classification as never,
          reservationStatus: input.reservationStatus as never,
        }),
      ),
    ),

    [INVOKE.reservationsGet]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.getReservation(key)),
    ),

    [INVOKE.reservationsChannels]: handleNoInput(() => withApi((api) => api.listChannels())),

    [INVOKE.evidenceList]: handle(executionIdSchema, (executionId) =>
      withApi((api) => api.listEvidence(executionId)),
    ),

    [INVOKE.evidenceSave]: handle(evidenceSaveInputSchema, (input) => {
      const { saveEvidence } = services;
      if (!saveEvidence) return Promise.resolve(fail({ code: 'internal_error' }));
      return withApi((api) => saveEvidence({ api, ...input }));
    }),
  };
}
