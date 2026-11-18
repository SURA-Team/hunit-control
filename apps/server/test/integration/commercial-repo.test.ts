/**
 * Repositório da planilha do Comercial (specs/005, data-model §1.4 a §1.7 e §4) — tasks.md, T016.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelLine,
  findLine,
  getCommercialDetail,
  getSheetState,
  loadCommercialSummary,
  markLinesSynced,
  openLineOnSend,
  pendingLines,
  refreshCommercialLine,
  restoreLine,
  updateSheetState,
} from '../../src/persistence/commercial-repo.js';
import { findDatabaseError } from '../../src/persistence/errors.js';
import { commercialReturns, reservations } from '../../src/persistence/schema.js';
import {
  insertCommercialReservation,
  insertDispatch,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient } from '../helpers/factories.js';

let database: TestDatabase;
let clientId: string;
const now = new Date('2026-11-17T12:00:00Z');

beforeAll(async () => {
  database = await createTestDatabase();
  await seedTestHotels(database.db);
  clientId = (await insertClient(database.db)).id;
});

afterAll(async () => {
  await database.close();
});

const key = (number: number) => ({
  hotelCode: 'hml_um',
  reservationNumber: String(900_000 + number),
});

async function reclassify(number: number, classification: string) {
  await database.db
    .update(reservations)
    .set({ classification: classification as never, statusChangedAt: now })
    .where(
      and(
        eq(reservations.hotelCode, 'hml_um'),
        eq(reservations.reservationNumber, String(900_000 + number)),
      ),
    );
}

describe('openLineOnSend (FR-008)', () => {
  it('cria a linha aberta e, no reenvio, reabre e atualiza sem duplicar', async () => {
    await insertCommercialReservation(database.db, 1);
    const first = await insertDispatch(database.db, { clientId });
    await database.db.transaction((tx) =>
      openLineOnSend(tx, { key: key(1), dispatchId: first.id, clientId, now }),
    );
    expect(await findLine(database.db, key(1))).toMatchObject({ state: 'open', version: 1 });

    const second = await insertDispatch(database.db, { clientId });
    const later = new Date(now.getTime() + 60_000);
    await database.db.transaction((tx) =>
      openLineOnSend(tx, { key: key(1), dispatchId: second.id, clientId, now: later }),
    );
    expect(await findLine(database.db, key(1))).toMatchObject({
      state: 'open',
      lastDispatchId: second.id,
      firstSentAt: now,
      lastSentAt: later,
      version: 2,
    });
  });
});

describe('refreshCommercialLine (FR-009)', () => {
  it('Hunit "já cobrada": linha concluída, retorno aguardando encerrado ("A verificar")', async () => {
    await insertCommercialReservation(database.db, 2);
    await insertLine(database.db, key(2));
    const awaiting = await insertReturn(database.db, key(2));

    await reclassify(2, 'virtual_card_already_charged');
    await database.db.transaction((tx) => refreshCommercialLine(tx, key(2), now));

    expect(await findLine(database.db, key(2))).toMatchObject({
      state: 'concluded',
      concludedAt: now,
    });
    const [row] = await database.db
      .select()
      .from(commercialReturns)
      .where(eq(commercialReturns.id, awaiting.id));
    expect(row?.state).toBe('closed');
    const detail = await getCommercialDetail(database.db, key(2));
    expect(detail.events.map((event) => event.type)).toEqual(['return_closed', 'line_concluded']);
    expect(detail.events[0]?.reason).toBe('o Hunit não exige mais cobrança');
  });

  it('o Hunit volta a exigir cobrança: a linha volta para "A cobrar"', async () => {
    await reclassify(2, 'virtual_card_charge_error');
    await database.db.transaction((tx) => refreshCommercialLine(tx, key(2), now));
    expect(await findLine(database.db, key(2))).toMatchObject({ state: 'open', concludedAt: null });
  });

  it('retorno confirmado conclui a linha; sempre fica pendente para a planilha', async () => {
    await insertCommercialReservation(database.db, 3);
    const line = await insertLine(database.db, key(3));
    await insertReturn(database.db, key(3), { state: 'confirmed' });
    await database.db.transaction((tx) => refreshCommercialLine(tx, key(3), now));

    const refreshed = await findLine(database.db, key(3));
    expect(refreshed).toMatchObject({ state: 'concluded' });
    expect(refreshed?.version).toBe(line.version + 1);
  });
});

describe('desfazer e reverter o envio (R-11)', () => {
  it('recusa com retorno aguardando validação; sem ele, a linha fica cancelada', async () => {
    await insertCommercialReservation(database.db, 4);
    await insertLine(database.db, key(4));
    const awaiting = await insertReturn(database.db, key(4));

    expect(await cancelLine(database.db, { key: key(4), clientId, now })).toEqual({
      ok: false,
      reason: 'return_awaiting_validation',
    });

    await database.db
      .update(commercialReturns)
      .set({ state: 'rejected', rejectionReason: 'valor diferente' })
      .where(eq(commercialReturns.id, awaiting.id));
    expect(await cancelLine(database.db, { key: key(4), clientId, now })).toEqual({ ok: true });
    expect(await findLine(database.db, key(4))).toMatchObject({
      state: 'cancelled',
      cancelledAt: now,
      cancelledByClientId: clientId,
    });
    expect(await cancelLine(database.db, { key: key(4), clientId, now })).toEqual({
      ok: false,
      reason: 'not_open',
    });
  });

  it('reverter volta a linha para "A cobrar", com o evento', async () => {
    await database.db.transaction((tx) => restoreLine(tx, { key: key(4), clientId, now }));
    expect(await findLine(database.db, key(4))).toMatchObject({ state: 'open', cancelledAt: null });
    const detail = await getCommercialDetail(database.db, key(4));
    expect(detail.events.map((event) => event.type)).toEqual(['line_restored', 'line_cancelled']);
  });
});

describe('restrições do banco', () => {
  it('no máximo um retorno aguardando validação ou confirmado por reserva', async () => {
    await insertCommercialReservation(database.db, 5);
    await insertReturn(database.db, key(5));
    const error = await insertReturn(database.db, key(5), { state: 'confirmed' }).catch(
      (caught: unknown) => caught,
    );
    expect(findDatabaseError(error)?.constraint).toBe('commercial_returns_one_current');
    // Recusados e substituídos podem ser vários.
    await insertReturn(database.db, key(5), {
      state: 'rejected',
      rejectionReason: 'código errado',
    });
    await insertReturn(database.db, key(5), { state: 'superseded' });
  });

  it('textos do retorno com mais de 100 caracteres são recusados', async () => {
    await insertCommercialReservation(database.db, 6);
    const error = await database.db
      .insert(commercialReturns)
      .values({
        ...key(6),
        authorizationCode: 'x'.repeat(101),
        chargeHotel: 'Estabelecimento Fictício',
        chargedAmount: '10.00',
        chargedBy: 'Comercial Fictício 1',
        readAt: now,
      })
      .catch((caught: unknown) => caught);
    expect(findDatabaseError(error)?.constraint).toBe('commercial_returns_texts_check');
  });
});

describe('pendências e estado da planilha (FR-013)', () => {
  it('synced_version só avança até a versão que a rodada viu', async () => {
    await insertCommercialReservation(database.db, 7);
    const line = await insertLine(database.db, key(7));
    expect((await loadCommercialSummary(database.db, key(7)))?.syncPending).toBe(true);

    // A rodada viu a versão 1; enquanto escrevia, a linha mudou (versão 2).
    await database.db.transaction((tx) => refreshCommercialLine(tx, key(7), now));
    await markLinesSynced(database.db, [{ key: key(7), version: line.version }], now);
    expect((await loadCommercialSummary(database.db, key(7)))?.syncPending).toBe(true);

    await markLinesSynced(database.db, [{ key: key(7), version: line.version + 1 }], now);
    expect((await loadCommercialSummary(database.db, key(7)))?.syncPending).toBe(false);
    expect((await pendingLines(database.db)).count).toBeGreaterThan(0);
  });

  it('estado da integração: uma linha só, criada na primeira leitura', async () => {
    expect(await getSheetState(database.db)).toMatchObject({ id: 1, consecutiveFailures: 0 });
    await updateSheetState(database.db, {
      lastErrorCode: 'sheet_unavailable',
      consecutiveFailures: 2,
    });
    expect(await getSheetState(database.db)).toMatchObject({
      lastErrorCode: 'sheet_unavailable',
      consecutiveFailures: 2,
    });
  });
});
