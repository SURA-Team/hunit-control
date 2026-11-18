/**
 * Envio ao Comercial de ponta a ponta (specs/005, T039; US1 cenários 1 e 2, research R-14): o app
 * compilado, contra a API com o Hunit simulado e a planilha do Comercial em memória, envia 3
 * reservas, informa o token pelo aviso comum e acompanha até "Concluído", com 1 retirada (o Hunit
 * passou a mostrá-la como cobrada). A planilha recebe as 2 enviadas, sem o nome do hóspede.
 * Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { reservationDetails } from '../../../server/test/helpers/fake-hunit-gateway.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  daysFromToday,
  isoDate,
  launchApp,
  notifications,
  type LaunchedApp,
} from './app-fixture.js';

const VALID_TOKEN = '135790';
const GUEST_MARKER = 'HOSPEDE-MARCADOR-E2E-ENVIO';
const CHECK_IN = isoDate(daysFromToday(2));

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer({
    commercialSheet: true,
    twoFactorTimeoutMs: 20_000,
    scenario: {
      validToken: VALID_TOKEN,
      hotels: [
        {
          code: '31',
          name: 'Hotel Praia',
          reservations: [
            { reservationNumber: '3101', listing: { checkIn: CHECK_IN } },
            { reservationNumber: '3102', listing: { checkIn: CHECK_IN } },
            {
              reservationNumber: '3103',
              listing: { checkIn: CHECK_IN },
              detail: reservationDetails.alreadyCharged(),
            },
          ],
        },
      ],
    },
  });
  await server.insertHotel('31', 'Hotel Praia');
  const execution = await server.insertExecution({
    clientId: server.operator.id,
    status: 'completed',
    finishedAt: new Date(),
  });
  for (const number of ['3101', '3102', '3103']) {
    await server.insertReservation({
      lastExecutionId: execution.id,
      hotelCode: '31',
      reservationNumber: number,
      guestName: `${GUEST_MARKER} ${number}`,
      checkIn: CHECK_IN,
      totalAmount: '100.00',
    });
  }
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

describe('envio ao Comercial (US1)', () => {
  it('envia 3, informa o token pelo aviso e acompanha até "Concluído" com 1 retirada', async () => {
    const { window, app } = launched;
    await window.getByRole('navigation').getByText('Reservas', { exact: true }).click();
    await window.getByRole('cell', { name: '3103', exact: true }).waitFor();
    await window.getByRole('checkbox', { name: 'Selecionar todas as reservas listadas' }).check();
    await window.getByRole('button', { name: 'Enviar ao Comercial' }).click();

    const dialog = window.getByRole('dialog', { name: 'Enviar ao Comercial' });
    await dialog.getByText('3 reservas aceitas', { exact: false }).waitFor();
    await dialog.getByLabel('Usuário do Hunit').fill('operador@hotel.test');
    await dialog.getByLabel('Senha do Hunit').fill('SENHA-MARCADOR-E2E-ENVIO');
    await dialog.getByRole('button', { name: 'Enviar 3 ao Comercial' }).click();

    // O mesmo aviso do token das execuções, identificado como envio.
    await window.getByText('O Hunit pediu o token').waitFor({ timeout: 15_000 });
    const tokenDialog = window.getByRole('dialog', { name: /O Hunit pediu o token/ });
    await tokenDialog.getByText('Envio ao Comercial').waitFor();
    await tokenDialog.getByLabel('Token do autenticador').fill(VALID_TOKEN);
    await tokenDialog.getByRole('button', { name: 'Enviar token' }).click();
    await window.getByText('Token aceito pelo Hunit. O envio ao Comercial continua.').waitFor({
      timeout: 15_000,
    });
    await tokenDialog.getByRole('button', { name: 'Fechar', exact: true }).click();

    const view = dialog.getByTestId('dispatch-view');
    await view.getByText('Concluído', { exact: true }).waitFor({ timeout: 20_000 });
    await expect.poll(() => view.textContent()).toContain('3 de 3 verificadas');
    expect(await view.textContent()).toContain('2 enviada(s) · 1 retirada(s) · 0 não');
    expect(await view.getByText('Retirada', { exact: true }).count()).toBe(1);

    // A notificação de fim chega como nas execuções.
    await expect
      .poll(async () => (await notifications(app)).map((item) => item.title))
      .toContain('Envio ao Comercial concluído');

    // A planilha recebe as 2 enviadas, sem o nome do hóspede (FR-010).
    expect((await server.test.sync?.runRound())?.ok).toBe(true);
    const rows = server.sheet?.rows('toCharge') ?? [];
    expect(rows.map((row) => row[1]).sort()).toEqual(['3101', '3102']);
    expect(JSON.stringify(rows)).not.toContain(GUEST_MARKER);
  });
});
