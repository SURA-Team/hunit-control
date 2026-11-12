/**
 * Servidor de teste para o app desktop de ponta a ponta (specs/002, T038, research R-12).
 *
 * A API real da feature 001 com o Hunit simulado (`FakeHunit`, programável) e um PostgreSQL do
 * Testcontainers, escutando em HTTP em `127.0.0.1` numa porta livre. O app não fala com ele
 * direto: um terminador TLS (apps/desktop/test/helpers/tls-terminator.ts) faz o papel do Caddy.
 *
 * Exige a preparação global do PostgreSQL (`postgres-global-setup.ts`) no projeto do Vitest.
 */
import { insertExecution, insertHotel, insertReservation } from './factories.js';
import { createTestApp, type TestApp, type TestClient } from './app.js';
import type { FakeHunit, FakeScenario } from './fake-hunit-gateway.js';
import type { HunitRetryNotice } from '../../src/hunit/gateway.js';

export interface E2eServerOptions {
  scenario?: FakeScenario;
  /** Prazo do token. Nos testes, alguns segundos. */
  twoFactorTimeoutMs?: number;
}

export interface E2eServer {
  /** Ex.: "http://127.0.0.1:54321". */
  url: string;
  port: number;
  /** Chave de operador desta "máquina" e a de consulta. */
  operator: TestClient;
  reader: TestClient;
  /** Hunit simulado: troque `hunit.scenario` ou registre `hunit.before(...)` para programar. */
  hunit: FakeHunit;
  test: TestApp;
  /** Cadastra outro cliente da API (outra máquina). */
  createClient(role: 'operator' | 'reader'): Promise<TestClient>;
  /** Troca o roteiro do Hunit simulado para as próximas execuções. */
  setScenario(scenario: FakeScenario): void;
  /**
   * Faz a próxima leitura de reserva do hotel avisar uma nova tentativa por erro passageiro,
   * como o gateway real faz (specs/002, FR-016a).
   */
  notifyRetryOnNextRead(hotelCode: string, notice?: Partial<HunitRetryNotice>): void;
  /** Insere hotel e reservas direto no banco (consultas da US3). */
  insertHotel: (code: string, name: string) => ReturnType<typeof insertHotel>;
  insertReservation: (
    overrides: Parameters<typeof insertReservation>[1],
  ) => ReturnType<typeof insertReservation>;
  insertExecution: (
    overrides: Parameters<typeof insertExecution>[1],
  ) => ReturnType<typeof insertExecution>;
  close(): Promise<void>;
}

export async function startE2eServer(options: E2eServerOptions = {}): Promise<E2eServer> {
  const test = await createTestApp({
    ...(options.scenario && { scenario: options.scenario }),
    ...(options.twoFactorTimeoutMs !== undefined && {
      twoFactorTimeoutMs: options.twoFactorTimeoutMs,
    }),
  });
  const address = await test.app.listen({ host: '127.0.0.1', port: 0 });
  const port = Number(new URL(address).port);
  const operator = await test.createClient('operator');
  const reader = await test.createClient('reader');
  const { hunit } = test.harness;
  const { db } = test.database;

  /** Hotéis com aviso pendente na próxima leitura de reserva. */
  const pendingRetries = new Map<string, Partial<HunitRetryNotice>>();
  hunit.before('readReservation', async (call) => {
    const notice = pendingRetries.get(call.hotelCode);
    if (!notice) return;
    pendingRetries.delete(call.hotelCode);
    const session = hunit.sessions[call.session - 1];
    await session?.notifyRetry({
      attempt: 1,
      maxAttempts: 5,
      delayMs: 2_000,
      reason: 'o Hunit não respondeu',
      hotelCode: call.hotelCode,
      ...notice,
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    operator,
    reader,
    hunit,
    test,
    createClient: (role) => test.createClient(role),
    setScenario(scenario) {
      hunit.scenario = scenario;
    },
    notifyRetryOnNextRead(hotelCode, notice = {}) {
      pendingRetries.set(hotelCode, notice);
    },
    insertHotel: (code, name) => insertHotel(db, { code, name }),
    insertReservation: (overrides) => insertReservation(db, overrides),
    insertExecution: (overrides) => insertExecution(db, overrides),
    close: () => test.close(),
  };
}
