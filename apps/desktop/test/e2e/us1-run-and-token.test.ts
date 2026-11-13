/**
 * US1 de ponta a ponta (specs/002, T051, SC-002): configurar no primeiro uso, iniciar, receber o
 * pedido de token com a janela minimizada, responder e ver o resultado; senha errada, token recusado
 * e prazo do token esgotado com "Iniciar de novo". Servidor da 001 com o Hunit simulado, atrás do
 * terminador TLS.
 */
import { InvalidCredentialsError } from '../../../server/src/hunit/errors.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import type { FakeScenario } from '../../../server/test/helpers/fake-hunit-gateway.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import { configureApp, launchApp, notifications, type LaunchedApp } from './app-fixture.js';

const VALID_TOKEN = '246810';
const PASSWORD = 'SENHA-MARCADOR-E2E-US1';

const SCENARIO: FakeScenario = {
  validToken: VALID_TOKEN,
  hotels: [
    {
      code: '31',
      name: 'Hotel Praia',
      reservations: [
        { reservationNumber: '3101', listing: { checkIn: '2026-11-03' } },
        { reservationNumber: '3102', listing: { checkIn: '2026-11-04' } },
      ],
    },
  ],
};

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer({ scenario: SCENARIO, twoFactorTimeoutMs: 8_000 });
  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp();
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
});

async function windowState() {
  return launched.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { minimized: window?.isMinimized(), visible: window?.isVisible() };
  });
}

async function fillAccessAndPeriod(password = PASSWORD) {
  const { window } = launched;
  const username = window.getByLabel('Usuário do Hunit');
  if (await username.isVisible()) {
    await username.fill('operador@hotel.test');
    await window.getByLabel('Senha do Hunit').fill(password);
  }
  await window.getByLabel('Check-in de').fill('01/11/2026');
  await window.getByLabel('Check-in até').fill('07/11/2026');
  await window.getByLabel('Check-in até').press('Tab');
}

async function waitForDialog() {
  await launched.window.getByText('O Hunit pediu o token').waitFor({ timeout: 10_000 });
}

async function closeDialog() {
  await launched.window.getByRole('button', { name: 'Fechar' }).click();
}

describe('US1 — executar e responder ao token', () => {
  it('primeiro uso: a configuração confirmada leva à tela Executar (cenário 1)', async () => {
    await launched.window.getByRole('button', { name: 'Iniciar execução' }).waitFor();
  });

  it('com a janela minimizada, o pedido de token avisa em até 5 s e o token aceito leva ao resultado (SC-002)', async () => {
    const { app, window } = launched;
    await fillAccessAndPeriod();
    await window.getByRole('button', { name: 'Iniciar execução' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());

    await waitForDialog();
    await vi.waitFor(async () =>
      expect(await windowState()).toEqual({ minimized: false, visible: true }),
    );
    expect((await notifications(app)).map((item) => item.title)).toContain('O Hunit pediu o token');
    expect(await window.getByText(/^\d+:\d{2}$/).count()).toBeGreaterThan(0);

    await window.getByLabel('Token do autenticador').fill(VALID_TOKEN);
    await window.getByRole('button', { name: 'Enviar token' }).click();
    await window.getByText(/token aceito/i).waitFor({ timeout: 10_000 });
    await closeDialog();

    await window.getByText('Resultado da execução').waitFor({ timeout: 20_000 });
    await vi.waitFor(async () =>
      expect((await notifications(app)).map((item) => item.title)).toContain('Execução concluída'),
    );
    // O usuário continua preenchido depois de iniciar (cenário 6), e a senha não aparece.
    await window.getByText(/senha guardada/i).waitFor();
    expect(await window.locator('body').innerText()).not.toContain(PASSWORD);
  });

  it('token recusado: o diálogo explica e o resultado mostra o motivo (FR-013)', async () => {
    const { window } = launched;
    await window.getByRole('button', { name: 'Iniciar execução' }).click();
    await waitForDialog();

    await window.getByLabel('Token do autenticador').fill('111111');
    await window.getByRole('button', { name: 'Enviar token' }).click();

    // O desfecho aparece no próprio diálogo (o servidor volta a running antes de o Hunit
    // recusar; o pedido não pode fechar como aceito).
    await window
      .getByRole('dialog', { name: 'O Hunit pediu o token' })
      .getByText('O Hunit recusou o token.')
      .waitFor({ timeout: 10_000 });
    await closeDialog();
    await window.getByRole('button', { name: 'Iniciar de novo' }).waitFor();
  });

  it('prazo do token esgotado: mensagem e "Iniciar de novo" com os mesmos dados (cenário 5)', async () => {
    const { window } = launched;
    const before = server.hunit.sessions.length;
    await window.getByRole('button', { name: 'Iniciar execução' }).click();
    await waitForDialog();

    await window.getByText('O prazo para informar o token terminou.').first().waitFor({
      timeout: 20_000,
    });
    await closeDialog();
    await window.getByRole('button', { name: 'Iniciar de novo' }).click();

    await waitForDialog();
    await vi.waitFor(() => expect(server.hunit.sessions.length).toBe(before + 2));
    const searches = server.hunit.callsTo('searchReservations');
    expect(searches.every((call) => call.period.from === '2026-11-01')).toBe(true);
    await window.getByLabel('Token do autenticador').fill(VALID_TOKEN);
    await window.getByRole('button', { name: 'Enviar token' }).click();
    await window.getByText(/token aceito/i).waitFor({ timeout: 10_000 });
    await closeDialog();
    await window.getByText('Resultado da execução').waitFor({ timeout: 20_000 });
  });

  it('senha errada: mensagem clara, sem a senha, com os campos para correção (cenário 8)', async () => {
    const { window } = launched;
    server.setScenario({ ...SCENARIO, login: new InvalidCredentialsError() });
    try {
      await window.getByRole('button', { name: 'Limpar acesso' }).click();
      await fillAccessAndPeriod('SENHA-ERRADA-MARCADOR');
      await window.getByRole('button', { name: 'Iniciar execução' }).click();

      await window.getByText('Usuário ou senha do Hunit incorretos.').waitFor({ timeout: 15_000 });
      expect(await window.locator('body').innerText()).not.toContain('SENHA-ERRADA-MARCADOR');
      await window.getByRole('button', { name: 'Limpar acesso' }).waitFor();
    } finally {
      server.setScenario(SCENARIO);
    }
  });
});
