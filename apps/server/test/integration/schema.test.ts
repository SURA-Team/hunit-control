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
  commercialDispatchItems,
  commercialReports,
  commercialReturns,
  evidence,
  executions,
  noChargeMarks,
  reservationManualAmounts,
  reservationObservations,
  treatmentDocuments,
  treatmentFiles,
} from '../../src/persistence/schema.js';
import { insertDispatch } from '../helpers/commercial-fixtures.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import {
  insertClient,
  insertExecution,
  insertReservation as insertReservationIn,
} from '../helpers/factories.js';

let database: TestDatabase;

const insertReservation = (overrides: Parameters<typeof insertReservationIn>[1] = {}) =>
  insertReservationIn(database.db, overrides);

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

describe('migrations (T012)', () => {
  it('cria todas as tabelas do modelo de dados', async () => {
    const result = await database.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);

    // Comparadas em ordem do JavaScript: a colação do banco ignora o "_" e ordenaria
    // "commercial_dispatches" antes de "commercial_dispatch_events".
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
      'account_hotels',
      'api_clients',
      'commercial_dispatch_events',
      'commercial_dispatch_items',
      'commercial_dispatches',
      'commercial_events',
      'commercial_lines',
      'commercial_reports',
      'commercial_returns',
      'commercial_sheet_state',
      'evidence',
      'execution_events',
      'execution_hotels',
      'executions',
      'hotels',
      'legacy_hotel_mappings',
      'legacy_imports',
      'legacy_reservations',
      'no_charge_marks',
      'reservation_manual_amounts',
      'reservation_observations',
      'reservations',
      'treatment_documents',
      'treatment_events',
      'treatment_files',
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

describe('tratativas (specs/003, data-model §1)', () => {
  const SHA = 'c'.repeat(64);

  async function setup(reservationNumber: string) {
    const client = await insertClient(database.db);
    const reservation = await insertReservation({ reservationNumber });
    await database.db
      .insert(treatmentFiles)
      .values({
        sha256: SHA,
        content: Buffer.from('%PDF'),
        sizeBytes: 4,
        mediaType: 'application/pdf',
        uploadedByClientId: client.id,
      })
      .onConflictDoNothing();
    const document = {
      hotelCode: reservation.hotelCode,
      reservationNumber,
      kind: 'proof' as const,
      fileSha256: SHA,
      originalName: 'c.pdf',
      sizeBytes: 4,
      mediaType: 'application/pdf',
      attachedByClientId: client.id,
    };
    return { client, reservation, document };
  }

  it('o arquivo precisa ter o tamanho do conteúdo e um SHA-256 válido', async () => {
    const client = await insertClient(database.db);
    const file = {
      content: Buffer.from('%PDF'),
      mediaType: 'application/pdf',
      uploadedByClientId: client.id,
    };

    expect(
      await violation(
        database.db
          .insert(treatmentFiles)
          .values({ ...file, sha256: 'd'.repeat(64), sizeBytes: 5 }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'treatment_files_size_check' });
    expect(
      await violation(
        database.db.insert(treatmentFiles).values({ ...file, sha256: 'nao-e-sha', sizeBytes: 4 }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'treatment_files_sha256_check' });
  });

  it('permite no máximo um documento vigente por reserva e tipo', async () => {
    const { document, client } = await setup('TRAT-1');
    await database.db.insert(treatmentDocuments).values(document);

    expect(await violation(database.db.insert(treatmentDocuments).values(document))).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: 'treatment_documents_one_current',
    });

    // O outro tipo e um documento já encerrado não contam.
    await expect(
      database.db.insert(treatmentDocuments).values({ ...document, kind: 'request' }),
    ).resolves.toBeDefined();
    await expect(
      database.db.insert(treatmentDocuments).values({
        ...document,
        state: 'replaced',
        endedAt: new Date(),
        endedByClientId: client.id,
      }),
    ).resolves.toBeDefined();
  });

  it('o estado precisa combinar com o fim e com a purga', async () => {
    const { document, client } = await setup('TRAT-2');
    const ended = { endedAt: new Date(), endedByClientId: client.id };

    // Atual com data de fim; substituído sem data de fim.
    expect(
      await violation(database.db.insert(treatmentDocuments).values({ ...document, ...ended })),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'treatment_documents_state_check' });
    expect(
      await violation(
        database.db.insert(treatmentDocuments).values({ ...document, state: 'replaced' }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'treatment_documents_state_check' });

    // Purgado ainda com arquivo; não purgado sem arquivo.
    expect(
      await violation(
        database.db
          .insert(treatmentDocuments)
          .values({ ...document, ...ended, state: 'purged', purgedAt: new Date() }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'treatment_documents_purged_check' });
    expect(
      await violation(
        database.db
          .insert(treatmentDocuments)
          .values({ ...document, fileSha256: null, originalName: null }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'treatment_documents_purged_check' });

    // Fim sem quem encerrou.
    expect(
      await violation(
        database.db
          .insert(treatmentDocuments)
          .values({ ...document, state: 'removed', endedAt: new Date() }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'treatment_documents_ended_by_check' });

    // Purgado que continua vigente (reserva anonimizada, FR-016) é válido.
    await expect(
      database.db.insert(treatmentDocuments).values({
        ...document,
        state: 'purged',
        fileSha256: null,
        originalName: null,
        purgedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });

  it('só aceita documento e valor de reserva existente, e valor maior que zero', async () => {
    const { document, client, reservation } = await setup('TRAT-3');

    expect(
      await violation(
        database.db
          .insert(treatmentDocuments)
          .values({ ...document, reservationNumber: 'NAO-EXISTE' }),
      ),
    ).toEqual({
      code: PG_FOREIGN_KEY_VIOLATION,
      constraint: 'treatment_documents_reservation_fk',
    });

    const amount = {
      hotelCode: reservation.hotelCode,
      reservationNumber: 'TRAT-3',
      setByClientId: client.id,
    };
    expect(
      await violation(
        database.db.insert(reservationManualAmounts).values({ ...amount, amount: '0.00' }),
      ),
    ).toEqual({
      code: PG_CHECK_VIOLATION,
      constraint: 'reservation_manual_amounts_amount_check',
    });
    expect(
      await violation(
        database.db
          .insert(reservationManualAmounts)
          .values({ ...amount, reservationNumber: 'NAO-EXISTE', amount: '10.00' }),
      ),
    ).toEqual({
      code: PG_FOREIGN_KEY_VIOLATION,
      constraint: 'reservation_manual_amounts_reservation_fk',
    });
  });
});

describe('ajustes de cobrança (specs/008, data-model §1 e §2)', () => {
  async function enumValues(name: string) {
    const result = await database.db.execute<{ value: string }>(sql`
      select e.enumlabel as value from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = ${name} order by e.enumsortorder
    `);
    return result.rows.map((row) => row.value);
  }

  it('cria os enums novos e acrescenta os valores aos que já existiam', async () => {
    expect(await enumValues('charge_situation_kind')).toEqual([
      'charged_at_terminal',
      'charged_in_hunit',
      // "Não cobrada" (not_charged) virou "Cancelada" na homologação (R-19, migration 0014).
      'cancelled',
      'other',
    ]);
    expect(await enumValues('commercial_report_kind')).toEqual(['charged_in_hunit', 'cancelled']);
    expect(await enumValues('commercial_report_validation')).toEqual([
      'awaiting_validation',
      'confirmed',
      'rejected',
    ]);
    expect(await enumValues('dispatch_purpose')).toEqual(['send', 'hunit_check']);
    expect(await enumValues('hunit_check_result')).toEqual(['confirmed', 'not_found']);
    expect(await enumValues('dispatch_item_outcome')).toContain('checked');
    expect((await enumValues('commercial_event_type')).slice(-6)).toEqual([
      'report_received',
      'report_changed',
      'report_cleared',
      'hunit_checked',
      'cancellation_confirmed',
      'cancellation_rejected',
    ]);
  });

  it('no_charge_marks: no máximo uma marcação ativa por reserva; desfeita libera outra', async () => {
    const client = await insertClient(database.db);
    const reservation = await insertReservation({ reservationNumber: 'SEMCOB-1' });
    const mark = {
      hotelCode: reservation.hotelCode,
      reservationNumber: 'SEMCOB-1',
      markedByClientId: client.id,
      previousAmount: '655.00',
    };
    const [first] = await database.db.insert(noChargeMarks).values(mark).returning();

    expect(await violation(database.db.insert(noChargeMarks).values(mark))).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: 'no_charge_marks_one_active',
    });

    await database.db
      .update(noChargeMarks)
      .set({ undoneAt: new Date(), undoneByClientId: client.id })
      .where(sql`${noChargeMarks.id} = ${first?.id}`);
    await expect(database.db.insert(noChargeMarks).values(mark)).resolves.toBeDefined();
  });

  it('no_charge_marks: observação de 1 a 500 e desfazer com quem e quando juntos', async () => {
    const client = await insertClient(database.db);
    const reservation = await insertReservation({ reservationNumber: 'SEMCOB-2' });
    const mark = {
      hotelCode: reservation.hotelCode,
      reservationNumber: 'SEMCOB-2',
      markedByClientId: client.id,
    };

    expect(
      await violation(database.db.insert(noChargeMarks).values({ ...mark, note: '' })),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'no_charge_marks_note_check' });
    expect(
      await violation(database.db.insert(noChargeMarks).values({ ...mark, note: 'x'.repeat(501) })),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'no_charge_marks_note_check' });
    expect(
      await violation(database.db.insert(noChargeMarks).values({ ...mark, undoneAt: new Date() })),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'no_charge_marks_undone_check' });
    expect(
      await violation(
        database.db.insert(noChargeMarks).values({ ...mark, reservationNumber: 'NAO-EXISTE' }),
      ),
    ).toEqual({ code: PG_FOREIGN_KEY_VIOLATION, constraint: 'no_charge_marks_reservation_fk' });
    await expect(
      database.db.insert(noChargeMarks).values({ ...mark, note: 'x'.repeat(500) }),
    ).resolves.toBeDefined();
  });

  it('commercial_reports: um relato por reserva, textos de 1 a 100', async () => {
    const reservation = await insertReservation({ reservationNumber: 'RELATO-1' });
    const report = {
      hotelCode: reservation.hotelCode,
      reservationNumber: 'RELATO-1',
      kind: 'charged_in_hunit' as const,
      situationText: 'Cobrada no Hunit',
      chargedBy: 'Comercial Fictício 1',
      readAt: new Date(),
    };
    await database.db.insert(commercialReports).values(report);

    expect(await violation(database.db.insert(commercialReports).values(report))).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: 'commercial_reports_hotel_code_reservation_number_pk',
    });
    expect(
      await violation(
        database.db.insert(commercialReports).values({ ...report, reservationNumber: 'RELATO-2' }),
      ),
    ).toEqual({ code: PG_FOREIGN_KEY_VIOLATION, constraint: 'commercial_reports_reservation_fk' });
    await insertReservation({ hotelCode: reservation.hotelCode, reservationNumber: 'RELATO-3' });
    expect(
      await violation(
        database.db
          .insert(commercialReports)
          .values({ ...report, reservationNumber: 'RELATO-3', situationText: 'x'.repeat(101) }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'commercial_reports_texts_check' });
  });

  it('commercial_returns: situação da cobrança até 100 caracteres, data opcional', async () => {
    const reservation = await insertReservation({ reservationNumber: 'RETSIT-1' });
    const value = {
      hotelCode: reservation.hotelCode,
      reservationNumber: 'RETSIT-1',
      authorizationCode: 'AUT1',
      chargeHotel: 'Estabelecimento Fictício',
      chargedAmount: '10.00',
      chargedBy: 'Comercial Fictício 1',
      readAt: new Date(),
      state: 'rejected' as const,
    };
    expect(
      await violation(
        database.db
          .insert(commercialReturns)
          .values({ ...value, chargeSituationText: 'x'.repeat(101), chargeSituationKind: 'other' }),
      ),
    ).toEqual({
      code: PG_CHECK_VIOLATION,
      constraint: 'commercial_returns_charge_situation_check',
    });
    const [row] = await database.db
      .insert(commercialReturns)
      .values({
        ...value,
        chargeSituationText: 'Cobrada na maquininha',
        chargeSituationKind: 'charged_at_terminal',
        chargeDate: '2026-11-19',
      })
      .returning();
    expect(row?.chargeDate).toBe('2026-11-19');
  });

  it('envios: propósito padrão "send"; resultado da verificação só em item "checked"', async () => {
    const dispatch = await insertDispatch(database.db);
    expect(dispatch.purpose).toBe('send');

    const item = {
      dispatchId: dispatch.id,
      hotelCode: 'h',
      reservationNumber: '1',
      position: 1,
      processedAt: new Date(),
    };
    expect(
      await violation(
        database.db
          .insert(commercialDispatchItems)
          .values({ ...item, outcome: 'sent', checkResult: 'confirmed' }),
      ),
    ).toEqual({
      code: PG_CHECK_VIOLATION,
      constraint: 'commercial_dispatch_items_check_result_check',
    });
    expect(
      await violation(
        database.db.insert(commercialDispatchItems).values({ ...item, outcome: 'checked' }),
      ),
    ).toEqual({
      code: PG_CHECK_VIOLATION,
      constraint: 'commercial_dispatch_items_check_result_check',
    });
    await expect(
      database.db
        .insert(commercialDispatchItems)
        .values({ ...item, outcome: 'checked', checkResult: 'not_found' }),
    ).resolves.toBeDefined();
  });
});

describe('validação dos retornos do Comercial (specs/009, data-model §1.1)', () => {
  async function returnValues(reservationNumber: string) {
    const reservation = await insertReservation({ reservationNumber });
    return {
      hotelCode: reservation.hotelCode,
      reservationNumber,
      chargedBy: 'Comercial Fictício 1',
      readAt: new Date(),
      state: 'rejected' as const,
    };
  }

  it('retorno da 005 (sem tipo) e da maquininha exigem código, hotel e valor', async () => {
    const value = await returnValues('RETSIT9-1');
    for (const kind of [null, 'charged_at_terminal'] as const) {
      expect(
        await violation(
          database.db.insert(commercialReturns).values({
            ...value,
            authorizationCode: 'AUT1',
            chargeHotel: null,
            chargedAmount: '10.00',
            chargeSituationKind: kind,
          }),
        ),
      ).toEqual({
        code: PG_CHECK_VIOLATION,
        constraint: 'commercial_returns_terminal_fields_check',
      });
    }
  });

  it('retorno de situação livre ("other") aceita código, hotel e valor nulos', async () => {
    const value = await returnValues('RETSIT9-2');
    const [row] = await database.db
      .insert(commercialReturns)
      .values({
        ...value,
        chargeSituationText: 'Cobrada pela OTA',
        chargeSituationKind: 'other',
      })
      .returning();
    expect(row).toMatchObject({ authorizationCode: null, chargeHotel: null, chargedAmount: null });
  });

  it('textos presentes de 1 a 100 e valor maior que zero continuam valendo', async () => {
    const value = await returnValues('RETSIT9-3');
    const other = { ...value, chargeSituationText: 'Outra', chargeSituationKind: 'other' as const };
    expect(
      await violation(
        database.db.insert(commercialReturns).values({ ...other, authorizationCode: '' }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'commercial_returns_texts_check' });
    expect(
      await violation(
        database.db.insert(commercialReturns).values({ ...other, chargedAmount: '0' }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'commercial_returns_amount_check' });
  });

  it('retornos "other" da 008, com os três campos, continuam válidos', async () => {
    const value = await returnValues('RETSIT9-4');
    await expect(
      database.db.insert(commercialReturns).values({
        ...value,
        authorizationCode: 'AUT1',
        chargeHotel: 'Estabelecimento Fictício',
        chargedAmount: '10.00',
        chargeSituationText: 'Texto livre da 008',
        chargeSituationKind: 'other',
      }),
    ).resolves.toBeDefined();
  });

  it('no_charge_mark_id só em retorno de situação livre encerrado', async () => {
    const client = await insertClient(database.db);
    const value = await returnValues('RETSIT9-5');
    const [mark] = await database.db
      .insert(noChargeMarks)
      .values({
        hotelCode: value.hotelCode,
        reservationNumber: value.reservationNumber,
        markedByClientId: client.id,
        previousAmount: '655.00',
      })
      .returning();
    const other = {
      ...value,
      chargeSituationText: 'Hóspede não compareceu',
      chargeSituationKind: 'other' as const,
      noChargeMarkId: mark?.id ?? null,
    };
    expect(
      await violation(
        database.db.insert(commercialReturns).values({ ...other, state: 'awaiting_validation' }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'commercial_returns_no_charge_check' });
    expect(
      await violation(
        database.db.insert(commercialReturns).values({
          ...other,
          state: 'closed',
          authorizationCode: 'AUT1',
          chargeHotel: 'Estabelecimento Fictício',
          chargedAmount: '10.00',
          chargeSituationKind: 'charged_at_terminal',
        }),
      ),
    ).toEqual({ code: PG_CHECK_VIOLATION, constraint: 'commercial_returns_no_charge_check' });
    await expect(
      database.db.insert(commercialReturns).values({ ...other, state: 'closed' }),
    ).resolves.toBeDefined();
  });
});
