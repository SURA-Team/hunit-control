/**
 * Marcadores do envio ao Comercial (specs/005, SC-007, SC-009) — tasks.md, T058.
 *
 * Com `GUEST_MARKER` como nome do hóspede e `SHEET_SECRET_MARKER` no lugar do ID e da chave da
 * planilha: roda um envio com token, a rodada da planilha, retornos (completo e incompleto), falhas
 * da planilha (inclusive um erro cru com o ID na mensagem) e o comando administrativo; confere que
 * nenhum marcador aparece na planilha em memória, nos logs, nas respostas da API, nos eventos SSE,
 * nas mensagens de erro nem na saída do comando. Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../src/cli.js';
import { MemorySheetGateway } from '../../src/commercial-sheet/memory-sheet-gateway.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  GUEST_MARKER,
  insertCommercialReservation,
  SHEET_SECRET_MARKER,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { reservationDetails } from '../helpers/fake-hunit-gateway.js';
import { TEST_PASSWORD } from '../helpers/runner.js';

const HOTEL = 'Hotel Homologação Um';
const CHECK_IN = '2026-11-03';
const SHEET_ID = `planilha_${SHEET_SECRET_MARKER}_0123456789`;
const RAW_GOOGLE_ERROR = `Requested entity was not found: https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

const number = (n: number) => String(900_000 + n);
const key = (n: number) => ({ hotelCode: 'hml_um', reservationNumber: number(n) });

let test: TestApp;
let operator: TestClient;
let reader: TestClient;
/** Tudo o que saiu do servidor para os clientes e para a saída do comando. */
const outputs: string[] = [];

function record(response: LightMyRequestResponse): LightMyRequestResponse {
  outputs.push(response.body);
  return response;
}

const call = async (method: 'GET' | 'POST', url: string, client = operator, payload?: unknown) =>
  record(
    await test.app.inject({
      method,
      url,
      headers: client.headers,
      ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
    }),
  );

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true, twoFactorTimeoutMs: 5_000 });
  // O servidor registra o ID e a chave da planilha ao carregá-la (key.ts); aqui, o marcador.
  test.secrets.register(SHEET_ID, SHEET_SECRET_MARKER);
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
  await seedTestHotels(test.database.db);
  for (const n of [1, 2, 3]) {
    await insertCommercialReservation(test.database.db, n, {
      guestName: `${GUEST_MARKER} ${n}`,
      checkIn: CHECK_IN,
    });
  }
  test.harness.hunit.scenario = {
    hotels: [
      {
        code: 'hml_um',
        reservations: [
          {
            reservationNumber: number(1),
            listing: { checkIn: CHECK_IN, guestName: `${GUEST_MARKER} 1` },
          },
          {
            reservationNumber: number(2),
            listing: { checkIn: CHECK_IN, guestName: `${GUEST_MARKER} 2` },
          },
          {
            reservationNumber: number(3),
            listing: { checkIn: CHECK_IN, guestName: `${GUEST_MARKER} 3` },
            detail: reservationDetails.alreadyCharged(),
          },
        ],
      },
    ],
  };
});

afterAll(async () => {
  await test.close();
});

describe('nenhum marcador sai do servidor (SC-007, SC-009)', () => {
  it('envio, rodada, retornos, falhas da planilha e comando administrativo', async () => {
    // Envio com token.
    await call('POST', '/v1/commercial-dispatches/check', operator, {
      reservations: [key(1), key(2), key(3)],
    });
    const created = await call('POST', '/v1/commercial-dispatches', operator, {
      credentials: {
        username: `operador-${randomUUID().slice(0, 8)}@hotel.test`,
        password: TEST_PASSWORD,
      },
      reservations: [key(1), key(2), key(3)],
    });
    expect(created.statusCode).toBe(202);
    const { id } = created.json<{ id: string }>();
    const status = async () =>
      (await call('GET', `/v1/commercial-dispatches/${id}`, reader)).json<{ status: string }>()
        .status;
    await vi.waitFor(async () => expect(await status()).toBe('awaiting_2fa'), {
      timeout: 10_000,
      interval: 20,
    });
    await call('POST', `/v1/commercial-dispatches/${id}/two-factor`, operator, { token: '123456' });
    await vi.waitFor(async () => expect(await status()).toBe('completed'), {
      timeout: 10_000,
      interval: 20,
    });
    // O fluxo de eventos de um envio encerrado entrega o histórico e fecha.
    const events = await call('GET', `/v1/commercial-dispatches/${id}/events`, reader);
    expect(events.body).toContain('event: status_changed');
    await call('GET', '/v1/commercial-dispatches?limit=10', reader);

    // Rodada: as linhas vão para a planilha sem o hóspede.
    expect((await test.sync?.runRound())?.ok).toBe(true);
    const sheet = test.sheet as MemorySheetGateway;
    expect(sheet.rows('toCharge')).toHaveLength(2);

    // Retornos: um completo e um incompleto; leitura pela API.
    sheet.fillReturn(HOTEL, number(1), ['AUT1', 'Maquininha Fictícia', 10, 'Comercial Fictício']);
    sheet.fillReturn(HOTEL, number(2), ['AUT2', '', '', '']);
    expect((await call('POST', '/v1/commercial-sheet/read')).statusCode).toBe(200);
    await call('GET', '/v1/commercial-sheet', reader);
    await call('GET', `/v1/reservations/hml_um/${number(1)}/commercial`, reader);
    await call('GET', '/v1/reservations/selection?hotelCode=hml_um', reader);

    // Falha crua da biblioteca do Google, com o ID da planilha na mensagem.
    sheet.failNextWith(new Error(RAW_GOOGLE_ERROR));
    const failed = await call('POST', '/v1/commercial-sheet/read');
    expect(failed.statusCode).toBe(503);
    const failing = await call('GET', '/v1/commercial-sheet', reader);
    expect(failing.json()).toMatchObject({
      status: 'failing',
      lastError: { code: 'sheet_unavailable' },
    });
    sheet.failNext('sheet_forbidden');
    await call('POST', '/v1/commercial-sheet/read');
    await call('GET', '/v1/commercial-sheet', reader);

    // Comando administrativo com o mesmo erro cru.
    let cli = '';
    const failingGateway = new MemorySheetGateway();
    failingGateway.failNextWith(new Error(RAW_GOOGLE_ERROR));
    const code = await runCli(
      ['commercial-sheet', 'check'],
      {
        stdout: (text) => (cli += text),
        stderr: (text) => (cli += text),
        env: {
          COMMERCIAL_SHEET_ID: SHEET_ID,
          COMMERCIAL_SHEET_KEY_FILE: '/run/secrets/commercial-sheet/commercial-sheet-key.json',
        },
      },
      { commercialSheet: { createGateway: () => Promise.resolve(failingGateway) } },
    );
    expect(code).not.toBe(0);
    expect(cli).toContain('Falha inesperada ao acessar a planilha do Comercial');
    outputs.push(cli);

    // Conferência: planilha, logs, respostas (inclusive SSE e erros) e a saída do comando.
    const sheetText = JSON.stringify([sheet.rows('toCharge'), sheet.rows('done')]);
    expect(sheetText).not.toContain(GUEST_MARKER);
    expect(sheetText).not.toContain(SHEET_SECRET_MARKER);
    const logs = test.logs.text();
    expect(logs).not.toContain(SHEET_SECRET_MARKER);
    expect(logs).not.toContain(GUEST_MARKER);
    expect(logs).not.toContain(TEST_PASSWORD);
    for (const output of outputs) {
      expect(output).not.toContain(SHEET_SECRET_MARKER);
      expect(output).not.toContain(TEST_PASSWORD);
    }
    // O nome do hóspede só sai onde o contrato prevê (lista da seleção); nunca nos envios,
    // nos eventos, no estado da planilha nem na saída do comando.
    const withoutSelection = outputs.filter((output) => !output.includes('"truncated"'));
    for (const output of withoutSelection) expect(output).not.toContain(GUEST_MARKER);
  });
});
