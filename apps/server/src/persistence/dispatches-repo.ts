/**
 * Envios ao Comercial (specs/005, FR-001 a FR-007; data-model §1.1 a §1.3; research R-01): o job,
 * as reservas de cada envio e o desfecho de cada uma.
 *
 * Os estados e as transições são os das execuções (`EXECUTION_TRANSITIONS`). A regra "uma
 * automação por conta" vale entre as duas tabelas, pela trava da conta (`account-lock.ts`).
 */
import type { Classification } from '@hunit/domain';
import { and, asc, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { activeAutomationsOf, lockHunitAccount, type Transaction } from './account-lock.js';
import type { Database } from './db.js';
import { isConstraintViolation, PG_UNIQUE_VIOLATION } from './errors.js';
import {
  EXECUTION_TRANSITIONS,
  InvalidCursorError,
  type ExecutionTransition,
} from './executions-repo.js';
import {
  ACTIVE_EXECUTION_STATUSES,
  apiClients,
  commercialDispatchItems,
  commercialDispatches,
  type ExecutionEndReason,
  type ExecutionStatus,
} from './schema.js';

export type DispatchRow = typeof commercialDispatches.$inferSelect;
export type DispatchItemRow = typeof commercialDispatchItems.$inferSelect;
export type DispatchItemOutcome = DispatchItemRow['outcome'];
type Executor = Database | Transaction;

/** Já existe uma execução ou um envio ativo para a mesma conta do Hunit (research R-01). */
export class AccountBusyError extends Error {
  constructor() {
    super('Já existe uma execução ou um envio ao Comercial ativo para esta conta do Hunit.');
    this.name = 'AccountBusyError';
  }
}

/** O envio já foi retomado: retoma-se o último envio da sequência (FR-007). */
export class DispatchAlreadyResumedError extends Error {
  constructor(readonly resumedBy: string | null) {
    super(
      resumedBy
        ? `Este envio já foi retomado pelo envio ${resumedBy}; para continuar, retome esse.`
        : 'Este envio já foi retomado; para continuar, retome o último envio da sequência.',
    );
    this.name = 'DispatchAlreadyResumedError';
  }
}

/** Uma reserva pedida no envio, já com a conferência de elegibilidade feita (FR-003). */
export interface NewDispatchItem {
  hotelCode: string;
  reservationNumber: string;
  /** `null` = a reserva não existe (fica `ignored/not_found`). */
  classificationBefore: Classification | null;
  /** `ignored` com o motivo, ou `pending` para verificar no Hunit. */
  outcome: 'pending' | 'ignored';
  reason: string | null;
}

export interface NewDispatch {
  accountKey: string;
  clientId: string;
  parentDispatchId?: string | null;
  items: readonly NewDispatchItem[];
  now: Date;
}

/** Linhas por comando de inserção (limite de parâmetros do PostgreSQL). */
const INSERT_BATCH = 500;

/**
 * Cria o envio (`queued`) e as reservas dele, na ordem pedida.
 *
 * @throws AccountBusyError se a conta já tem uma execução ou um envio ativo.
 * @throws DispatchAlreadyResumedError se `parentDispatchId` já foi retomado (índice único).
 */
export async function createDispatch(db: Database, input: NewDispatch): Promise<DispatchRow> {
  try {
    return await db.transaction(async (tx) => {
      await lockHunitAccount(tx, input.accountKey);
      const active = await activeAutomationsOf(tx, input.accountKey);
      if (active.execution || active.dispatch) throw new AccountBusyError();

      const [row] = await tx
        .insert(commercialDispatches)
        .values({
          accountKey: input.accountKey,
          clientId: input.clientId,
          parentDispatchId: input.parentDispatchId ?? null,
          createdAt: input.now,
        })
        .returning();
      if (!row) throw new Error('O banco não devolveu o envio criado.');

      const items = input.items.map((item, index) => ({
        dispatchId: row.id,
        hotelCode: item.hotelCode,
        reservationNumber: item.reservationNumber,
        position: index + 1,
        outcome: item.outcome,
        classificationBefore: item.classificationBefore,
        reason: item.reason,
        processedAt: item.outcome === 'pending' ? null : input.now,
      }));
      for (let start = 0; start < items.length; start += INSERT_BATCH) {
        await tx.insert(commercialDispatchItems).values(items.slice(start, start + INSERT_BATCH));
      }
      return row;
    });
  } catch (error) {
    if (
      isConstraintViolation(
        error,
        PG_UNIQUE_VIOLATION,
        'commercial_dispatches_one_active_per_account',
      )
    ) {
      throw new AccountBusyError();
    }
    if (
      isConstraintViolation(
        error,
        PG_UNIQUE_VIOLATION,
        'commercial_dispatches_one_resume_per_parent',
      )
    ) {
      throw new DispatchAlreadyResumedError(null);
    }
    throw error;
  }
}

function sourcesOf(target: ExecutionStatus): ExecutionStatus[] {
  return (Object.keys(EXECUTION_TRANSITIONS) as ExecutionStatus[]).filter((source) =>
    EXECUTION_TRANSITIONS[source].includes(target),
  );
}

/**
 * Muda o estado do envio, se a transição for permitida (as mesmas das execuções). A checagem e a
 * mudança acontecem no mesmo comando.
 *
 * @returns o envio atualizado, ou `null` se ele não existe ou não pode mais ir para esse estado.
 */
export async function transitionDispatch(
  db: Database,
  dispatchId: string,
  transition: ExecutionTransition,
  now: Date,
): Promise<DispatchRow | null> {
  const changes: Partial<Record<keyof DispatchRow, unknown>> = { status: transition.to };
  switch (transition.to) {
    case 'running':
      changes.startedAt = sql`coalesce(${commercialDispatches.startedAt}, ${now.toISOString()}::timestamptz)`;
      changes.twoFactorDeadline = null;
      break;
    case 'awaiting_2fa':
      changes.twoFactorDeadline = transition.twoFactorDeadline;
      break;
    case 'completed':
      changes.finishedAt = now;
      changes.twoFactorDeadline = null;
      break;
    case 'failed':
    case 'cancelled':
      changes.finishedAt = now;
      changes.twoFactorDeadline = null;
      changes.endReason = transition.endReason;
      if (transition.to === 'cancelled') {
        changes.cancelledByClientId = transition.cancelledByClientId ?? null;
      }
      break;
  }

  const [row] = await db
    .update(commercialDispatches)
    .set(changes as Partial<typeof commercialDispatches.$inferInsert>)
    .where(
      and(
        eq(commercialDispatches.id, dispatchId),
        inArray(commercialDispatches.status, sourcesOf(transition.to)),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Marca como `failed` todos os envios ativos (servidor reiniciado: as credenciais estavam só na
 * memória do processo anterior) e as reservas pendentes deles como não verificadas.
 */
export async function failAllActiveDispatches(
  db: Database,
  endReason: ExecutionEndReason,
  pendingReason: string,
  now: Date,
): Promise<DispatchRow[]> {
  return db.transaction(async (tx) => {
    const failed = await tx
      .update(commercialDispatches)
      .set({ status: 'failed', endReason, finishedAt: now, twoFactorDeadline: null })
      .where(inArray(commercialDispatches.status, [...ACTIVE_EXECUTION_STATUSES]))
      .returning();
    if (failed.length > 0) {
      await tx
        .update(commercialDispatchItems)
        .set({ outcome: 'not_verified', reason: pendingReason, processedAt: now })
        .where(
          and(
            inArray(
              commercialDispatchItems.dispatchId,
              failed.map((row) => row.id),
            ),
            eq(commercialDispatchItems.outcome, 'pending'),
          ),
        );
    }
    return failed;
  });
}

export interface DispatchWithClient {
  dispatch: DispatchRow;
  /** Nome do cliente da API que fez o envio. */
  clientName: string;
}

export async function findDispatch(
  db: Database,
  dispatchId: string,
): Promise<DispatchWithClient | null> {
  const [row] = await db
    .select({ dispatch: commercialDispatches, clientName: apiClients.name })
    .from(commercialDispatches)
    .innerJoin(apiClients, eq(apiClients.id, commercialDispatches.clientId))
    .where(eq(commercialDispatches.id, dispatchId));
  return row ?? null;
}

/** O envio que retomou o informado, se houver. */
export async function findResumeOfDispatch(
  db: Database,
  dispatchId: string,
): Promise<DispatchRow | null> {
  const [row] = await db
    .select()
    .from(commercialDispatches)
    .where(eq(commercialDispatches.parentDispatchId, dispatchId));
  return row ?? null;
}

/** Reservas do envio, na ordem de processamento. */
export async function listDispatchItems(
  executor: Executor,
  dispatchId: string,
): Promise<DispatchItemRow[]> {
  return executor
    .select()
    .from(commercialDispatchItems)
    .where(eq(commercialDispatchItems.dispatchId, dispatchId))
    .orderBy(asc(commercialDispatchItems.position));
}

/** Grava o desfecho de uma reserva do envio (só sai de `pending`). */
export async function recordItemOutcome(
  executor: Executor,
  input: {
    dispatchId: string;
    hotelCode: string;
    reservationNumber: string;
    outcome: Exclude<DispatchItemOutcome, 'pending' | 'ignored'>;
    classificationAfter: Classification | null;
    reason: string | null;
    now: Date;
  },
): Promise<void> {
  await executor
    .update(commercialDispatchItems)
    .set({
      outcome: input.outcome,
      classificationAfter: input.classificationAfter,
      reason: input.reason,
      processedAt: input.now,
    })
    .where(
      and(
        eq(commercialDispatchItems.dispatchId, input.dispatchId),
        eq(commercialDispatchItems.hotelCode, input.hotelCode),
        eq(commercialDispatchItems.reservationNumber, input.reservationNumber),
        eq(commercialDispatchItems.outcome, 'pending'),
      ),
    );
}

/** As reservas que ainda estavam pendentes ficam como não verificadas, com o motivo. */
export async function failPendingItems(
  db: Database,
  dispatchId: string,
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(commercialDispatchItems)
    .set({ outcome: 'not_verified', reason, processedAt: now })
    .where(
      and(
        eq(commercialDispatchItems.dispatchId, dispatchId),
        eq(commercialDispatchItems.outcome, 'pending'),
      ),
    )
    .returning({ position: commercialDispatchItems.position });
  return rows.length;
}

export interface DispatchCounts {
  total: number;
  pending: number;
  sent: number;
  withdrawn: number;
  notVerified: number;
  ignored: number;
}

const EMPTY_COUNTS: DispatchCounts = {
  total: 0,
  pending: 0,
  sent: 0,
  withdrawn: 0,
  notVerified: 0,
  ignored: 0,
};

/** Contagem dos desfechos de vários envios, numa consulta só. */
export async function countDispatchItems(
  db: Database,
  dispatchIds: readonly string[],
): Promise<Map<string, DispatchCounts>> {
  const result = new Map<string, DispatchCounts>();
  if (dispatchIds.length === 0) return result;
  const rows = await db
    .select({
      dispatchId: commercialDispatchItems.dispatchId,
      outcome: commercialDispatchItems.outcome,
      count: sql<number>`count(*)::int`,
    })
    .from(commercialDispatchItems)
    .where(inArray(commercialDispatchItems.dispatchId, [...dispatchIds]))
    .groupBy(commercialDispatchItems.dispatchId, commercialDispatchItems.outcome);
  for (const id of dispatchIds) result.set(id, { ...EMPTY_COUNTS });
  for (const row of rows) {
    const counts = result.get(row.dispatchId);
    if (!counts) continue;
    counts.total += row.count;
    if (row.outcome === 'not_verified') counts.notVerified += row.count;
    else counts[row.outcome] += row.count;
  }
  return result;
}

export interface ListDispatchesOptions {
  /** true = só ativos; false = só encerrados. */
  active?: boolean | undefined;
  limit: number;
  cursor?: string | undefined;
}

export type DispatchListItem = DispatchRow & { clientName: string };

function encodeCursor(dispatchId: string): string {
  return Buffer.from(dispatchId, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string {
  const dispatchId = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dispatchId)) {
    throw new InvalidCursorError();
  }
  return dispatchId;
}

/**
 * Envios, dos mais recentes para os mais antigos, paginados por cursor (a posição é comparada no
 * banco, como na lista de execuções).
 *
 * @throws InvalidCursorError
 */
export async function listDispatches(
  db: Database,
  options: ListDispatchesOptions,
): Promise<{ items: DispatchListItem[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (options.active === true) {
    conditions.push(inArray(commercialDispatches.status, [...ACTIVE_EXECUTION_STATUSES]));
  } else if (options.active === false) {
    conditions.push(notInArray(commercialDispatches.status, [...ACTIVE_EXECUTION_STATUSES]));
  }
  if (options.cursor !== undefined) {
    const cursorId = decodeCursor(options.cursor);
    const [anchor] = await db
      .select({ id: commercialDispatches.id })
      .from(commercialDispatches)
      .where(eq(commercialDispatches.id, cursorId));
    if (!anchor) throw new InvalidCursorError();
    conditions.push(
      sql`(${commercialDispatches.createdAt}, ${commercialDispatches.id}) < (select d.created_at, d.id from commercial_dispatches d where d.id = ${cursorId})`,
    );
  }

  const rows = await db
    .select({ dispatch: commercialDispatches, clientName: apiClients.name })
    .from(commercialDispatches)
    .innerJoin(apiClients, eq(apiClients.id, commercialDispatches.clientId))
    .where(and(...conditions))
    .orderBy(desc(commercialDispatches.createdAt), desc(commercialDispatches.id))
    .limit(options.limit + 1);

  const items = rows
    .slice(0, options.limit)
    .map(({ dispatch, clientName }) => ({ ...dispatch, clientName }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > options.limit && last ? encodeCursor(last.id) : null,
  };
}
