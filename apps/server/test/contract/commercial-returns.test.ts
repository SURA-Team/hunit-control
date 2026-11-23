/**
 * Retorno do Comercial e validação do Financeiro (specs/005, US2; FR-014 a FR-019, FR-016a;
 * research R-08) — tasks.md, T040 e T042. Planilha em memória; dados fictícios.
 */
import type { components } from '@hunit/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  insertCommercialReservation,
  insertLine,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { attach, pdfFile } from '../helpers/treatments.js';

type Reservation = components['schemas']['Reservation'];
type Commercial = components['schemas']['CommercialDetail'];
type Treatment = components['schemas']['ReservationTreatment'];

const HOTEL = 'Hotel Homologação Um';
let test: TestApp;
let operator: TestClient;
let reader: TestClient;

const number = (n: number) => String(900_000 + n);
const key = (n: number) => ({ hotelCode: 'hml_um', reservationNumber: number(n) });
/** Situação e data obrigatórias desde a homologação da 008 (R-19); 46345 = 19/11/2026. */
const complete = (amount: number | string = 1234.56) =>
  [
    'AUT123',
    'Maquininha Fictícia',
    amount,
    'Comercial Fictício 1',
    'Cobrada na maquininha',
    46345,
  ] as const;

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true });
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  await seedTestHotels(test.database.db);
});

afterAll(async () => {
  await test.close();
});

/** Reserva enviada, com a linha já escrita em "A cobrar". */
async function sent(n: number): Promise<void> {
  await insertCommercialReservation(test.database.db, n);
  await insertLine(test.database.db, key(n));
  await round();
}

async function round() {
  const result = await test.sync?.runRound();
  expect(result?.ok).toBe(true);
  return result;
}

const reservation = async (n: number) =>
  (
    await test.app.inject({
      method: 'GET',
      url: `/v1/reservations/hml_um/${number(n)}`,
      headers: reader.headers,
    })
  ).json<Reservation>();

const commercial = async (n: number) =>
  (
    await test.app.inject({
      method: 'GET',
      url: `/v1/reservations/hml_um/${number(n)}/commercial`,
      headers: reader.headers,
    })
  ).json<Commercial>();

const columnJ = (tab: 'toCharge' | 'done', n: number) =>
  test.sheet?.rows(tab).find((row) => row[1] === number(n))?.[9];

function decide(
  returnId: string,
  action: 'confirm' | 'reject' | 'undo-confirmation',
  payload?: object,
  client = operator,
): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'POST',
    url: `/v1/commercial-returns/${returnId}/${action}`,
    headers: client.headers,
    ...(payload ? { payload } : {}),
  });
}

describe('leitura do retorno (T040)', () => {
  it('completo: "Validar comprovante", coluna J e histórico do Comercial', async () => {
    await sent(1);
    test.sheet?.fillReturn(HOTEL, number(1), complete());
    const result = await round();
    expect(result).toMatchObject({ returnsReceived: 1, returnsChanged: 0 });

    expect((await reservation(1)).treatment).toMatchObject({
      situation: 'treatment_sent',
      detailedSituation: 'return_pending',
    });
    expect(columnJ('toCharge', 1)).toBe('Aguardando validação do Financeiro');
    const detail = await commercial(1);
    expect(detail.returns[0]).toMatchObject({
      state: 'awaiting_validation',
      authorizationCode: 'AUT123',
      chargeHotel: 'Maquininha Fictícia',
      chargedAmount: '1234.56',
      chargedBy: 'Comercial Fictício 1',
    });
    expect(detail.events[0]).toMatchObject({
      type: 'return_received',
      actor: { kind: 'commercial_sheet', name: 'Comercial (planilha)' },
    });
  });

  it('incompleto e não entendido: nada muda na reserva; o problema vai para a coluna J', async () => {
    await sent(2);
    test.sheet?.fillReturn(HOTEL, number(2), [
      'AUT1',
      'Maquininha Fictícia',
      '',
      'Fulano',
      'Cobrada na maquininha',
      46345,
    ]);
    expect((await round())?.problems).toBeGreaterThan(0);
    expect(columnJ('toCharge', 2)).toBe('Retorno incompleto: falta o valor cobrado');
    expect((await reservation(2)).treatment.detailedSituation).toBe('treatment_sent');
    expect((await reservation(2)).commercial?.returnProblem).toBe(
      'Retorno incompleto: falta o valor cobrado',
    );

    test.sheet?.fillReturn(HOTEL, number(2), [
      'AUT1',
      'Maquininha Fictícia',
      'abc',
      'Fulano',
      'Cobrada na maquininha',
      46345,
    ]);
    await round();
    expect(columnJ('toCharge', 2)).toBe(
      'Retorno não entendido: valor cobrado não é um valor em reais',
    );
    expect((await commercial(2)).returns).toEqual([]);
  });

  it('o Comercial corrige antes da validação: o retorno novo substitui o anterior', async () => {
    test.sheet?.fillReturn(HOTEL, number(1), complete(1300));
    expect((await round())?.returnsChanged).toBe(1);
    const detail = await commercial(1);
    expect(detail.returns.map((row) => [row.state, row.chargedAmount])).toEqual([
      ['awaiting_validation', '1300.00'],
      ['superseded', '1234.56'],
    ]);
    expect(detail.events[0]?.type).toBe('return_changed');
  });
});

describe('validação do Financeiro (T042)', () => {
  it('confirmar: "Comprovante enviado" com o valor do Comercial; a linha vai para "Concluídas"', async () => {
    const returnId = (await commercial(1)).returns[0]?.id ?? '';
    const response = await decide(returnId, 'confirm');
    expect(response.statusCode).toBe(200);
    expectMatchesContract('confirmCommercialReturn', response);
    expect(response.json<Treatment>()).toMatchObject({
      situation: 'proof_sent',
      commercialChargedAmount: '1300.00',
      effectiveChargedAmount: '1300.00',
      chargedAmountOrigin: 'commercial',
    });

    await round();
    expect(columnJ('done', 1)).toBe('Confirmado pelo Financeiro');
    expect(
      test.sheet
        ?.rows('done')
        .find((row) => row[1] === number(1))
        ?.slice(10),
    ).toEqual([
      'AUT123',
      'Maquininha Fictícia',
      1300,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      46345,
    ]);
    expect((await decide(returnId, 'confirm')).json()).toMatchObject({
      code: 'return_not_awaiting_validation',
    });
  });

  it('desfazer a confirmação: volta a "Validar comprovante" e a "A cobrar"', async () => {
    const returnId = (await commercial(1)).returns[0]?.id ?? '';
    const response = await decide(returnId, 'undo-confirmation');
    expect(response.statusCode).toBe(200);
    expect(response.json<Treatment>().detailedSituation).toBe('return_pending');
    await round();
    expect(columnJ('toCharge', 1)).toBe('Aguardando validação do Financeiro');
  });

  it('recusar exige o motivo; a recusa e o motivo aparecem na linha', async () => {
    const returnId = (await commercial(1)).returns[0]?.id ?? '';
    expect((await decide(returnId, 'reject', { reason: '' })).statusCode).toBe(400);
    expect((await decide(returnId, 'reject', { reason: '   ' })).statusCode).toBe(400);

    const response = await decide(returnId, 'reject', { reason: 'valor diferente' });
    expect(response.statusCode).toBe(200);
    expect(response.json<Treatment>().detailedSituation).toBe('treatment_sent');
    await round();
    expect(columnJ('toCharge', 1)).toBe('Recusado pelo Financeiro: valor diferente');
  });

  it('o Comercial corrige depois da recusa: retorno novo e a recusa sai da linha', async () => {
    // Sem mudança, nada acontece.
    expect((await round())?.returnsChanged).toBe(0);
    test.sheet?.fillReturn(HOTEL, number(1), complete(1250));
    expect((await round())?.returnsChanged).toBe(1);
    await round();
    expect(columnJ('toCharge', 1)).toBe('Aguardando validação do Financeiro');
    expect((await commercial(1)).returns.map((row) => row.state)).toEqual([
      'awaiting_validation',
      'superseded',
      'superseded',
    ]);
  });

  it('comprovante por arquivo com retorno aguardando: o retorno é encerrado', async () => {
    await attach(test, operator, key(1), 'proof', 'comprovante.pdf', pdfFile('ret-1'));
    const detail = await commercial(1);
    expect(detail.returns[0]?.state).toBe('closed');
    expect(detail.events[0]).toMatchObject({
      type: 'return_closed',
      reason: 'comprovante registrado',
    });
  });

  it('confirmar em lote: as sem retorno aguardando ficam de fora, com o motivo', async () => {
    for (const n of [11, 12, 13]) {
      await sent(n);
      test.sheet?.fillReturn(HOTEL, number(n), complete(100 + n));
    }
    await round();
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/commercial-returns/confirm',
      headers: operator.headers,
      payload: { reservations: [key(11), key(12), key(2), key(13), key(999)] },
    });
    expect(response.statusCode).toBe(200);
    expectMatchesContract('confirmCommercialReturns', response);
    const body = response.json<components['schemas']['ConfirmationBatchResult']>();
    expect(body.items.map((item) => [item.reservationNumber, item.outcome, item.reason])).toEqual([
      [number(11), 'confirmed', null],
      [number(12), 'confirmed', null],
      [number(2), 'ignored', 'no_return_awaiting_validation'],
      [number(13), 'confirmed', null],
      [number(999), 'ignored', 'not_found'],
    ]);
    expect(body.countsByClassification).toEqual({ virtual_card_pending_charge: 3 });
    const detail = await commercial(12);
    // A confirmação e, logo depois, a linha concluída.
    expect(detail.events.map((event) => event.type).slice(0, 2)).toEqual([
      'line_concluded',
      'return_confirmed',
    ]);
    expect(detail.events[1]?.batchId).toBe(body.batchId);
  });

  it('o perfil consulta não confirma, não recusa e não desfaz', async () => {
    const returnId = (await commercial(13)).returns[0]?.id ?? '';
    expect((await decide(returnId, 'undo-confirmation', undefined, reader)).statusCode).toBe(403);
    expect((await decide(returnId, 'confirm', undefined, reader)).statusCode).toBe(403);
    expect((await decide(returnId, 'reject', { reason: 'x' }, reader)).statusCode).toBe(403);
    const batch = await test.app.inject({
      method: 'POST',
      url: '/v1/commercial-returns/confirm',
      headers: reader.headers,
      payload: { reservations: [key(13)] },
    });
    expect(batch.statusCode).toBe(403);
  });
});
