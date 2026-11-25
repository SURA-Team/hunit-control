/**
 * Canais da ponte do envio ao Comercial (specs/005, contracts/ipc.md): envios (com o pedido de
 * token, como as execuções), retornos do Comercial, planilha, "selecionar todas do filtro",
 * "Verificar" em lote e "Copiar para e-mail".
 *
 * Mesmas regras dos outros canais: entrada validada antes de qualquer efeito (até 2 000 reservas),
 * `Result` em toda resposta, usuário e senha do Hunit tirados do cofre do principal e nunca
 * devolvidos à interface. Quem decide o que cada reserva aceita é o servidor.
 */
import { INVOKE } from '../shared/ipc-channels.js';
import {
  copyReservationsInputSchema,
  dispatchIdSchema,
  dispatchListInputSchema,
  dispatchTokenInputSchema,
  confirmReturnsInputSchema,
  rejectCancellationInputSchema,
  rejectReturnInputSchema,
  reservationFiltersSchema,
  reservationKeySchema,
  reservationsInputSchema,
  returnIdSchema,
} from '../shared/ipc-schemas.js';
import type {
  AppError,
  CopyResult,
  JobRef,
  ReservationFilters,
  Result,
} from '../shared/ipc-types.js';
import type { ApiClient } from './api-client.js';
import { buildCopy, toCopySource, type CopyContent } from './clipboard.js';
import type { CredentialsVault } from './credentials-vault.js';
import type { ExecutionWatcher } from './execution-watcher.js';
import { fail, handle, handleNoInput, ok, type InvokeHandlers } from './ipc-handlers.js';

type CommercialApi = Pick<
  ApiClient,
  | 'selectReservations'
  | 'confirmTreatmentReviews'
  | 'checkCommercialDispatch'
  | 'startCommercialDispatch'
  | 'listCommercialDispatches'
  | 'getCommercialDispatch'
  | 'resumeCommercialDispatch'
  | 'cancelCommercialDispatch'
  | 'sendDispatchToken'
  | 'getReservationCommercial'
  | 'cancelCommercialLine'
  | 'restoreCommercialLine'
  | 'confirmCommercialReturn'
  | 'rejectCommercialReturn'
  | 'undoCommercialReturnConfirmation'
  | 'confirmCommercialReturns'
  | 'getCommercialSheetStatus'
  | 'readCommercialSheet'
  | 'listHunitCharges'
  | 'checkHunitCharges'
  | 'confirmCommercialCancellation'
  | 'rejectCommercialCancellation'
>;

export interface CommercialServices {
  /** Cliente da API da configuração atual; `null` = não configurado. */
  getApi(): CommercialApi | null;
  vault: Pick<CredentialsVault, 'take'>;
  watcher: Pick<ExecutionWatcher, 'track' | 'watch' | 'unwatch' | 'noteTokenSent'>;
  reportFailure(error: AppError): void;
  /** Grava na área de transferência do sistema (HTML e texto). */
  writeClipboard(content: CopyContent): Promise<void>;
  now?: () => Date;
}

const NOT_CONFIGURED: AppError = {
  code: 'not_configured',
  detail: 'Configure a conexão com o servidor.',
};

const SELECTION_DESCRIPTION = 'Reservas selecionadas';
const FILTER_DESCRIPTION = 'Resultado da pesquisa';

const dispatchJob = (id: string): JobRef => ({ kind: 'dispatch', id });

/** O esquema confere os campos; os valores de enum são conferidos pelo servidor. */
const asFilters = (filters: unknown) => filters as ReservationFilters;

export function createCommercialHandlers(services: CommercialServices): InvokeHandlers {
  const now = services.now ?? (() => new Date());

  async function withApi<T>(call: (api: CommercialApi) => Promise<Result<T>>): Promise<Result<T>> {
    const api = services.getApi();
    if (!api) return fail(NOT_CONFIGURED);
    const result = await call(api);
    if (!result.ok) services.reportFailure(result.error);
    return result;
  }

  return {
    // ------------------------------------------------------------- seleção e "Verificar" em lote
    [INVOKE.reservationsSelectAll]: handle(reservationFiltersSchema, (filters) =>
      withApi((api) => api.selectReservations(asFilters(filters))),
    ),

    [INVOKE.treatmentsConfirmReviews]: handle(reservationsInputSchema, (input) =>
      withApi((api) => api.confirmTreatmentReviews(input.reservations)),
    ),

    // ---------------------------------------------------------------------------------- envios
    [INVOKE.dispatchesCheck]: handle(reservationsInputSchema, (input) =>
      withApi((api) => api.checkCommercialDispatch(input.reservations)),
    ),

    [INVOKE.dispatchesStart]: handle(reservationsInputSchema, async (input) => {
      const credentials = services.vault.take();
      if (!credentials.ok) return credentials;
      const started = await withApi((api) =>
        api.startCommercialDispatch({
          credentials: credentials.data,
          reservations: input.reservations,
        }),
      );
      if (started.ok) services.watcher.track(dispatchJob(started.data.id), { own: true });
      return started;
    }),

    [INVOKE.dispatchesList]: handle(dispatchListInputSchema, (input) =>
      withApi((api) => api.listCommercialDispatches(input)),
    ),

    [INVOKE.dispatchesGet]: handle(dispatchIdSchema, (dispatchId) =>
      withApi((api) => api.getCommercialDispatch(dispatchId)),
    ),

    [INVOKE.dispatchesResume]: handle(dispatchIdSchema, async (dispatchId) => {
      const credentials = services.vault.take();
      if (!credentials.ok) return credentials;
      const resumed = await withApi((api) =>
        api.resumeCommercialDispatch(dispatchId, credentials.data),
      );
      if (resumed.ok) services.watcher.track(dispatchJob(resumed.data.id), { own: true });
      return resumed;
    }),

    [INVOKE.dispatchesCancel]: handle(dispatchIdSchema, (dispatchId) =>
      withApi((api) => api.cancelCommercialDispatch(dispatchId)),
    ),

    [INVOKE.dispatchesSendToken]: handle(dispatchTokenInputSchema, (input) => {
      // Marcado antes do envio: a saída da espera pode chegar antes da resposta do POST.
      services.watcher.noteTokenSent(dispatchJob(input.dispatchId));
      return withApi((api) => api.sendDispatchToken(input.dispatchId, input.token));
    }),

    [INVOKE.dispatchesWatch]: handle(dispatchIdSchema, (dispatchId) => {
      services.watcher.watch(dispatchJob(dispatchId));
      return Promise.resolve(ok(undefined));
    }),

    [INVOKE.dispatchesUnwatch]: handle(dispatchIdSchema, (dispatchId) => {
      services.watcher.unwatch(dispatchJob(dispatchId));
      return Promise.resolve(ok(undefined));
    }),

    // ------------------------------------------------------------- linha, retornos e planilha
    [INVOKE.commercialGet]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.getReservationCommercial(key)),
    ),

    [INVOKE.commercialCancelLine]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.cancelCommercialLine(key)),
    ),

    [INVOKE.commercialRestoreLine]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.restoreCommercialLine(key)),
    ),

    [INVOKE.commercialConfirmReturn]: handle(returnIdSchema, (returnId) =>
      withApi((api) => api.confirmCommercialReturn(returnId)),
    ),

    [INVOKE.commercialRejectReturn]: handle(rejectReturnInputSchema, (input) =>
      withApi((api) => api.rejectCommercialReturn(input.returnId, input.reason)),
    ),

    [INVOKE.commercialUndoConfirmation]: handle(returnIdSchema, (returnId) =>
      withApi((api) => api.undoCommercialReturnConfirmation(returnId)),
    ),

    [INVOKE.commercialConfirmReturns]: handle(confirmReturnsInputSchema, (input) =>
      withApi((api) =>
        api.confirmCommercialReturns(input.reservations, input.includeCancellations === true),
      ),
    ),

    // A "Cancelada" do Comercial (homologação da 008, R-19).
    [INVOKE.commercialConfirmCancellation]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.confirmCommercialCancellation(key)),
    ),

    [INVOKE.commercialRejectCancellation]: handle(rejectCancellationInputSchema, (input) =>
      withApi((api) => api.rejectCommercialCancellation(input.key, input.reason)),
    ),

    [INVOKE.commercialSheetStatus]: handleNoInput(() =>
      withApi((api) => api.getCommercialSheetStatus()),
    ),

    [INVOKE.commercialReadNow]: handleNoInput(() => withApi((api) => api.readCommercialSheet())),

    // ------------------------------------------------- fila "Cobradas no Hunit" (specs/008)
    [INVOKE.commercialHunitCharges]: handleNoInput(() => withApi((api) => api.listHunitCharges())),

    [INVOKE.commercialCheckHunitCharges]: handleNoInput(async () => {
      // Credenciais do cofre, como o envio; sem elas, o mesmo erro (a tela pede as credenciais).
      const credentials = services.vault.take();
      if (!credentials.ok) return credentials;
      const started = await withApi((api) =>
        api.checkHunitCharges({ credentials: credentials.data }),
      );
      if (started.ok) services.watcher.track(dispatchJob(started.data.id), { own: true });
      return started;
    }),

    // ------------------------------------------------------------------ "Copiar para e-mail"
    [INVOKE.clipboardCopyReservations]: handle(
      copyReservationsInputSchema,
      async (input): Promise<Result<CopyResult>> => {
        if (input.source === 'selection') {
          const sources = input.rows.map(toCopySource);
          if (sources.some((source) => source === null)) {
            return fail({ code: 'invalid_input', detail: 'Situação de reserva desconhecida.' });
          }
          await services.writeClipboard(
            buildCopy(sources as NonNullable<(typeof sources)[number]>[], {
              description: SELECTION_DESCRIPTION,
              at: now(),
            }),
          );
          return ok({ copied: sources.length, total: sources.length, truncated: false });
        }

        const selected = await withApi((api) => api.selectReservations(asFilters(input.filters)));
        if (!selected.ok) return selected;
        const { items, total, truncated } = selected.data;
        if (items.length === 0) {
          return fail({ code: 'invalid_input', detail: 'Nenhuma reserva para copiar.' });
        }
        // `toCopySource` só lê as colunas da cópia: o nome do hóspede da seleção fica de fora.
        const sources = items.map(toCopySource);
        if (sources.some((source) => source === null)) {
          return fail({ code: 'internal_error' });
        }
        await services.writeClipboard(
          buildCopy(sources as NonNullable<(typeof sources)[number]>[], {
            description: input.description ?? FILTER_DESCRIPTION,
            at: now(),
            totalFound: total,
          }),
        );
        return ok({ copied: items.length, total, truncated });
      },
    ),
  };
}
