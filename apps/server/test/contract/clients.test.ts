/**
 * Teste de contrato de `GET /v1/me` (specs/002, T010): nome e perfil do cliente dono da chave,
 * usados pelo app desktop para mostrar só as ações do perfil (FR-004) e reconhecer as execuções
 * iniciadas na própria máquina (FR-012).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { revokeClient } from '../../src/persistence/clients-repo.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import { expectMatchesContract } from '../helpers/contract.js';

let test: TestApp;
let operator: TestClient;
let reader: TestClient;

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
  reader = await test.createClient('reader');
});

afterAll(async () => {
  await test.close();
});

describe('GET /v1/me (feature 002)', () => {
  it.each([
    ['operador', () => operator],
    ['consulta', () => reader],
  ])('devolve nome e perfil da chave de %s', async (_perfil, clientOf) => {
    const client = clientOf();
    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: client.headers,
    });

    expect(response.statusCode).toBe(200);
    expectMatchesContract('getCurrentClient', response);
    expect(response.json()).toEqual({ name: client.name, role: client.role });
  });

  it('recusa sem chave com 401', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/v1/me' });

    expect(response.statusCode).toBe(401);
    expectMatchesContract('getCurrentClient', response);
  });

  it('recusa chave revogada com 401', async () => {
    const revoked = await test.createClient('operator');
    await revokeClient(test.database.db, revoked.name);

    const response = await test.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: revoked.headers,
    });

    expect(response.statusCode).toBe(401);
    expectMatchesContract('getCurrentClient', response);
  });
});
