/**
 * Teste de segurança da SC-004 (T059, research R-12): nenhuma ocorrência de usuário, senha ou
 * token do Hunit em nada do que o servidor grava.
 *
 * Roda pela API HTTP, com o Hunit simulado, os fluxos da US1 e da US2 (acesso, token errado,
 * telas não reconhecidas no login, no token, na listagem e no detalhe, hotel com falha e
 * retomada), usando valores marcadores fáceis de procurar. As telas e respostas simuladas
 * "vazam" esses valores de propósito, como faria uma tela do Hunit que mostrasse o usuário ou
 * uma mensagem de erro que repetisse a senha. Depois, procura os marcadores em:
 *
 * - todas as linhas de log;
 * - todas as linhas de todas as tabelas do banco;
 * - todos os arquivos da pasta de evidências.
 *
 * Fica para a T021: repetir com o gateway real contra as fixtures anonimizadas do Hunit.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScreenNotRecognizedError } from '../../src/hunit/errors.js';
import { REDACTED } from '../../src/secrets.js';
import { createTestApp, type TestApp, type TestClient } from '../helpers/app.js';
import type { FakeScenario } from '../helpers/fake-hunit-gateway.js';

const USERNAME = 'sc004.marcador@hotel.test';
const PASSWORD = 'SC004-Senha-Marcadora-q7Z';
const TOKEN = '73915824';
const WRONG_TOKEN = '55501234';
const RESUME_USERNAME = 'sc004.retomada@hotel.test';
const RESUME_PASSWORD = 'SC004-Senha-Retomada-k2P';
const RESUME_TOKEN = '86420975';

const SECRETS = [
  USERNAME,
  PASSWORD,
  TOKEN,
  WRONG_TOKEN,
  RESUME_USERNAME,
  RESUME_PASSWORD,
  RESUME_TOKEN,
];

/** Tela que, por defeito, mostrasse tudo o que foi digitado. */
const leakyScreen = (username: string, password: string, token = '') =>
  `<html><body><p>${username}</p><input name="password" value="${password}">` +
  `<input name="otp" value="${token}"><p>${password} ${token}</p></body></html>`;

/** Hotéis do acesso completo: um com reserva ilegível, outro que falha na listagem. */
function fullScenario(username: string, token: string): FakeScenario {
  return {
    validToken: token,
    hotels: [
      {
        code: '41',
        name: 'Hotel Quarenta e Um',
        reservations: [
          { reservationNumber: '4101', listing: { checkIn: '2026-11-03' } },
          {
            reservationNumber: '4102',
            listing: { checkIn: '2026-11-04' },
            detail: new ScreenNotRecognizedError(`detalhe inesperado para ${username}`, {
              evidence: { response: JSON.stringify({ operador: username }) },
            }),
          },
        ],
      },
      {
        code: '42',
        name: 'Hotel Quarenta e Dois',
        searchError: new ScreenNotRecognizedError('listagem inesperada', {
          evidence: { response: JSON.stringify({ usuario: username }) },
        }),
      },
    ],
  };
}

let test: TestApp;
let operator: TestClient;

beforeAll(async () => {
  test = await createTestApp();
  operator = await test.createClient('operator');
});

afterAll(async () => {
  await test.close();
});

async function post(url: string, payload: Record<string, unknown>) {
  return test.app.inject({ method: 'POST', url, headers: operator.headers, payload });
}

async function startExecution(username: string, password: string): Promise<string> {
  const response = await post('/v1/executions', {
    credentials: { username, password },
    period: { from: '2026-11-01', to: '2026-11-07' },
  });
  expect(response.statusCode).toBe(202);
  return response.json<{ id: string }>().id;
}

async function sendToken(executionId: string, token: string) {
  await vi.waitFor(
    async () => {
      const response = await post(`/v1/executions/${executionId}/two-factor`, { token });
      expect(response.statusCode).toBe(202);
    },
    { timeout: 5_000, interval: 20 },
  );
}

async function finishedStatus(executionId: string) {
  await test.harness.runner.whenFinished(executionId);
  const response = await test.app.inject({
    method: 'GET',
    url: `/v1/executions/${executionId}`,
    headers: operator.headers,
  });
  return response.json<{ status: string; endReason: string | null }>();
}

/** Todas as linhas de todas as tabelas, como texto. */
async function databaseDump(): Promise<string> {
  const tables = await test.database.db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  const dumps: string[] = [];
  for (const { table_name: table } of tables.rows) {
    const rows = await test.database.db.execute<{ row: string }>(
      sql`select row_to_json(t)::text as row from ${sql.identifier(table)} t`,
    );
    dumps.push(...rows.rows.map((row) => row.row));
  }
  return dumps.join('\n');
}

/** Conteúdo de todos os arquivos da pasta de evidências (binários lidos byte a byte). */
async function evidenceFiles(): Promise<string[]> {
  const dir = test.harness.evidenceDir;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(path.join(entry.parentPath, entry.name), 'latin1')),
  );
}

describe('SC-004: usuário, senha e token fora de logs, banco e evidências', () => {
  beforeAll(async () => {
    const hunit = test.harness.hunit;

    // 1. Tela de login não reconhecida, mostrando usuário e senha.
    hunit.scenario = {
      login: new ScreenNotRecognizedError(`tela inesperada para ${USERNAME}`, {
        evidence: { html: leakyScreen(USERNAME, PASSWORD) },
      }),
    };
    const loginFailure = await startExecution(USERNAME, PASSWORD);
    expect(await finishedStatus(loginFailure)).toMatchObject({
      status: 'failed',
      endReason: 'hunit_screen_not_recognized',
    });

    // 2. Token errado.
    hunit.scenario = { validToken: TOKEN };
    const wrongToken = await startExecution(USERNAME, PASSWORD);
    await sendToken(wrongToken, WRONG_TOKEN);
    expect(await finishedStatus(wrongToken)).toMatchObject({
      status: 'failed',
      endReason: 'invalid_token',
    });

    // 3. Tela do token não reconhecida, mostrando usuário, senha e token.
    hunit.scenario = {
      tokenError: new ScreenNotRecognizedError(`token ${TOKEN} de ${USERNAME} não aceito`, {
        evidence: { html: leakyScreen(USERNAME, PASSWORD, TOKEN) },
      }),
    };
    const tokenFailure = await startExecution(USERNAME, PASSWORD);
    await sendToken(tokenFailure, TOKEN);
    expect(await finishedStatus(tokenFailure)).toMatchObject({
      status: 'failed',
      endReason: 'hunit_screen_not_recognized',
    });

    // 4. Acesso completo: reserva ilegível (erro de análise) e hotel com falha na listagem.
    hunit.scenario = fullScenario(USERNAME, TOKEN);
    const full = await startExecution(USERNAME, PASSWORD);
    await sendToken(full, TOKEN);
    expect(await finishedStatus(full)).toMatchObject({ status: 'completed' });

    // 5. Retomada do hotel que falhou, com outra conta.
    hunit.scenario = fullScenario(RESUME_USERNAME, RESUME_TOKEN);
    const resumed = await post(`/v1/executions/${full}/resume`, {
      credentials: { username: RESUME_USERNAME, password: RESUME_PASSWORD },
    });
    expect(resumed.statusCode).toBe(202);
    const resumedId = resumed.json<{ id: string }>().id;
    await sendToken(resumedId, RESUME_TOKEN);
    expect(await finishedStatus(resumedId)).toMatchObject({ status: 'completed' });
  });

  it('os fluxos geraram o que procurar: logs, linhas no banco e evidências', async () => {
    expect(test.logs.lines.length).toBeGreaterThan(0);
    const files = await evidenceFiles();
    // Login, token, reserva ilegível e hotel com falha (duas vezes, com a retomada).
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.join('\n')).toContain(REDACTED);
    expect(await databaseDump()).toContain('"reservation_number":"4101"');
  });

  it.each(SECRETS)('nenhuma linha de log contém "%s"', (secret) => {
    expect(test.logs.text()).not.toContain(secret);
  });

  it.each(SECRETS)('nenhuma linha do banco contém "%s"', async (secret) => {
    expect(await databaseDump()).not.toContain(secret);
  });

  it.each(SECRETS)('nenhum arquivo de evidência contém "%s"', async (secret) => {
    for (const content of await evidenceFiles()) {
      expect(content).not.toContain(secret);
    }
  });

  it('nenhum segredo fica registrado na memória depois das execuções', () => {
    expect(test.secrets.size).toBe(0);
  });
});
