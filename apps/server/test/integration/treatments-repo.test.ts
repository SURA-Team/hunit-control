/**
 * Tratativas manuais sobre o banco real (specs/003, T013 e T023): deduplicação do arquivo,
 * registros simultâneos na mesma reserva, registro por inteiro ou nada (FR-011), tratativas
 * intactas depois de uma nova coleta (SC-004) e nenhuma chamada ao Hunit (SC-003).
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { reservations } from '../../src/persistence/schema.js';
import {
  findTreatmentFile,
  findTreatmentFileContent,
  saveTreatmentFile,
} from '../../src/persistence/treatment-files-repo.js';
import {
  getTreatmentDetail,
  registerDocuments,
  setManualAmount,
  type ReservationKey,
} from '../../src/persistence/treatments-repo.js';
import {
  createTestApp,
  startExecutionBody,
  type TestApp,
  type TestClient,
} from '../helpers/app.js';
import { insertExecution, insertHotel, insertReservation } from '../helpers/factories.js';
import { reservationDetails } from '../helpers/fake-hunit-gateway.js';
import { attach, emlFile, pdfFile, treatmentDetail } from '../helpers/treatments.js';

const HOTEL = 'T1';
const NOW = new Date('2026-11-13T12:00:00.000Z');

let test: TestApp;
let operator: TestClient;

const key = (reservationNumber: string): ReservationKey => ({
  hotelCode: HOTEL,
  reservationNumber,
});

async function savedFile(marker: string) {
  const content = pdfFile(marker);
  return saveTreatmentFile(test.database.db, {
    sha256: createHash('sha256').update(content).digest('hex'),
    content,
    mediaType: 'application/pdf',
    clientId: operator.id,
    now: NOW,
  });
}

beforeAll(async () => {
  test = await createTestApp({
    scenario: {
      validToken: '123456',
      hotels: [
        {
          code: HOTEL,
          name: 'Hotel Tratativas',
          reservations: [
            // A reserva R-COLETA aparece na coleta, já cobrada pelo Hunit.
            {
              reservationNumber: 'R-COLETA',
              listing: { checkIn: '2026-11-03' },
              detail: reservationDetails.alreadyCharged(),
            },
          ],
        },
      ],
    },
  });
  operator = await test.createClient('operator');
  const { db } = test.database;

  await insertHotel(db, { code: HOTEL, name: 'Hotel Tratativas' });
  const { id: lastExecutionId } = await insertExecution(db);
  for (const number of ['R-CONC', 'R-ATOM', 'R-COLETA']) {
    await insertReservation(db, { hotelCode: HOTEL, lastExecutionId, reservationNumber: number });
  }
});

afterAll(async () => {
  await test.close();
});

describe('arquivos', () => {
  it('o mesmo conteúdo é guardado uma vez e lido idêntico', async () => {
    const content = pdfFile('dedup');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const file = { sha256, content, mediaType: 'application/pdf', clientId: operator.id, now: NOW };

    const first = await saveTreatmentFile(test.database.db, file);
    const second = await saveTreatmentFile(test.database.db, file);

    expect(second).toEqual(first);
    expect(first).toEqual({ sha256, sizeBytes: content.length, mediaType: 'application/pdf' });
    expect(await findTreatmentFile(test.database.db, sha256)).toEqual(first);
    expect((await findTreatmentFileContent(test.database.db, sha256))?.equals(content)).toBe(true);
    expect(await findTreatmentFileContent(test.database.db, '0'.repeat(64))).toBeNull();
  });
});

describe('registros simultâneos na mesma reserva (research R-05)', () => {
  it('ficam em sequência: um único documento vigente e os dois no histórico', async () => {
    const [fileA, fileB] = await Promise.all([savedFile('conc-a'), savedFile('conc-b')]);
    const input = {
      kind: 'proof' as const,
      keys: [key('R-CONC')],
      clientId: operator.id,
      now: NOW,
    };

    const results = await Promise.all([
      registerDocuments(test.database.db, {
        ...input,
        file: fileA,
        fileName: 'a.pdf',
        batchId: '00000000-0000-4000-8000-00000000000a',
      }),
      registerDocuments(test.database.db, {
        ...input,
        file: fileB,
        fileName: 'b.pdf',
        batchId: '00000000-0000-4000-8000-00000000000b',
      }),
    ]);

    expect(
      results
        .flat()
        .map((outcome) => outcome.outcome)
        .sort(),
    ).toEqual(['registered', 'replaced']);
    const detail = await getTreatmentDetail(test.database.db, key('R-CONC'));
    expect(detail.documents.map((document) => document.state).sort()).toEqual([
      'current',
      'replaced',
    ]);
    expect(detail.events.map((event) => event.type).sort()).toEqual(['attached', 'replaced']);
    expect(detail.summary.proof?.state).toBe('current');
  });
});

describe('registro por inteiro ou nada (FR-011)', () => {
  it('se o evento não puder ser gravado, o documento também não fica', async () => {
    const file = await savedFile('atomico');
    // O histórico falha depois de o documento já ter sido inserido na mesma transação.
    await test.database.pool.query(`
      create function fail_event_for_test() returns trigger language plpgsql as $$
      begin raise exception 'falha simulada no historico'; end $$;
      create trigger fail_event_for_test before insert on treatment_events
        for each row execute function fail_event_for_test();
    `);
    try {
      const [outcome] = await registerDocuments(test.database.db, {
        kind: 'proof',
        file,
        fileName: 'c.pdf',
        keys: [key('R-ATOM')],
        clientId: operator.id,
        batchId: '00000000-0000-4000-8000-00000000000c',
        now: NOW,
      });

      expect(outcome).toMatchObject({ outcome: 'failed', documentId: null });
      expect(outcome?.error).toBeInstanceOf(Error);
    } finally {
      await test.database.pool.query(
        'drop trigger fail_event_for_test on treatment_events; drop function fail_event_for_test();',
      );
    }

    const detail = await getTreatmentDetail(test.database.db, key('R-ATOM'));
    expect(detail.documents).toEqual([]);
    expect(detail.events).toEqual([]);
  });
});

describe('camada ao lado da reserva (FR-007)', () => {
  it('uma nova coleta não toca nas tratativas, e as tratativas não chamam o Hunit', async () => {
    const reservation = key('R-COLETA');
    await attach(test, operator, reservation, 'request', 'pedido.eml', emlFile('coleta'));
    await attach(test, operator, reservation, 'proof', 'comprovante.pdf', pdfFile('coleta'));
    await setManualAmount(test.database.db, {
      key: reservation,
      amount: '321.00',
      clientId: operator.id,
      now: NOW,
    });
    const download = await test.app.inject({
      method: 'GET',
      url: `/v1/treatment-documents/${(await treatmentDetail(test, operator, reservation)).treatment.proof?.id ?? ''}/file`,
      headers: operator.headers,
    });
    expect(download.statusCode).toBe(200);

    // Nada do que foi feito até aqui acessou o Hunit (SC-003).
    expect(test.harness.hunit.calls).toEqual([]);
    expect(test.harness.hunit.sessions).toEqual([]);
    const before = await getTreatmentDetail(test.database.db, reservation);

    // Coleta completa do hotel pelo executor, com o Hunit simulado.
    const started = await test.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: operator.headers,
      payload: startExecutionBody({ hotelCodes: [HOTEL] }),
    });
    expect(started.statusCode).toBe(202);
    const { id: executionId } = started.json<{ id: string }>();
    await vi.waitFor(
      () => expect(test.harness.runner.submitToken(executionId, '123456')).toBe(true),
      { timeout: 5_000, interval: 10 },
    );
    await test.harness.runner.whenFinished(executionId);

    // A coleta atualizou a reserva (agora "já cobrada" pelo Hunit)...
    const [row] = await test.database.db
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.hotelCode, HOTEL), eq(reservations.reservationNumber, 'R-COLETA')),
      );
    expect(row).toMatchObject({
      classification: 'virtual_card_already_charged',
      verificationCount: 2,
      lastExecutionId: executionId,
    });

    // ...e as tratativas ficaram exatamente como estavam (SC-004).
    expect(await getTreatmentDetail(test.database.db, reservation)).toEqual(before);
    const view = await treatmentDetail(test, operator, reservation);
    expect(view.treatment).toMatchObject({
      status: 'charged',
      manualChargedAmount: '321.00',
      // A classificação nova não aceita novos registros, mas os documentos continuam visíveis.
      acceptsDocuments: false,
    });
    expect(view.documents).toHaveLength(2);
  });
});
