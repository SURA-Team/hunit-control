/**
 * A "Cancelada" do Comercial de ponta a ponta (homologação da 008, research R-19; spec FR-007c,
 * US2-7), com o app compilado contra a API e a planilha do Comercial em memória: o Comercial
 * preenche só a situação "Cancelada" em duas reservas (uma sem responsável, outra com o texto
 * "Cancelada na Expedia") → as duas aparecem no topo de "Retornos a validar", com o selo
 * "Cancelada" → o Financeiro confirma uma (a reserva fica "Cancelada sem cobrança", em
 * "Concluídas", e a linha vai para a aba "Concluídas" da planilha) e recusa a outra com o motivo,
 * que aparece na coluna J. Dados fictícios.
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
/** 3401 é confirmada; 3402 é recusada. */
const CONFIRMED = '3401';
const REJECTED = '3402';
const REASON = 'Hóspede fez check-in';

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
  // As duas enviadas ao Comercial (direto no banco) e escritas na planilha.
  const { db } = server.test.database;
  const dispatch = await insertDispatch(db);
  for (const reservationNumber of [CONFIRMED, REJECTED]) {
    const key = { hotelCode: HOTEL.code, reservationNumber };
    await server.insertReservation({
      ...key,
      lastExecutionId: execution.id,
      totalAmount: '655.00',
    });
    await insertLine(db, key, { dispatchId: dispatch.id, clientId: dispatch.clientId });
  }
  expect((await server.test.sync?.runRound())?.ok).toBe(true);
  // Só a situação: o responsável é opcional, e "Cancelada …" vale como "Cancelada".
  server.sheet?.fillReturn(HOTEL.name, CONFIRMED, ['', '', '', '', 'Cancelada']);
  server.sheet?.fillReturn(HOTEL.name, REJECTED, [
    '',
    '',
    '',
    'Paula (Comercial)',
    'Cancelada na Expedia',
  ]);
  // Uma rodada lê o relato; a seguinte reescreve a coluna J.
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

/** A linha da reserva na planilha em memória (coluna B = número; coluna J = índice 9). */
function sheetRow(tab: 'toCharge' | 'done', reservationNumber: string) {
  return server.sheet?.rows(tab).find((row) => row[1] === reservationNumber);
}

describe('"Cancelada" do Comercial (R-19)', () => {
  it('aparece em "Retornos a validar" com o selo próprio; confirmar e recusar', async () => {
    const { window } = launched;
    // A planilha mostra que as duas aguardam o Financeiro.
    for (const number of [CONFIRMED, REJECTED]) {
      expect(sheetRow('toCharge', number)?.[9]).toBe(
        'Cancelada: aguardando validação do Financeiro',
      );
    }

    await window.getByRole('navigation').getByText('Comercial', { exact: true }).click();
    const tab = window.getByRole('tab', { name: /^Retornos a validar/ });
    await expect.poll(() => tab.innerText(), { timeout: 15_000 }).toMatch(/2$/);
    await tab.click();
    await returnsTable(window).waitFor({ timeout: 15_000 });
    for (const number of [CONFIRMED, REJECTED]) {
      await returnRow(window, number).getByText('Cancelada', { exact: true }).waitFor();
    }
    await returnRow(window, REJECTED).getByText('"Cancelada na Expedia"').waitFor();

    // Confirmar: a reserva vira "Cancelada sem cobrança" e sai da lista.
    await returnRow(window, CONFIRMED)
      .getByRole('button', { name: 'Confirmar cancelamento' })
      .click();
    await window
      .getByText(`Reserva ${CONFIRMED} marcada como cancelada sem cobrança.`)
      .waitFor({ timeout: 15_000 });
    await expect.poll(() => returnRow(window, CONFIRMED).count(), { timeout: 15_000 }).toBe(0);

    // Recusar com o motivo, sem as sugestões dos retornos de cobrança.
    await returnRow(window, REJECTED).getByRole('button', { name: 'Recusar' }).click();
    const dialog = window.getByRole('dialog', { name: 'Recusar a "Cancelada" do Comercial' });
    await dialog.getByLabel('Motivo da recusa').fill(REASON);
    await dialog.getByRole('button', { name: 'Recusar' }).click();
    await dialog.waitFor({ state: 'detached' });
    await expect.poll(() => returnRow(window, REJECTED).count(), { timeout: 15_000 }).toBe(0);
    await window.getByText('Nenhum retorno do Comercial aguardando validação.').waitFor();

    // A planilha: a confirmada vai para "Concluídas"; a recusada fica com o motivo na coluna J.
    expect((await server.test.sync?.runRound())?.ok).toBe(true);
    expect(sheetRow('toCharge', CONFIRMED)).toBeUndefined();
    expect(sheetRow('done', CONFIRMED)?.[9]).toBe('Cancelada sem cobrança pelo Financeiro');
    expect(sheetRow('toCharge', REJECTED)?.[9]).toBe(`Recusado pelo Financeiro: ${REASON}`);

    // Na lista de reservas, a confirmada está em "Concluídas", marcada como cancelada sem cobrança.
    await window.getByRole('navigation').getByText('Reservas', { exact: true }).click();
    await searchReservations(window, CONFIRMED);
    await waitForReservationRows(window, 1);
    const reservation = window
      .locator('table[aria-label="Reservas"] tbody tr')
      .filter({ has: window.getByText(new RegExp(`^${CONFIRMED}( ·|$)`)) });
    await reservation.getByText('Cancelada sem cobrança').waitFor({ timeout: 15_000 });
    await reservation.click();
    const detail = window.getByTestId('reservation-detail');
    await detail.getByText('Situação informada pelo Comercial: Cancelada').waitFor();
  }, 180_000);
});
