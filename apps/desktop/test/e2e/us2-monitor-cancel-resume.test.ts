/**
 * US2 de ponta a ponta (specs/002, T060, FR-012, FR-015 a FR-019, FR-016a, FR-026): acompanhar uma
 * execução de vários hotéis com aviso de nova tentativa, cancelar, retomar só os hotéis que
 * faltaram, ver a execução de outra máquina sem receber o pedido de token dela, execução já ativa
 * na conta e fechar e reabrir o app com o pedido de token reaparecendo.
 */
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import type { FakeScenario } from '../../../server/test/helpers/fake-hunit-gateway.js';
import type { TestClient } from '../../../server/test/helpers/app.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  launchApp,
  newUserDataDir,
  stubMessageBox,
  type LaunchedApp,
} from './app-fixture.js';

const VALID_TOKEN = '246810';
const USERNAME = 'operador@hotel.test';

const SCENARIO: FakeScenario = {
  validToken: VALID_TOKEN,
  hotels: ['31', '32', '33'].map((code) => ({
    code,
    name: `Hotel ${code}`,
    reservations: [
      { reservationNumber: `${code}01`, listing: { checkIn: '2026-11-03' } },
      { reservationNumber: `${code}02`, listing: { checkIn: '2026-11-04' } },
    ],
  })),
};

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;
let userDataDir: string;

/** Leitura de reservas de um hotel travada até o teste liberar. */
let gate: { hotelCode: string; reached: () => void; released: Promise<void> } | null = null;

function hold(hotelCode: string) {
  let release: () => void = () => undefined;
  let reached: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  gate = { hotelCode, reached, released };
  return {
    reached: reachedPromise,
    release: () => {
      gate = null;
      release();
    },
  };
}

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer({ scenario: SCENARIO, twoFactorTimeoutMs: 120_000 });
  server.hunit.before('readReservation', async (call) => {
    const current = gate;
    if (!current || current.hotelCode !== call.hotelCode) return;
    current.reached();
    await current.released;
  });
  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  userDataDir = await newUserDataDir();
  launched = await launchApp({ userDataDir });
  await configureApp(launched, {
    serverUrl: tls.url,
    certificatePem: certificates.authority.certificatePem,
    apiKey: server.operator.apiKey,
  });
});

afterAll(async () => {
  gate = null;
  await launched?.close();
  await tls?.close();
  await server?.close();
  await rm(userDataDir, { recursive: true, force: true });
});

async function goTo(area: 'Executar' | 'Execuções') {
  await launched.window.getByRole('navigation').getByText(area, { exact: true }).click();
}

async function startFromRunScreen() {
  const { window } = launched;
  await goTo('Executar');
  const username = window.getByLabel('Usuário do Hunit');
  if (await username.isVisible()) {
    await username.fill(USERNAME);
    await window.getByLabel('Senha do Hunit').fill('SENHA-MARCADOR-E2E-US2');
  }
  await window.getByLabel('Check-in de').fill('01/11/2026');
  await window.getByLabel('Check-in até').fill('07/11/2026');
  await window.getByLabel('Check-in até').press('Tab');
  await window.getByRole('button', { name: 'Iniciar execução' }).click();
}

async function answerToken() {
  const { window } = launched;
  const dialog = window.getByRole('dialog', { name: 'O Hunit pediu o token' });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Token do autenticador').fill(VALID_TOKEN);
  await dialog.getByRole('button', { name: 'Enviar token' }).click();
  await dialog.getByText(/token aceito/i).waitFor({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Fechar' }).click();
}

/** Inicia uma execução direto pela API, como outra máquina faria. */
async function startElsewhere(client: TestClient, username: string): Promise<string> {
  const response = await fetch(`${server.url}/v1/executions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${client.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      credentials: { username, password: 'OUTRA-SENHA' },
      period: { from: '2026-11-01', to: '2026-11-07' },
    }),
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { id: string }).id;
}

async function sendTokenElsewhere(client: TestClient, executionId: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const response = await fetch(`${server.url}/v1/executions/${executionId}/two-factor`, {
        method: 'POST',
        headers: { authorization: `Bearer ${client.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ token: VALID_TOKEN }),
      });
      expect(response.status).toBe(202);
    },
    { timeout: 10_000, interval: 200 },
  );
}

describe('US2 — acompanhar, cancelar e retomar', () => {
  it(
    'acompanha com aviso de nova tentativa, cancela e retoma só os hotéis que faltaram',
    { timeout: 120_000 },
    async () => {
      const { window } = launched;
      const held = hold('32');
      server.notifyRetryOnNextRead('31');

      await startFromRunScreen();
      await answerToken();
      await held.reached;

      await goTo('Execuções');
      await window
        .getByRole('row', { name: /Em andamento/ })
        .first()
        .click();
      const detail = window.getByTestId('execution-detail');
      await detail.getByText(/Hotel atual/).waitFor({ timeout: 10_000 });
      await detail
        .getByTestId('execution-warnings')
        .getByText(/Nova tentativa 1 de 5/)
        .waitFor({ timeout: 5_000 });

      await detail.getByRole('button', { name: 'Cancelar execução' }).click();
      await window.getByRole('button', { name: 'Sim, cancelar' }).click();
      held.release();
      await detail.getByText('Cancelada', { exact: true }).first().waitFor({ timeout: 20_000 });

      const sessionsBefore = server.hunit.sessions.length;
      await detail.getByRole('button', { name: 'Retomar' }).click();
      await answerToken();
      await detail.getByRole('button', { name: 'Abrir a retomada' }).click();
      await detail.getByRole('button', { name: /Retomada de/ }).waitFor();
      await detail.getByText('Concluída', { exact: true }).first().waitFor({ timeout: 20_000 });

      const resumedHotels = server.hunit
        .callsTo('searchReservations')
        .filter((call) => call.session > sessionsBefore)
        .map((call) => call.hotelCode);
      expect(new Set(resumedHotels)).toEqual(new Set(['32', '33']));
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();
    },
  );

  it(
    'execução iniciada em outra máquina aparece na lista, sem pedido de token neste app (FR-012)',
    { timeout: 90_000 },
    async () => {
      const { window } = launched;
      const other = await server.createClient('operator');
      const id = await startElsewhere(other, 'controladoria@hotel.test');

      await goTo('Execuções');
      await window
        .getByRole('row', { name: new RegExp(`${other.name}.*Aguardando token`) })
        .waitFor({ timeout: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(await window.getByRole('dialog', { name: 'O Hunit pediu o token' }).count()).toBe(0);

      await sendTokenElsewhere(other, id);
    },
  );

  it(
    'execução já ativa na mesma conta leva à execução ativa (cenário 6)',
    { timeout: 90_000 },
    async () => {
      const { window } = launched;
      const other = await server.createClient('operator');
      const id = await startElsewhere(other, USERNAME);

      await startFromRunScreen();
      await window.getByText(/Já existe uma execução ativa/).waitFor({ timeout: 10_000 });
      await window.getByRole('button', { name: 'Ver a execução ativa' }).click();
      await window.getByTestId('execution-detail').waitFor();
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();

      await sendTokenElsewhere(other, id);
      await vi.waitFor(
        async () => {
          const response = await fetch(`${server.url}/v1/executions/${id}`, {
            headers: { authorization: `Bearer ${other.apiKey}` },
          });
          expect(((await response.json()) as { status: string }).status).toBe('completed');
        },
        { timeout: 20_000, interval: 300 },
      );
    },
  );

  it(
    'fechar com execução aguardando token avisa; ao reabrir, o pedido reaparece (FR-026, FR-019)',
    { timeout: 120_000 },
    async () => {
      await startFromRunScreen();
      await launched.window
        .getByRole('dialog', { name: 'O Hunit pediu o token' })
        .waitFor({ timeout: 10_000 });

      // Primeiro o operador desiste de fechar: o aviso aparece e o app continua aberto.
      await stubMessageBox(launched.app, 1);
      await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
      await vi.waitFor(async () => {
        const messages = await launched.app.evaluate(
          () =>
            ((globalThis as Record<string, unknown>)['__hunitTest'] as { messageBoxes?: string[] })
              .messageBoxes ?? [],
        );
        expect(messages.join(' ')).toContain('o pedido de token não será recebido');
      });
      expect(launched.app.windows()).toHaveLength(1);

      // Depois confirma: o app fecha.
      await stubMessageBox(launched.app, 0);
      const closed = new Promise<void>((resolve) => launched.app.once('close', () => resolve()));
      await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
      await closed;

      launched = await launchApp({ userDataDir });
      const dialog = launched.window.getByRole('dialog', { name: 'O Hunit pediu o token' });
      await dialog.waitFor({ timeout: 20_000 });
      const remaining = await dialog.getByText(/^\d+:\d{2}$/).innerText();
      expect(Number(remaining.split(':')[0])).toBeGreaterThanOrEqual(1);

      // A senha não fica no disco: o cofre voltou vazio, mas o token pode ser enviado.
      await dialog.getByLabel('Token do autenticador').fill(VALID_TOKEN);
      await dialog.getByRole('button', { name: 'Enviar token' }).click();
      await dialog.getByText(/token aceito/i).waitFor({ timeout: 10_000 });
    },
  );
});
