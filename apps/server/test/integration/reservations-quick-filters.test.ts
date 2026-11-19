/**
 * Filtros rápidos, contagens e ordem por hotel e check-in (specs/006, T029; research R-09 e R-18,
 * data-model §1 e §5), contra o PostgreSQL:
 * - paridade: para cada grupo, a contagem é igual ao número de reservas da lista com o mesmo
 *   `quickFilter`, e as duas batem com o que `quickFiltersOf` diz de cada reserva;
 * - `order=hotel_check_in` percorre todas as páginas sem repetir nem pular; cursor de uma ordem com
 *   a outra é recusado; o cursor da 1.7.0 continua valendo para `hotel_number`;
 * - com 20 000 reservas, a seleção corta nas 2 000 primeiras da ordem pedida e a contagem responde
 *   em até 1 s.
 * Todos os dados são fictícios.
 */
import type { components } from '@hunit/contracts';
import {
  CLASSIFICATIONS,
  QUICK_FILTERS,
  isPendingCharge,
  quickFiltersOf,
  type QuickFilter,
} from '@hunit/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commercialLines, commercialReturns, reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertDispatch,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';

type Reservation = components['schemas']['Reservation'];
type Counts = components['schemas']['ReservationQuickFilterCounts'];
type Selection = components['schemas']['ReservationSelection'];

/** Campo das contagens de cada grupo. */
const COUNT_FIELD: Record<QuickFilter, keyof Counts> = {
  pending_charge: 'pendingCharge',
  to_review: 'toReview',
  with_error: 'withError',
  done: 'done',
};

async function get(
  test: TestApp,
  client: TestClient,
  path: string,
): Promise<LightMyRequestResponse> {
  return test.app.inject({ method: 'GET', url: `/v1${path}`, headers: client.headers });
}

/** Todas as páginas da lista com `query`, seguindo o cursor. */
async function listAll(
  test: TestApp,
  client: TestClient,
  query: string,
  limit = 100,
): Promise<Reservation[]> {
  const items: Reservation[] = [];
  let cursor: string | null = null;
  do {
    const after: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await get(test, client, `/reservations?${query}&limit=${limit}${after}`);
    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<{ items: Reservation[]; nextCursor: string | null }>();
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const keyOf = (item: { hotelCode: string; reservationNumber: string }) =>
  `${item.hotelCode}/${item.reservationNumber}`;

/** Grupos da reserva pelo domínio, a partir do que a própria API devolve dela. */
function domainGroups(item: Reservation): QuickFilter[] {
  return quickFiltersOf({
    pendingCharge: isPendingCharge(item.classification, item.treatment.status),
    needsReview: item.treatment.needsReview,
    detailedSituation: item.treatment.detailedSituation,
  });
}

describe('paridade entre contagens, lista e domínio; ordem por hotel e check-in', () => {
  let test: TestApp;
  let reader: TestClient;

  /** Reserva `n` no hotel e com o check-in dados (o check-in decresce com o número). */
  const key = (hotelCode: string, n: number) => ({
    hotelCode,
    reservationNumber: String(900_000 + n),
  });

  beforeAll(async () => {
    test = await createTestApp();
    reader = await test.createClient('reader');
    const { db } = test.database;
    await seedTestHotels(db);

    let n = 0;
    for (const hotelCode of ['hml_um', 'hml_dois']) {
      // Uma reserva sem tratativa de cada classificação.
      for (const classification of CLASSIFICATIONS) {
        n += 1;
        await insertCommercialReservation(db, n, {
          hotelCode,
          classification,
          checkIn: `2026-11-${String(30 - (n % 28)).padStart(2, '0')}`,
        });
      }
      const extra = async (overrides: Parameters<typeof insertCommercialReservation>[2]) => {
        n += 1;
        await insertCommercialReservation(db, n, {
          hotelCode,
          checkIn: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`,
          ...overrides,
        });
        return key(hotelCode, n);
      };
      // Tratativa enviada (linha na planilha), sem retorno.
      await insertLine(db, await extra({}));
      // "Validar comprovante": retorno do Comercial aguardando.
      const awaiting = await extra({});
      await insertLine(db, awaiting);
      await insertReturn(db, awaiting);
      // Comprovante: retorno confirmado.
      const confirmed = await extra({});
      await insertLine(db, confirmed, { state: 'concluded' });
      await insertReturn(db, confirmed, { state: 'confirmed' });
      // Erro na cobrança com tratativa enviada.
      await insertLine(db, await extra({ classification: 'virtual_card_charge_error' }));
      // Alerta "Verificar": enviada e o Hunit passou a "Já cobrada".
      await insertLine(
        db,
        await extra({
          classification: 'virtual_card_already_charged',
          statusChangedAt: new Date('2026-11-17T10:00:00Z'),
        }),
        { state: 'concluded' },
      );
      // "A revisar (sistema anterior)" com comprovante.
      const legacyProof = await extra({ classification: 'not_virtual_card' });
      await insertLine(db, legacyProof, { state: 'concluded' });
      await insertReturn(db, legacyProof, { state: 'confirmed' });
      // Envio desfeito: não conta como tratativa.
      await insertLine(db, await extra({}), { state: 'cancelled' });
    }
  });

  afterAll(async () => {
    await test?.close();
  });

  it.each([
    ['sem filtros', ''],
    ['com filtros', 'hotelCode=hml_dois&checkInFrom=2026-10-10'],
  ])('%s: contagem = lista com o quickFilter = domínio', async (_, filters) => {
    const all = await listAll(test, reader, filters);
    const countsResponse = await get(test, reader, `/reservations/quick-filter-counts?${filters}`);
    expect(countsResponse.statusCode).toBe(200);
    const counts = countsResponse.json<Counts>();
    expect(counts.all).toBe(all.length);

    for (const filter of QUICK_FILTERS) {
      const listed = await listAll(test, reader, `${filters}&quickFilter=${filter}`);
      const expected = all.filter((item) => domainGroups(item).includes(filter)).map(keyOf);
      expect(listed.map(keyOf).sort(), filter).toEqual(expected.sort());
      expect(counts[COUNT_FIELD[filter]], filter).toBe(listed.length);
    }
    // Pelas regras atuais, toda reserva está em algum grupo (data-model §1).
    expect(all.every((item) => domainGroups(item).length > 0)).toBe(true);
  });

  it('cada grupo tem reservas no cenário (o teste não passa à toa)', async () => {
    const counts = (await get(test, reader, '/reservations/quick-filter-counts')).json<Counts>();
    for (const filter of QUICK_FILTERS) expect(counts[COUNT_FIELD[filter]]).toBeGreaterThan(1);
  });

  it('order=hotel_check_in percorre todas as páginas sem repetir nem pular, na ordem certa', async () => {
    const { rows } = await test.database.pool.query<{ key: string }>(
      `select hotel_code || '/' || reservation_number as key from reservations
       order by hotel_code, check_in, reservation_number`,
    );
    const paged = await listAll(test, reader, 'order=hotel_check_in', 7);
    expect(paged.map(keyOf)).toEqual(rows.map((row) => row.key));
    // A ordem nova é diferente da antiga neste cenário.
    const old = await listAll(test, reader, '', 7);
    expect(old.map(keyOf)).not.toEqual(paged.map(keyOf));
    expect(new Set(old.map(keyOf))).toEqual(new Set(paged.map(keyOf)));
  });

  it('cursor de uma ordem usado com a outra: 400', async () => {
    const page = async (query: string) =>
      (await get(test, reader, `/reservations?${query}&limit=3`)).json<{ nextCursor: string }>();
    const byCheckIn = await page('order=hotel_check_in');
    const byNumber = await page('order=hotel_number');

    for (const query of [
      `order=hotel_number&cursor=${byCheckIn.nextCursor}`,
      `cursor=${byCheckIn.nextCursor}`,
      `order=hotel_check_in&cursor=${byNumber.nextCursor}`,
    ]) {
      const response = await get(test, reader, `/reservations?${query}`);
      expect(response.statusCode, query).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('validation_error');
    }
  });

  it('o cursor da 1.7.0 ([hotel, número]) continua valendo para hotel_number', async () => {
    // As reservas do hml_dois são as de número 900018 a 900034 (17 por hotel).
    const old = Buffer.from(JSON.stringify(['hml_dois', '900020']), 'utf8').toString('base64url');
    const response = await get(test, reader, `/reservations?cursor=${old}&limit=2`);
    expect(response.statusCode).toBe(200);
    const items = response.json<{ items: Reservation[] }>().items;
    expect(items.map(keyOf)).toEqual(['hml_dois/900021', 'hml_dois/900022']);

    const withCheckIn = await get(test, reader, `/reservations?order=hotel_check_in&cursor=${old}`);
    expect(withCheckIn.statusCode).toBe(400);
  });
});

describe('20 000 reservas: seleção na ordem pedida e contagem em até 1 s', () => {
  const COUNT = 20_000;
  let test: TestApp;
  let reader: TestClient;

  beforeAll(async () => {
    test = await createTestApp();
    reader = await test.createClient('reader');
    const { db } = test.database;
    await seedTestHotels(db);
    const dispatch = await insertDispatch(db);
    const now = new Date();
    const hotelCodes = ['hml_um', 'hml_dois', 'hml_tres', 'hml_quatro'];
    const rows = Array.from({ length: COUNT }, (_unused, i) => ({
      hotelCode: hotelCodes[i % hotelCodes.length] ?? 'hml_um',
      reservationNumber: String(1_000_000 + i),
      guestName: `Hóspede Fictício ${i}`,
      channel: 'Booking.com',
      // O check-in não acompanha o número: a ordem por check-in é outra.
      checkIn: `2026-${String(1 + ((i * 7) % 12)).padStart(2, '0')}-${String(1 + ((i * 13) % 28)).padStart(2, '0')}`,
      checkOut: '2026-12-31',
      stayPeriod: '01/01/2026 - 31/12/2026',
      totalAmount: `${100 + (i % 900)}.00`,
      reservationStatus: 'active' as const,
      classification: CLASSIFICATIONS[i % CLASSIFICATIONS.length] ?? 'invoiced',
      reason: 'fictícia',
      prePaymentFound: true,
      chargeActionVisible: false,
      firstVerifiedAt: now,
      lastVerifiedAt: now,
      statusChangedAt: i % 7 === 0 ? now : null,
    }));
    for (let start = 0; start < rows.length; start += 1_000) {
      const batch = rows.slice(start, start + 1_000);
      await db.insert(reservations).values(batch);
      // Uma em cada cinco enviada ao Comercial; uma em cada 15 com retorno aguardando e uma em
      // cada 10 com retorno confirmado (comprovante).
      const sent = batch.filter((_row, index) => (start + index) % 5 === 0);
      await db.insert(commercialLines).values(
        sent.map((row) => ({
          hotelCode: row.hotelCode,
          reservationNumber: row.reservationNumber,
          state: 'open' as const,
          firstSentAt: now,
          lastSentAt: now,
          lastDispatchId: dispatch.id,
          lastSentByClientId: dispatch.clientId,
          changedAt: now,
        })),
      );
      const returned = sent.filter((_row, index) => index % 2 === 0);
      await db.insert(commercialReturns).values(
        returned.map((row, index) => ({
          hotelCode: row.hotelCode,
          reservationNumber: row.reservationNumber,
          authorizationCode: 'AUT123',
          chargeHotel: 'Estabelecimento Fictício',
          chargedAmount: row.totalAmount,
          chargedBy: 'Comercial Fictício',
          readAt: now,
          state: index % 3 === 0 ? ('awaiting_validation' as const) : ('confirmed' as const),
        })),
      );
    }
    await test.database.pool.query('analyze');
  }, 120_000);

  afterAll(async () => {
    await test?.close();
  });

  it('a seleção com order corta nas 2 000 primeiras dessa ordem', async () => {
    const response = await get(test, reader, '/reservations/selection?order=hotel_check_in');
    expect(response.statusCode).toBe(200);
    const body = response.json<Selection>();
    expect(body.total).toBe(COUNT);
    expect(body.truncated).toBe(true);
    const { rows } = await test.database.pool.query<{ key: string }>(
      `select hotel_code || '/' || reservation_number as key from reservations
       order by hotel_code, check_in, reservation_number limit 2000`,
    );
    expect(body.items.map(keyOf)).toEqual(rows.map((row) => row.key));
  });

  it('a contagem dos filtros rápidos responde em até 1 s', async () => {
    // A primeira chamada aquece o plano e o cache do banco.
    await get(test, reader, '/reservations/quick-filter-counts');
    const started = performance.now();
    const response = await get(test, reader, '/reservations/quick-filter-counts');
    const elapsed = performance.now() - started;
    expect(response.statusCode).toBe(200);
    const counts = response.json<Counts>();
    expect(counts.all).toBe(COUNT);
    expect(counts.pendingCharge + counts.toReview + counts.withError + counts.done).toBeGreaterThan(
      0,
    );
    expect(elapsed).toBeLessThan(1_000);
  });
});
