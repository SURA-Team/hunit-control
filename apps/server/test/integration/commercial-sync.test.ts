/**
 * Sincronizador da planilha do Comercial (specs/005, FR-008 a FR-013, FR-026; research R-06,
 * R-07) — tasks.md, T025. Planilha em memória e relógio controlado; dados fictícios.
 */
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemorySheetGateway } from '../../src/commercial-sheet/memory-sheet-gateway.js';
import { CommercialSheetSync } from '../../src/commercial-sheet/sync.js';
import { findLine, getSheetState, pendingLines } from '../../src/persistence/commercial-repo.js';
import { commercialLines, commercialSheetState } from '../../src/persistence/schema.js';
import {
  GUEST_MARKER,
  insertCommercialReservation,
  insertLine,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { captureLogs } from '../helpers/log-capture.js';

const MINUTE = 60_000;
let database: TestDatabase;
let clock: Date;
let sheet: MemorySheetGateway;
let sync: CommercialSheetSync;
let counter = 0;

const HOTEL = 'Hotel Homologação Um';
const key = (number: number) => ({
  hotelCode: 'hml_um',
  reservationNumber: String(900_000 + number),
});

beforeAll(async () => {
  database = await createTestDatabase();
  await seedTestHotels(database.db);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  // Cada teste com a planilha e as linhas limpas.
  await database.db.delete(commercialLines);
  await database.db.delete(commercialSheetState);
  clock = new Date('2026-11-17T13:15:00Z');
  sheet = new MemorySheetGateway();
  sync = new CommercialSheetSync({
    db: database.db,
    gateway: sheet,
    logger: captureLogs().logger,
    doneRetentionDays: 90,
    now: () => clock,
  });
});

/** Reserva nova (número único entre os testes) com a linha da planilha. */
async function sentReservation(
  options: { state?: 'open' | 'concluded' | 'cancelled'; classification?: string; at?: Date } = {},
) {
  counter += 1;
  await insertCommercialReservation(database.db, counter, {
    guestName: GUEST_MARKER,
    ...(options.classification ? { classification: options.classification as never } : {}),
  });
  await insertLine(database.db, key(counter), {
    state: options.state ?? 'open',
    at: options.at ?? new Date('2026-11-17T13:00:00Z'),
  });
  return { number: counter, reservationNumber: String(900_000 + counter) };
}

describe('linhas novas e projeção (FR-008, FR-010)', () => {
  it('acrescenta a linha aberta em "A cobrar", só com as colunas do sistema, e a sincroniza', async () => {
    const { number, reservationNumber } = await sentReservation();
    const result = await sync.runRound();

    expect(result).toMatchObject({ ok: true, linesWritten: 1 });
    expect(sheet.rows('toCharge')).toEqual([
      [
        HOTEL,
        reservationNumber,
        '03/11/2026',
        'Booking.com',
        'R$ 1.234,56',
        'Pendente de cobrança',
        'Ativa',
        'Tratativa enviada',
        '17/11/2026 10:00',
        'Aguardando retorno do Comercial',
      ],
    ]);
    expect(await findLine(database.db, key(number))).toMatchObject({ syncedVersion: 1 });
    expect((await pendingLines(database.db)).count).toBe(0);
    expect(JSON.stringify(sheet.rows('toCharge'))).not.toContain(GUEST_MARKER);
  });

  it('rodada sem mudanças não escreve nada', async () => {
    await sentReservation();
    await sync.runRound();
    const applies = sheet.applies;
    expect((await sync.runRound()).linesWritten).toBe(0);
    expect(sheet.applies).toBe(applies);
  });
});

describe('o que alguém muda na planilha (FR-011, R-07)', () => {
  it('célula do sistema alterada é restaurada e relatada', async () => {
    const { number, reservationNumber } = await sentReservation();
    await sync.runRound();
    sheet.setCell('toCharge', sheet.rowIndexOf('toCharge', HOTEL, reservationNumber), 4, 'R$ 1,00');

    await sync.runRound();
    expect(sheet.rows('toCharge')[0]?.[4]).toBe('R$ 1.234,56');
    expect((await findLine(database.db, key(number)))?.sheetIssue).toBe(
      'Célula do sistema alterada na planilha e restaurada.',
    );
  });

  it('linha apagada é reconstruída e relatada', async () => {
    const { number, reservationNumber } = await sentReservation();
    await sync.runRound();
    sheet.deleteRow('toCharge', sheet.rowIndexOf('toCharge', HOTEL, reservationNumber));

    await sync.runRound();
    expect(sheet.rowIndexOf('toCharge', HOTEL, reservationNumber)).toBeGreaterThan(0);
    expect((await findLine(database.db, key(number)))?.sheetIssue).toBe(
      'Linha apagada da planilha e reconstruída.',
    );
  });

  it('linha repetida é apagada; linha órfã com retorno fica e é relatada', async () => {
    const { reservationNumber } = await sentReservation();
    await sync.runRound();
    const copy = sheet.rows('toCharge')[0] ?? [];
    sheet.appendRow('toCharge', copy);
    sheet.appendRow('toCharge', [
      'Hotel Que Não Existe',
      '999999',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'AUT9',
    ]);

    await sync.runRound();
    expect(sheet.rows('toCharge').filter((row) => row[1] === reservationNumber)).toHaveLength(1);
    expect(sheet.rows('toCharge').some((row) => row[1] === '999999')).toBe(true);
    const state = await getSheetState(database.db);
    expect(state.roundProblems.map((problem) => problem.kind).sort()).toEqual([
      'duplicate_line',
      'orphan_line',
    ]);
  });

  it('nunca escreve nas colunas de retorno de uma linha que fica em "A cobrar"', async () => {
    const { number, reservationNumber } = await sentReservation();
    await sync.runRound();
    // A linha muda (versão nova) e, entre a leitura e a escrita, o Comercial digita o retorno.
    await database.db
      .update(commercialLines)
      .set({ version: 5, returnProblem: 'Retorno incompleto: falta o valor cobrado' })
      .where(eq(commercialLines.reservationNumber, key(number).reservationNumber));
    sheet.beforeApply = () => {
      sheet.fillReturn(HOTEL, reservationNumber, [
        'AUT1',
        'Maquininha Fictícia',
        10,
        'Comercial Fictício 1',
      ]);
      sheet.beforeApply = null;
    };

    await sync.runRound();
    const row = sheet.rows('toCharge')[0] ?? [];
    expect(row[9]).toBe('Retorno incompleto: falta o valor cobrado');
    expect(row.slice(10)).toEqual(['AUT1', 'Maquininha Fictícia', 10, 'Comercial Fictício 1']);
  });
});

describe('abas e retenção (FR-009, FR-026)', () => {
  it('linha concluída sai de "A cobrar" e vai para "Concluídas" com o retorno lido', async () => {
    const { number, reservationNumber } = await sentReservation();
    await sync.runRound();
    sheet.fillReturn(HOTEL, reservationNumber, [
      'AUT1',
      'Maquininha Fictícia',
      10,
      'Comercial Fictício 1',
    ]);
    await database.db
      .update(commercialLines)
      .set({ state: 'concluded', concludedAt: clock, version: 2 })
      .where(eq(commercialLines.reservationNumber, key(number).reservationNumber));

    await sync.runRound();
    expect(sheet.rows('toCharge')).toEqual([]);
    const moved = sheet.rows('done')[0] ?? [];
    expect(moved.slice(0, 2)).toEqual([HOTEL, reservationNumber]);
    expect(moved.slice(10)).toEqual(['AUT1', 'Maquininha Fictícia', 10, 'Comercial Fictício 1']);
  });

  it('linha cancelada mostra "Pedido cancelado pelo Financeiro" em "Concluídas"', async () => {
    await sentReservation({ state: 'cancelled' });
    await sync.runRound();
    expect(sheet.rows('done')[0]?.[7]).toBe('Pedido cancelado pelo Financeiro');
    // Concluída sem retorno confirmado: a coluna J fica vazia, sem cor (FR-010a).
    expect(sheet.rows('done')[0]?.[9]).toBe('');
  });

  it('concluída há mais de 90 dias sai da planilha e fica no sistema', async () => {
    const old = new Date(clock.getTime() - 91 * 24 * 60 * MINUTE);
    const { number, reservationNumber } = await sentReservation({ state: 'concluded', at: old });
    await sync.runRound();

    expect(sheet.rowIndexOf('done', HOTEL, reservationNumber)).toBe(-1);
    expect(await findLine(database.db, key(number))).toMatchObject({ removedFromSheetAt: clock });
  });
});

describe('planilha indisponível (FR-013, SC-010)', () => {
  it('falha deixa pendente, agenda nova tentativa (1, 2, 4, 5 min) e aplica quando volta', async () => {
    await sentReservation();
    sheet.setFailing('sheet_unavailable');

    const waits: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await sync.runRound();
      expect(result).toMatchObject({ ok: false, errorCode: 'sheet_unavailable' });
      const state = await getSheetState(database.db);
      waits.push(((state.nextAttemptAt?.getTime() ?? 0) - clock.getTime()) / MINUTE);
    }
    expect(waits).toEqual([1, 2, 4, 5, 5]);
    expect((await pendingLines(database.db)).count).toBe(1);

    sheet.setFailing(null);
    expect((await sync.runRound()).ok).toBe(true);
    expect((await pendingLines(database.db)).count).toBe(0);
    expect(await getSheetState(database.db)).toMatchObject({
      lastErrorCode: null,
      consecutiveFailures: 0,
      lastRoundOkAt: clock,
    });
  });

  it('formato alterado: nada é escrito até rodar a preparação', async () => {
    await sentReservation();
    sheet.setCell('toCharge', 0, 7, 'Status');
    const result = await sync.runRound();

    expect(result).toMatchObject({ ok: false, errorCode: 'sheet_layout_invalid' });
    expect(sheet.applies).toBe(0);
  });
});

describe('coluna J "Aguardando retorno do Comercial" (FR-010a, migration 0012)', () => {
  const migration = new URL(
    '../../src/persistence/migrations/0012_commercial_lines_awaiting_return.sql',
    import.meta.url,
  );

  it('linha aberta escrita com a coluna J vazia é reescrita sem relatar célula alterada', async () => {
    const { number, reservationNumber } = await sentReservation();
    const done = await sentReservation({ state: 'concluded' });
    await sync.runRound();
    // Como a versão anterior escrevia a linha aberta sem retorno.
    sheet.setCell('toCharge', sheet.rowIndexOf('toCharge', HOTEL, reservationNumber), 9, '');

    await database.db.execute(sql.raw(readFileSync(migration, 'utf8')));
    expect(await findLine(database.db, key(number))).toMatchObject({
      version: 2,
      syncedVersion: 1,
    });
    expect(await findLine(database.db, key(done.number))).toMatchObject({ version: 1 });

    const result = await sync.runRound();
    expect(result).toMatchObject({ ok: true, linesWritten: 1 });
    expect(sheet.rows('toCharge')[0]?.[9]).toBe('Aguardando retorno do Comercial');
    expect(await findLine(database.db, key(number))).toMatchObject({
      syncedVersion: 2,
      sheetIssue: null,
    });
  });
});
