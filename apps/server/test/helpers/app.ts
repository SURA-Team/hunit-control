import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/http/app.js';
import { generateApiKey, hashApiKey } from '../../src/http/auth.js';
import { createClient } from '../../src/persistence/clients-repo.js';
import type { ClientRole } from '../../src/persistence/schema.js';
import { SecretRegistry } from '../../src/secrets.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import type { FakeScenario } from './fake-hunit-gateway.js';
import { captureLogs, type CapturedLogs } from './log-capture.js';
import { createRunnerHarness, type RunnerHarness } from './runner.js';

export interface TestClient {
  id: string;
  name: string;
  role: ClientRole;
  apiKey: string;
  /** Cabeçalho pronto para usar em `app.inject({ headers })`. */
  headers: { authorization: string };
}

export interface TestApp {
  app: FastifyInstance;
  database: TestDatabase;
  logs: CapturedLogs;
  secrets: SecretRegistry;
  /** Executor, Hunit simulado e eventos usados pela aplicação. */
  harness: RunnerHarness;
  /** Cadastra um cliente da API e devolve a chave dele. */
  createClient(role: ClientRole): Promise<TestClient>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Roteiro do Hunit simulado. */
  scenario?: FakeScenario;
  twoFactorTimeoutMs?: number;
}

/**
 * Sobe a aplicação HTTP completa sobre um banco de testes exclusivo, com os logs capturados
 * em memória e o Hunit simulado. Use em `beforeAll` e chame `close()` em `afterAll`.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  const secrets = new SecretRegistry();
  const logs = captureLogs({ secrets });
  const harness = await createRunnerHarness(database, { ...options, secrets, logs });
  const app = await buildApp({
    db: database.db,
    logger: logs.logger,
    events: harness.events,
    runner: harness.runner,
  });
  await app.ready();

  return {
    app,
    database,
    logs,
    secrets,
    harness,
    async createClient(role) {
      const apiKey = generateApiKey();
      const client = await createClient(database.db, {
        name: `${role}-${randomUUID().slice(0, 8)}`,
        role,
        keyHash: hashApiKey(apiKey),
      });
      return { ...client, apiKey, headers: { authorization: `Bearer ${apiKey}` } };
    },
    async close() {
      await app.close();
      await harness.close();
      await database.close();
    },
  };
}

/** Corpo válido para `POST /v1/executions`, com credenciais reconhecíveis nos testes de log. */
export function startExecutionBody(overrides: Record<string, unknown> = {}) {
  return {
    credentials: { username: 'operador@hotel.test', password: 'SENHA-NO-CORPO-123' },
    period: { from: '2026-11-01', to: '2026-11-07' },
    ...overrides,
  };
}
