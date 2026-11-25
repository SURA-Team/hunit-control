/**
 * "Cancelada sem cobrança" de ponta a ponta (specs/008, T032; US4, FR-018 a FR-021, SC-006), com o
 * app compilado contra o servidor de teste: marcar com observação → selo, valor R$ 0,00 com o
 * anterior, contagens dos filtros rápidos ("Falta cobrar" → "Concluídas") e a linha da lista;
 * desfazer → tudo volta, e a reserva fica exatamente como antes (só o histórico guarda o que houve).
 *
 * Reservas fictícias, criadas aqui.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  launchApp,
  searchReservations,
  waitForReservationRows,
  type LaunchedApp,
  type Page,
} from './app-fixture.js';

const NUMBER = 'R-SEMCOB';

let certificates: TestCertificates;
let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startE2eServer();
  await server.insertHotel('H1', 'Hotel Praia');
  const execution = await server.insertExecution({
    clientId: server.operator.id,
    status: 'completed',
    finishedAt: new Date(),
  });
  await server.insertReservation({
    lastExecutionId: execution.id,
    hotelCode: 'H1',
    reservationNumber: NUMBER,
    totalAmount: '655.00',
  });

  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp();
  await configureApp(launched, {
    serverUrl: tls.url,
    certificatePem: certificates.authority.certificatePem,
    apiKey: server.operator.apiKey,
  });
  await launched.window.getByRole('navigation').getByText('Reservas', { exact: true }).click();
}, 240_000);

afterAll(async () => {
  await launched?.close();
  await tls?.close();
  await server?.close();
});

// ---------------------------------------------------------------------------

const row = (window: Page) =>
  window
    .locator('table[aria-label="Reservas"] tbody tr')
    .filter({ has: window.getByText(new RegExp(`^${NUMBER}( ·|$)`)) });

const detail = (window: Page) => window.getByTestId('reservation-detail');
const noCharge = (window: Page) => window.getByTestId('no-charge-section');

/** Contagem do chip de filtro rápido (o texto é o rótulo seguido do número). */
async function chipCount(window: Page, label: string): Promise<string> {
  const chip = window
    .getByRole('group', { name: 'Filtros rápidos' })
    .getByRole('button', { name: new RegExp(`^${label}`) });
  return (await chip.innerText()).replace(label, '').trim();
}

const counts = async (window: Page) => ({
  pending: await chipCount(window, 'Falta cobrar'),
  done: await chipCount(window, 'Concluídas'),
});

/** O Intl separa "R$" do valor com um espaço que não quebra a linha. */
const plain = (text: string) => text.replace(/\s+/g, ' ').trim();

async function amountCell(window: Page): Promise<string> {
  return plain(await row(window).locator('td[data-col="amount"]').innerText());
}

async function openDetail(window: Page) {
  await row(window).click();
  await detail(window).waitFor();
}

async function closeDetail(window: Page) {
  await window.getByRole('button', { name: 'Fechar detalhe' }).click();
  await detail(window).waitFor({ state: 'detached' });
}

/** A reserva como a API devolve, sem o histórico das marcações (que guarda o que houve). */
async function reservationState(): Promise<Record<string, unknown>> {
  const response = await server.test.app.inject({
    method: 'GET',
    url: `/v1/reservations/H1/${NUMBER}`,
    headers: server.reader.headers,
  });
  const body = response.json<{ treatment: Record<string, unknown> } & Record<string, unknown>>();
  const treatment = { ...body.treatment };
  delete treatment['noChargeHistory'];
  return { ...body, treatment };
}

// ---------------------------------------------------------------------------

describe('US4 — cancelada sem cobrança', () => {
  it('marcar → "Concluídas", R$ 0,00 e contagens; desfazer → tudo volta (SC-006)', async () => {
    const { window } = launched;
    const before = await reservationState();
    await searchReservations(window, NUMBER);
    await waitForReservationRows(window, 1);
    await expect.poll(() => counts(window)).toEqual({ pending: '1', done: '0' });
    expect(await amountCell(window)).toBe('R$ 655,00');

    // Marcar, com observação (tela 7.17).
    await openDetail(window);
    await noCharge(window)
      .getByRole('button', { name: 'Marcar como cancelada sem cobrança' })
      .click();
    const dialog = window.getByRole('dialog', { name: 'Marcar como cancelada sem cobrança?' });
    await dialog.waitFor();
    expect(plain(await dialog.innerText())).toContain('R$ 655,00 → R$ 0,00');
    await dialog
      .getByRole('textbox', { name: 'Observação (opcional)' })
      .fill('hóspede cancelou antes do check-in');
    await dialog.getByRole('button', { name: 'Marcar como cancelada' }).click();
    await dialog.waitFor({ state: 'detached' });

    // Marcada (tela 7.18): selo, valor e o anterior, observação e o histórico.
    await noCharge(window).getByText('Reserva marcada como cancelada sem cobrança.').waitFor();
    await noCharge(window).getByRole('button', { name: 'Desfazer' }).waitFor();
    const marked = plain(await noCharge(window).innerText());
    expect(marked).toContain('R$ 0,00');
    expect(marked).toContain('antes R$ 655,00');
    expect(marked).toContain('Observação: hóspede cancelou antes do check-in');
    await window
      .getByRole('list', { name: 'Histórico da tratativa' })
      .getByText(/Marcou como cancelada sem cobrança/)
      .waitFor();
    await closeDetail(window);

    // Lista e contagens.
    await expect.poll(() => counts(window)).toEqual({ pending: '0', done: '1' });
    await expect.poll(() => amountCell(window)).toBe('R$ 0,00 antes R$ 655,00');
    await row(window).getByText('Cancelada sem cobrança').waitFor();

    // Desfazer, com confirmação.
    await openDetail(window);
    await noCharge(window).getByRole('button', { name: 'Desfazer' }).click();
    const undo = window.getByRole('dialog', { name: 'Desfazer a marcação?' });
    await undo.getByRole('button', { name: 'Desfazer' }).click();
    await undo.waitFor({ state: 'detached' });
    await noCharge(window)
      .getByRole('button', { name: 'Marcar como cancelada sem cobrança' })
      .waitFor();
    await window
      .getByRole('list', { name: 'Histórico da tratativa' })
      .getByText(/Desfez a marcação/)
      .waitFor();
    await closeDetail(window);

    await expect.poll(() => counts(window)).toEqual({ pending: '1', done: '0' });
    await expect.poll(() => amountCell(window)).toBe('R$ 655,00');
    expect(await reservationState()).toEqual(before);
  });
});
