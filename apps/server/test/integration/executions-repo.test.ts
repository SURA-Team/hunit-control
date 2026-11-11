import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createExecution,
  EXECUTION_TRANSITIONS,
  ExecutionAlreadyActiveError,
  failAllActive,
  findExecution,
  InvalidCursorError,
  listExecutions,
  transitionExecution,
  type ExecutionTransition,
  type NewExecution,
} from '../../src/persistence/executions-repo.js';
import type { ExecutionStatus } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient, insertExecution } from '../helpers/factories.js';

let database: TestDatabase;
let clientId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  clientId = (await insertClient(database.db, { name: 'desktop' })).id;
});

afterAll(async () => {
  await database.close();
});

function newExecution(overrides: Partial<NewExecution> = {}): NewExecution {
  return {
    accountKey: `conta-${randomUUID()}`,
    clientId,
    period: { from: '2026-11-01', to: '2026-11-07' },
    requestedHotelCodes: null,
    ...overrides,
  };
}

describe('createExecution (T029)', () => {
  it('cria a execução em queued, sem início nem fim', async () => {
    const execution = await createExecution(
      database.db,
      newExecution({ requestedHotelCodes: ['H1', 'H2'] }),
    );

    expect(execution).toMatchObject({
      status: 'queued',
      endReason: null,
      startedAt: null,
      finishedAt: null,
      twoFactorDeadline: null,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-07',
      requestedHotelCodes: ['H1', 'H2'],
      parentExecutionId: null,
    });
  });

  it('recusa uma segunda execução ativa na mesma conta (FR-006)', async () => {
    const accountKey = `conta-${randomUUID()}`;
    await createExecution(database.db, newExecution({ accountKey }));

    await expect(createExecution(database.db, newExecution({ accountKey }))).rejects.toThrow(
      ExecutionAlreadyActiveError,
    );
  });

  it('recusa mesmo com pedidos simultâneos: só um é criado', async () => {
    const accountKey = `conta-${randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createExecution(database.db, newExecution({ accountKey }))),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results.filter((r) => r.status === 'rejected')) {
      expect(result.reason).toBeInstanceOf(ExecutionAlreadyActiveError);
    }
  });

  it('aceita nova execução na conta depois que a anterior terminou', async () => {
    const accountKey = `conta-${randomUUID()}`;
    const first = await createExecution(database.db, newExecution({ accountKey }));
    await transitionExecution(database.db, first.id, { to: 'failed', endReason: 'invalid_token' });

    await expect(createExecution(database.db, newExecution({ accountKey }))).resolves.toMatchObject(
      { status: 'queued' },
    );
  });
});

describe('transitionExecution (T029, diagrama do data-model)', () => {
  const ALL: ExecutionStatus[] = [
    'queued',
    'running',
    'awaiting_2fa',
    'completed',
    'failed',
    'cancelled',
  ];

  it('segue o caminho normal: queued → running → awaiting_2fa → running → completed', async () => {
    const { id } = await createExecution(database.db, newExecution());
    const deadline = new Date('2026-11-11T12:02:00Z');

    const running = await transitionExecution(
      database.db,
      id,
      { to: 'running' },
      new Date('2026-11-11T12:00:00Z'),
    );
    expect(running?.startedAt).toEqual(new Date('2026-11-11T12:00:00Z'));

    const awaiting = await transitionExecution(database.db, id, {
      to: 'awaiting_2fa',
      twoFactorDeadline: deadline,
    });
    expect(awaiting).toMatchObject({ status: 'awaiting_2fa', twoFactorDeadline: deadline });

    const back = await transitionExecution(
      database.db,
      id,
      { to: 'running' },
      new Date('2026-11-11T12:01:00Z'),
    );
    // O início continua sendo o da primeira vez; o prazo do token deixa de valer.
    expect(back).toMatchObject({
      status: 'running',
      startedAt: new Date('2026-11-11T12:00:00Z'),
      twoFactorDeadline: null,
    });

    const done = await transitionExecution(
      database.db,
      id,
      { to: 'completed' },
      new Date('2026-11-11T12:30:00Z'),
    );
    expect(done).toMatchObject({
      status: 'completed',
      endReason: null,
      finishedAt: new Date('2026-11-11T12:30:00Z'),
    });
  });

  it('grava o motivo e o fim em failed e cancelled', async () => {
    const failed = await createExecution(database.db, newExecution());
    await transitionExecution(database.db, failed.id, { to: 'running' });
    expect(
      await transitionExecution(database.db, failed.id, {
        to: 'failed',
        endReason: 'invalid_credentials',
      }),
    ).toMatchObject({ status: 'failed', endReason: 'invalid_credentials' });

    const cancelled = await createExecution(database.db, newExecution());
    const result = await transitionExecution(database.db, cancelled.id, {
      to: 'cancelled',
      endReason: 'cancelled_by_client',
      cancelledByClientId: clientId,
    });
    expect(result).toMatchObject({
      status: 'cancelled',
      endReason: 'cancelled_by_client',
      cancelledByClientId: clientId,
    });
    expect(result?.finishedAt).toBeInstanceOf(Date);
  });

  it.each(ALL)('a partir de %s, só aceita as transições do diagrama', async (from) => {
    for (const to of ALL) {
      const execution = await insertExecution(database.db, {
        status: from,
        endReason: from === 'failed' || from === 'cancelled' ? 'internal_error' : null,
      });

      // "queued" não é destino de nenhuma transição; o tipo não o aceita, mas o banco também
      // precisa recusar.
      const transition = (
        to === 'awaiting_2fa'
          ? { to, twoFactorDeadline: new Date() }
          : to === 'failed' || to === 'cancelled'
            ? { to, endReason: 'internal_error' }
            : { to }
      ) as ExecutionTransition;
      const result = await transitionExecution(database.db, execution.id, transition);

      if (EXECUTION_TRANSITIONS[from].includes(to)) {
        expect(result?.status, `${from} → ${to}`).toBe(to);
      } else {
        expect(result, `${from} → ${to} deveria ser recusada`).toBeNull();
        const unchanged = await findExecution(database.db, execution.id);
        expect(unchanged?.execution.status).toBe(from);
      }
    }
  });

  it('devolve null para execução inexistente', async () => {
    expect(await transitionExecution(database.db, randomUUID(), { to: 'running' })).toBeNull();
  });
});

describe('failAllActive (T029)', () => {
  it('marca toda execução ativa como failed/server_restarted e não mexe nas encerradas', async () => {
    const own = await createTestDatabase();
    try {
      const queued = await insertExecution(own.db, { status: 'queued' });
      const awaiting = await insertExecution(own.db, {
        status: 'awaiting_2fa',
        twoFactorDeadline: new Date(),
      });
      const completed = await insertExecution(own.db, { status: 'completed' });

      const affected = await failAllActive(own.db, 'server_restarted');

      expect(affected.map((row) => row.id).sort()).toEqual([queued.id, awaiting.id].sort());
      for (const row of affected) {
        expect(row).toMatchObject({
          status: 'failed',
          endReason: 'server_restarted',
          twoFactorDeadline: null,
        });
      }
      expect((await findExecution(own.db, completed.id))?.execution.status).toBe('completed');
    } finally {
      await own.close();
    }
  });
});

describe('findExecution e listExecutions', () => {
  it('devolve a execução com o nome do cliente', async () => {
    const execution = await createExecution(database.db, newExecution());

    expect(await findExecution(database.db, execution.id)).toEqual({
      execution,
      clientName: 'desktop',
    });
    expect(await findExecution(database.db, randomUUID())).toBeNull();
  });

  it('pagina por cursor, das mais recentes para as mais antigas, sem repetir nem pular', async () => {
    const own = await createTestDatabase();
    try {
      const created: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        created.push((await insertExecution(own.db, { status: 'completed' })).id);
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listExecutions(own.db, { limit: 3, cursor });
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      expect(seen).toEqual([...created].reverse());
    } finally {
      await own.close();
    }
  });

  it('filtra por estado', async () => {
    const own = await createTestDatabase();
    try {
      await insertExecution(own.db, { status: 'completed' });
      const failed = await insertExecution(own.db, {
        status: 'failed',
        endReason: 'invalid_token',
      });

      const page = await listExecutions(own.db, { status: 'failed', limit: 50 });
      expect(page.items.map((item) => item.id)).toEqual([failed.id]);
      expect(page.nextCursor).toBeNull();
    } finally {
      await own.close();
    }
  });

  it('recusa cursor inválido ou de execução inexistente', async () => {
    await expect(listExecutions(database.db, { limit: 10, cursor: 'lixo' })).rejects.toThrow(
      InvalidCursorError,
    );
    const unknown = Buffer.from(randomUUID()).toString('base64url');
    await expect(listExecutions(database.db, { limit: 10, cursor: unknown })).rejects.toThrow(
      InvalidCursorError,
    );
  });
});
