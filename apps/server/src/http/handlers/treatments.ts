/**
 * Tratativas manuais das reservas (specs/003; contracts/api-changes.md): envio do arquivo,
 * registro da tratativa e do comprovante em uma ou várias reservas, desfazer, reverter, valor
 * cobrado informado à mão, download e histórico.
 *
 * Nenhuma destas operações acessa o Hunit nem altera a classificação da reserva (FR-007). As
 * que gravam são exclusivas do perfil operador (`OPERATOR_ONLY_OPERATIONS`, FR-014).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { operations } from '@hunit/contracts';
import {
  detectTreatmentFile,
  fileNameMatchesMediaType,
  isValidTreatmentFileName,
} from '@hunit/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ClientIdentity } from '../../persistence/clients-repo.js';
import type { Database } from '../../persistence/db.js';
import { findReservation } from '../../persistence/reservations-repo.js';
import {
  findTreatmentFile,
  findTreatmentFileContent,
  saveTreatmentFile,
} from '../../persistence/treatment-files-repo.js';
import {
  checkDocuments,
  clearManualAmount,
  findDocument,
  getTreatmentDetail,
  loadTreatmentSummary,
  registerDocuments,
  removeDocument,
  reservationKeyOf,
  revertDocument,
  setManualAmount,
  type ReservationKey,
  type ReservationOutcome,
} from '../../persistence/treatments-repo.js';
import { ProblemError } from '../problem.js';
import {
  toReservationOutcomeView,
  toReservationTreatmentView,
  toTreatmentDocumentView,
  toTreatmentEventView,
  type ReservationTreatmentView,
} from '../views.js';

type UploadQuery = operations['uploadTreatmentFile']['parameters']['query'];
type CheckBody =
  operations['checkTreatmentDocuments']['requestBody']['content']['application/json'];
type RegisterBody =
  operations['registerTreatmentDocuments']['requestBody']['content']['application/json'];
type DocumentParams = operations['removeTreatmentDocument']['parameters']['path'];
type ReservationParams = operations['getReservationTreatment']['parameters']['path'];
type ManualAmountBody =
  operations['setManualChargedAmount']['requestBody']['content']['application/json'];

export interface TreatmentHandlerDependencies {
  db: Database;
  /** Relógio; os testes podem informar um fixo. */
  now?: () => Date;
}

function clientOf(request: FastifyRequest): ClientIdentity {
  // As operações deste arquivo exigem autenticação; sem cliente, a rota não chegaria aqui.
  if (!request.client) throw new ProblemError('unauthorized');
  return request.client;
}

/** Tira as reservas repetidas do pedido, mantendo a ordem. */
function uniqueKeys(keys: readonly ReservationKey[]): ReservationKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const mapKey = reservationKeyOf(key);
    if (seen.has(mapKey)) return false;
    seen.add(mapKey);
    return true;
  });
}

/** Soma valores "1234.56" em centavos, sem erro de ponto flutuante. */
function sumAmounts(amounts: readonly (string | null)[]): string {
  let cents = 0n;
  for (const amount of amounts) {
    if (amount === null) continue;
    const [whole = '0', fraction = ''] = amount.split('.');
    cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  }
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function isAccepted(outcome: ReservationOutcome): boolean {
  return outcome.outcome === 'registered' || outcome.outcome === 'replaced';
}

/**
 * `content-disposition` para baixar com o nome original (FR-009): `filename*` leva o nome em
 * UTF-8 (RFC 6266) e `filename`, uma versão só com ASCII para clientes antigos.
 */
function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function createTreatmentHandlers(dependencies: TreatmentHandlerDependencies) {
  const { db } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /** Resumo atual da tratativa da reserva, no formato do contrato. */
  async function treatmentOf(key: ReservationKey): Promise<ReservationTreatmentView> {
    const reservation = await findReservation(db, key.hotelCode, key.reservationNumber);
    if (!reservation) throw new ProblemError('not_found', 'Reserva não encontrada.');
    return toReservationTreatmentView(reservation, await loadTreatmentSummary(db, key), now());
  }

  return {
    /**
     * POST /v1/treatment-files — recebe o arquivo puro, confere tamanho e tipo pelo conteúdo
     * (research R-03) e o guarda uma vez por conteúdo (R-01). Só passa a valer quando é
     * registrado em alguma reserva.
     */
    async uploadTreatmentFile(request: FastifyRequest, reply: FastifyReply) {
      const { name } = request.query as UploadQuery;
      if (!isValidTreatmentFileName(name)) {
        throw new ProblemError(
          'validation_error',
          'O nome do arquivo (name) deve ter de 1 a 255 caracteres, sem barras nem caracteres de controle.',
        );
      }

      const content = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const check = detectTreatmentFile(name, content);
      if (!check.ok) throw new ProblemError(check.code);

      const file = await saveTreatmentFile(db, {
        sha256: createHash('sha256').update(content).digest('hex'),
        content,
        mediaType: check.mediaType,
        clientId: clientOf(request).id,
        now: now(),
      });
      return reply
        .code(201)
        .send({ fileId: file.sha256, sizeBytes: file.sizeBytes, mediaType: file.mediaType });
    },

    /**
     * POST /v1/treatment-documents/check — o que aconteceria com cada reserva, sem gravar nada:
     * é o que a confirmação do lote mostra (FR-006).
     */
    async checkTreatmentDocuments(request: FastifyRequest) {
      const body = request.body as CheckBody;
      const outcomes = await checkDocuments(db, {
        kind: body.kind,
        keys: uniqueKeys(body.reservations),
      });
      const accepted = outcomes.filter(isAccepted);
      return {
        items: outcomes.map(toReservationOutcomeView),
        acceptedCount: accepted.length,
        replacingCount: accepted.filter((outcome) => outcome.outcome === 'replaced').length,
        ignoredCount: outcomes.length - accepted.length,
        acceptedTotalAmount: sumAmounts(accepted.map((outcome) => outcome.totalAmount)),
      };
    },

    /**
     * POST /v1/treatment-documents — registra o documento em cada reserva, uma transação por
     * reserva (FR-011). Responde 200 com o desfecho de cada uma, mesmo com ignoradas ou falhas.
     */
    async registerTreatmentDocuments(request: FastifyRequest) {
      const body = request.body as RegisterBody;
      if (!isValidTreatmentFileName(body.fileName)) {
        throw new ProblemError(
          'validation_error',
          'O nome do arquivo (fileName) não pode ter barras nem caracteres de controle.',
        );
      }
      const file = await findTreatmentFile(db, body.fileId);
      if (!file) {
        throw new ProblemError(
          'file_not_found',
          'Envie o arquivo de novo: o servidor não tem (ou não tem mais) o arquivo informado.',
        );
      }
      if (!fileNameMatchesMediaType(body.fileName, file.mediaType)) {
        throw new ProblemError(
          'unsupported_file_type',
          'A extensão do nome informado não corresponde ao tipo do arquivo enviado.',
        );
      }

      const batchId = randomUUID();
      const outcomes = await registerDocuments(db, {
        kind: body.kind,
        file,
        fileName: body.fileName,
        keys: uniqueKeys(body.reservations),
        clientId: clientOf(request).id,
        batchId,
        now: now(),
      });
      for (const outcome of outcomes) {
        if (outcome.outcome !== 'failed') continue;
        request.log.error(
          {
            err: outcome.error,
            hotelCode: outcome.hotelCode,
            reservationNumber: outcome.reservationNumber,
            batchId,
          },
          'falha ao registrar o documento numa reserva',
        );
      }
      return { batchId, items: outcomes.map(toReservationOutcomeView) };
    },

    /** DELETE /v1/treatment-documents/{documentId} — desfaz o documento vigente (FR-004). */
    async removeTreatmentDocument(request: FastifyRequest, reply: FastifyReply) {
      const { documentId } = request.params as DocumentParams;
      const result = await removeDocument(db, {
        documentId,
        clientId: clientOf(request).id,
        now: now(),
      });
      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new ProblemError('not_found', 'Documento não encontrado.');
        }
        throw new ProblemError(
          'document_not_current',
          'Este documento já foi substituído ou desfeito.',
        );
      }
      return reply.code(204).send();
    },

    /**
     * POST /v1/treatment-documents/{documentId}/revert — o documento substituído ou desfeito
     * volta a ser o atual, dentro do prazo de 30 dias (FR-013a).
     */
    async revertTreatmentDocument(request: FastifyRequest) {
      const { documentId } = request.params as DocumentParams;
      const result = await revertDocument(db, {
        documentId,
        clientId: clientOf(request).id,
        now: now(),
      });
      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw new ProblemError('not_found', 'Documento não encontrado.');
        }
        if (result.reason === 'not_eligible') {
          throw new ProblemError(
            'not_eligible_for_treatment',
            'A situação atual da reserva não exige cobrança; o documento não pode ser revertido.',
          );
        }
        throw new ProblemError(
          'document_not_revertible',
          'Só um documento substituído ou desfeito há menos de 30 dias pode ser revertido.',
        );
      }
      return treatmentOf(result.key);
    },

    /**
     * GET /v1/treatment-documents/{documentId}/file — o arquivo, idêntico ao enviado, com o
     * nome original (FR-009). Vale para documentos atuais, substituídos e desfeitos.
     */
    async getTreatmentDocumentFile(request: FastifyRequest, reply: FastifyReply) {
      const { documentId } = request.params as DocumentParams;
      const document = await findDocument(db, documentId);
      if (!document) throw new ProblemError('not_found', 'Documento não encontrado.');

      const content =
        document.fileSha256 === null
          ? null
          : await findTreatmentFileContent(db, document.fileSha256);
      if (content === null || document.originalName === null) {
        throw new ProblemError('document_purged');
      }

      // O arquivo veio de fora: quem baixa não deve executar nem reinterpretar nada dele.
      return reply
        .type(document.mediaType)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', 'sandbox')
        .header('content-disposition', attachmentDisposition(document.originalName))
        .send(content);
    },

    /**
     * GET /v1/reservations/{hotelCode}/{reservationNumber}/treatment — documentos (vigentes e
     * anteriores) e histórico da reserva (FR-012, FR-015).
     */
    async getReservationTreatment(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const reservation = await findReservation(db, key.hotelCode, key.reservationNumber);
      if (!reservation) throw new ProblemError('not_found', 'Reserva não encontrada.');

      const detail = await getTreatmentDetail(db, key);
      const at = now();
      return {
        treatment: toReservationTreatmentView(reservation, detail.summary, at),
        documents: detail.documents.map((document) => toTreatmentDocumentView(document, at)),
        events: detail.events.map(toTreatmentEventView),
      };
    },

    /** PUT .../manual-amount — informa à mão o valor cobrado (FR-005). */
    async setManualChargedAmount(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const { amount } = request.body as ManualAmountBody;
      if (Number(amount) <= 0) {
        throw new ProblemError('validation_error', 'O valor (amount) deve ser maior que zero.');
      }

      const result = await setManualAmount(db, {
        key,
        amount,
        clientId: clientOf(request).id,
        now: now(),
      });
      if (result === 'not_found') throw new ProblemError('not_found', 'Reserva não encontrada.');
      if (result === 'proof_required') throw new ProblemError('proof_required');
      return treatmentOf(key);
    },

    /** DELETE .../manual-amount — remove o valor informado à mão; volta a valer o do Hunit. */
    async clearManualChargedAmount(request: FastifyRequest) {
      const key = request.params as ReservationParams;
      const result = await clearManualAmount(db, {
        key,
        clientId: clientOf(request).id,
        now: now(),
      });
      if (result === 'not_found') throw new ProblemError('not_found', 'Reserva não encontrada.');
      return treatmentOf(key);
    },
  };
}
