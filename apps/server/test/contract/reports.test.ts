/**
 * Rota `GET /reports/overview` (specs/007, T006 e T007; contracts/api-changes.md, data-model §1 e
 * §2), contra o PostgreSQL: cada faixa do relatório com os casos que a definem, a paridade do valor
 * em aberto com a lista ("Falta cobrar") e com `reportBucket` do domínio, o recorte do FR-008a, o
 * período vazio, as recusas e o perfil consulta. Todos os dados são fictícios.
 */
import type { components } from '@hunit/contracts';
import {
  effectiveClassification,
  isPendingCharge,
  REPORT_EXCLUDED_SITUATIONS,
  reportBucket,
  type ReportBucket,
} from '@hunit/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noChargeMarks, reservationManualAmounts } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertClient } from '../helpers/factories.js';

type Overview = components['schemas']['ReportOverview'];
type Reservation = components['schemas']['Reservation'];

const PERIOD = 'checkInFrom=2026-11-01&checkInTo=2026-11-30';
/** Depois do `now` das demais (a leitura mais recente). */
const LATEST_VERIFICATION = new Date(Date.now() + 60 * 60 * 1000);

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const key = (hotelCode: string, n: number) => ({
  hotelCode,
  reservationNumber: String(900_000 + n),
});

/** Faixa esperada de cada reserva do cenário (pela construção). */
const expected = new Map<string, ReportBucket>();

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  const { db } = test.database;
  await seedTestHotels(db);
  const client = await insertClient(db);

  const add = async (
    n: number,
    bucket: ReportBucket,
    overrides: Parameters<typeof insertCommercialReservation>[2] = {},
  ) => {
    const hotelCode = overrides.hotelCode ?? 'hml_um';
    await insertCommercialReservation(db, n, { checkIn: '2026-11-10', ...overrides, hotelCode });
    expected.set(`${hotelCode}/${900_000 + n}`, bucket);
    return key(hotelCode, n);
  };

  // hml_um
  await add(1, 'pending', { totalAmount: '100.00', checkIn: '2026-11-01' });
  await insertLine(db, await add(2, 'requested', { totalAmount: '200.00' }));
  const awaiting = await add(3, 'requested', { totalAmount: '300.00', checkIn: '2026-11-30' });
  await insertLine(db, awaiting);
  await insertReturn(db, awaiting);
  await add(4, 'pending', { totalAmount: '400.00', classification: 'virtual_card_charge_error' });
  await add(5, 'previous_charged', {
    totalAmount: '510.00',
    chargedAmount: '500.00',
    classification: 'virtual_card_already_charged',
  });
  // O Hunit passou a mostrar a cobrança depois da tratativa; sem valor cobrado, vale o total.
  await insertLine(
    db,
    await add(6, 'recovered', {
      totalAmount: '600.00',
      chargedAmount: null,
      classification: 'virtual_card_already_charged',
    }),
    { state: 'concluded' },
  );
  const confirmed = await add(7, 'recovered', { totalAmount: '700.00' });
  await insertLine(db, confirmed, { state: 'concluded' });
  await insertReturn(db, confirmed, { state: 'confirmed', chargedAmount: '650.00' });
  // O valor informado à mão (com comprovante) prevalece sobre o do Comercial.
  const manual = await add(8, 'recovered', { totalAmount: '800.00' });
  await insertLine(db, manual, { state: 'concluded' });
  await insertReturn(db, manual, { state: 'confirmed', chargedAmount: '790.00' });
  await db
    .insert(reservationManualAmounts)
    .values({ ...manual, amount: '680.00', setByClientId: client.id });
  await add(9, 'none', { classification: 'cancelled_no_charge', totalAmount: '900.00' });
  const marked = await add(10, 'none', { totalAmount: '1000.00' });
  await db.insert(noChargeMarks).values({ ...marked, markedByClientId: client.id });
  await add(11, 'excluded', { classification: 'invoiced' });
  await add(12, 'excluded', { classification: 'ignored_hotelbeds_258' });
  await add(13, 'excluded', { classification: 'not_virtual_card' });
  await add(14, 'pending', { totalAmount: null, lastVerifiedAt: LATEST_VERIFICATION });
  // Fora do período.
  await insertCommercialReservation(db, 15, { checkIn: '2026-12-05', totalAmount: '1500.00' });
  await insertCommercialReservation(db, 16, { checkIn: '2026-10-31', totalAmount: '1600.00' });
  // Envio desfeito: não conta como tratativa.
  await insertLine(db, await add(17, 'pending', { totalAmount: '160.00' }), { state: 'cancelled' });

  // hml_dois
  await add(18, 'pending', { hotelCode: 'hml_dois', totalAmount: '1000.00' });
  const legacyProof = await add(19, 'recovered', {
    hotelCode: 'hml_dois',
    classification: 'not_virtual_card',
    totalAmount: '55.00',
  });
  await insertLine(db, legacyProof, { state: 'concluded' });
  await insertReturn(db, legacyProof, { state: 'confirmed', chargedAmount: '50.00' });
});

afterAll(async () => {
  await test?.close();
});

function get(path: string, client: TestClient | null = reader): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'GET',
    url: `/v1${path}`,
    ...(client ? { headers: client.headers } : {}),
  });
}

async function overview(query = PERIOD, client: TestClient = reader): Promise<Overview> {
  const response = await get(`/reports/overview?${query}`, client);
  expect(response.statusCode, response.body).toBe(200);
  expectMatchesContract('getReportOverview', response);
  return response.json<Overview>();
}

async function listAll(query: string): Promise<Reservation[]> {
  const items: Reservation[] = [];
  let cursor: string | null = null;
  do {
    const after: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await get(`/reservations?${query}&limit=100${after}`);
    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<{ items: Reservation[]; nextCursor: string | null }>();
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const cents = (amount: string | null) => (amount === null ? 0 : Math.round(Number(amount) * 100));

describe('GET /reports/overview (specs/007)', () => {
  it('totais do período: faixas, recorte do FR-008a e "X de Y"', async () => {
    const body = await overview();
    expect(body.period).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(body.reservations).toBe(14);
    expect(body.treatmentsSent).toBe(6);
    expect(body.withoutAmount).toBe(1);
    expect(body.hotels).toEqual({ withData: 2, total: 4 });
    expect(body.open).toEqual({
      amount: '2160.00',
      count: 7,
      requested: '500.00',
      pending: '1660.00',
    });
    expect(body.charged).toEqual({ amount: '2480.00', previous: '500.00', recovered: '1980.00' });
    expect(body.lastVerifiedAt).toBe(LATEST_VERIFICATION.toISOString());
    expect(Date.parse(body.generatedAt)).not.toBeNaN();
  });

  it('uma linha por hotel, sem dado de hóspede', async () => {
    const body = await overview();
    expect(body.hotelRows).toEqual([
      {
        hotelCode: 'hml_dois',
        hotelName: 'Hotel Homologação Dois',
        reservations: 2,
        treatmentsSent: 1,
        openCount: 1,
        openAmount: '1000.00',
        requested: '0.00',
        pending: '1000.00',
        previousCharged: '0.00',
        recovered: '50.00',
      },
      {
        hotelCode: 'hml_um',
        hotelName: 'Hotel Homologação Um',
        reservations: 12,
        treatmentsSent: 5,
        openCount: 6,
        openAmount: '1160.00',
        requested: '500.00',
        pending: '660.00',
        previousCharged: '500.00',
        recovered: '1930.00',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('Hóspede');
  });

  it('paridade: o valor em aberto de cada hotel é o "Falta cobrar" da lista no mesmo período', async () => {
    const body = await overview();
    for (const row of body.hotelRows) {
      const listed = await listAll(
        `hotelCode=${row.hotelCode}&${PERIOD}&quickFilter=pending_charge`,
      );
      expect(listed, row.hotelCode).toHaveLength(row.openCount);
      const sum = listed.reduce((total, item) => total + cents(item.amountToCharge), 0);
      expect(sum, row.hotelCode).toBe(cents(row.openAmount));
    }
  });

  it('paridade com o domínio: a faixa de cada reserva da lista é a do cenário', async () => {
    const all = await listAll(PERIOD);
    expect(all).toHaveLength(expected.size);
    for (const item of all) {
      const classification = effectiveClassification(item.classification, item.noCharge !== null);
      const hasRequest =
        item.treatment.request !== null ||
        (item.commercial != null && item.commercial.lineState !== 'cancelled');
      const bucket = reportBucket({
        detailedSituation: item.treatment.detailedSituation,
        pendingCharge: isPendingCharge(classification, item.treatment.status),
        hasRequest,
      });
      expect(bucket, `${item.hotelCode}/${item.reservationNumber}`).toBe(
        expected.get(`${item.hotelCode}/${item.reservationNumber}`),
      );
    }
  });

  it('período sem reservas: zeros, sem hotéis e sem última verificação', async () => {
    const body = await overview('checkInFrom=2027-01-01&checkInTo=2027-01-31');
    expect(body).toMatchObject({
      reservations: 0,
      treatmentsSent: 0,
      withoutAmount: 0,
      hotels: { withData: 0, total: 4 },
      open: { amount: '0.00', count: 0, requested: '0.00', pending: '0.00' },
      charged: { amount: '0.00', previous: '0.00', recovered: '0.00' },
      hotelRows: [],
      lastVerifiedAt: null,
    });
  });

  it('o perfil operador recebe o mesmo resumo', async () => {
    const byReader = await overview();
    const byOperator = await overview(PERIOD, operator);
    expect({ ...byOperator, generatedAt: '' }).toEqual({ ...byReader, generatedAt: '' });
  });

  it.each([
    ['sem o fim', 'checkInFrom=2026-11-01'],
    ['sem o início', 'checkInTo=2026-11-30'],
    ['data inexistente', 'checkInFrom=2026-02-30&checkInTo=2026-03-10'],
    ['início depois do fim', 'checkInFrom=2026-11-30&checkInTo=2026-11-01'],
  ])('%s: 400', async (_, query) => {
    const response = await get(`/reports/overview?${query}`);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('validation_error');
    expectMatchesContract('getReportOverview', response);
  });

  it('sem chave: 401', async () => {
    const response = await get(`/reports/overview?${PERIOD}`, null);
    expect(response.statusCode).toBe(401);
    expectMatchesContract('getReportOverview', response);
  });
});

describe('GET /reports/overview com os filtros da lista (specs/007, FR-005a, R-14)', () => {
  it('filtro de hotel: só as linhas e o "X de Y" dos hotéis escolhidos', async () => {
    const body = await overview(`${PERIOD}&hotelCode=hml_dois`);
    expect(body.hotelRows.map((row) => row.hotelCode)).toEqual(['hml_dois']);
    expect(body.hotels).toEqual({ withData: 1, total: 1 });
    expect(body.open).toEqual({
      amount: '1000.00',
      count: 1,
      requested: '0.00',
      pending: '1000.00',
    });
    const both = await overview(`${PERIOD}&hotelCode=hml_um&hotelCode=hml_dois`);
    expect(both.hotels).toEqual({ withData: 2, total: 2 });
  });

  it.each([
    'hotelCode=hml_um',
    'reservationStatus=active',
    'reservationStatus=cancelled&reservationStatus=unknown',
    'fromLegacy=false',
    'fromLegacy=true',
    'notFound=true',
    'detailedSituation=treatment_sent&detailedSituation=return_pending',
    'detailedSituation=invoiced',
    'channel=Canal%20inexistente',
  ])('paridade com a lista: %s', async (filters) => {
    const body = await overview(`${PERIOD}&${filters}`);
    const listed = await listAll(`${PERIOD}&${filters}`);
    const counted = listed.filter(
      (item) => !REPORT_EXCLUDED_SITUATIONS.includes(item.treatment.detailedSituation),
    );
    expect(body.reservations).toBe(counted.length);
    const open = await listAll(`${PERIOD}&${filters}&quickFilter=pending_charge`);
    expect(body.open.count).toBe(open.length);
    const sum = open.reduce((total, item) => total + cents(item.amountToCharge), 0);
    expect(cents(body.open.amount)).toBe(sum);
  });

  it('todos os hotéis escolhidos: o mesmo resumo de sem filtro', async () => {
    const plain = await overview();
    const empty = await overview(
      `${PERIOD}&hotelCode=hml_um&hotelCode=hml_dois&hotelCode=hml_tres&hotelCode=hml_quatro`,
    );
    expect(empty.reservations).toBe(plain.reservations);
    expect(empty.open).toEqual(plain.open);
  });

  it('filtro inválido: 400', async () => {
    const response = await get(`/reports/overview?${PERIOD}&reservationStatus=talvez`);
    expect(response.statusCode).toBe(400);
    expectMatchesContract('getReportOverview', response);
  });
});
