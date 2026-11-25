/**
 * "No máximo uma automação por vez para a mesma conta do Hunit" (constitution, princípio IV)
 * entre execuções e envios ao Comercial (specs/005, research R-01).
 *
 * Cada tabela tem o seu índice único parcial ("uma ativa por conta"), mas um índice não enxerga a
 * outra tabela. Por isso a criação de uma execução ou de um envio acontece numa transação que
 * primeiro trava a conta (`pg_advisory_xact_lock`) e então confere as duas tabelas: duas criações
 * simultâneas na mesma conta ficam em fila, e a segunda vê a primeira.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { ACTIVE_EXECUTION_STATUSES, commercialDispatches, executions } from './schema.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Trava a conta até o fim da transação. A chave é o HMAC do usuário, nunca o usuário. */
export async function lockHunitAccount(tx: Transaction, accountKey: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hunit-account:${accountKey}`}))`);
}

/** O que está ativo na conta neste momento. */
export async function activeAutomationsOf(
  tx: Transaction,
  accountKey: string,
): Promise<{ execution: boolean; dispatch: boolean }> {
  const [execution] = await tx
    .select({ id: executions.id })
    .from(executions)
    .where(
      and(
        eq(executions.accountKey, accountKey),
        inArray(executions.status, [...ACTIVE_EXECUTION_STATUSES]),
      ),
    )
    .limit(1);
  const [dispatch] = await tx
    .select({ id: commercialDispatches.id })
    .from(commercialDispatches)
    .where(
      and(
        eq(commercialDispatches.accountKey, accountKey),
        inArray(commercialDispatches.status, [...ACTIVE_EXECUTION_STATUSES]),
      ),
    )
    .limit(1);
  return { execution: execution !== undefined, dispatch: dispatch !== undefined };
}
