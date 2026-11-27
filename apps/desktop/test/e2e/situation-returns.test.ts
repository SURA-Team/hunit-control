/**
 * A situação livre do Comercial de ponta a ponta (specs/009, US1; FR-006 a FR-008) — tasks.md, T017.
 * O app compilado contra a API e a planilha do Comercial em memória. O Comercial escreve uma
 * situação livre e o responsável em três reservas, sem código, hotel nem valor. O Financeiro:
 * - confirma a primeira como cobrada, com o valor digitado (a reserva fica "Comprovante enviado",
 *   com o valor informado à mão);
 * - confirma a segunda como cancelada sem cobrança e desfaz (ela volta para validar);
 * - recusa a terceira com o motivo, que aparece na coluna J da planilha.
 * Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertDispatch, insertLine } from '../../../server/test/helpers/commercial-fixtures.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  launchApp,
  searchReservations,
  waitForReservationRows,
  type LaunchedApp,
  type Page,
} from './app-fixture.js';

const HOTEL = { code: '31', name: 'Hotel Praia' };
const CHARGED = '3501';
const NO_CHARGE = '3502';
const REJECTED = '3503';
const REASON = 'Falta o comprovante da OTA';

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer({ scenario: { hotels: [] }, commercialSheet: true });
  await server.insertHotel(HOTEL.code, HOTEL.name);
  const execution = await server.insertExecution({
    clientId: server.operator.id,
    status: 'completed',
    finishedAt: new Date(),
  });
  const { db } = server.test.database;
  const dispatch = await insertDispatch(db);
  for (const reservationNumber of [CHARGED, NO_CHARGE, REJECTED]) {
    const key = { hotelCode: HOTEL.code, reservationNumber };
    await server.insertReservation({
      ...key,
      lastExecutionId: execution.id,
      totalAmount: '655.00',
    });
    await insertLine(db, key, { dispatchId: dispatch.id, clientId: dispatch.clientId });
  }
  expect((await server.test.sync?.runRound())?.ok).toBe(true);
  for (const reservationNumber of [CHARGED, NO_CHARGE, REJECTED]) {
    server.sheet?.fillReturn(HOTEL.name, reservationNumber, [
      '',
      '',
      '',
      'Paula (Comercial)',
      'Cobrada pela OTA',
    ]);
  }
  expect((await server.test.sync?.runRound())?.ok).toBe(true);
  expect((await server.test.sync?.runRound())?.ok).toBe(true);

  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp();
  await configureApp(launched, {
    serverUrl: tls.url,
    certificatePem: certificates.authority.certificatePem,
    apiKey: server.operator.apiKey,
  });
}, 240_000);

afterAll(async () => {
  await launched?.close();
  await tls?.close();
  await server?.close();
});

const returnsTable = (window: Page) => window.getByRole('table', { name: 'Retornos a validar' });

const returnRow = (window: Page, reservationNumber: string) =>
  returnsTable(window)
    .locator('tbody tr')
    .filter({ has: window.getByText(reservationNumber, { exact: true }) });

function sheetRow(tab: 'toCharge' | 'awaitingValidation' | 'done', reservationNumber: string) {
  return server.sheet?.rows(tab).find((row) => row[1] === reservationNumber);
}

describe('situação livre do Comercial (specs/009, US1)', () => {
  it('aparece em "Retornos a validar"; cobrada, sem cobrança (e desfeita) e recusada', async () => {
    const { window } = launched;
    for (const number of [CHARGED, NO_CHARGE, REJECTED]) {
      expect(sheetRow('toCharge', number)?.[9]).toBe('Aguardando validação do Financeiro');
    }

    await window.getByRole('navigation').getByText('Comercial', { exact: true }).click();
    const tab = window.getByRole('tab', { name: /^Retornos a validar/ });
    await expect.poll(() => tab.innerText(), { timeout: 15_000 }).toMatch(/3$/);
    await tab.click();
    await returnsTable(window).waitFor({ timeout: 15_000 });
    for (const number of [CHARGED, NO_CHARGE, REJECTED]) {
      await returnRow(window, number).getByText('Outra situação', { exact: true }).waitFor();
    }

    // Cobrada: o Comercial não informou o valor; o Financeiro digita.
    await returnRow(window, CHARGED)
      .getByRole('button', { name: `Confirmar como cobrada a reserva ${CHARGED}` })
      .click();
    const charged = window.getByRole('dialog', { name: 'Confirmar como cobrada?' });
    await charged.getByLabel('Valor cobrado (R$)').fill('321,00');
    await charged.getByRole('button', { name: 'Confirmar como cobrada' }).click();
    await window
      .getByText(`Reserva ${CHARGED} confirmada como cobrada.`)
      .waitFor({ timeout: 15_000 });
    await expect.poll(() => returnRow(window, CHARGED).count(), { timeout: 15_000 }).toBe(0);

    // Sem cobrança.
    await returnRow(window, NO_CHARGE)
      .getByRole('button', {
        name: `Confirmar como cancelada sem cobrança a reserva ${NO_CHARGE}`,
      })
      .click();
    const noCharge = window.getByRole('dialog', { name: 'Confirmar como cancelada sem cobrança?' });
    await noCharge.getByRole('button', { name: 'Marcar como cancelada' }).click();
    await expect.poll(() => returnRow(window, NO_CHARGE).count(), { timeout: 15_000 }).toBe(0);

    // Recusada, com o motivo.
    await returnRow(window, REJECTED)
      .getByRole('button', { name: `Recusar a situação da reserva ${REJECTED}` })
      .click();
    const reject = window.getByRole('dialog', {
      name: 'Recusar a situação informada pelo Comercial',
    });
    await reject.getByLabel('Motivo da recusa').fill(REASON);
    await reject.getByRole('button', { name: 'Recusar' }).click();
    await reject.waitFor({ state: 'detached' });
    await expect.poll(() => returnRow(window, REJECTED).count(), { timeout: 15_000 }).toBe(0);

    // A planilha.
    expect((await server.test.sync?.runRound())?.ok).toBe(true);
    expect(sheetRow('done', CHARGED)?.[9]).toBe('Confirmado pelo Financeiro');
    expect(sheetRow('done', NO_CHARGE)?.[9]).toBe('Cancelada sem cobrança pelo Financeiro');
    expect(sheetRow('toCharge', REJECTED)?.[9]).toBe(`Recusado pelo Financeiro: ${REASON}`);

    // A cobrada: "Comprovante enviado", com o valor informado à mão.
    await window.getByRole('navigation').getByText('Reservas', { exact: true }).click();
    await searchReservations(window, CHARGED);
    await waitForReservationRows(window, 1);
    await window
      .locator('table[aria-label="Reservas"] tbody tr')
      .filter({ has: window.getByText(new RegExp(`^${CHARGED}( ·|$)`)) })
      .click();
    const detail = window.getByTestId('reservation-detail');
    await detail.getByText('Confirmada como cobrada').first().waitFor({ timeout: 15_000 });
    await detail.getByText('R$ 321,00').first().waitFor();

    // A sem cobrança: desfazer a marcação devolve a situação para validar.
    await window.keyboard.press('Escape');
    await detail.waitFor({ state: 'detached' });
    await searchReservations(window, NO_CHARGE);
    await waitForReservationRows(window, 1);
    await window
      .locator('table[aria-label="Reservas"] tbody tr')
      .filter({ has: window.getByText(new RegExp(`^${NO_CHARGE}( ·|$)`)) })
      .click();
    await window
      .getByTestId('no-charge-section')
      .getByRole('button', { name: 'Desfazer', exact: true })
      .click();
    await window
      .getByRole('dialog', { name: 'Desfazer a marcação?' })
      .getByRole('button', { name: 'Desfazer', exact: true })
      .click();
    await detail
      .getByRole('button', { name: `Confirmar como cobrada a reserva ${NO_CHARGE}` })
      .waitFor({ timeout: 15_000 });
  }, 180_000);
});
