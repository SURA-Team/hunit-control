/**
 * Aba "Aguardando validação do Financeiro" (specs/009, US2; FR-010 a FR-014; research R-06 e R-07) —
 * tasks.md, T020 a T022. Planilha em memória, relógio simulado; dados fictícios.
 */
import type { components } from '@hunit/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshCommercialLine } from '../../src/persistence/commercial-repo.js';
import { reservations } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import {
  GUEST_MARKER,
  insertCommercialReservation,
  insertLine,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { expectMatchesContract } from '../helpers/contract.js';

type Commercial = components['schemas']['CommercialDetail'];
type Reservation = components['schemas']['Reservation'];

const HOTEL = 'Hotel Homologação Um';
const MINUTE = 60_000;

let test: TestApp;
let operator: TestClient;
let clock = new Date();
const advance = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * MINUTE);
};

const number = (n: number) => String(600_000 + n);
const key = (n: number) => ({ hotelCode: 'hml_um', reservationNumber: number(n) });

beforeAll(async () => {
  test = await createTestApp({ commercialSheet: true, now: () => clock });
  operator = await test.createClient('operator');
  await seedTestHotels(test.database.db);
});

afterAll(async () => {
  await test.close();
});

async function round() {
  const result = await test.sync?.runRound();
  expect(result?.ok, JSON.stringify(result)).toBe(true);
}

async function sent(n: number): Promise<void> {
  await insertCommercialReservation(test.database.db, n - 300_000, {
    guestName: `${GUEST_MARKER} ${n}`,
  });
  await insertLine(test.database.db, key(n));
  await round();
}

function fill(n: number, cells: readonly (string | number)[]): void {
  test.sheet?.fillReturn(HOTEL, number(n), cells);
}

/** Em que aba a linha está (ou `null`). */
function tabOf(n: number): 'toCharge' | 'awaitingValidation' | 'done' | null {
  for (const tab of ['toCharge', 'awaitingValidation', 'done'] as const) {
    if (test.sheet?.rows(tab).some((row) => row[1] === number(n))) return tab;
  }
  return null;
}

/** Quantas vezes a linha aparece na planilha inteira (SC-006: nenhuma perdida ou duplicada). */
function copies(n: number): number {
  return (['toCharge', 'awaitingValidation', 'done'] as const).reduce(
    (total, tab) =>
      total + (test.sheet?.rows(tab).filter((row) => row[1] === number(n)).length ?? 0),
    0,
  );
}

const returnCells = (tab: 'toCharge' | 'awaitingValidation' | 'done', n: number) =>
  test.sheet
    ?.rows(tab)
    .find((row) => row[1] === number(n))
    ?.slice(10, 16);

async function reservation(n: number): Promise<Reservation> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/reservations/hml_um/${number(n)}`,
    headers: operator.headers,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Reservation>();
}

async function commercial(n: number): Promise<Commercial> {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/reservations/hml_um/${number(n)}/commercial`,
    headers: operator.headers,
  });
  expectMatchesContract('getReservationCommercial', response);
  return response.json<Commercial>();
}

async function post(url: string, payload?: unknown) {
  const response = await test.app.inject({
    method: 'POST',
    url,
    headers: operator.headers,
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response;
}

describe('a linha muda de aba depois de 10 minutos sem mudança (FR-010, decisão S7)', () => {
  it('retorno da maquininha aguardando: fica em "A cobrar" antes do prazo e muda depois', async () => {
    await sent(1);
    fill(1, [
      'AUT1',
      'Maquininha Fictícia',
      100,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      '19/11/2026',
    ]);
    await round();
    expect(tabOf(1)).toBe('toCharge');
    expect((await commercial(1)).line?.sheetTab).toBe('to_charge');

    advance(9);
    await round();
    expect(tabOf(1)).toBe('toCharge');

    advance(1);
    await round();
    expect(tabOf(1)).toBe('awaitingValidation');
    expect(copies(1)).toBe(1);
    expect(returnCells('awaitingValidation', 1)).toEqual([
      'AUT1',
      'Maquininha Fictícia',
      100,
      'Comercial Fictício 1',
      'Cobrada na maquininha',
      '19/11/2026',
    ]);
    const line = (await commercial(1)).line;
    expect(line?.sheetTab).toBe('awaiting_validation');
    // Os apps da 1.11.0 continuam vendo "A cobrar".
    expect(line?.tab).toBe('to_charge');
  });

  it('mudança do Comercial antes do prazo reinicia a contagem', async () => {
    await sent(2);
    fill(2, ['', '', '', 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();
    advance(8);
    fill(2, ['', '', 50, 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();
    advance(8);
    await round();
    expect(tabOf(2)).toBe('toCharge');
    advance(2);
    await round();
    expect(tabOf(2)).toBe('awaitingValidation');
  });

  it('linha sem retorno, com problema ou recusada fica em "A cobrar" (FR-013)', async () => {
    await sent(3);
    fill(3, ['', '', '', '', 'Cobrada pela OTA']);
    await round();
    advance(30);
    await round();
    expect(tabOf(3)).toBe('toCharge');
  });
});

describe('saídas da aba nova (FR-011)', () => {
  it('recusa devolve a linha para o fim de "A cobrar", com o motivo', async () => {
    const id = (await reservation(2)).commercial?.situationReturn?.id ?? '';
    await post(`/v1/commercial-returns/${id}/reject`, { reason: 'Falta o comprovante' });
    await round();
    expect(tabOf(2)).toBe('toCharge');
    const rows = test.sheet?.rows('toCharge') ?? [];
    expect(rows.at(-1)?.[1]).toBe(number(2));
    expect(rows.at(-1)?.[9]).toBe('Recusado pelo Financeiro: Falta o comprovante');
    expect(copies(2)).toBe(1);
  });

  it('confirmação leva para "Concluídas"; desfazer a devolve à aba nova', async () => {
    const id = (await commercial(1)).returns[0]?.id ?? '';
    await post(`/v1/commercial-returns/${id}/confirm`);
    await round();
    expect(tabOf(1)).toBe('done');

    await post(`/v1/commercial-returns/${id}/undo-confirmation`);
    await round();
    expect(tabOf(1)).toBe('awaitingValidation');
    expect(copies(1)).toBe(1);
  });

  it('decisão antes do prazo: a linha vai direto de "A cobrar" para "Concluídas"', async () => {
    await sent(4);
    fill(4, ['', '', '', 'Comercial Fictício 1', 'Hóspede não compareceu']);
    await round();
    const id = (await reservation(4)).commercial?.situationReturn?.id ?? '';
    const response = await post(`/v1/commercial-returns/${id}/situation/confirm`, {
      as: 'no_charge',
    });
    await round();
    expect(tabOf(4)).toBe('done');

    // Desfazer a marcação devolve a situação para validar; já passou do prazo, então a aba nova.
    advance(15);
    await post(`/v1/reservations/hml_um/${number(4)}/no-charge/undo`, {
      markId: response.json<Reservation>().noCharge?.id,
    });
    await round();
    expect(tabOf(4)).toBe('awaitingValidation');
  });

  it('"Cobrada no Hunit" aguardando fica na aba nova; "não encontrada" volta para "A cobrar"', async () => {
    await sent(5);
    fill(5, ['', '', '', 'Comercial Fictício 1', 'Cobrada no Hunit']);
    await round();
    advance(10);
    await round();
    expect(tabOf(5)).toBe('awaitingValidation');

    advance(1);
    await test.database.db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({ classification: 'virtual_card_pending_charge', lastVerifiedAt: clock })
        .where(
          and(eq(reservations.hotelCode, 'hml_um'), eq(reservations.reservationNumber, number(5))),
        );
      await refreshCommercialLine(tx, key(5), clock);
    });
    await round();
    expect(tabOf(5)).toBe('toCharge');
    expect(test.sheet?.rows('toCharge').find((row) => row[1] === number(5))?.[9]).toBe(
      'Recusado pelo Financeiro: cobrança não encontrada no Hunit',
    );
  });
});

describe('aba só para consulta e formato (FR-012, FR-014, FR-016)', () => {
  it('K a P alterados na aba nova são restaurados', async () => {
    await sent(6);
    fill(6, ['', '', '', 'Comercial Fictício 1', 'Cobrada pela OTA']);
    await round();
    advance(10);
    await round();
    expect(tabOf(6)).toBe('awaitingValidation');

    const index = test.sheet?.rowIndexOf('awaitingValidation', HOTEL, number(6)) ?? -1;
    test.sheet?.setCell('awaitingValidation', index, 13, 'Outra pessoa');
    await round();
    expect(returnCells('awaitingValidation', 6)?.[3]).toBe('Comercial Fictício 1');
    expect((await commercial(6)).line?.sheetIssue).toBe(
      'Retorno alterado na aba "Aguardando validação do Financeiro" e restaurado.',
    );
    // Uma rodada sem mudança não restaura de novo.
    const before = test.sheet?.applies ?? 0;
    await round();
    expect(test.sheet?.applies).toBe(before);
  });

  it('nenhuma linha da aba nova traz o nome do hóspede', () => {
    const text = JSON.stringify(test.sheet?.rows('awaitingValidation'));
    expect(text).not.toContain(GUEST_MARKER);
  });

  it('sem a aba nova, a planilha fica "Formato alterado" até o setup; depois, as linhas voltam a ela', async () => {
    test.sheet?.removeTab('awaitingValidation');
    const failed = await test.sync?.runRound();
    expect(failed).toMatchObject({ ok: false, errorCode: 'sheet_layout_invalid' });

    const report = await test.sheet?.setupLayout();
    expect(report?.tabsCreated).toEqual(['awaitingValidation']);
    await round();
    expect(tabOf(6)).toBe('awaitingValidation');
    expect(copies(6)).toBe(1);
  });
});
