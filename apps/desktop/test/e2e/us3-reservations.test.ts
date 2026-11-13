/**
 * US3 de ponta a ponta (specs/002, T071, FR-020 a FR-024, SC-005, SC-009): achar uma reserva pelo
 * código de autorização e pelo valor do extrato sem saber o hotel, pelo nome sem acento, filtrar
 * por canal, abrir o detalhe e salvar uma evidência; com a chave de consulta, nenhuma ação de
 * operador aparece. Reservas fictícias inseridas pelo servidor de teste.
 */
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import { configureApp, launchApp, stubSaveDialog, type LaunchedApp } from './app-fixture.js';

let certificates: TestCertificates;
let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;
let executionId: string;

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startE2eServer();
  await server.insertHotel('H1', 'Hotel Praia');
  await server.insertHotel('H2', 'Pousada Serra');
  const execution = await server.insertExecution({
    clientId: server.operator.id,
    status: 'failed',
    endReason: 'hunit_screen_not_recognized',
    finishedAt: new Date(),
  });
  executionId = execution.id;
  const base = { lastExecutionId: executionId };
  await server.insertReservation({
    ...base,
    hotelCode: 'H1',
    reservationNumber: '258-1234',
    guestName: 'João Silva',
    channel: 'Booking.com',
    authorizationCode: 'AUT-0042',
    totalAmount: '1234.50',
  });
  await server.insertReservation({
    ...base,
    hotelCode: 'H2',
    reservationNumber: '7001',
    guestName: 'Maria Souza',
    channel: 'Expedia',
    totalAmount: '500.00',
    chargedAmount: '987.65',
  });
  await server.test.harness.evidence.save({
    executionId,
    hotelCode: 'H2',
    kind: 'screen_not_recognized',
    reason: 'Tela do Hunit não reconhecida.',
    material: { screenshot: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  });
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

async function goTo(window: LaunchedApp['window'], area: string) {
  await window.getByRole('navigation').getByText(area, { exact: true }).click();
}

async function searchFor(window: LaunchedApp['window'], fields: { q?: string; amount?: string }) {
  await window.getByRole('button', { name: 'Limpar' }).click();
  if (fields.q) await window.getByLabel('Busca livre').fill(fields.q);
  if (fields.amount) await window.getByLabel('Valor (R$)').fill(fields.amount);
  await window.getByRole('button', { name: 'Buscar' }).click();
}

function resultRows(window: LaunchedApp['window']) {
  return window.locator('tbody tr');
}

describe('US3 — consultar reservas e evidências', () => {
  it('acha pelo código de autorização e pelo valor do extrato, sem informar o hotel (cenário 2)', async () => {
    const { window } = launched;
    await goTo(window, 'Reservas');

    await searchFor(window, { q: 'aut-0042' });
    await resultRows(window).filter({ hasText: '258-1234' }).waitFor();
    expect(await resultRows(window).count()).toBe(1);

    await searchFor(window, { amount: '987,65' });
    await resultRows(window).filter({ hasText: '7001' }).waitFor();
    expect(await resultRows(window).count()).toBe(1);
  });

  it('acha pelo nome sem acento e filtra por canal', async () => {
    const { window } = launched;
    await searchFor(window, { q: 'joao' });
    await resultRows(window).filter({ hasText: 'João Silva' }).waitFor();
    expect(await resultRows(window).count()).toBe(1);

    await window.getByRole('button', { name: 'Limpar' }).click();
    await window.getByPlaceholder('Todos os canais').click();
    await window.getByRole('option', { name: 'Expedia' }).click();
    await window.getByRole('button', { name: 'Buscar' }).click();
    await resultRows(window).filter({ hasText: 'Maria Souza' }).waitFor();
    expect(await resultRows(window).count()).toBe(1);
  });

  it('abre o detalhe com os dados da cobrança', async () => {
    const { window } = launched;
    await resultRows(window).filter({ hasText: 'Maria Souza' }).click();
    const detail = window.getByTestId('reservation-detail');
    await detail.getByText('Valor cobrado').waitFor();
    expect(await detail.innerText()).toContain('987,65');
    await window.getByRole('button', { name: 'Fechar detalhe' }).click();
  });

  it('salva a evidência de um hotel que falhou onde o operador escolher (FR-024)', async () => {
    const { app, window, userDataDir } = launched;
    const target = path.join(userDataDir, 'evidencia-salva.png');
    await stubSaveDialog(app, target);

    await goTo(window, 'Execuções');
    await window
      .getByRole('row', { name: /Falhou/ })
      .first()
      .click();
    const evidence = window.getByTestId('execution-detail').getByTestId('evidence-list');
    await evidence.getByRole('button', { name: 'Salvar captura' }).click();
    await evidence.getByText(/Salvo em/).waitFor();

    await expect(access(target)).resolves.toBeUndefined();
    await rm(target, { force: true });
    await window.getByRole('button', { name: 'Fechar detalhe' }).click();
  });

  it('com a chave de consulta, nenhuma ação de operador aparece e a consulta funciona (SC-009)', async () => {
    const reader = await launchApp();
    try {
      await configureApp(reader, {
        serverUrl: tls.url,
        certificatePem: certificates.authority.certificatePem,
        apiKey: server.reader.apiKey,
      });
      const { window } = reader;
      expect(
        await window.getByRole('navigation').getByText('Executar', { exact: true }).count(),
      ).toBe(0);

      await goTo(window, 'Reservas');
      await searchFor(window, { q: 'aut-0042' });
      await resultRows(window).filter({ hasText: '258-1234' }).waitFor();

      await goTo(window, 'Execuções');
      await window
        .getByRole('row', { name: /Falhou/ })
        .first()
        .click();
      const detail = window.getByTestId('execution-detail');
      await detail.getByText('Falhou', { exact: true }).first().waitFor();
      expect(await detail.getByRole('button', { name: 'Retomar' }).count()).toBe(0);
      expect(await detail.getByRole('button', { name: 'Cancelar execução' }).count()).toBe(0);
    } finally {
      await reader.close();
    }
  });
});
