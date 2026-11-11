import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExecutionEventBus } from '../../src/executions/events.js';
import { ExecutionRunner, type StartExecutionInput } from '../../src/executions/runner.js';
import { EvidenceStore } from '../../src/evidence/store.js';
import { SecretRegistry } from '../../src/secrets.js';
import type { TestDatabase } from './db.js';
import { FakeHunit, type FakeScenario } from './fake-hunit-gateway.js';
import { captureLogs, type CapturedLogs } from './log-capture.js';

export const TEST_ACCOUNT_KEY_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';

/** Senha fictícia, fácil de procurar em logs, eventos e evidências. */
export const TEST_PASSWORD = 'SENHA-SECRETA-DE-TESTE-987';

export interface RunnerHarness {
  runner: ExecutionRunner;
  hunit: FakeHunit;
  events: ExecutionEventBus;
  evidence: EvidenceStore;
  evidenceDir: string;
  secrets: SecretRegistry;
  logs: CapturedLogs;
  close(): Promise<void>;
}

export interface RunnerHarnessOptions {
  scenario?: FakeScenario;
  twoFactorTimeoutMs?: number;
  /** Tamanho máximo de cada consulta ao Hunit, em dias (MAX_PERIOD_DAYS). */
  maxPeriodDays?: number | null;
  /** Hotéis processados ao mesmo tempo (HOTEL_CONCURRENCY). Padrão: 1. */
  hotelConcurrency?: number;
  /** Prazo da parada cooperativa antes de fechar o navegador à força. Padrão: 10 s. */
  cancelGraceMs?: number;
  /** Usa estes componentes em vez de criar novos (ex.: os da aplicação HTTP de teste). */
  secrets?: SecretRegistry;
  logs?: CapturedLogs;
}

/** Executor completo sobre o banco de teste e o Hunit simulado. */
export async function createRunnerHarness(
  database: TestDatabase,
  options: RunnerHarnessOptions = {},
): Promise<RunnerHarness> {
  const secrets = options.secrets ?? new SecretRegistry();
  const logs = options.logs ?? captureLogs({ secrets });
  const evidenceDir = await mkdtemp(path.join(tmpdir(), 'hunit-evidence-'));
  const hunit = new FakeHunit(options.scenario);
  const events = new ExecutionEventBus({ db: database.db, secrets, logger: logs.logger });
  const evidence = new EvidenceStore({
    db: database.db,
    dir: evidenceDir,
    retentionDays: 30,
    secrets,
  });
  const runner = new ExecutionRunner({
    db: database.db,
    events,
    evidence,
    secrets,
    createGateway: hunit.createGateway,
    accountKeySecret: TEST_ACCOUNT_KEY_SECRET,
    twoFactorTimeoutMs: options.twoFactorTimeoutMs ?? 60_000,
    maxPeriodDays: options.maxPeriodDays ?? null,
    hotelConcurrency: options.hotelConcurrency ?? 1,
    ...(options.cancelGraceMs !== undefined && { cancelGraceMs: options.cancelGraceMs }),
    logger: logs.logger,
  });

  return {
    runner,
    hunit,
    events,
    evidence,
    evidenceDir,
    secrets,
    logs,
    async close() {
      await runner.shutdown();
      await rm(evidenceDir, { recursive: true, force: true });
    },
  };
}

/** Pedido de execução com credenciais fictícias; cada chamada usa uma conta diferente. */
export function startInput(
  clientId: string,
  overrides: Partial<StartExecutionInput> = {},
): StartExecutionInput {
  return {
    clientId,
    credentials: {
      username: `operador-${randomUUID().slice(0, 8)}@hotel.test`,
      password: TEST_PASSWORD,
    },
    period: { from: '2026-11-01', to: '2026-11-07' },
    hotelCodes: null,
    ...overrides,
  };
}
