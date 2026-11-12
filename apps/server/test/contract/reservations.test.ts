/**
 * Testes de contrato da consulta de reservas e do download de evidências (T040, US2). As
 * reservas são gravadas por execuções reais do executor, com o Hunit simulado.
 */
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evidence, reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import {
  reservationDetails,
  type FakeHotel,
  type FakeReservation,
} from '../helpers/fake-hunit-gateway.js';
import { startInput } from '../helpers/runner.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;
let firstExecutionId: string;
let secondExecutionId: string;

interface ReservationBody {
  hotelCode: string;
  reservationNumber: string;
  guestName: string | null;
  classification: string;
  reservationStatus: string;
  paymentForm: string | null;
  totalAmount: string | null;
  payment: Record<string, unknown>;
  tracking: { notFoundSince: string | null; changedFields: string[] };
  verificationCount: number;
  anonymized: boolean;
}

interface ListBody {
  items: ReservationBody[];
  nextCursor: string | null;
}

function reservation(number: string, overrides: Partial<FakeReservation> = {}): FakeReservation {
  return { reservationNumber: number, listing: { checkIn: '2026-11-03' }, ...overrides };
}

const hotelR1: FakeHotel = {
  code: 'R1',
  name: 'Hotel R1',
  reservations: [
    reservation('P1'),
    reservation('P2', { reservationStatus: 'cancelled' }),
    reservation('C1', {
      reservationStatus: 'cancelled',
      detail: reservationDetails.alreadyCharged(),
    }),
    reservation('258-1'),
    reservation('X1', { detail: reservationDetails.unrecognized() }),
  ],
};
const hotelR2: FakeHotel = {
  code: 'R2',
  name: 'Hotel R2',
  reservations: [
    reservation('C2', {
      listing: { checkIn: '2026-11-06' },
      detail: reservationDetails.alreadyCharged({ chargedAmount: '1234.50' }),
    }),
    // Sem pré-pagamento (research R-22): faturada e cobrar na maquininha.
    reservation('F1', { detail: reservationDetails.invoiced() }),
    reservation('M1', { detail: reservationDetails.chargeAtTerminal() }),
  ],
};

async function runExecution(hotelCodes: string[] | null): Promise<string> {
  const { runner } = test.harness;
  const execution = await runner.start(startInput(operator.id, { hotelCodes }));
  await vi.waitFor(() => expect(runner.submitToken(execution.id, '123456')).toBe(true), {
    timeout: 5_000,
    interval: 10,
  });
  await runner.whenFinished(execution.id);
  return execution.id;
}

beforeAll(async () => {
  test = await createTestApp({ scenario: { hotels: [hotelR1, hotelR2] } });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');

  firstExecutionId = await runExecution(null);
  // Segunda verificação só do R1, sem a X1: ela vira "não encontrada".
  hotelR1.reservations = hotelR1.reservations?.filter((item) => item.reservationNumber !== 'X1');
  secondExecutionId = await runExecution(['R1']);
});

afterAll(async () => {
  await test.close();
});

async function list(query = '', client: TestClient = operator): Promise<LightMyRequestResponse> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/reservations${query}`,
    headers: client.headers,
  });
  expectMatchesContract('listReservations', response);
  return response;
}

async function numbers(query: string): Promise<string[]> {
  const response = await list(query);
  expect(response.statusCode).toBe(200);
  return response
    .json<ListBody>()
    .items.map((item) => `${item.hotelCode}/${item.reservationNumber}`);
}

describe('GET /v1/reservations (FR-020)', () => {
  it('lista todas as reservas, em ordem de hotel e número, no formato do contrato', async () => {
    expect(await numbers('')).toEqual([
      'R1/258-1',
      'R1/C1',
      'R1/P1',
      'R1/P2',
      'R1/X1',
      'R2/C2',
      'R2/F1',
      'R2/M1',
    ]);
  });

  it('nível consulta (reader) também lista', async () => {
    expect((await list('', reader)).statusCode).toBe(200);
  });

  it('sem chave → 401', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/v1/reservations' });
    expect(response.statusCode).toBe(401);
  });

  it('canceladas pendentes de cobrança (classificação + situação combinadas)', async () => {
    expect(
      await numbers('?classification=virtual_card_pending_charge&reservationStatus=cancelled'),
    ).toEqual(['R1/P2']);
  });

  it('canceladas e já cobradas, distintas das ativas e já cobradas (US2, cenário 11)', async () => {
    expect(
      await numbers('?classification=virtual_card_already_charged&reservationStatus=cancelled'),
    ).toEqual(['R1/C1']);
    expect(
      await numbers('?classification=virtual_card_already_charged&reservationStatus=active'),
    ).toEqual(['R2/C2']);
  });

  it('várias classificações e hotéis (parâmetros repetidos)', async () => {
    expect(
      await numbers(
        '?classification=ignored_hotelbeds_258&classification=analysis_error&hotelCode=R1&hotelCode=R2',
      ),
    ).toEqual(['R1/258-1', 'R1/X1']);
  });

  it('faturadas e a cobrar na maquininha (research R-22)', async () => {
    expect(await numbers('?classification=invoiced')).toEqual(['R2/F1']);
    expect(await numbers('?classification=charge_at_terminal')).toEqual(['R2/M1']);
  });

  it('"não encontrada na última verificação" (notFound)', async () => {
    expect(await numbers('?notFound=true')).toEqual(['R1/X1']);
    expect(await numbers('?notFound=false&hotelCode=R1')).toEqual([
      'R1/258-1',
      'R1/C1',
      'R1/P1',
      'R1/P2',
    ]);
  });

  it('por execução: só o que ela observou', async () => {
    expect(await numbers(`?executionId=${firstExecutionId}`)).toHaveLength(8);
    expect(await numbers(`?executionId=${secondExecutionId}`)).toEqual([
      'R1/258-1',
      'R1/C1',
      'R1/P1',
      'R1/P2',
    ]);
  });

  it('por período de check-in', async () => {
    expect(await numbers('?checkInFrom=2026-11-04&checkInTo=2026-11-30')).toEqual(['R2/C2']);
  });

  it('período de check-in invertido → 400', async () => {
    const response = await list('?checkInFrom=2026-11-10&checkInTo=2026-11-01');
    expect(response.statusCode).toBe(400);
  });

  it('pagina por cursor sem repetir nem pular reservas', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body: ListBody = (await list(query)).json<ListBody>();
      seen.push(...body.items.map((item) => `${item.hotelCode}/${item.reservationNumber}`));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(2);
    expect(seen).toEqual(await numbers(''));
  });

  it('cursor inválido → 400', async () => {
    const response = await list('?cursor=nao-e-um-cursor');
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('validation_error');
  });
});

describe('GET /v1/reservations/{hotelCode}/{reservationNumber}', () => {
  async function get(hotelCode: string, number: string) {
    const response = await test.app.inject({
      method: 'GET',
      url: `/v1/reservations/${encodeURIComponent(hotelCode)}/${encodeURIComponent(number)}`,
      headers: reader.headers,
    });
    expectMatchesContract('getReservation', response);
    return response;
  }

  it('devolve a reserva com pagamento, histórico e valores como string decimal', async () => {
    const response = await get('R2', 'C2');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      hotelCode: 'R2',
      reservationNumber: 'C2',
      guestName: 'Hóspede de Teste',
      channel: 'Booking.com',
      checkIn: '2026-11-06',
      totalAmount: '500.00',
      reservationStatus: 'active',
      classification: 'virtual_card_already_charged',
      payment: {
        prePaymentFound: true,
        chargedAt: '2026-11-02T14:30:00.000Z',
        chargedAmount: '1234.50',
        chargeActionVisible: false,
      },
      tracking: { changedFields: [], statusChanged: false, notFoundSince: null },
      verificationCount: 1,
      lastExecutionId: firstExecutionId,
      anonymized: false,
    });
  });

  it('reserva verificada nas duas execuções conta duas verificações', async () => {
    const response = await get('R1', 'P1');
    expect(response.json<ReservationBody>().verificationCount).toBe(2);
  });

  it('reserva anonimizada: sem nome do hóspede (FR-026)', async () => {
    await test.database.db
      .update(reservations)
      .set({ guestName: null, anonymizedAt: new Date() })
      .where(eq(reservations.reservationNumber, 'P2'));

    const response = await get('R1', 'P2');

    expect(response.json()).toMatchObject({ guestName: null, anonymized: true });
  });

  it('reserva inexistente → 404', async () => {
    const response = await get('R1', 'NAO-EXISTE');
    expect(response.statusCode).toBe(404);
  });

  it('devolve a forma de pagamento informada pelo Hunit (FR-016, R-22)', async () => {
    expect((await get('R2', 'M1')).json()).toMatchObject({
      classification: 'charge_at_terminal',
      paymentForm: 'cartão de crédito',
      payment: { prePaymentFound: false },
    });
    expect((await get('R2', 'F1')).json()).toMatchObject({
      classification: 'invoiced',
      paymentForm: 'Faturado',
    });
    expect((await get('R2', 'C2')).json<ReservationBody>().paymentForm).toBeNull();
  });

  it('reserva gravada antes com "não é cartão virtual" (obsoleta) continua no contrato', async () => {
    await test.database.db
      .update(reservations)
      .set({ classification: 'not_virtual_card' })
      .where(eq(reservations.reservationNumber, 'F1'));

    const response = await get('R2', 'F1');

    expect(response.statusCode).toBe(200);
    expect(response.json<ReservationBody>().classification).toBe('not_virtual_card');
  });
});

describe('GET /v1/evidence/{evidenceId}/{file} (FR-024, FR-025)', () => {
  async function evidenceOfX1() {
    const [row] = await test.database.db
      .select()
      .from(evidence)
      .where(eq(evidence.reservationNumber, 'X1'));
    if (!row) throw new Error('a evidência da X1 não foi gravada');
    return row;
  }

  async function download(evidenceId: string, file: string) {
    const response = await test.app.inject({
      method: 'GET',
      url: `/v1/evidence/${evidenceId}/${file}`,
      headers: reader.headers,
    });
    expectMatchesContract('getEvidenceFile', response);
    return response;
  }

  it('baixa a resposta do Hunit gravada como evidência', async () => {
    const row = await evidenceOfX1();

    const response = await download(row.id, 'response');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.json()).toMatchObject({ fake: true });
  });

  it('arquivo que a evidência não tem → 404', async () => {
    const row = await evidenceOfX1();
    expect((await download(row.id, 'screenshot')).statusCode).toBe(404);
  });

  it('evidência inexistente → 404', async () => {
    expect((await download('00000000-0000-4000-8000-000000000000', 'html')).statusCode).toBe(404);
  });

  it('tipo de arquivo fora do contrato → 400', async () => {
    const row = await evidenceOfX1();
    expect((await download(row.id, 'senha')).statusCode).toBe(400);
  });

  it('depois do prazo de retenção → 410 evidence_expired', async () => {
    const row = await evidenceOfX1();
    await test.database.db
      .update(evidence)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(evidence.id, row.id));

    const response = await download(row.id, 'response');

    expect(response.statusCode).toBe(410);
    expect(response.json<{ code: string }>().code).toBe('evidence_expired');
  });
});
