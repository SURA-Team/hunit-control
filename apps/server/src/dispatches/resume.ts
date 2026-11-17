/**
 * Retomada de um envio ao Comercial (specs/005, FR-007; constitution, princípio IV): um envio
 * filho, com novo login e token, só com as reservas que ficaram não verificadas.
 */
import type { HunitCredentials } from '../hunit/gateway.js';
import type { Database } from '../persistence/db.js';
import {
  DispatchAlreadyResumedError,
  findDispatch,
  findResumeOfDispatch,
  listDispatchItems,
  type DispatchRow,
} from '../persistence/dispatches-repo.js';
import { isActiveExecutionStatus } from '../persistence/schema.js';
import type { DispatchRunner } from './runner.js';

export class DispatchNotFoundError extends Error {
  constructor() {
    super('Envio não encontrado.');
    this.name = 'DispatchNotFoundError';
  }
}

export class DispatchStillActiveError extends Error {
  constructor() {
    super('O envio ainda está em andamento; aguarde o fim dele ou cancele-o.');
    this.name = 'DispatchStillActiveError';
  }
}

export class NothingToResumeDispatchError extends Error {
  constructor() {
    super('O envio não tem reservas não verificadas para retomar.');
    this.name = 'NothingToResumeDispatchError';
  }
}

/**
 * @throws DispatchNotFoundError, DispatchStillActiveError, DispatchAlreadyResumedError,
 *   NothingToResumeDispatchError e os erros de `DispatchRunner.start`.
 */
export async function resumeDispatch(
  dependencies: { db: Database; runner: DispatchRunner },
  input: { dispatchId: string; clientId: string; credentials: HunitCredentials },
): Promise<DispatchRow> {
  const { db, runner } = dependencies;
  const found = await findDispatch(db, input.dispatchId);
  if (!found) throw new DispatchNotFoundError();
  if (isActiveExecutionStatus(found.dispatch.status)) throw new DispatchStillActiveError();
  const resumedBy = await findResumeOfDispatch(db, input.dispatchId);
  if (resumedBy) throw new DispatchAlreadyResumedError(resumedBy.id);

  const pending = (await listDispatchItems(db, input.dispatchId)).filter(
    (item) => item.outcome === 'not_verified',
  );
  if (pending.length === 0) throw new NothingToResumeDispatchError();

  return runner.start({
    clientId: input.clientId,
    credentials: input.credentials,
    reservations: pending.map((item) => ({
      hotelCode: item.hotelCode,
      reservationNumber: item.reservationNumber,
    })),
    parentDispatchId: input.dispatchId,
  });
}
