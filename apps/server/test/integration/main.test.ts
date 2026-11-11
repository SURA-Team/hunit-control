/**
 * Subida completa do servidor (T035): migrations, execuções interrompidas, API HTTP escutando e
 * desligamento. O Hunit é simulado.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import { generateApiKey, hashApiKey } from '../../src/http/auth.js';
import { startServer, type RunningServer } from '../../src/main.js';
import { createClient } from '../../src/persistence/clients-repo.js';
import { findExecution } from '../../src/persistence/executions-repo.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertExecution } from '../helpers/factories.js';
import { FakeHunit } from '../helpers/fake-hunit-gateway.js';

let database: TestDatabase;
let evidenceDir: string;
let server: RunningServer;
let interruptedId: string;
const hunit = new FakeHunit({ hotels: [{ code: '10', name: 'Hotel Alfa' }] });
const logLines: string[] = [];

function configFor(databaseUrl: string): AppConfig {
  return {
    port: 0,
    logLevel: 'info',
    databaseUrl,
    accountKeySecret: 'segredo-de-teste-com-mais-de-32-caracteres',
    hunit: {
      webUrl: 'https://hunit.test',
      apiUrl: 'https://hunit-api.test',
      twoFactorTimeoutSeconds: 120,
      hotelConcurrency: 1,
      maxPeriodDays: null,
    },
    evidence: { dir: evidenceDir, retentionDays: 30 },
    reservationRetentionYears: 5,
  };
}

beforeAll(async () => {
  database = await createTestDatabase();
  evidenceDir = await mkdtemp(path.join(tmpdir(), 'hunit-main-'));
  // Execução que "ficou ativa" quando o processo anterior caiu.
  interruptedId = (await insertExecution(database.db, { status: 'awaiting_2fa' })).id;

  server = await startServer({
    config: configFor(database.url),
    createGateway: hunit.createGateway,
    host: '127.0.0.1',
    logDestination: { write: (line: string) => void logLines.push(line) },
  });
});

afterAll(async () => {
  await server.close();
  await database.close();
  await rm(evidenceDir, { recursive: true, force: true });
});

describe('startServer (T035)', () => {
  it('ao subir, encerra as execuções que estavam ativas como failed/server_restarted', async () => {
    expect((await findExecution(database.db, interruptedId))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'server_restarted',
    });
  });

  it('responde por HTTP: health, início da execução, token e conclusão', async () => {
    expect(await (await fetch(`${server.url}/v1/health`)).json()).toEqual({ status: 'ok' });

    const apiKey = generateApiKey();
    await createClient(database.db, {
      name: 'desktop',
      role: 'operator',
      keyHash: hashApiKey(apiKey),
    });
    const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };

    const created = await fetch(`${server.url}/v1/executions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        credentials: { username: 'operador@hotel.test', password: 'SENHA-DO-TESTE-MAIN' },
        period: { from: '2026-11-01', to: '2026-11-07' },
      }),
    });
    expect(created.status).toBe(202);
    const { id } = (await created.json()) as { id: string };

    const status = async () =>
      (
        (await (await fetch(`${server.url}/v1/executions/${id}`, { headers })).json()) as {
          status: string;
        }
      ).status;
    // Mesmo prazo dos demais testes: com a suíte inteira em paralelo, 1 s (o padrão) é pouco.
    const wait = { timeout: 5_000, interval: 20 };
    await vi.waitFor(async () => expect(await status()).toBe('awaiting_2fa'), wait);

    const token = await fetch(`${server.url}/v1/executions/${id}/two-factor`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: '123456' }),
    });
    expect(token.status).toBe(202);
    await vi.waitFor(async () => expect(await status()).toBe('completed'), wait);

    const logs = logLines.join('');
    expect(logs).not.toContain('SENHA-DO-TESTE-MAIN');
    expect(logs).not.toContain('operador@hotel.test');
  });
});
