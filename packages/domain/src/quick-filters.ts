/**
 * Filtros rápidos da lista de reservas (specs/006, FR-016, research R-09, data-model §1): Falta
 * cobrar, A verificar, Com erro e Concluídas. Uma reserva pode estar em mais de um grupo (ex.:
 * "Validar comprovante" falta cobrar e pede verificação); a que não estiver em nenhum aparece só em
 * "Todas". Funções puras, sem I/O; o servidor monta o SQL com as mesmas listas, e um teste de
 * paridade confere que os dois dizem o mesmo.
 */
import type { ReservationDetailedSituation } from './treatment.js';

export const QUICK_FILTERS = ['pending_charge', 'to_review', 'with_error', 'done'] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

/** Grupos que dependem só da situação detalhada (os outros vêm de "Falta cobrar" e do alerta). */
type SituationGroup = Exclude<QuickFilter, 'pending_charge'>;

/**
 * Grupo de cada situação detalhada. `Record` completo de propósito: uma situação nova não compila
 * sem decidir aqui. `null` = a situação, sozinha, não põe a reserva em grupo nenhum (as que exigem
 * cobrança entram em "Falta cobrar" por `pendingCharge`).
 */
const SITUATION_GROUP: Readonly<Record<ReservationDetailedSituation, SituationGroup | null>> = {
  proof_sent: 'done',
  treatment_sent: null,
  // "Validar comprovante" (specs/005): o retorno do Comercial aguarda o Financeiro.
  return_pending: 'to_review',
  virtual_card_pending_charge: null,
  virtual_card_validated_only: null,
  charge_at_terminal: null,
  virtual_card_charge_error: 'with_error',
  analysis_error: 'with_error',
  ignored_hotelbeds_258: 'done',
  invoiced: 'done',
  cancelled_no_charge: 'done',
  virtual_card_already_charged: 'done',
  // "A revisar (sistema anterior)" (specs/004, FR-007a).
  not_virtual_card: 'to_review',
};

/** Situações detalhadas de cada grupo, para o servidor montar as condições sem repetir a regra. */
export const QUICK_FILTER_SITUATIONS: Readonly<
  Record<SituationGroup, readonly ReservationDetailedSituation[]>
> = {
  to_review: situationsOf('to_review'),
  with_error: situationsOf('with_error'),
  done: situationsOf('done'),
};

function situationsOf(group: SituationGroup): ReservationDetailedSituation[] {
  return (Object.keys(SITUATION_GROUP) as ReservationDetailedSituation[]).filter(
    (situation) => SITUATION_GROUP[situation] === group,
  );
}

/**
 * Grupos de filtro rápido da reserva, na ordem de `QUICK_FILTERS`:
 * - `pending_charge`: "Falta cobrar" (`isPendingCharge`, specs/003);
 * - `to_review`: alerta "Verificar" (`needsReview`), "A revisar (sistema anterior)" ou "Validar
 *   comprovante";
 * - `with_error`: erro na cobrança ou erro de análise;
 * - `done`: comprovante enviado, faturada, já cobrada, cancelada sem cobrança ou ignorada.
 */
export function quickFiltersOf(input: {
  pendingCharge: boolean;
  needsReview: boolean;
  detailedSituation: ReservationDetailedSituation;
}): QuickFilter[] {
  const group = SITUATION_GROUP[input.detailedSituation];
  return QUICK_FILTERS.filter((filter) => {
    if (filter === 'pending_charge') return input.pendingCharge;
    if (filter === 'to_review') return input.needsReview || group === 'to_review';
    return group === filter;
  });
}
