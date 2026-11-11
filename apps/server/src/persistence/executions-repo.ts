import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Period } from '@hunit/domain';
import type { Database } from './db.js';
import { isConstraintViolation, PG_UNIQUE_VIOLATION } from './errors.js';
import {
  ACTIVE_EXECUTION_STATUSES,
  apiClients,
  executionHotels,
  executions,
  hotels,
  type ExecutionEndReason,
  type ExecutionStatus,
} from './schema.js';

export type ExecutionRow = typeof executions.$inferSelect;
export type ExecutionHotelRow = typeof executionHotels.$inferSelect & { hotelName: string };

/** Já existe uma execução ativa para a mesma conta do Hunit (FR-006). */
export class ExecutionAlreadyActiveError extends Error {
  constructor() {
    super('Já existe uma execução ativa para esta conta do Hunit.');
    this.name = 'ExecutionAlreadyActiveError';
  }
}

/** O cursor de paginação não foi gerado por este servidor ou aponta para um registro removido. */
export class InvalidCursorError extends Error {
  constructor() {
    super('Cursor de paginação inválido.');
    this.name = 'InvalidCursorError';
  }
}

export interface NewExecution {
  /** HMAC do usuário do Hunit (research R-11). */
  accountKey: string;
  clientId: string;
  period: Period;
  /** `null` = todos os hotéis do catálogo (FR-009). */
  requestedHotelCodes: string[] | null;
  /** Preenchido nas retomadas (FR-023). */
  parentExecutionId?: string | null;
}

/**
 * Cria a execução no estado `queued`.
 *
 * @throws ExecutionAlreadyActiveError se a conta já tem uma execução ativa. Quem garante a regra
 *   é o índice único parcial do banco, então ela vale mesmo com pedidos simultâneos.
 */
export async function createExecution(db: Database, input: NewExecution): Promise<ExecutionRow> {
  try {
    const [row] = await db
      .insert(executions)
      .values({
        accountKey: input.accountKey,
        clientId: input.clientId,
        periodFrom: input.period.from,
        periodTo: input.period.to,
        requestedHotelCodes: input.requestedHotelCodes,
        parentExecutionId: input.parentExecutionId ?? null,
      })
      .returning();
    if (!row) throw new Error('O banco não devolveu a execução criada.');
    return row;
  } catch (error) {
    if (isConstraintViolation(error, PG_UNIQUE_VIOLATION, 'executions_one_active_per_account')) {
      throw new ExecutionAlreadyActiveError();
    }
    throw error;
  }
}

/**
 * Transições de estado permitidas (data-model.md, "Transições de estado"). Estados finais não
 * saem do lugar.
 */
export const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> =
  {
    queued: ['running', 'failed', 'cancelled'],
    running: ['awaiting_2fa', 'completed', 'failed', 'cancelled'],
    awaiting_2fa: ['running', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };

export type ExecutionTransition =
  | { to: 'running' }
  | { to: 'awaiting_2fa'; twoFactorDeadline: Date }
  | { to: 'completed' }
  | { to: 'failed'; endReason: ExecutionEndReason }
  | { to: 'cancelled'; endReason: ExecutionEndReason; cancelledByClientId?: string | null };

function sourcesOf(target: ExecutionStatus): ExecutionStatus[] {
  return (Object.keys(EXECUTION_TRANSITIONS) as ExecutionStatus[]).filter((source) =>
    EXECUTION_TRANSITIONS[source].includes(target),
  );
}

/**
 * Muda o estado da execução, se a transição for permitida a partir do estado atual.
 *
 * A checagem e a mudança acontecem no mesmo comando do banco: duas mudanças simultâneas (ex.: o
 * executor concluindo e um cliente cancelando) nunca produzem um estado fora do diagrama.
 *
 * @returns a execução atualizada, ou `null` se ela não existe ou o estado atual não permite a
 *   transição (ex.: já foi cancelada).
 */
export async function transitionExecution(
  db: Database,
  executionId: string,
  transition: ExecutionTransition,
  now: Date = new Date(),
): Promise<ExecutionRow | null> {
  const changes: Partial<Record<keyof ExecutionRow, unknown>> = { status: transition.to };

  switch (transition.to) {
    case 'running':
      changes.startedAt = sql`coalesce(${executions.startedAt}, ${now.toISOString()}::timestamptz)`;
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
    .update(executions)
    .set(changes as Partial<typeof executions.$inferInsert>)
    .where(
      and(eq(executions.id, executionId), inArray(executions.status, sourcesOf(transition.to))),
    )
    .returning();
  return row ?? null;
}

/**
 * Marca como `failed` todas as execuções ativas. Usado na subida do servidor: as credenciais e o
 * token ficavam só na memória do processo anterior, então essas execuções não podem continuar.
 *
 * @returns as execuções afetadas.
 */
export async function failAllActive(
  db: Database,
  endReason: ExecutionEndReason,
  now: Date = new Date(),
): Promise<ExecutionRow[]> {
  return db
    .update(executions)
    .set({ status: 'failed', endReason, finishedAt: now, twoFactorDeadline: null })
    .where(inArray(executions.status, [...ACTIVE_EXECUTION_STATUSES]))
    .returning();
}

export interface ExecutionWithClient {
  execution: ExecutionRow;
  /** Nome do cliente da API que iniciou a execução. */
  clientName: string;
}

export async function findExecution(
  db: Database,
  executionId: string,
): Promise<ExecutionWithClient | null> {
  const [row] = await db
    .select({ execution: executions, clientName: apiClients.name })
    .from(executions)
    .innerJoin(apiClients, eq(apiClients.id, executions.clientId))
    .where(eq(executions.id, executionId));
  return row ?? null;
}

/** Hotéis de uma execução, na ordem em que foram incluídos. */
export async function listExecutionHotels(
  db: Database,
  executionId: string,
): Promise<ExecutionHotelRow[]> {
  const rows = await db
    .select({ run: executionHotels, hotelName: hotels.name })
    .from(executionHotels)
    .innerJoin(hotels, eq(hotels.code, executionHotels.hotelCode))
    .where(eq(executionHotels.executionId, executionId))
    .orderBy(executionHotels.hotelCode);
  return rows.map(({ run, hotelName }) => ({ ...run, hotelName }));
}

export interface ListExecutionsOptions {
  status?: ExecutionStatus | undefined;
  limit: number;
  /** Valor de `nextCursor` de uma página anterior. */
  cursor?: string | undefined;
}

export interface ExecutionPage {
  items: ExecutionRow[];
  /** Cursor da próxima página; `null` quando esta é a última. */
  nextCursor: string | null;
}

/** O cursor é o id da última execução da página, codificado para não ser lido como dado. */
function encodeCursor(executionId: string): string {
  return Buffer.from(executionId, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string {
  const executionId = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(executionId)) {
    throw new InvalidCursorError();
  }
  return executionId;
}

/**
 * Execuções, das mais recentes para as mais antigas, paginadas por cursor.
 *
 * A posição do cursor é comparada no próprio banco (pela data de criação e pelo id), sem passar
 * a data pelo JavaScript, que perderia os microssegundos e poderia pular ou repetir execuções.
 *
 * @throws InvalidCursorError
 */
export async function listExecutions(
  db: Database,
  options: ListExecutionsOptions,
): Promise<ExecutionPage> {
  const conditions: SQL[] = [];
  if (options.status) conditions.push(eq(executions.status, options.status));

  if (options.cursor !== undefined) {
    const cursorId = decodeCursor(options.cursor);
    const [anchor] = await db
      .select({ id: executions.id })
      .from(executions)
      .where(eq(executions.id, cursorId));
    if (!anchor) throw new InvalidCursorError();
    conditions.push(
      sql`(${executions.createdAt}, ${executions.id}) < (select e.created_at, e.id from executions e where e.id = ${cursorId})`,
    );
  }

  // Lê um registro a mais para saber se existe uma próxima página.
  const rows = await db
    .select()
    .from(executions)
    .where(and(...conditions))
    .orderBy(desc(executions.createdAt), desc(executions.id))
    .limit(options.limit + 1);

  const items = rows.slice(0, options.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > options.limit && last ? encodeCursor(last.id) : null,
  };
}
