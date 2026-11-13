/**
 * Nada sensível no disco (specs/002, T073, SC-004, FR-007, FR-008a, research R-14): depois de um
 * ciclo completo — execução com token, cancelamento e retomada, senha errada, token errado e
 * consulta de reservas —, nenhum arquivo da pasta de dados do app (nem a de minidumps) contém a
 * senha, o token, a chave da API em texto puro ou os nomes de hóspedes exibidos.
 */
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvalidCredentialsError } from '../../../server/src/hunit/errors.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import type { FakeScenario } from '../../../server/test/helpers/fake-hunit-gateway.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  launchApp,
  newUserDataDir,
  type LaunchedApp,
  daysFromToday,
  isoDate,
  pickPeriod,
} from './app-fixture.js';

const PASSWORD = 'SenhaMarcadorDisco7781';
const WRONG_PASSWORD = 'SenhaErradaMarcador5530';
const TOKEN = '97531864';
const WRONG_TOKEN = '86420975';
const GUESTS = ['Hospede Marcador Zeta', 'Hospede Marcador Omega'];

const SCENARIO: FakeScenario = {
  validToken: TOKEN,
  hotels: ['31', '32'].map((code, index) => ({
    code,
    name: `Hotel ${code}`,
    reservations: [
      {
        reservationNumber: `${code}01`,
        listing: { checkIn: isoDate(daysFromToday(1)), guestName: GUESTS[index] ?? 'x' },
      },
    ],
  })),
};

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;
let userDataDir: string;
let crashDumpsDir: string;
/** Leitura do hotel 32 travada até o teste liberar (para cancelar no meio). */
let holdState: { reached: () => void; released: Promise<void> } | null = null;

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer({ scenario: SCENARIO, twoFactorTimeoutMs: 120_000 });
  server.hunit.before('readReservation', async (call) => {
    const current = holdState;
    if (!current || call.hotelCode !== '32') return;
    holdState = null;
    current.reached();
    await current.released;
  });
  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  userDataDir = await newUserDataDir();
  launched = await launchApp({ userDataDir });
  crashDumpsDir = await launched.app.evaluate(({ app }) => app.getPath('crashDumps'));
  await configureApp(launched, {
    serverUrl: tls.url,
    certificatePem: certificates.authority.certificatePem,
    apiKey: server.operator.apiKey,
  });
});

afterAll(async () => {
  await launched?.close();
  await tls?.close();
  await server?.close();
  await rm(userDataDir, { recursive: true, force: true });
});

function holdHotel32() {
  let release: () => void = () => undefined;
  let reached: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  holdState = { reached, released };
  return { reached: reachedPromise, release: () => release() };
}

async function goTo(area: string) {
  await launched.window.getByRole('navigation').getByText(area, { exact: true }).click();
}

async function start(password: string) {
  const { window } = launched;
  await goTo('Executar');
  if (await window.getByRole('button', { name: 'Limpar acesso' }).isVisible()) {
    await window.getByRole('button', { name: 'Limpar acesso' }).click();
  }
  await window.getByLabel('Usuário do Hunit').fill('operador@hotel.test');
  await window.getByLabel('Senha do Hunit').fill(password);
  await pickPeriod(window, daysFromToday(0), daysFromToday(6));
  await window.getByRole('button', { name: 'Iniciar execução' }).click();
}

async function answer(token: string, outcome: RegExp) {
  const dialog = launched.window.getByRole('dialog', { name: 'O Hunit pediu o token' });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Token do autenticador').fill(token);
  await dialog.getByRole('button', { name: 'Enviar token' }).click();
  await dialog.getByText(outcome).waitFor({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Fechar' }).click();
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** Procura o texto em UTF-8 e em UTF-16 (como o Chromium grava parte dos dados). */
function contains(content: Buffer, text: string): boolean {
  return (
    content.includes(Buffer.from(text, 'utf8')) || content.includes(Buffer.from(text, 'utf16le'))
  );
}

describe('nada sensível no disco (SC-004)', () => {
  it(
    'depois de um ciclo completo, nenhum arquivo do app tem senha, token, chave ou hóspede',
    { timeout: 240_000 },
    async () => {
      const { window } = launched;

      // Execução com token aceito.
      await start(PASSWORD);
      await answer(TOKEN, /token aceito/i);
      await window.getByText('Resultado da execução').waitFor({ timeout: 20_000 });

      // Cancelamento e retomada.
      const hold = holdHotel32();
      await start(PASSWORD);
      await answer(TOKEN, /token aceito/i);
      await hold.reached;
      await goTo('Execuções');
      await window
        .getByRole('row', { name: /Em andamento/ })
        .first()
        .click();
      const detail = window.getByTestId('execution-detail');
      await detail.getByRole('button', { name: 'Cancelar execução' }).click();
      await window.getByRole('button', { name: 'Sim, cancelar' }).click();
      hold.release();
      await detail.getByRole('button', { name: 'Retomar' }).waitFor({ timeout: 20_000 });
      await detail.getByRole('button', { name: 'Retomar' }).click();
      await answer(TOKEN, /token aceito/i);
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();

      // Token errado.
      await start(PASSWORD);
      await answer(WRONG_TOKEN, /recusou o token/i);

      // Senha errada.
      server.setScenario({ ...SCENARIO, login: new InvalidCredentialsError() });
      await start(WRONG_PASSWORD);
      await window
        .getByText('Usuário ou senha do Hunit incorretos.')
        .first()
        .waitFor({ timeout: 15_000 });
      server.setScenario(SCENARIO);

      // Consulta de reservas com os nomes dos hóspedes na tela.
      await goTo('Reservas');
      await window.getByRole('button', { name: 'Buscar' }).click();
      for (const guest of GUESTS)
        await window.getByText(guest).first().waitFor({ timeout: 10_000 });

      await launched.close();

      const files = [...(await filesUnder(userDataDir)), ...(await filesUnder(crashDumpsDir))];
      expect(files.length).toBeGreaterThan(0);
      const secrets = [
        PASSWORD,
        WRONG_PASSWORD,
        TOKEN,
        WRONG_TOKEN,
        server.operator.apiKey,
        ...GUESTS,
      ];
      const leaks: string[] = [];
      for (const file of files) {
        if ((await stat(file)).size > 50 * 1024 * 1024) continue;
        const content = await readFile(file);
        for (const secret of secrets) {
          if (contains(content, secret))
            leaks.push(`${path.relative(userDataDir, file)}: ${secret.slice(0, 6)}…`);
        }
      }
      expect(leaks).toEqual([]);

      const config = JSON.parse(await readFile(path.join(userDataDir, 'config.json'), 'utf8')) as {
        apiKey: { ciphertext: string };
      };
      expect(config.apiKey.ciphertext.length).toBeGreaterThan(0);
    },
  );
});
