/**
 * Servidor indisponível e de volta (specs/002, T072, FR-005, SC-006): o que estava na tela continua
 * visível com o horário, as ações ficam desabilitadas, e o app volta sozinho em até 30 s; aberto
 * com o servidor fora do ar, não mostra dados até conectar.
 */
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import { configureApp, launchApp, newUserDataDir, type LaunchedApp } from './app-fixture.js';

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;
let userDataDir: string;

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer();
  await server.insertHotel('H1', 'Hotel Praia');
  const { id: lastExecutionId } = await server.insertExecution({ clientId: server.operator.id });
  await server.insertReservation({
    hotelCode: 'H1',
    reservationNumber: '9001',
    guestName: 'Hóspede Fictício',
    lastExecutionId,
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
  await launched?.close();
  await tls?.close();
  await server?.close();
  await rm(userDataDir, { recursive: true, force: true });
});

describe('servidor indisponível (FR-005, SC-006)', () => {
  it(
    'mantém a lista com o horário, desabilita as ações e volta sozinho em até 30 s',
    { timeout: 120_000 },
    async () => {
      const { window } = launched;
      await window.getByRole('navigation').getByText('Reservas', { exact: true }).click();
      await window.getByText('9001').waitFor();

      await tls.stop();
      await window.getByText('Servidor indisponível', { exact: true }).waitFor({ timeout: 40_000 });
      await window.getByText(/dados de \d{2}:\d{2} — servidor indisponível/).waitFor();
      expect(await window.getByText('9001').isVisible()).toBe(true);
      expect(await window.getByRole('button', { name: 'Buscar' }).isDisabled()).toBe(true);

      const restartedAt = Date.now();
      await tls.start();
      await window
        .getByText('Servidor indisponível', { exact: true })
        .waitFor({ state: 'hidden', timeout: 30_000 });
      expect(Date.now() - restartedAt).toBeLessThanOrEqual(30_000);
      expect(await window.getByRole('button', { name: 'Buscar' }).isEnabled()).toBe(true);
    },
  );

  it(
    'aberto com o servidor fora do ar, não mostra dados até conectar',
    { timeout: 120_000 },
    async () => {
      await launched.close();
      await tls.stop();

      launched = await launchApp({ userDataDir });
      const { window } = launched;
      await window.getByText('Servidor indisponível', { exact: true }).waitFor({ timeout: 30_000 });
      expect(await window.getByText('9001').count()).toBe(0);

      await tls.start();
      await window
        .getByText('Servidor indisponível', { exact: true })
        .waitFor({ state: 'hidden', timeout: 30_000 });
      await window.getByRole('navigation').getByText('Reservas', { exact: true }).click();
      await window.getByText('9001').waitFor({ timeout: 15_000 });
    },
  );
});
