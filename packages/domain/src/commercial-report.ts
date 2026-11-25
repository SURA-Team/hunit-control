/**
 * Fila "Cobradas no Hunit" (specs/008, US3; research R-07; data-model §3.4). Funções puras, sem I/O.
 *
 * O Comercial informa na planilha que cobrou a reserva no Hunit (relato `charged_in_hunit`). A
 * situação na fila não é guardada: é **derivada** da última leitura da reserva no Hunit depois do
 * relato (vale o "Verificar agora" e as execuções), sempre pela classificação do Hunit — nunca a
 * efetiva da marcação "Cancelada sem cobrança" do Financeiro. O servidor monta o mesmo cálculo em
 * SQL (teste de paridade).
 */
import { hunitShowsCharge } from './treatment.js';
import type { Classification } from './types.js';

/** Situação na fila: aguardando verificação, confirmada no Hunit ou não encontrada no Hunit. */
export const HUNIT_CHARGE_STATUSES = ['awaiting', 'not_found', 'confirmed'] as const;
export type HunitChargeStatus = (typeof HUNIT_CHARGE_STATUSES)[number];

/**
 * Dias que uma confirmada, ou uma não encontrada que não exige mais cobrança, continua na fila depois
 * da leitura que a definiu (spec FR-013).
 */
export const HUNIT_QUEUE_CONFIRMED_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Situação de um relato "Cobrada no Hunit" (research R-07):
 * - `awaiting` — a reserva não foi lida no Hunit depois do relato;
 * - `confirmed` — lida depois, e o Hunit mostra a cobrança (`virtual_card_already_charged`);
 * - `not_found` — lida depois, e o Hunit não mostra a cobrança, qualquer que seja a classificação.
 */
export function hunitChargeStatus(input: {
  readAt: Date;
  lastVerifiedAt: Date;
  hunitClassification: Classification;
}): HunitChargeStatus {
  if (input.lastVerifiedAt.getTime() <= input.readAt.getTime()) return 'awaiting';
  return hunitShowsCharge(input.hunitClassification) ? 'confirmed' : 'not_found';
}

/**
 * O relato aparece na fila? (FR-013, data-model §3.4.) Aguardando sempre; não encontrada que ainda
 * exige cobrança (classificação efetiva, sem comprovante) sempre; as demais até
 * `HUNIT_QUEUE_CONFIRMED_DAYS` depois da leitura que as definiu (`settledAt`).
 */
export function inHunitQueue(input: {
  status: HunitChargeStatus;
  requiresChargeNow: boolean;
  settledAt: Date;
  now: Date;
}): boolean {
  if (input.status === 'awaiting') return true;
  if (input.status === 'not_found' && input.requiresChargeNow) return true;
  return input.now.getTime() - input.settledAt.getTime() <= HUNIT_QUEUE_CONFIRMED_DAYS * DAY_MS;
}

/**
 * O "Verificar agora" confere este relato? (FR-014.) Aguardando e não encontradas que ainda exigem
 * cobrança; as confirmadas e as que não exigem mais cobrança, não.
 */
export function isHunitCheckTarget(input: {
  status: HunitChargeStatus;
  requiresChargeNow: boolean;
}): boolean {
  return input.status === 'awaiting' || (input.status === 'not_found' && input.requiresChargeNow);
}

/** Os relatos que o "Verificar agora" confere, na ordem recebida. */
export function hunitCheckTargets<
  T extends { status: HunitChargeStatus; requiresChargeNow: boolean },
>(items: readonly T[]): T[] {
  return items.filter(isHunitCheckTarget);
}
