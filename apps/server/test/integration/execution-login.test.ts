/**
 * Acesso ao Hunit com token 2FA pelo executor (T026, US1): Hunit simulado + banco real.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExecutionEventBus } from '../../src/executions/events.js';
import { failInterruptedExecutions } from '../../src/executions/runner.js';
import {
  HunitUnavailableError,
  InvalidCredentialsError,
  ScreenNotRecognizedError,
} from '../../src/hunit/errors.js';
import {
  ExecutionAlreadyActiveError,
  findExecution,
} from '../../src/persistence/executions-repo.js';
import { listHotels } from '../../src/persistence/hotels-repo.js';
import { evidence, type ExecutionStatus } from '../../src/persistence/schema.js';
import { REDACTED, SecretRegistry } from '../../src/secrets.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertClient, insertExecution } from '../helpers/factories.js';
import {
  createRunnerHarness,
  startInput,
  TEST_PASSWORD,
  type RunnerHarness,
  type RunnerHarnessOptions,
} from '../helpers/runner.js';

let database: TestDatabase;
let clientId: string;
const harnesses: RunnerHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  clientId = (await insertClient(database.db, { name: 'desktop' })).id;
});

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function harness(options: RunnerHarnessOptions = {}): Promise<RunnerHarness> {
  const created = await createRunnerHarness(database, options);
  harnesses.push(created);
  return created;
}

async function statusOf(executionId: string): Promise<ExecutionStatus | undefined> {
  return (await findExecution(database.db, executionId))?.execution.status;
}

async function waitForStatus(executionId: string, status: ExecutionStatus): Promise<void> {
  await vi.waitFor(async () => expect(await statusOf(executionId)).toBe(status), {
    timeout: 5_000,
    interval: 20,
  });
}

async function eventsOf(h: RunnerHarness, executionId: string) {
  return h.events.listRecent(executionId, 100);
}

describe('acesso com token (FR-001, FR-002)', () => {
  it('pausa em awaiting_2fa com prazo, recebe o token e conclui o acesso lendo o catálogo', async () => {
    const h = await harness({
      scenario: {
        validToken: '654321',
        hotels: [
          { code: '10', name: 'Hotel Alfa' },
          { code: '20', name: 'Hotel Beta' },
        ],
      },
      twoFactorTimeoutMs: 120_000,
    });
    const before = Date.now();

    const execution = await h.runner.start(startInput(clientId));
    expect(execution.status).toBe('queued');

    await waitForStatus(execution.id, 'awaiting_2fa');
    const waiting = await findExecution(database.db, execution.id);
    const deadline = waiting?.execution.twoFactorDeadline?.getTime() ?? 0;
    expect(deadline).toBeGreaterThanOrEqual(before + 120_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 120_000);

    expect(h.runner.submitToken(execution.id, '654321')).toBe(true);
    await h.runner.whenFinished(execution.id);

    const finished = await findExecution(database.db, execution.id);
    expect(finished?.execution).toMatchObject({
      status: 'completed',
      endReason: null,
      twoFactorDeadline: null,
    });
    expect(finished?.execution.startedAt).toBeInstanceOf(Date);
    expect(finished?.execution.finishedAt).toBeInstanceOf(Date);

    expect((await listHotels(database.db)).map((hotel) => hotel.name)).toEqual(
      expect.arrayContaining(['Hotel Alfa', 'Hotel Beta']),
    );

    const events = await eventsOf(h, execution.id);
    expect(events.map((event) => [event.type, event.status])).toEqual([
      ['status_changed', 'queued'],
      ['status_changed', 'running'],
      ['status_changed', 'awaiting_2fa'],
      ['status_changed', 'running'],
      ['catalog_updated', null],
      ['status_changed', 'completed'],
    ]);
    expect(events.find((event) => event.type === 'catalog_updated')?.message).toContain('2 hotéis');

    // O navegador foi fechado e o token chegou ao Hunit.
    expect(h.hunit.callsTo('submitToken').map((call) => call.token)).toEqual(['654321']);
    expect(h.hunit.sessions[0]?.closed).toBe(true);
  });

  it('avisa que espera o token assim que o Hunit o pede (SC-005)', async () => {
    const h = await harness();
    const execution = await h.runner.start(startInput(clientId));

    const started = Date.now();
    const received = await new Promise<number>((resolve, reject) => {
      h.events
        .subscribe(execution.id, 0, (event) => {
          if (event.status === 'awaiting_2fa') resolve(Date.now());
        })
        .catch(reject);
    });

    expect(received - started).toBeLessThan(5_000);
  });

  it('conclui sem pedir token quando o Hunit não exige', async () => {
    const h = await harness({ scenario: { login: 'authenticated' } });
    const execution = await h.runner.start(startInput(clientId));
    await h.runner.whenFinished(execution.id);

    expect(await statusOf(execution.id)).toBe('completed');
    const statuses = (await eventsOf(h, execution.id)).map((event) => event.status);
    expect(statuses).not.toContain('awaiting_2fa');
  });

  it('só aceita token enquanto espera por ele, e só o primeiro', async () => {
    const h = await harness();
    const execution = await h.runner.start(startInput(clientId));

    expect(h.runner.submitToken('00000000-0000-0000-0000-000000000000', '123456')).toBe(false);

    await waitForStatus(execution.id, 'awaiting_2fa');
    expect(h.runner.submitToken(execution.id, '123456')).toBe(true);
    expect(h.runner.submitToken(execution.id, '123456')).toBe(false);

    await h.runner.whenFinished(execution.id);
    expect(h.runner.submitToken(execution.id, '123456')).toBe(false);
    expect(h.hunit.callsTo('submitToken')).toHaveLength(1);
  });
});

describe('falhas com motivo distinto (FR-003)', () => {
  it('credenciais inválidas: failed/invalid_credentials sem pedir o token', async () => {
    const h = await harness({ scenario: { login: new InvalidCredentialsError() } });
    const execution = await h.runner.start(startInput(clientId));
    await h.runner.whenFinished(execution.id);

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'invalid_credentials',
    });
    const events = await eventsOf(h, execution.id);
    expect(events.map((event) => event.status)).not.toContain('awaiting_2fa');
    expect(events.at(-1)?.message).toBe('O Hunit recusou o usuário ou a senha.');
    expect(h.hunit.callsTo('submitToken')).toHaveLength(0);
  });

  it('token inválido: failed/invalid_token', async () => {
    const h = await harness({ scenario: { validToken: '111111' } });
    const execution = await h.runner.start(startInput(clientId));
    await waitForStatus(execution.id, 'awaiting_2fa');

    h.runner.submitToken(execution.id, '999999');
    await h.runner.whenFinished(execution.id);

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'invalid_token',
    });
  });

  it('sem token no prazo: failed/two_factor_timeout', async () => {
    const h = await harness({ twoFactorTimeoutMs: 300 });
    const execution = await h.runner.start(startInput(clientId));
    await h.runner.whenFinished(execution.id);

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'two_factor_timeout',
    });
    // Depois do prazo, o token não é mais aceito.
    expect(h.runner.submitToken(execution.id, '123456')).toBe(false);
    expect(h.hunit.callsTo('submitToken')).toHaveLength(0);
  });

  it('Hunit fora do ar: failed/hunit_unavailable', async () => {
    const h = await harness({ scenario: { login: new HunitUnavailableError('tempo esgotado') } });
    const execution = await h.runner.start(startInput(clientId));
    await h.runner.whenFinished(execution.id);

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'hunit_unavailable',
    });
  });

  it('tela não reconhecida: failed/hunit_screen_not_recognized com evidência', async () => {
    const h = await harness({
      scenario: {
        login: new ScreenNotRecognizedError('campo "Senha" não encontrado', {
          evidence: { html: '<html><body><h1>Tela nova</h1></body></html>' },
        }),
      },
    });
    const execution = await h.runner.start(startInput(clientId));
    await h.runner.whenFinished(execution.id);

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'hunit_screen_not_recognized',
    });

    const [stored] = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.executionId, execution.id));
    expect(stored).toMatchObject({
      kind: 'screen_not_recognized',
      reason: expect.stringContaining('campo "Senha" não encontrado') as unknown,
    });
    const html = await readFile(path.join(h.evidenceDir, stored?.htmlPath ?? ''), 'utf8');
    expect(html).toContain('Tela nova');

    const types = (await eventsOf(h, execution.id)).map((event) => event.type);
    expect(types).toContain('evidence_recorded');
  });

  it('erro inesperado: failed/internal_error, e o navegador é fechado', async () => {
    const h = await harness({ scenario: { listHotelsError: new Error('falha qualquer') } });
    const execution = await h.runner.start(startInput(clientId));
    await waitForStatus(execution.id, 'awaiting_2fa');
    h.runner.submitToken(execution.id, '123456');
    await h.runner.whenFinished(execution.id);

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'internal_error',
    });
    expect(h.hunit.sessions[0]?.closed).toBe(true);
    expect(h.logs.text()).toContain('falha inesperada na execução');
  });
});

describe('uma execução ativa por conta (FR-006)', () => {
  it('recusa uma segunda execução da mesma conta, mesmo com usuário escrito diferente', async () => {
    const h = await harness();
    const first = startInput(clientId);
    const execution = await h.runner.start(first);
    await waitForStatus(execution.id, 'awaiting_2fa');

    const sameAccount = startInput(clientId, {
      credentials: {
        username: `  ${first.credentials.username.toUpperCase()} `,
        password: 'outra',
      },
    });
    await expect(h.runner.start(sameAccount)).rejects.toThrow(ExecutionAlreadyActiveError);

    // Outra conta pode executar ao mesmo tempo.
    const other = await h.runner.start(startInput(clientId));
    await waitForStatus(other.id, 'awaiting_2fa');
  });
});

describe('reinício do servidor', () => {
  it('desligar o servidor encerra as execuções em andamento como failed/server_restarted', async () => {
    const h = await harness();
    const execution = await h.runner.start(startInput(clientId));
    await waitForStatus(execution.id, 'awaiting_2fa');

    await h.runner.shutdown();

    expect((await findExecution(database.db, execution.id))?.execution).toMatchObject({
      status: 'failed',
      endReason: 'server_restarted',
    });
    expect(h.hunit.sessions[0]?.closed).toBe(true);
    expect((await eventsOf(h, execution.id)).at(-1)?.message).toContain('servidor foi reiniciado');
  });

  it('ao subir, marca como failed/server_restarted o que ficou ativo no processo anterior', async () => {
    const own = await createTestDatabase();
    try {
      const events = new ExecutionEventBus({ db: own.db, secrets: new SecretRegistry() });
      const awaiting = await insertExecution(own.db, {
        status: 'awaiting_2fa',
        twoFactorDeadline: new Date(),
      });
      const done = await insertExecution(own.db, { status: 'completed' });

      const interrupted = await failInterruptedExecutions(own.db, events);

      expect(interrupted.map((row) => row.id)).toEqual([awaiting.id]);
      expect((await findExecution(own.db, awaiting.id))?.execution).toMatchObject({
        status: 'failed',
        endReason: 'server_restarted',
      });
      expect((await findExecution(own.db, done.id))?.execution.status).toBe('completed');
      expect((await events.listRecent(awaiting.id)).map((event) => event.status)).toEqual([
        'failed',
      ]);
    } finally {
      await own.close();
    }
  });
});

describe('credenciais e token fora de logs, eventos e evidências (FR-005)', () => {
  async function writtenBy(h: RunnerHarness, executionId: string): Promise<string> {
    const stored = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.executionId, executionId));
    const files = await Promise.all(
      stored
        .flatMap((row) => [row.htmlPath, row.responsePath])
        .filter((file): file is string => file !== null)
        .map((file) => readFile(path.join(h.evidenceDir, file), 'utf8')),
    );
    return [
      h.logs.text(),
      JSON.stringify(await eventsOf(h, executionId)),
      JSON.stringify(stored),
      ...files,
    ].join('\n');
  }

  it('falha na tela do token: usuário, senha e token são apagados de tudo o que é gravado', async () => {
    const token = '24681357';
    const input = startInput(clientId);
    const { username } = input.credentials;
    // Uma tela que, por defeito, mostrasse usuário, senha e token.
    const leakyScreen = `<html><body>${username} ${TEST_PASSWORD} ${token}</body></html>`;

    const h = await harness({
      scenario: {
        tokenError: new ScreenNotRecognizedError(`tela inesperada para ${username}`, {
          evidence: { html: leakyScreen },
        }),
      },
    });

    const execution = await h.runner.start(input);
    await waitForStatus(execution.id, 'awaiting_2fa');
    h.runner.submitToken(execution.id, token);
    await h.runner.whenFinished(execution.id);

    const written = await writtenBy(h, execution.id);
    for (const secret of [username, TEST_PASSWORD, token]) {
      expect(written).not.toContain(secret);
    }
    expect(written).toContain(REDACTED);
    expect(h.secrets.size).toBe(0);
  });

  it('depois do acesso, senha e token são descartados e só o usuário segue protegido', async () => {
    const input = startInput(clientId);
    const { username } = input.credentials;
    const h = await harness({
      scenario: {
        listHotelsError: new ScreenNotRecognizedError('formato inesperado', {
          evidence: { response: `{"user":"${username}"}` },
        }),
      },
    });

    let registeredDuringCatalog = -1;
    h.hunit.before('listHotels', () => {
      registeredDuringCatalog = h.secrets.size;
    });

    const execution = await h.runner.start(input);
    await waitForStatus(execution.id, 'awaiting_2fa');
    h.runner.submitToken(execution.id, '123456');
    await h.runner.whenFinished(execution.id);

    // Durante a leitura do catálogo resta um registro (o do usuário); ao final, nenhum.
    expect(registeredDuringCatalog).toBe(1);
    expect(h.secrets.size).toBe(0);
    expect(await writtenBy(h, execution.id)).not.toContain(username);
  });
});
