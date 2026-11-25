/**
 * Volume do resumo do período (specs/007, T006; research R-04, SC-003): com 35 000 reservas no
 * período, `GET /reports/overview` responde em até 1 s, e os totais batem com a soma das linhas.
 * Todos os dados são fictícios.
 */
import type { components } from '@hunit/contracts';
import { CLASSIFICATIONS } from '@hunit/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commercialLines, commercialReturns, reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { insertDispatch, seedTestHotels } from '../helpers/commercial-fixtures.js';

type Overview = components['schemas']['ReportOverview'];

const COUNT = 35_000;
const PERIOD = 'checkInFrom=2026-01-01&checkInTo=2026-12-31';

describe('resumo do período com 35 000 reservas', () => {
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
      reservationNumber: String(2_000_000 + i),
      guestName: `Hóspede Fictício ${i}`,
      channel: 'Booking.com',
      checkIn: `2026-${String(1 + ((i * 7) % 12)).padStart(2, '0')}-${String(1 + ((i * 13) % 28)).padStart(2, '0')}`,
      checkOut: '2026-12-31',
      stayPeriod: '01/01/2026 - 31/12/2026',
      totalAmount: `${100 + (i % 900)}.00`,
      chargedAmount: i % 3 === 0 ? `${100 + (i % 900)}.00` : null,
      reservationStatus: 'active' as const,
      classification: CLASSIFICATIONS[i % CLASSIFICATIONS.length] ?? 'invoiced',
      reason: 'fictícia',
      prePaymentFound: true,
      chargeActionVisible: false,
      firstVerifiedAt: now,
      lastVerifiedAt: now,
    }));
    for (let start = 0; start < rows.length; start += 1_000) {
      const batch = rows.slice(start, start + 1_000);
      await db.insert(reservations).values(batch);
      // Uma em cada cinco enviada ao Comercial; metade delas com retorno (aguardando ou confirmado).
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
          authorizationCode: `MAQ-${row.reservationNumber}`,
          chargeHotel: 'Estabelecimento Fictício',
          chargedAmount: row.totalAmount,
          chargedBy: 'Comercial Fictício',
          readAt: now,
          state: index % 3 === 0 ? ('awaiting_validation' as const) : ('confirmed' as const),
        })),
      );
    }
    await test.database.pool.query('analyze');
  }, 180_000);

  afterAll(async () => {
    await test?.close();
  });

  const get = () =>
    test.app.inject({
      method: 'GET',
      url: `/v1/reports/overview?${PERIOD}`,
      headers: reader.headers,
    });

  it('responde em até 1 s', async () => {
    // A primeira chamada aquece o plano e o cache do banco.
    await get();
    const started = performance.now();
    const response = await get();
    const elapsed = performance.now() - started;
    expect(response.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('os totais são a soma das linhas de hotel', async () => {
    const body = (await get()).json<Overview>();
    expect(body.hotelRows).toHaveLength(4);
    const sum = (pick: (row: Overview['hotelRows'][number]) => number) =>
      body.hotelRows.reduce((total, row) => total + pick(row), 0);
    const cents = (amount: string) => Math.round(Number(amount) * 100);
    expect(body.reservations).toBe(sum((row) => row.reservations));
    expect(body.open.count).toBe(sum((row) => row.openCount));
    expect(cents(body.open.amount)).toBe(sum((row) => cents(row.openAmount)));
    expect(cents(body.charged.recovered)).toBe(sum((row) => cents(row.recovered)));
    // As três situações de fora (FR-008a) somem do total.
    const excluded = ['ignored_hotelbeds_258', 'not_virtual_card', 'invoiced'];
    const { rows } = await test.database.pool.query<{ total: number }>(
      `select count(*)::int as total from reservations
       where not (classification::text = any($1)) or exists (
         select 1 from commercial_returns cr where cr.hotel_code = reservations.hotel_code
           and cr.reservation_number = reservations.reservation_number and cr.state = 'confirmed')`,
      [excluded],
    );
    expect(body.reservations).toBe(rows[0]?.total);
  });
});
