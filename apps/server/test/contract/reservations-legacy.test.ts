/**
 * Reservas importadas do sistema anterior na API 1.6.0 (specs/004; FR-007a, FR-011; SC-009) —
 * tasks.md, T023 (US2) e T030 (US4). As reservas importadas passam pelo comando real.
 */
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setHotelMapping } from '../../src/persistence/legacy-import-repo.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import {
  legacyAttachmentPath,
  legacyFile,
  legacyReservationRow,
  legacyTreatmentRow,
  writeLegacyAttachments,
  writeLegacyWorkbook,
} from '../helpers/legacy-fixtures.js';
import { legacyImport, legacyWorkspace, reportId } from '../helpers/legacy-import.js';

let test: TestApp;
let reader: TestClient;
const workspace = legacyWorkspace();

interface ReservationBody {
  reservationNumber: string;
  classification: string;
  lastExecutionId?: string;
  legacy: null | {
    originalClassification: string;
    verificationCount: number;
    merged: boolean;
    importedAt: string;
  };
  treatment: { situation: string; needsReview: boolean; status: string };
}

beforeAll(async () => {
  test = await createTestApp();
  reader = await test.createClient('reader');
  const { db } = test.database;
  await insertHotel(db, { code: 'HML1', name: 'Hotel Homologação Um' });
  const execution = await insertExecution(db);
  await insertReservation(db, {
    hotelCode: 'HML1',
    reservationNumber: 'H-PEND',
    lastExecutionId: execution.id,
  });
  await insertReservation(db, {
    hotelCode: 'HML1',
    reservationNumber: 'L-MERGE',
    lastExecutionId: execution.id,
  });

  const request = (number: string) =>
    legacyTreatmentRow(number, {
      'Tratativa - arquivo no Dropbox': legacyAttachmentPath(`t_${number}.pdf`),
    });
  await writeLegacyWorkbook(workspace.xlsx, {
    reservations: [
      legacyReservationRow({ Reserva: 'L-PEND' }, 1),
      legacyReservationRow({ Reserva: 'L-PEND-T' }, 2),
      legacyReservationRow({ Reserva: 'L-REV', 'Codigo status': 'not_virtual_card' }, 3),
      legacyReservationRow({ Reserva: 'L-REV2', 'Codigo status': 'not_virtual_card' }, 4),
      legacyReservationRow({ Reserva: 'L-MERGE' }, 5),
    ],
    treatments: [request('L-PEND-T'), request('L-REV')],
  });
  writeLegacyAttachments(workspace.files, {
    [legacyAttachmentPath('t_L-PEND-T.pdf')]: legacyFile.pdf('pend'),
    [legacyAttachmentPath('t_L-REV.pdf')]: legacyFile.pdf('rev'),
  });
  const files = ['--xlsx', workspace.xlsx, '--files', workspace.files];
  await legacyImport(test.database, ['simulate', ...files]);
  await setHotelMapping(db, 'legacy_hml_um', 'HML1');
  const simulation = await legacyImport(test.database, ['simulate', ...files]);
  const run = await legacyImport(test.database, [
    'run',
    '--simulation',
    reportId(simulation.stdout),
    ...files,
  ]);
  expect(run.exitCode, run.stderr).toBe(0);
});

afterAll(async () => {
  await test.close();
  workspace.cleanup();
});

function list(query: string, client = reader): Promise<LightMyRequestResponse> {
  return test.app.inject({
    method: 'GET',
    url: `/v1/reservations?${query}`,
    headers: client.headers,
  });
}

async function numbers(query: string): Promise<string[]> {
  const response = await list(query);
  expect(response.statusCode).toBe(200);
  expectMatchesContract('listReservations', response);
  return response.json<{ items: ReservationBody[] }>().items.map((item) => item.reservationNumber);
}

describe('Reservation.legacy e lastExecutionId (US2, T023)', () => {
  it('importada e não verificada: legacy preenchido, sem lastExecutionId, no contrato', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/reservations/HML1/L-REV2',
      headers: reader.headers,
    });
    expect(response.statusCode).toBe(200);
    expectMatchesContract('getReservation', response);
    const body = response.json<ReservationBody>();
    expect(body.lastExecutionId).toBeUndefined();
    expect(body.classification).toBe('not_virtual_card');
    expect(body.legacy).toMatchObject({
      originalClassification: 'not_virtual_card',
      verificationCount: 3,
      merged: false,
    });
  });

  it('do HUNIT Control: legacy null; já conhecida e importada: merged', async () => {
    const all = (await list('limit=200')).json<{ items: ReservationBody[] }>();
    const byNumber = new Map(all.items.map((item) => [item.reservationNumber, item]));
    expect(byNumber.get('H-PEND')?.legacy).toBeNull();
    expect(byNumber.get('L-MERGE')?.legacy?.merged).toBe(true);
    expect(byNumber.get('L-MERGE')?.lastExecutionId).toBeDefined();
  });

  it('"Falta cobrar": pendentes importadas (com ou sem tratativa) junto com as do HUNIT Control, sem "A revisar" (SC-009)', async () => {
    const pending = await numbers('pendingCharge=true');
    expect(pending).toEqual(expect.arrayContaining(['H-PEND', 'L-PEND', 'L-PEND-T', 'L-MERGE']));
    expect(pending).not.toContain('L-REV');
    expect(pending).not.toContain('L-REV2');
  });

  it('"A revisar (sistema anterior)": com e sem tratativa, sem alerta (FR-007a)', async () => {
    expect((await numbers('situation=not_virtual_card')).sort()).toEqual(['L-REV', 'L-REV2']);
    expect(await numbers('situation=treatment_sent')).toEqual(['L-PEND-T']);
    expect(await numbers('needsReview=true')).toEqual([]);
    const detail = await test.app.inject({
      method: 'GET',
      url: '/v1/reservations/HML1/L-REV',
      headers: reader.headers,
    });
    expect(detail.json<ReservationBody>().treatment).toMatchObject({
      status: 'sent',
      situation: 'not_virtual_card',
      needsReview: false,
    });
  });
});

describe('filtro fromLegacy (US4, T030)', () => {
  it('true: só as importadas, inclusive as que o HUNIT Control já conhecia', async () => {
    expect((await numbers('fromLegacy=true')).sort()).toEqual(
      ['L-MERGE', 'L-PEND', 'L-PEND-T', 'L-REV', 'L-REV2'].sort(),
    );
  });

  it('false: o complemento', async () => {
    expect(await numbers('fromLegacy=false')).toEqual(['H-PEND']);
  });

  it('combina com hotel, situação e "Falta cobrar"', async () => {
    expect((await numbers('fromLegacy=true&pendingCharge=true&hotelCode=HML1')).sort()).toEqual([
      'L-MERGE',
      'L-PEND',
      'L-PEND-T',
    ]);
    expect(await numbers('fromLegacy=false&situation=not_virtual_card')).toEqual([]);
  });

  it('liberado aos dois perfis', async () => {
    const operator = await test.createClient('operator');
    expect((await list('fromLegacy=true', operator)).statusCode).toBe(200);
  });
});
