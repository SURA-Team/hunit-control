/**
 * Regras das tratativas manuais (specs/003, research R-04; data-model §3 e §4).
 *
 * A tratativa é uma camada ao lado da reserva: dois documentos independentes — a tratativa
 * (pedido de cobrança) e o comprovante — que mudam a situação **exibida**, nunca a classificação
 * calculada a partir do Hunit. Funções puras, sem I/O.
 */
import type { Classification, Money } from './types.js';

/** Tipo do documento: `request` = tratativa (pedido de cobrança); `proof` = comprovante. */
export const TREATMENT_DOCUMENT_KINDS = ['request', 'proof'] as const;
export type TreatmentDocumentKind = (typeof TREATMENT_DOCUMENT_KINDS)[number];

/**
 * Situação dos documentos: sem tratativa, `sent` (só tratativa) ou `charged` (com comprovante). O
 * que a lista mostra é a `ReservationSituation`, que também considera a classificação.
 */
export const TREATMENT_STATUSES = ['none', 'sent', 'charged'] as const;
export type TreatmentStatus = (typeof TREATMENT_STATUSES)[number];

/**
 * Estado de um documento: atual, substituído, desfeito ou purgado (arquivo apagado pelo prazo de
 * retenção; o registro fica).
 */
export const TREATMENT_DOCUMENT_STATES = ['current', 'replaced', 'removed', 'purged'] as const;
export type TreatmentDocumentState = (typeof TREATMENT_DOCUMENT_STATES)[number];

/** Dias em que um documento substituído ou desfeito fica guardado e pode ser revertido (FR-013). */
export const TREATMENT_REVERT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Classificações que exigem uma cobrança ainda não registrada no Hunit: só elas aceitam
 * registrar, substituir e reverter documentos (FR-003). `Record` completo de propósito: uma
 * classificação nova não compila sem decidir aqui.
 */
const ACCEPTS_TREATMENT: Readonly<Record<Classification, boolean>> = {
  virtual_card_pending_charge: true,
  virtual_card_charge_error: true,
  virtual_card_validated_only: true,
  analysis_error: true,
  charge_at_terminal: true,
  ignored_hotelbeds_258: false,
  invoiced: false,
  cancelled_no_charge: false,
  virtual_card_already_charged: false,
  // "A revisar (sistema anterior)" (specs/004, FR-007a): reserva importada sem classificação
  // correspondente; aceita os documentos, mas não exige cobrança (ver `requiresCharge`).
  not_virtual_card: true,
};

/** A reserva com essa classificação aceita tratativa e comprovante? (FR-003) */
export function acceptsTreatment(classification: Classification): boolean {
  return ACCEPTS_TREATMENT[classification];
}

/** Classificações que aceitam tratativa, para montar filtros sem repetir a lista. */
export const CLASSIFICATIONS_ACCEPTING_TREATMENT: readonly Classification[] = (
  Object.keys(ACCEPTS_TREATMENT) as Classification[]
).filter((classification) => ACCEPTS_TREATMENT[classification]);

/**
 * A classificação exige cobrança? É a base de "Falta cobrar", de "Tratativa enviada" e do alerta
 * "Verificar". Igual a `acceptsTreatment`, menos "A revisar (sistema anterior)": ela aceita
 * documentos, mas ainda não se sabe se exige cobrança (specs/004, FR-007a, research R-04).
 */
export function requiresCharge(classification: Classification): boolean {
  return acceptsTreatment(classification) && classification !== 'not_virtual_card';
}

/** Classificações que exigem cobrança, para montar filtros sem repetir a lista. */
export const CLASSIFICATIONS_REQUIRING_CHARGE: readonly Classification[] =
  CLASSIFICATIONS_ACCEPTING_TREATMENT.filter(requiresCharge);

/** Situação exibida a partir dos documentos atuais da reserva (FR-002). */
export function treatmentStatus(documents: {
  hasCurrentRequest: boolean;
  hasCurrentProof: boolean;
}): TreatmentStatus {
  if (documents.hasCurrentProof) return 'charged';
  return documents.hasCurrentRequest ? 'sent' : 'none';
}

/**
 * Situação da reserva (FR-002, research R-14): "Comprovante enviado", "Tratativa enviada" ou a
 * própria classificação (o status do Hunit). É o valor da coluna única da lista e do filtro.
 */
export type ReservationSituation = 'proof_sent' | 'treatment_sent' | Classification;

/**
 * Comprovante sempre prevalece. A tratativa só aparece enquanto o Hunit ainda indica que falta
 * cobrar; se a classificação deixou de exigir cobrança (ex.: "já cobrada"), vale a do Hunit, com o
 * alerta de `needsReview`.
 */
export function reservationSituation(
  classification: Classification,
  status: TreatmentStatus,
): ReservationSituation {
  if (status === 'charged') return 'proof_sent';
  if (status === 'sent' && requiresCharge(classification)) return 'treatment_sent';
  return classification;
}

/**
 * Alerta "Verificar" (FR-002a, research R-14): só com tratativa, a classificação deixou de exigir
 * cobrança e ninguém confirmou depois da última mudança de situação no Hunit. `statusChangedAt`
 * nulo (a situação nunca mudou) torna válida qualquer confirmação.
 */
export function needsReview(input: {
  classification: Classification;
  status: TreatmentStatus;
  statusChangedAt: Date | null;
  lastReviewAt: Date | null;
}): boolean {
  // `acceptsTreatment`, e não `requiresCharge`: "A revisar (sistema anterior)" aceita tratativa e
  // não gera alerta (specs/004, FR-007a).
  if (input.status !== 'sent' || acceptsTreatment(input.classification)) return false;
  if (input.lastReviewAt === null) return true;
  return (
    input.statusChangedAt !== null && input.lastReviewAt.getTime() < input.statusChangedAt.getTime()
  );
}

/**
 * "Falta cobrar" (FR-002): a classificação exige cobrança e a reserva não tem comprovante — sem
 * tratativa ou "Tratativa enviada".
 */
export function isPendingCharge(classification: Classification, status: TreatmentStatus): boolean {
  return requiresCharge(classification) && status !== 'charged';
}

/** Até quando um documento que deixou de ser o atual em `endedAt` pode ser revertido. */
export function revertDeadline(endedAt: Date): Date {
  return new Date(endedAt.getTime() + TREATMENT_REVERT_DAYS * DAY_MS);
}

/** O documento pode voltar a ser o atual? Só substituído ou desfeito, e antes do prazo (FR-013a). */
export function isRevertible(
  document: { state: TreatmentDocumentState; endedAt: Date | null },
  now: Date,
): boolean {
  if (document.state !== 'replaced' && document.state !== 'removed') return false;
  if (document.endedAt === null) return false;
  return now.getTime() < revertDeadline(document.endedAt).getTime();
}

/**
 * Valor cobrado a exibir (FR-005): o do Hunit prevalece; o informado à mão só vale enquanto a
 * reserva tem comprovante atual.
 */
export function effectiveChargedAmount(
  hunitAmount: Money | null,
  manualAmount: Money | null,
  hasCurrentProof: boolean,
): Money | null {
  if (hunitAmount !== null) return hunitAmount;
  return hasCurrentProof ? manualAmount : null;
}
