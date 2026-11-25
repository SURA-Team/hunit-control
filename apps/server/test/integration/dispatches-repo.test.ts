/**
 * Repositório dos envios ao Comercial (specs/005, data-model §1.1 a §1.3) — tasks.md, T015.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countDispatchItems,
  createDispatch,
  DispatchAlreadyResumedError,
  failAllActiveDispatches,
  failPendingItems,
  findDispatch,
  listDispatches,
  listDispatchItems,
  recordItemOutcome,
  transitionDispatch,
  type NewDispatchItem,
} from '../../src/persistence/dispatches-repo.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient } from '../helpers/factories.js';

let database: TestDatabase;
let clientId: string;
let clientName: string;
const now = new Date('2026-11-17T12:00:00Z');
let accounts = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  const client = await insertClient(database.db);
  clientId = client.id;
  clientName = client.name;
});

afterAll(async () => {
  await database.close();
});

const item = (
  reservationNumber: string,
  outcome: NewDispatchItem['outcome'] = 'pending',
): NewDispatchItem => ({
  hotelCode: 'hml_um',
  reservationNumber,
  classificationBefore: outcome === 'pending' ? 'virtual_card_pending_charge' : null,
  outcome,
  reason: outcome === 'ignored' ? 'not_found' : null,
});

const create = (items: NewDispatchItem[], parentDispatchId: string | null = null) =>
  createDispatch(database.db, {
    accountKey: `conta-${(accounts += 1)}`,
    clientId,
    parentDispatchId,
    items,
    now,
  });

describe('createDispatch', () => {
  it('grava as reservas na ordem pedida; as ignoradas já nascem processadas', async () => {
    const dispatch = await create([item('900003'), item('900001', 'ignored'), item('900002')]);
    const items = await listDispatchItems(database.db, dispatch.id);

    expect(items.map((row) => [row.position, row.reservationNumber, row.outcome])).toEqual([
      [1, '900003', 'pending'],
      [2, '900001', 'ignored'],
      [3, '900002', 'pending'],
    ]);
    expect(items[1]?.processedAt).toEqual(now);
    expect(items[1]?.reason).toBe('not_found');
    expect(items[0]?.processedAt).toBeNull();
  });

  it('cada envio é retomado no máximo uma vez', async () => {
    const parent = await create([item('900010')]);
    await transitionDispatch(
      database.db,
      parent.id,
      { to: 'failed', endReason: 'internal_error' },
      now,
    );
    await create([item('900010')], parent.id);
    await expect(create([item('900010')], parent.id)).rejects.toBeInstanceOf(
      DispatchAlreadyResumedError,
    );
  });
});

describe('transições e desfechos', () => {
  it('segue o diagrama das execuções', async () => {
    const dispatch = await create([item('900020')]);
    expect(
      await transitionDispatch(database.db, dispatch.id, { to: 'running' }, now),
    ).toMatchObject({
      status: 'running',
      startedAt: now,
    });
    const deadline = new Date(now.getTime() + 300_000);
    expect(
      await transitionDispatch(
        database.db,
        dispatch.id,
        { to: 'awaiting_2fa', twoFactorDeadline: deadline },
        now,
      ),
    ).toMatchObject({ status: 'awaiting_2fa', twoFactorDeadline: deadline });
    await transitionDispatch(database.db, dispatch.id, { to: 'running' }, now);
    await transitionDispatch(database.db, dispatch.id, { to: 'completed' }, now);
    // Estado final não sai do lugar.
    expect(await transitionDispatch(database.db, dispatch.id, { to: 'running' }, now)).toBeNull();
  });

  it('desfecho de cada reserva e as pendentes viram não verificadas', async () => {
    const dispatch = await create([
      item('900030'),
      item('900031'),
      item('900032'),
      item('900033', 'ignored'),
    ]);
    await recordItemOutcome(database.db, {
      dispatchId: dispatch.id,
      hotelCode: 'hml_um',
      reservationNumber: '900030',
      outcome: 'sent',
      classificationAfter: 'virtual_card_pending_charge',
      reason: null,
      now,
    });
    await recordItemOutcome(database.db, {
      dispatchId: dispatch.id,
      hotelCode: 'hml_um',
      reservationNumber: '900031',
      outcome: 'withdrawn',
      classificationAfter: 'virtual_card_already_charged',
      reason: 'Já cobrada',
      now,
    });
    expect(await failPendingItems(database.db, dispatch.id, 'envio cancelado', now)).toBe(1);

    const counts = await countDispatchItems(database.db, [dispatch.id]);
    expect(counts.get(dispatch.id)).toEqual({
      total: 4,
      pending: 0,
      sent: 1,
      withdrawn: 1,
      notVerified: 1,
      ignored: 1,
      checked: 0,
    });
  });

  it('servidor reiniciado: envios ativos falham e as pendentes ficam não verificadas', async () => {
    const dispatch = await create([item('900040')]);
    await transitionDispatch(database.db, dispatch.id, { to: 'running' }, now);
    const failed = await failAllActiveDispatches(
      database.db,
      'server_restarted',
      'servidor reiniciado',
      now,
    );

    expect(failed.map((row) => row.id)).toContain(dispatch.id);
    const [row] = await listDispatchItems(database.db, dispatch.id);
    expect(row).toMatchObject({ outcome: 'not_verified', reason: 'servidor reiniciado' });
  });
});

describe('consultas', () => {
  it('encontra o envio com o nome de quem enviou', async () => {
    const dispatch = await create([item('900050')]);
    expect(await findDispatch(database.db, dispatch.id)).toMatchObject({
      dispatch: { id: dispatch.id },
      clientName,
    });
  });

  it('lista dos mais recentes para os mais antigos, com cursor e filtro de ativos', async () => {
    const page = await listDispatches(database.db, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const next = await listDispatches(database.db, { limit: 2, cursor: page.nextCursor ?? '' });
    expect(next.items.map((row) => row.id)).not.toContain(page.items[0]?.id);

    const active = await listDispatches(database.db, { limit: 50, active: true });
    expect(
      active.items.every((row) => ['queued', 'running', 'awaiting_2fa'].includes(row.status)),
    ).toBe(true);
  });
});
