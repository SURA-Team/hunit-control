/**
 * Auxiliares dos testes da interface (grupo desktop-ui): a ponte `window.hunit` simulada, com
 * respostas programáveis e eventos que o teste dispara, e a renderização com os mesmos provedores
 * do app (Mantine, TanStack Query sem novas tentativas, ponte e estado da conexão).
 */
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi, type Mock } from 'vitest';
import { HunitContext } from '../../src/renderer/src/hunit';
import { ConnectionProvider } from '../../src/renderer/src/state/connection';
import type {
  ConnectionState,
  CredentialsClearReason,
  CredentialsInput,
  ExecutionChanged,
  HunitApi,
  PreferencesInput,
  Result,
  TwoFactorClosed,
  TwoFactorRequest,
} from '../../src/shared/ipc-types';

type Listener<T> = (payload: T) => void;

export interface FakeHunit {
  api: HunitApi;
  /** Dispara um evento do principal para a interface. */
  emit: {
    connectionState(state: ConnectionState): void;
    credentialsCleared(reason: CredentialsClearReason): void;
    executionChanged(event: ExecutionChanged): void;
    twoFactorRequested(request: TwoFactorRequest): void;
    twoFactorClosed(event: TwoFactorClosed): void;
    playSound(): void;
  };
}

export function okResult<T>(data: T): Promise<Result<T>> {
  return Promise.resolve({ ok: true, data });
}

export function errorResult(code: string, detail?: string): Promise<Result<never>> {
  return Promise.resolve({
    ok: false,
    error: { code: code as never, ...(detail !== undefined && { detail }) },
  });
}

export const ONLINE_OPERATOR: ConnectionState = {
  status: 'online',
  client: { name: 'desktop-financeiro', role: 'operator' },
  checkedAt: '2026-11-12T12:00:00.000Z',
};

export const ONLINE_READER: ConnectionState = {
  status: 'online',
  client: { name: 'consulta', role: 'reader' },
  checkedAt: '2026-11-12T12:00:00.000Z',
};

/** Ponte simulada: tudo responde "deu certo" com dados vazios até o teste programar outra coisa. */
export function fakeHunit(state: ConnectionState = ONLINE_OPERATOR): FakeHunit {
  const listeners = {
    connectionState: new Set<Listener<ConnectionState>>(),
    credentialsCleared: new Set<Listener<{ reason: CredentialsClearReason }>>(),
    executionChanged: new Set<Listener<ExecutionChanged>>(),
    twoFactorRequested: new Set<Listener<TwoFactorRequest>>(),
    twoFactorClosed: new Set<Listener<TwoFactorClosed>>(),
    playSound: new Set<Listener<void>>(),
  };
  const on =
    <T,>(set: Set<Listener<T>>) =>
    (callback: Listener<T>) => {
      set.add(callback);
      return () => {
        set.delete(callback);
      };
    };

  const api: HunitApi = {
    app: { info: vi.fn(() => okResult({ version: '0.1.0' })) },
    connection: {
      getState: vi.fn(() => okResult(state)),
      getConfig: vi.fn(() => okResult(null)),
      pickCertificate: vi.fn(() => okResult(null)),
      test: vi.fn(() => okResult(state.client ?? { name: 'x', role: 'operator' as const })),
      save: vi.fn(() => errorResult('invalid_input')),
      remove: vi.fn(() => okResult(undefined)),
      onState: on(listeners.connectionState),
    },
    preferences: {
      set: vi.fn((input: PreferencesInput) =>
        okResult({ soundEnabled: input.soundEnabled ?? true, idleHours: input.idleHours ?? 8 }),
      ),
    },
    attention: {
      test: vi.fn(() => okResult(undefined)),
      onPlaySound: on(listeners.playSound),
    },
    credentials: {
      status: vi.fn(() => okResult({ username: null, hasPassword: false })),
      set: vi.fn((input: CredentialsInput) =>
        okResult({ username: input.username, hasPassword: true }),
      ),
      clear: vi.fn(() => okResult({ username: null, hasPassword: false })),
      onCleared: on(listeners.credentialsCleared),
    },
    activity: { ping: vi.fn() },
    hotels: { list: vi.fn(() => okResult([])) },
    executions: {
      list: vi.fn(() => okResult({ items: [], nextCursor: null })),
      get: vi.fn(() => errorResult('not_found')),
      start: vi.fn(() => errorResult('internal_error')),
      resume: vi.fn(() => errorResult('internal_error')),
      cancel: vi.fn(() => errorResult('internal_error')),
      sendToken: vi.fn(() => okResult(undefined)),
      watch: vi.fn(() => okResult(undefined)),
      unwatch: vi.fn(() => okResult(undefined)),
      onChanged: on(listeners.executionChanged),
    },
    twoFactor: {
      onRequested: on(listeners.twoFactorRequested),
      onClosed: on(listeners.twoFactorClosed),
    },
    evidence: {
      list: vi.fn(() => okResult([])),
      save: vi.fn(() => okResult(null)),
    },
    reservations: {
      list: vi.fn(() => okResult({ items: [], nextCursor: null })),
      get: vi.fn(() => errorResult('not_found')),
      channels: vi.fn(() => okResult([])),
    },
  };

  const emitTo = <T,>(set: Set<Listener<T>>, payload: T) => {
    for (const listener of [...set]) listener(payload);
  };

  return {
    api,
    emit: {
      connectionState: (next) => emitTo(listeners.connectionState, next),
      credentialsCleared: (reason) => emitTo(listeners.credentialsCleared, { reason }),
      executionChanged: (event) => emitTo(listeners.executionChanged, event),
      twoFactorRequested: (request) => emitTo(listeners.twoFactorRequested, request),
      twoFactorClosed: (event) => emitTo(listeners.twoFactorClosed, event),
      playSound: () => emitTo(listeners.playSound, undefined),
    },
  };
}

/** Atalho para o tipo das funções simuladas: `mocked(hunit.api.connection.test)`. */
export function mocked<T extends (...args: never[]) => unknown>(fn: T): Mock<T> {
  return fn as unknown as Mock<T>;
}

export function renderWithApp(
  ui: ReactElement,
  hunit: FakeHunit = fakeHunit(),
): RenderResult & { hunit: FakeHunit } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const result = render(
    <MantineProvider env="test">
      <DatesProvider settings={{ locale: 'pt-br' }}>
        <QueryClientProvider client={queryClient}>
          <HunitContext.Provider value={hunit.api}>
            <ConnectionProvider>{ui}</ConnectionProvider>
          </HunitContext.Provider>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>,
  );
  return { ...result, hunit };
}
