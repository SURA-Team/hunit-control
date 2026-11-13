/**
 * Estado da conexão com o servidor (specs/002, T018, FR-001, FR-002, FR-005, data-model §4.1):
 * não configurado, conectando, online, indisponível (novo teste a cada 5 s), servidor não
 * confirmado e chave recusada. O cliente da API é simulado; o relógio também.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager, type ConnectionApi } from '../../src/main/connection.js';
import type {
  AppError,
  ClientIdentity,
  ConnectionState,
  Result,
} from '../../src/shared/ipc-types.js';

const IDENTITY: ClientIdentity = { name: 'desktop-financeiro', role: 'operator' };
const CONFIG = { serverUrl: 'https://192.168.0.50' };

type Reply<T> = Result<T> | (() => Result<T>);

/** API simulada: cada chamada responde o que o teste programou. */
class FakeApi implements ConnectionApi {
  health: Reply<{ status: 'ok' }> = { ok: true, data: { status: 'ok' } };
  me: Reply<ClientIdentity> = { ok: true, data: IDENTITY };
  healthCalls = 0;
  closed = false;

  getHealth(): Promise<Result<{ status: 'ok' }>> {
    this.healthCalls += 1;
    return Promise.resolve(typeof this.health === 'function' ? this.health() : this.health);
  }
  getMe(): Promise<Result<ClientIdentity>> {
    return Promise.resolve(typeof this.me === 'function' ? this.me() : this.me);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function failure(code: AppError['code']): Result<never> {
  return { ok: false, error: { code } };
}

let api: FakeApi;
let states: ConnectionState[];
let config: typeof CONFIG | null;

function newManager() {
  return new ConnectionManager({
    loadConfig: () => Promise.resolve(config),
    createApi: () => api,
    onState: (state) => states.push(state),
    retryIntervalMs: 5_000,
  });
}

const statuses = () => states.map((state) => state.status);

beforeEach(() => {
  vi.useFakeTimers();
  api = new FakeApi();
  states = [];
  config = CONFIG;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionManager', () => {
  it('sem configuração → not_configured', async () => {
    config = null;
    const manager = newManager();

    await manager.start();

    expect(manager.getState()).toMatchObject({ status: 'not_configured', client: null });
    expect(manager.getApi()).toBeNull();
  });

  it('health e /me respondem → online com o cliente', async () => {
    const manager = newManager();

    await manager.start();

    expect(statuses()).toEqual(['connecting', 'online']);
    expect(manager.getState()).toMatchObject({ status: 'online', client: IDENTITY });
    expect(manager.getApi()).toBe(api);
    expect(Date.parse(manager.getState().checkedAt)).not.toBeNaN();
  });

  it('falha de rede → offline, novo teste a cada 5 s até voltar', async () => {
    api.health = failure('offline');
    const manager = newManager();

    await manager.start();
    expect(manager.getState().status).toBe('offline');
    expect(api.healthCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.healthCalls).toBe(2);
    expect(manager.getState().status).toBe('offline');

    api.health = { ok: true, data: { status: 'ok' } };
    await vi.advanceTimersByTimeAsync(5_000);

    expect(manager.getState()).toMatchObject({ status: 'online', client: IDENTITY });
    expect(statuses()).toEqual(['connecting', 'offline', 'connecting', 'online']);

    // Online, volta ao intervalo longo: nada de testes a cada 5 s.
    const calls = api.healthCalls;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.healthCalls).toBe(calls);
  });

  it('online, testa /health a cada 30 s e percebe sozinho que o servidor sumiu (FR-005)', async () => {
    const manager = newManager();
    await manager.start();
    const calls = api.healthCalls;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.healthCalls).toBe(calls + 1);
    expect(manager.getState().status).toBe('online');

    api.health = failure('offline');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(manager.getState().status).toBe('offline');
  });

  it('falha de TLS → untrusted_server, sem novas tentativas', async () => {
    api.health = failure('untrusted_server');
    const manager = newManager();

    await manager.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(manager.getState().status).toBe('untrusted_server');
    expect(api.healthCalls).toBe(1);
  });

  it('401 no /me → unauthorized', async () => {
    api.me = failure('unauthorized');
    const manager = newManager();

    await manager.start();

    expect(manager.getState()).toMatchObject({ status: 'unauthorized', client: null });
  });

  it('outro módulo avisa que o servidor sumiu → offline e volta sozinho', async () => {
    const manager = newManager();
    await manager.start();

    manager.reportFailure({ code: 'offline' });
    expect(manager.getState().status).toBe('offline');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(manager.getState().status).toBe('online');
  });

  it('nova configuração salva reconecta; remover volta a not_configured', async () => {
    api.me = failure('unauthorized');
    const manager = newManager();
    await manager.start();

    api.me = { ok: true, data: IDENTITY };
    await manager.reconnect();
    expect(manager.getState().status).toBe('online');

    config = null;
    const previous = api;
    await manager.reconnect();
    expect(manager.getState().status).toBe('not_configured');
    expect(previous.closed).toBe(true);
  });

  it('cada mudança de estado é emitida uma vez', async () => {
    const manager = newManager();
    await manager.start();
    manager.reportFailure({ code: 'offline' });
    manager.reportFailure({ code: 'offline' });

    expect(statuses()).toEqual(['connecting', 'online', 'offline']);
  });
});
