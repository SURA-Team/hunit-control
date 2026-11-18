/**
 * Regras do envio ao Comercial (specs/005, FR-003, FR-005, research R-11; data-model §3.1):
 * quem aceita o envio, o desfecho da verificação no Hunit e desfazer/reverter a linha da
 * planilha. Funções puras, sem I/O.
 */
import {
  acceptsTreatment,
  requiresCharge,
  TREATMENT_REVERT_DAYS,
  type CommercialLineState,
} from './treatment.js';
import type { Classification } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Por que uma reserva fica de fora do envio (FR-001, FR-003). */
export const DISPATCH_INELIGIBILITY_REASONS = [
  'not_found',
  'not_accepting',
  'has_proof',
  'return_awaiting_validation',
] as const;
export type DispatchIneligibility = (typeof DISPATCH_INELIGIBILITY_REASONS)[number];

export type DispatchEligibility =
  { eligible: true; resend: boolean } | { eligible: false; reason: DispatchIneligibility };

/**
 * A reserva aceita o envio? (FR-003.) Aceitam as que aceitam tratativa (specs/003, FR-003, e "A
 * revisar (sistema anterior)", specs/004, FR-007a), sem comprovante (documento ou retorno
 * confirmado) e sem retorno do Comercial aguardando validação. Já ter linha na planilha não
 * impede: é um reenvio (`resend`), que atualiza a linha.
 *
 * @param input.classification `null` = a reserva não existe.
 */
export function dispatchEligibility(input: {
  classification: Classification | null;
  hasCurrentProof: boolean;
  hasReturnAwaiting: boolean;
  lineState: CommercialLineState | null;
}): DispatchEligibility {
  if (input.classification === null) return { eligible: false, reason: 'not_found' };
  if (!acceptsTreatment(input.classification)) return { eligible: false, reason: 'not_accepting' };
  if (input.hasCurrentProof) return { eligible: false, reason: 'has_proof' };
  if (input.hasReturnAwaiting) return { eligible: false, reason: 'return_awaiting_validation' };
  return { eligible: true, resend: input.lineState !== null };
}

export type DispatchOutcome =
  { outcome: 'sent' } | { outcome: 'withdrawn'; classification: Classification };

/**
 * Desfecho de uma reserva verificada no Hunit (FR-005): enviada se a classificação lida ainda
 * exige cobrança; retirada, com a classificação como motivo, se não exige mais (já cobrada,
 * faturada, cancelada sem cobrança...).
 */
export function dispatchOutcome(classificationAfter: Classification): DispatchOutcome {
  return requiresCharge(classificationAfter)
    ? { outcome: 'sent' }
    : { outcome: 'withdrawn', classification: classificationAfter };
}

/**
 * Desfazer o envio (research R-11): só com a linha aberta e sem retorno do Comercial aguardando
 * validação — o Financeiro precisa confirmar ou recusar antes.
 */
export function canCancelLine(input: {
  state: CommercialLineState | null;
  hasReturnAwaiting: boolean;
}): 'ok' | 'not_open' | 'return_awaiting_validation' {
  if (input.state !== 'open') return 'not_open';
  if (input.hasReturnAwaiting) return 'return_awaiting_validation';
  return 'ok';
}

/** Até quando um envio desfeito pode ser revertido (o mesmo prazo da 003, FR-013a). */
export function lineRestoreDeadline(cancelledAt: Date): Date {
  return new Date(cancelledAt.getTime() + TREATMENT_REVERT_DAYS * DAY_MS);
}

/**
 * Reverter o envio desfeito (research R-11): só linha cancelada, antes do prazo, e com a reserva
 * ainda aceitando tratativa (a mesma regra da reversão de documentos, specs/003, FR-013a).
 */
export function canRestoreLine(
  line: { state: CommercialLineState; cancelledAt: Date | null },
  classification: Classification,
  now: Date,
): 'ok' | 'not_cancelled' | 'expired' | 'not_eligible' {
  if (line.state !== 'cancelled' || line.cancelledAt === null) return 'not_cancelled';
  if (now.getTime() >= lineRestoreDeadline(line.cancelledAt).getTime()) return 'expired';
  if (!acceptsTreatment(classification)) return 'not_eligible';
  return 'ok';
}
