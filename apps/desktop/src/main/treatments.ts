/**
 * Canais da ponte das tratativas manuais (specs/003, contracts/ipc.md).
 *
 * - O arquivo escolhido fica só na memória do processo principal (`PickedFiles`): a interface
 *   recebe a pré-visualização e um id, nunca o caminho nem o nome para devolver.
 * - Quem decide o que cada reserva aceita é o servidor: a confirmação usa o `check` dele, e o
 *   registro devolve o desfecho de cada reserva. Aqui só se divide o lote em partes de 200 e se
 *   juntam as respostas (research R-05).
 * - Se a conexão cair no meio do envio, o arquivo continua na memória para "Tentar de novo".
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { INVOKE } from '../shared/ipc-channels.js';
import {
  documentIdSchema,
  manualAmountInputSchema,
  pickFileInputSchema,
  reservationKeySchema,
  selectionIdSchema,
  treatmentApplyInputSchema,
  treatmentCheckInputSchema,
} from '../shared/ipc-schemas.js';
import type {
  AppError,
  DocumentPreview,
  PickedFile,
  ReservationKey,
  ReservationOutcome,
  Result,
  TreatmentApplyResult,
  TreatmentCheck,
  TreatmentDocumentKind,
} from '../shared/ipc-types.js';
import type { ApiClient } from './api-client.js';
import type { SaveDialog } from './evidence-download.js';
import { fail, handle, ok, type InvokeHandlers } from './ipc-handlers.js';
import type { PickedFileEntry, PickedFiles } from './picked-files.js';

/** Máximo de reservas por pedido ao servidor (contrato: `maxItems: 200`). */
export const RESERVATIONS_PER_REQUEST = 200;

type TreatmentApi = Pick<
  ApiClient,
  | 'uploadTreatmentFile'
  | 'checkTreatmentDocuments'
  | 'registerTreatmentDocuments'
  | 'removeTreatmentDocument'
  | 'revertTreatmentDocument'
  | 'getReservationTreatment'
  | 'setManualChargedAmount'
  | 'clearManualChargedAmount'
  | 'confirmTreatmentReview'
  | 'downloadTreatmentDocument'
>;

export interface TreatmentServices {
  /** Cliente da API da configuração atual; `null` = não configurado. */
  getApi(): TreatmentApi | null;
  reportFailure(error: AppError): void;
  files: Pick<PickedFiles, 'pick' | 'get' | 'discard'>;
  buildPreview(file: Pick<PickedFileEntry, 'mediaType' | 'bytes'>): Promise<DocumentPreview>;
  showSaveDialog: SaveDialog;
  /** Pasta sugerida no "Salvar como" (a de Downloads do usuário). */
  defaultDirectory: string;
}

const NOT_CONFIGURED: AppError = {
  code: 'not_configured',
  detail: 'Configure a conexão com o servidor.',
};

const FILE_EXPIRED: AppError = {
  code: 'invalid_input',
  detail: 'O arquivo escolhido não está mais disponível. Escolha o arquivo de novo.',
};

const PICK_TITLES: Record<TreatmentDocumentKind, string> = {
  request: 'Escolher a tratativa',
  proof: 'Escolher o comprovante',
};

function chunks<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    parts.push(items.slice(start, start + size));
  }
  return parts;
}

/** A requisição não chegou ao servidor (ou o servidor não foi confirmado): dá para tentar de novo. */
function isConnectionError(error: AppError): boolean {
  return error.code === 'offline' || error.code === 'untrusted_server';
}

/** Soma valores "1234.56" em centavos, sem erro de ponto flutuante. */
function sumAmounts(amounts: readonly string[]): string {
  let cents = 0n;
  for (const amount of amounts) {
    const [whole = '0', fraction = ''] = amount.split('.');
    cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  }
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

const keyOf = (outcome: ReservationKey): ReservationKey => ({
  hotelCode: outcome.hotelCode,
  reservationNumber: outcome.reservationNumber,
});

/** Nome aceito pelo Windows no "Salvar como": sem `< > : " / \ | ? *` nem caracteres de controle. */
export function safeFileName(fileName: string): string {
  // eslint-disable-next-line no-control-regex -- tirar caracteres de controle é o objetivo.
  const safe = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return safe === '' ? 'documento' : safe;
}

export function createTreatmentHandlers(services: TreatmentServices): InvokeHandlers {
  /** Chama a API da configuração atual e repassa ao estado da conexão as falhas de rede. */
  async function withApi<T>(call: (api: TreatmentApi) => Promise<Result<T>>): Promise<Result<T>> {
    const api = services.getApi();
    if (!api) return fail(NOT_CONFIGURED);
    const result = await call(api);
    if (!result.ok) services.reportFailure(result.error);
    return result;
  }

  return {
    [INVOKE.treatmentsPickFile]: handle(pickFileInputSchema, async ({ kind }) => {
      const picked = await services.files.pick(PICK_TITLES[kind]);
      if (!picked.ok) return picked;
      const entry = picked.data;
      if (entry === null) return ok(null);
      const file: PickedFile = {
        selectionId: entry.selectionId,
        fileName: entry.fileName,
        sizeBytes: entry.sizeBytes,
        mediaType: entry.mediaType,
        preview: await services.buildPreview(entry),
      };
      return ok(file);
    }),

    [INVOKE.treatmentsDiscardFile]: handle(selectionIdSchema, (selectionId) => {
      services.files.discard(selectionId);
      return Promise.resolve(ok(undefined));
    }),

    /** Conferência do servidor, em partes de 200, com as respostas somadas. */
    [INVOKE.treatmentsCheck]: handle(treatmentCheckInputSchema, async (input) => {
      const total: TreatmentCheck = {
        items: [],
        acceptedCount: 0,
        replacingCount: 0,
        ignoredCount: 0,
        acceptedTotalAmount: '0.00',
      };
      for (const reservations of chunks(input.reservations, RESERVATIONS_PER_REQUEST)) {
        const part = await withApi((api) =>
          api.checkTreatmentDocuments({ kind: input.kind, reservations }),
        );
        if (!part.ok) return part;
        total.items.push(...part.data.items);
        total.acceptedCount += part.data.acceptedCount;
        total.replacingCount += part.data.replacingCount;
        total.ignoredCount += part.data.ignoredCount;
        total.acceptedTotalAmount = sumAmounts([
          total.acceptedTotalAmount,
          part.data.acceptedTotalAmount,
        ]);
      }
      return ok(total);
    }),

    /**
     * Envia o arquivo uma vez e o registra nas reservas, em partes de 200. Com o servidor fora do
     * ar, devolve `retryable` e mantém o arquivo; em qualquer outro desfecho, libera a memória.
     */
    [INVOKE.treatmentsApply]: handle(treatmentApplyInputSchema, async (input) => {
      const entry = services.files.get(input.selectionId);
      if (!entry) return fail(FILE_EXPIRED);

      const interrupted = (
        items: ReservationOutcome[],
        pending: readonly ReservationKey[],
        error: AppError,
      ): Result<TreatmentApplyResult> => {
        const retryable = isConnectionError(error);
        if (!retryable) services.files.discard(input.selectionId);
        const failed = items.filter((item) => item.outcome === 'failed').map(keyOf);
        return ok({ items, failedKeys: [...failed, ...pending], retryable, error });
      };

      const upload = await withApi((api) => api.uploadTreatmentFile(entry.fileName, entry.bytes));
      if (!upload.ok) {
        if (isConnectionError(upload.error))
          return interrupted([], input.reservations, upload.error);
        // O servidor recusou o arquivo (tipo, tamanho, perfil): não adianta tentar de novo.
        services.files.discard(input.selectionId);
        return upload;
      }

      const items: ReservationOutcome[] = [];
      const parts = chunks(input.reservations, RESERVATIONS_PER_REQUEST);
      for (const [index, reservations] of parts.entries()) {
        const registered = await withApi((api) =>
          api.registerTreatmentDocuments({
            kind: input.kind,
            fileId: upload.data.fileId,
            fileName: entry.fileName,
            reservations,
          }),
        );
        if (!registered.ok) {
          return interrupted(items, parts.slice(index).flat(), registered.error);
        }
        items.push(...registered.data.items);
      }

      services.files.discard(input.selectionId);
      return ok({
        items,
        failedKeys: items.filter((item) => item.outcome === 'failed').map(keyOf),
        retryable: false,
      });
    }),

    [INVOKE.treatmentsGet]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.getReservationTreatment(key)),
    ),

    [INVOKE.treatmentsRemove]: handle(documentIdSchema, (documentId) =>
      withApi((api) => api.removeTreatmentDocument(documentId)),
    ),

    [INVOKE.treatmentsRevert]: handle(documentIdSchema, (documentId) =>
      withApi((api) => api.revertTreatmentDocument(documentId)),
    ),

    [INVOKE.treatmentsSetManualAmount]: handle(manualAmountInputSchema, ({ amount, ...key }) =>
      withApi((api) => api.setManualChargedAmount(key, amount)),
    ),

    [INVOKE.treatmentsClearManualAmount]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.clearManualChargedAmount(key)),
    ),

    [INVOKE.treatmentsConfirmReview]: handle(reservationKeySchema, (key) =>
      withApi((api) => api.confirmTreatmentReview(key)),
    ),

    /**
     * Baixa o documento e o grava onde o operador escolher, com o nome original (FR-009). A
     * interface recebe só o caminho gravado; o conteúdo não passa por ela.
     */
    [INVOKE.treatmentsSaveDocument]: handle(documentIdSchema, async (documentId) => {
      // Baixa antes de perguntar onde salvar: arquivo já apagado é avisado sem abrir o diálogo.
      const downloaded = await withApi((api) => api.downloadTreatmentDocument(documentId));
      if (!downloaded.ok) return downloaded;

      const fileName = safeFileName(downloaded.data.fileName);
      const extension = path.extname(fileName).slice(1);
      const chosen = await services.showSaveDialog({
        title: 'Salvar documento',
        defaultPath: path.join(services.defaultDirectory, fileName),
        filters: extension ? [{ name: 'Documento', extensions: [extension] }] : [],
      });
      if (chosen.canceled || !chosen.filePath) return ok(null);

      await writeFile(chosen.filePath, downloaded.data.content);
      return ok({ savedTo: chosen.filePath });
    }),
  };
}
