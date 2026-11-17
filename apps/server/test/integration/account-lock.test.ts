/**
 * "Uma automação por vez por conta do Hunit" entre execuções e envios ao Comercial (specs/005,
 * research R-01; constitution, princípio IV) — tasks.md, T019.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccountBusyError,
  createDispatch,
  transitionDispatch,
} from '../../src/persistence/dispatches-repo.js';
import {
  createExecution,
  ExecutionAlreadyActiveError,
  transitionExecution,
} from '../../src/persistence/executions-repo.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient } from '../helpers/factories.js';

let database: TestDatabase;
let clientId: string;
const now = new Date('2026-11-17T12:00:00Z');
const period = { from: '2026-11-01', to: '2026-11-07' };

beforeAll(async () => {
  database = await createTestDatabase();
  clientId = (await insertClient(database.db)).id;
});

afterAll(async () => {
  await database.close();
});

const newDispatch = (accountKey: string) =>
  createDispatch(database.db, { accountKey, clientId, items: [], now });
const newExecution = (accountKey: string) =>
  createExecution(database.db, { accountKey, clientId, period, requestedHotelCodes: null });

describe('trava da conta (R-01)', () => {
  it('execução ativa impede o envio na mesma conta', async () => {
    const execution = await newExecution('conta-a');
    await expect(newDispatch('conta-a')).rejects.toBeInstanceOf(AccountBusyError);
    await transitionExecution(database.db, execution.id, {
      to: 'failed',
      endReason: 'internal_error',
    });
    await expect(newDispatch('conta-a')).resolves.toMatchObject({ status: 'queued' });
  });

  it('envio ativo impede a execução na mesma conta', async () => {
    const dispatch = await newDispatch('conta-b');
    await expect(newExecution('conta-b')).rejects.toBeInstanceOf(ExecutionAlreadyActiveError);
    await transitionDispatch(
      database.db,
      dispatch.id,
      { to: 'cancelled', endReason: 'cancelled_by_client' },
      now,
    );
    await expect(newExecution('conta-b')).resolves.toMatchObject({ status: 'queued' });
  });

  it('dois envios ativos na mesma conta não convivem', async () => {
    await newDispatch('conta-c');
    await expect(newDispatch('conta-c')).rejects.toBeInstanceOf(AccountBusyError);
  });

  it('contas diferentes não se bloqueiam', async () => {
    await newExecution('conta-d');
    await expect(newDispatch('conta-e')).resolves.toMatchObject({ status: 'queued' });
  });

  it('duas criações simultâneas na mesma conta: só uma passa', async () => {
    const results = await Promise.allSettled([
      newExecution('conta-f'),
      newDispatch('conta-f'),
      newDispatch('conta-f'),
      newExecution('conta-f'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
});
