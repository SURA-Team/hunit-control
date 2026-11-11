import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/persistence/db.js';
import {
  findDatabaseError,
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from '../../src/persistence/errors.js';
import {
  apiClients,
  evidence,
  executions,
  reservationObservations,
  reservations,
} from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient, insertExecution, insertHotel } from '../helpers/factories.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

/** Executa a operação e devolve o código e a restrição do erro do PostgreSQL. */
async function violation(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    const databaseError = findDatabaseError(error);
    if (!databaseError) throw error;
    return { code: databaseError.code, constraint: databaseError.constraint };
  }
  throw new Error('a operação deveria ter violado uma restrição do banco');
}

async function insertReservation(overrides: Partial<typeof reservations.$inferInsert> = {}) {
  const hotelCode = overrides.hotelCode ?? (await insertHotel(database.db)).code;
  const lastExecutionId = overrides.lastExecutionId ?? (await insertExecution(database.db)).id;
  const now = new Date();
  const [row] = await database.db
    .insert(reservations)
    .values({
      reservationNumber: '1001',
      channel: 'Booking.com',
      checkIn: '2026-11-03',
      checkOut: '2026-11-05',
      stayPeriod: '03/11/2026 - 05/11/2026',
      totalAmount: '1234.56',
      reservationStatus: 'active',
      classification: 'virtual_card_pending_charge',
      reason: 'pré-pagamento sem registro de cobrança',
      prePaymentFound: true,
      chargeActionVisible: true,
      firstVerifiedAt: now,
      lastVerifiedAt: now,
      ...overrides,
      hotelCode,
      lastExecutionId,
    })
    .returning();
  if (!row) throw new Error('a reserva não foi inserida');
  return row;
}

describe('migrations (T012)', () => {
  it('cria todas as tabelas do modelo de dados', async () => {
    const result = await database.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'api_clients',
      'evidence',
      'execution_events',
      'execution_hotels',
      'executions',
      'hotels',
      'reservation_observations',
      'reservations',
    ]);
  });

  it('pode ser aplicada de novo sem erro (toda inicialização do servidor aplica)', async () => {
    await expect(runMigrations(database)).resolves.toBeUndefined();
  });

  it('aguenta duas aplicações ao mesmo tempo (servidor e CLI iniciando juntos)', async () => {
    const other = await createTestDatabase();
    try {
      await expect(
        Promise.all([runMigrations(other), runMigrations(other), runMigrations(other)]),
      ).resolves.toBeDefined();
    } finally {
      await other.close();
    }
  });
});

describe('executions (T011)', () => {
  it('permite no máximo uma execução ativa por conta do Hunit (FR-006)', async () => {
    const accountKey = 'conta-uma-ativa';
    const first = await insertExecution(database.db, { accountKey, status: 'running' });

    for (const status of ['queued', 'running', 'awaiting_2fa'] as const) {
      expect(await violation(insertExecution(database.db, { accountKey, status }))).toEqual({
        code: PG_UNIQUE_VIOLATION,
        constraint: 'executions_one_active_per_account',
      });
    }

    // Depois que a primeira termina, a conta pode ter uma nova execução ativa.
    await database.db
      .update(executions)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(sql`${executions.id} = ${first.id}`);

    await expect(
      insertExecution(database.db, { accountKey, status: 'queued' }),
    ).resolves.toBeDefined();
  });

  it('não limita execuções encerradas nem contas diferentes', async () => {
    const accountKey = 'conta-com-historico';
    await insertExecution(database.db, { accountKey, status: 'completed' });
    await insertExecution(database.db, { accountKey, status: 'completed' });
    await insertExecution(database.db, {
      accountKey,
      status: 'failed',
      endReason: 'invalid_token',
    });
    await insertExecution(database.db, { accountKey, status: 'running' });

    await expect(
      insertExecution(database.db, { accountKey: 'outra-conta', status: 'running' }),
    ).resolves.toBeDefined();
  });

  it('começa como "queued" e aceita período de um único dia', async () => {
    const execution = await insertExecution(database.db, {
      periodFrom: '2026-11-05',
      periodTo: '2026-11-05',
    });

    expect(execution.status).toBe('queued');
    expect(execution.periodFrom).toBe('2026-11-05');
    expect(execution.requestedHotelCodes).toBeNull();
    expect(execution.createdAt).toBeInstanceOf(Date);
  });

  it('recusa período com data inicial depois da final (FR-010a)', async () => {
    expect(
      await violation(
        insertExecution(database.db, { periodFrom: '2026-11-08', periodTo: '2026-11-07' }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'executions_period_check' });
  });

  it.each(['failed', 'cancelled'] as const)(
    'exige motivo de encerramento em execução "%s"',
    async (status) => {
      expect(await violation(insertExecution(database.db, { status }))).toEqual({
        code: PG_CHECK_VIOLATION,
        constraint: 'executions_end_reason_check',
      });
    },
  );

  it('exige um cliente existente', async () => {
    expect(
      await violation(
        insertExecution(database.db, { clientId: '00000000-0000-4000-8000-000000000000' }),
      ),
    ).toMatchObject({ code: PG_FOREIGN_KEY_VIOLATION });
  });
});

describe('api_clients (T011)', () => {
  it('não aceita dois clientes com o mesmo nome nem com a mesma chave', async () => {
    const client = await insertClient(database.db);

    expect(await violation(insertClient(database.db, { name: client.name }))).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: 'api_clients_name_unique',
    });
    expect(await violation(insertClient(database.db, { keyHash: client.keyHash }))).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: 'api_clients_key_hash_unique',
    });
  });

  it('recusa nível de acesso desconhecido', async () => {
    await expect(
      database.db.execute(
        sql`insert into ${apiClients} (name, role, key_hash) values ('x', 'admin', 'h')`,
      ),
    ).rejects.toThrow();
  });
});

describe('reservations (T011)', () => {
  it('identifica a reserva por hotel + número (FR-017)', async () => {
    const reservation = await insertReservation({ reservationNumber: 'dup-1' });

    expect(
      await violation(
        insertReservation({ hotelCode: reservation.hotelCode, reservationNumber: 'dup-1' }),
      ),
    ).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: 'reservations_hotel_code_reservation_number_pk',
    });

    // O mesmo número em outro hotel é outra reserva.
    await expect(insertReservation({ reservationNumber: 'dup-1' })).resolves.toBeDefined();
  });

  it('guarda valores com duas casas decimais e datas no formato ISO', async () => {
    const reservation = await insertReservation({
      reservationNumber: 'valores',
      totalAmount: '1500.5',
      chargedAmount: '0',
    });

    expect(reservation.totalAmount).toBe('1500.50');
    expect(reservation.chargedAmount).toBe('0.00');
    expect(reservation.checkIn).toBe('2026-11-03');
    expect(reservation.verificationCount).toBe(1);
    expect(reservation.changedFields).toEqual([]);
    expect(reservation.statusChanged).toBe(false);
  });

  it('exige quantidade de verificações maior ou igual a 1 (FR-018)', async () => {
    expect(
      await violation(insertReservation({ reservationNumber: 'zero', verificationCount: 0 })),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'reservations_verification_count_check' });
  });

  it('só registra observação de reserva existente', async () => {
    const execution = await insertExecution(database.db);

    expect(
      await violation(
        database.db.insert(reservationObservations).values({
          executionId: execution.id,
          hotelCode: 'hotel-inexistente',
          reservationNumber: 'nao-existe',
          classification: 'analysis_error',
          reservationStatus: 'unknown',
        }),
      ),
    ).toEqual({
      code: PG_FOREIGN_KEY_VIOLATION,
      constraint: 'reservation_observations_reservation_fk',
    });
  });
});

describe('evidence (T011)', () => {
  it('exige pelo menos um arquivo (captura, HTML ou resposta)', async () => {
    const execution = await insertExecution(database.db);
    const base = {
      executionId: execution.id,
      kind: 'screen_not_recognized' as const,
      reason: 'tela não reconhecida',
      expiresAt: new Date(),
    };

    expect(await violation(database.db.insert(evidence).values(base))).toEqual({
      code: PG_CHECK_VIOLATION,
      constraint: 'evidence_has_file_check',
    });

    await expect(
      database.db.insert(evidence).values({ ...base, responsePath: 'x/resposta.json' }),
    ).resolves.toBeDefined();
  });
});
