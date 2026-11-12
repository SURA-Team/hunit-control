import type { Classification, ReservationSnapshot, ReservationStatus } from './types.js';

/** Resultado da classificação de uma reserva (FR-013, FR-014, FR-014a). */
export interface ClassificationResult {
  classification: Classification;
  /** Motivo que determinou a classificação, em português, para o Financeiro (FR-014). */
  reason: string;
  /** Situação da reserva no Hunit, independente da cobrança (FR-014a). */
  reservationStatus: ReservationStatus;
}

/** Motivos de cada desfecho. Um texto por situação, para o Financeiro distinguir os casos. */
export const CLASSIFICATION_REASONS = {
  hotelbeds258: 'Número da reserva começa com "258-" (Hotelbeds): ignorada sem abrir a reserva.',
  detailUnavailable: 'Não foi possível ler o detalhe da reserva no Hunit.',
  structureNotRecognized: 'O detalhe da reserva veio num formato não reconhecido.',
  prePaymentUnknown: 'Não foi possível determinar se a reserva tem pré-pagamento.',
  invoiced: 'Reserva sem pré-pagamento, faturada: não exige cobrança.',
  chargeAtTerminal:
    'Reserva sem pré-pagamento com forma de pagamento cartão de crédito: cobrar na maquininha.',
  paymentFormMissing:
    'Reserva sem pré-pagamento e sem forma de pagamento informada pelo Hunit: não é possível saber se precisa ser cobrada.',
  /** Seguido da forma informada pelo Hunit e de ponto final. */
  paymentFormUnknown: 'Reserva sem pré-pagamento com forma de pagamento desconhecida:',
  chargeFailedUnknown: 'Não foi possível determinar se a cobrança do pré-pagamento falhou.',
  chargeFailed: 'O estado atual do pré-pagamento indica falha na cobrança.',
  chargeRecordUnknown: 'Não foi possível determinar se há registro de cobrança.',
  chargeKindUnknown:
    'Não foi possível determinar se o último evento de pagamento foi cobrança ou só validação do cartão.',
  contradictory:
    'O pré-pagamento tem registro de cobrança e de validação ao mesmo tempo: estado contraditório.',
  alreadyCharged: 'Pré-pagamento com registro de cobrança ("Cobrado em").',
  validatedOnly: 'Cartão apenas validado ("Validado em"), sem cobrança.',
  chargeActionUnknown: 'Não foi possível determinar se a ação de cobrar está disponível.',
  pendingCharge: 'Pré-pagamento sem registro de cobrança e com a ação de cobrar disponível.',
  undetermined:
    'Pré-pagamento sem registro de cobrança e sem a ação de cobrar: estado indeterminado.',
} as const;

const HOTELBEDS_258_PREFIX = '258-';

/** Reservas da Hotelbeds com número "258-…" são ignoradas sem abrir (FR-013, regra 1). */
export function isHotelbeds258(reservationNumber: string): boolean {
  return reservationNumber.trim().toUpperCase().startsWith(HOTELBEDS_258_PREFIX);
}

type Decision = Pick<ClassificationResult, 'classification' | 'reason'>;

const analysisError = (reason: string): Decision => ({ classification: 'analysis_error', reason });

/** Regra 2 da FR-013: reserva sem pré-pagamento, pela forma de pagamento informada pelo Hunit. */
function decideWithoutPrePayment(snapshot: ReservationSnapshot): Decision {
  const reasons = CLASSIFICATION_REASONS;
  const form = snapshot.paymentForm;
  if (form === null) return analysisError(reasons.paymentFormMissing);
  switch (form.kind) {
    case 'invoiced':
      return { classification: 'invoiced', reason: reasons.invoiced };
    case 'credit_card':
      return { classification: 'charge_at_terminal', reason: reasons.chargeAtTerminal };
    case 'unrecognized':
      return analysisError(`${reasons.paymentFormUnknown} ${form.label}.`);
  }
}

/**
 * Regras 2 a 7 da FR-013, na ordem. Cada sinal só é consultado quando a regra anterior não
 * decidiu; um sinal `null` consultado leva a erro de análise (FR-015: nunca presumir cobrança).
 */
function decide(snapshot: ReservationSnapshot): Decision {
  const reasons = CLASSIFICATION_REASONS;
  if (!snapshot.structureRecognized) return analysisError(reasons.structureNotRecognized);

  // Regra 2 — sem pré-pagamento: a forma de pagamento decide (research R-22).
  if (snapshot.prePaymentPresent === null) return analysisError(reasons.prePaymentUnknown);
  if (!snapshot.prePaymentPresent) return decideWithoutPrePayment(snapshot);

  // Regra 3 — falha de cobrança no estado atual.
  if (snapshot.chargeFailed === null) return analysisError(reasons.chargeFailedUnknown);
  if (snapshot.chargeFailed) {
    return { classification: 'virtual_card_charge_error', reason: reasons.chargeFailed };
  }

  // Regra 4 — registro "Cobrado em". Exige saber que não foi só uma validação.
  if (snapshot.chargeRecordPresent === null) return analysisError(reasons.chargeRecordUnknown);
  if (snapshot.chargeRecordPresent) {
    if (snapshot.validationOnly === null) return analysisError(reasons.chargeKindUnknown);
    if (snapshot.validationOnly) return analysisError(reasons.contradictory);
    return { classification: 'virtual_card_already_charged', reason: reasons.alreadyCharged };
  }

  // Regra 5 — só "Validado em".
  if (snapshot.validationOnly === null) return analysisError(reasons.chargeKindUnknown);
  if (snapshot.validationOnly) {
    return { classification: 'virtual_card_validated_only', reason: reasons.validatedOnly };
  }

  // Regra 6 — sem cobrança e com a ação de cobrar disponível.
  if (snapshot.chargeActionVisible === null) return analysisError(reasons.chargeActionUnknown);
  if (snapshot.chargeActionVisible) {
    return { classification: 'virtual_card_pending_charge', reason: reasons.pendingCharge };
  }

  // Regra 7 — qualquer outro caso.
  return analysisError(reasons.undetermined);
}

/**
 * Classifica uma reserva (FR-013), devolvendo o motivo (FR-014) e a situação da reserva
 * (FR-014a).
 *
 * @param reservationNumber número da reserva, como exibido no Hunit.
 * @param snapshot detalhe da reserva; `null` quando ela não foi aberta (as "258-", que não
 *   precisam do detalhe, ou uma reserva cujo detalhe não pôde ser lido).
 * @param listedStatus situação mostrada na listagem; vale quando o detalhe não a identifica.
 */
export function classifyReservation(
  reservationNumber: string,
  snapshot: ReservationSnapshot | null,
  listedStatus: ReservationStatus = 'unknown',
): ClassificationResult {
  const detailStatus = snapshot?.reservationStatus ?? 'unknown';
  const reservationStatus = detailStatus === 'unknown' ? listedStatus : detailStatus;

  // Regra 1 — vem antes de tudo: essas reservas nem são abertas.
  if (isHotelbeds258(reservationNumber)) {
    return {
      classification: 'ignored_hotelbeds_258',
      reason: CLASSIFICATION_REASONS.hotelbeds258,
      reservationStatus,
    };
  }

  const decision = snapshot
    ? decide(snapshot)
    : analysisError(CLASSIFICATION_REASONS.detailUnavailable);
  return { ...decision, reservationStatus };
}
