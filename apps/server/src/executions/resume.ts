import type { HunitCredentials } from '../hunit/gateway.js';
import type { Database } from '../persistence/db.js';
import {
  findExecution,
  listExecutionHotels,
  type ExecutionRow,
} from '../persistence/executions-repo.js';
import { ACTIVE_EXECUTION_STATUSES, type ExecutionStatus } from '../persistence/schema.js';
import type { ExecutionRunner } from './runner.js';

export class ExecutionNotFoundError extends Error {
  constructor() {
    super('Execução não encontrada.');
    this.name = 'ExecutionNotFoundError';
  }
}

/** A execução ainda está em andamento: só uma execução encerrada pode ser retomada. */
export class ExecutionStillActiveError extends Error {
  constructor(readonly status: ExecutionStatus) {
    super(`A execução ainda está em andamento (estado "${status}"); cancele-a ou aguarde o fim.`);
    this.name = 'ExecutionStillActiveError';
  }
}

/** Todos os hotéis da execução foram concluídos: não há o que retomar. */
export class NothingToResumeError extends Error {
  constructor() {
    super('Todos os hotéis desta execução já foram concluídos; não há o que retomar.');
    this.name = 'NothingToResumeError';
  }
}

export interface ResumeDependencies {
  db: Database;
  runner: ExecutionRunner;
}

export interface ResumeInput {
  executionId: string;
  /** Cliente que pediu a retomada; passa a ser o solicitante da nova execução. */
  clientId: string;
  /** Novo acesso ao Hunit: a sessão da execução original não existe mais (FR-023). */
  credentials: HunitCredentials;
}

function isActive(status: ExecutionStatus): boolean {
  return (ACTIVE_EXECUTION_STATUSES as readonly ExecutionStatus[]).includes(status);
}

/**
 * Hotéis que a retomada deve consultar: os da execução original que não foram concluídos
 * (data-model, "Retomada"), na ordem do pedido original quando ele lista os hotéis.
 *
 * - Hotéis `pending`, `failed` (inclusive os pedidos que não estavam no catálogo) e `cancelled`
 *   entram; os `completed` não (SC-007).
 * - Execução que terminou antes de definir os hotéis (ex.: token inválido): repete o pedido
 *   original — `null`, se ele era "todos os hotéis".
 *
 * @throws NothingToResumeError se não sobra nenhum hotel.
 */
export async function hotelsToResume(
  db: Database,
  execution: ExecutionRow,
): Promise<string[] | null> {
  const hotels = await listExecutionHotels(db, execution.id);
  const requested = execution.requestedHotelCodes;

  if (hotels.length === 0) {
    // Concluída sem nenhum hotel: o catálogo estava vazio, ou nenhum hotel pedido existia.
    if (execution.status === 'completed' && requested === null) throw new NothingToResumeError();
    return requested;
  }

  const completed = new Set(
    hotels.filter((hotel) => hotel.status === 'completed').map((hotel) => hotel.hotelCode),
  );
  const candidates = requested ?? hotels.map((hotel) => hotel.hotelCode);
  const pending = candidates.filter((code) => !completed.has(code));
  if (pending.length === 0) throw new NothingToResumeError();
  return pending;
}

/**
 * Retoma uma execução encerrada a partir dos hotéis não concluídos (FR-023): cria uma nova
 * execução ligada à original (`parent_execution_id`), com o mesmo período, e a inicia com as novas
 * credenciais — o que exige um novo token.
 *
 * @throws ExecutionNotFoundError
 * @throws ExecutionStillActiveError se a execução ainda está em andamento.
 * @throws NothingToResumeError se todos os hotéis foram concluídos.
 * @throws ExecutionAlreadyActiveError se a conta já tem uma execução ativa (FR-006).
 */
export async function resumeExecution(
  dependencies: ResumeDependencies,
  input: ResumeInput,
): Promise<ExecutionRow> {
  const { db, runner } = dependencies;
  const found = await findExecution(db, input.executionId);
  if (!found) throw new ExecutionNotFoundError();
  const { execution } = found;
  if (isActive(execution.status)) throw new ExecutionStillActiveError(execution.status);

  const hotelCodes = await hotelsToResume(db, execution);
  return runner.start({
    clientId: input.clientId,
    credentials: input.credentials,
    period: { from: execution.periodFrom, to: execution.periodTo },
    hotelCodes,
    parentExecutionId: execution.id,
  });
}
