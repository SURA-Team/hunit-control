/**
 * Teste de contrato da lista de evidências de uma execução (specs/002, T062, FR-024): o app
 * desktop mostra as evidências de falha da execução e de cada hotel e baixa a que o operador
 * escolher. Antes, o identificador da evidência só aparecia no texto do evento `evidence_recorded`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evidence } from '../../src/persistence/schema.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';
import { insertExecution } from '../helpers/factories.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

interface EvidenceBody {
  id: string;
  hotelCode: string | null;
  reservationNumber: string | null;
  kind: string;
  reason: string;
  files: string[];
  createdAt: string;
  expiresAt: string;
}

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
});

afterAll(async () => {
  await test.close();
});

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

async function listEvidence(executionId: string, client: TestClient = operator) {
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/executions/${executionId}/evidence`,
    headers: client.headers,
  });
  expectMatchesContract('listExecutionEvidence', response);
  return response;
}

describe('GET /v1/executions/{id}/evidence (feature 002)', () => {
  it('lista as evidências da execução, as mais recentes primeiro, com os arquivos existentes', async () => {
    const execution = await insertExecution(test.database.db, { clientId: operator.id });
    const other = await insertExecution(test.database.db, { clientId: operator.id });
    const { evidence: store } = test.harness;

    const screen = await store.save({
      executionId: execution.id,
      hotelCode: '31',
      kind: 'screen_not_recognized',
      reason: 'Tela do Hunit não reconhecida.',
      material: { screenshot: Buffer.from([1, 2, 3]), html: '<p>tela</p>' },
    });
    await pause();
    const response = await store.save({
      executionId: execution.id,
      hotelCode: '32',
      reservationNumber: '3201',
      kind: 'classification_failure',
      reason: 'Resposta do Hunit não reconhecida.',
      material: { response: '{"inesperado":true}' },
    });
    await store.save({
      executionId: other.id,
      kind: 'navigation_failure',
      reason: 'De outra execução.',
      material: { html: '<p>outra</p>' },
    });

    const result = await listEvidence(execution.id);

    expect(result.statusCode).toBe(200);
    const { items } = result.json<{ items: EvidenceBody[] }>();
    expect(items.map((item) => item.id)).toEqual([response?.id, screen?.id]);
    expect(items[0]).toMatchObject({
      hotelCode: '32',
      reservationNumber: '3201',
      kind: 'classification_failure',
      reason: 'Resposta do Hunit não reconhecida.',
      files: ['response'],
    });
    expect(items[1]).toMatchObject({
      hotelCode: '31',
      reservationNumber: null,
      kind: 'screen_not_recognized',
      files: ['screenshot', 'html'],
    });
  });

  it('não lista evidência vencida', async () => {
    const execution = await insertExecution(test.database.db, { clientId: operator.id });
    await test.database.db.insert(evidence).values({
      executionId: execution.id,
      kind: 'navigation_failure',
      reason: 'Vencida.',
      htmlPath: `${execution.id}/vencida.html`,
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const result = await listEvidence(execution.id);

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ items: [] });
  });

  it('o perfil consulta também pode listar', async () => {
    const execution = await insertExecution(test.database.db, { clientId: operator.id });

    const result = await listEvidence(execution.id, reader);

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ items: [] });
  });

  it('execução inexistente → 404', async () => {
    const result = await listEvidence(randomUUID());

    expect(result.statusCode).toBe(404);
    expect(result.json<{ code: string }>().code).toBe('not_found');
  });
});
