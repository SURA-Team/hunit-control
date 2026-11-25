/**
 * Módulo de Relatórios de ponta a ponta (specs/007, T019, T021 e T022), com o app compilado contra a
 * API e reservas fictícias em dois hotéis: abrir Relatórios → conferir o valor em aberto → abrir o
 * hotel com mais valor em aberto → "Ver as N reservas em Reservas" → a lista mostra N reservas, com
 * os filtros; "Ver reservas em aberto" leva os dois hotéis; com o servidor fora do ar, os números
 * ficam com a hora e as ações desabilitadas; o perfil consulta vê o mesmo relatório.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  launchApp,
  waitForReservationRows,
  type LaunchedApp,
  type Page,
} from './app-fixture.js';

const PRAIA = { code: '31', name: 'Hotel Praia Azul' };
const SERRA = { code: '32', name: 'Pousada Serra Verde' };

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;
let certificates: Awaited<ReturnType<typeof createTestCertificates>>;

/** Uma data dentro dos últimos 30 dias (o período padrão), no formato da API. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

beforeAll(async () => {
  certificates = await createTestCertificates();
  server = await startE2eServer({ scenario: { hotels: [] } });
  await server.insertHotel(PRAIA.code, PRAIA.name);
  await server.insertHotel(SERRA.code, SERRA.name);
  const execution = await server.insertExecution({
    clientId: server.operator.id,
    status: 'completed',
    finishedAt: new Date(),
  });
  const add = (hotelCode: string, reservationNumber: string, overrides = {}) =>
    server.insertReservation({
      hotelCode,
      reservationNumber,
      lastExecutionId: execution.id,
      checkIn: daysAgo(3),
      checkOut: daysAgo(1),
      ...overrides,
    });
  // Hotel Praia Azul: três em aberto (R$ 1.500,00) e uma já cobrada.
  await add(PRAIA.code, '4101', { totalAmount: '700.00' });
  await add(PRAIA.code, '4102', { totalAmount: '500.00' });
  await add(PRAIA.code, '4103', {
    totalAmount: '300.00',
    classification: 'virtual_card_charge_error',
  });
  await add(PRAIA.code, '4104', {
    totalAmount: '900.00',
    chargedAmount: '900.00',
    classification: 'virtual_card_already_charged',
  });
  // Pousada Serra Verde: uma em aberto (R$ 200,00) e uma faturada (fora do relatório).
  await add(SERRA.code, '4201', { totalAmount: '200.00' });
  await add(SERRA.code, '4202', { totalAmount: '999.00', classification: 'invoiced' });

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

async function openReports(window: Page) {
  await window.getByRole('navigation').getByText('Relatórios', { exact: true }).click();
  await window.getByTestId('report-loaded').waitFor({ timeout: 20_000 });
}

describe('Relatórios (specs/007)', () => {
  it('do valor em aberto às reservas do hotel, com a mesma quantidade', async () => {
    const { window } = launched;
    await openReports(window);
    const open = window.getByRole('region', { name: 'Valor em aberto' });
    expect((await open.innerText()).replace(/\s/g, ' ')).toContain('R$ 1.700,00');
    expect(await window.getByTestId('report-range-count').innerText()).toBe(
      '5 reservas no recorte',
    );
    const charged = window.getByRole('region', { name: 'Valor já cobrado' });
    expect((await charged.innerText()).replace(/\s/g, ' ')).toContain('R$ 900,00');

    await window.getByRole('button', { name: `Abrir o detalhe de ${PRAIA.name}` }).click();
    const drawer = window.getByTestId('report-hotel-drawer');
    await drawer.getByText('Reservas em aberto (3)').waitFor();
    await drawer.getByText('4101 ·', { exact: false }).waitFor();
    await drawer.getByRole('button', { name: 'Ver as 3 reservas em Reservas' }).click();

    await waitForReservationRows(window, 3);
    await window
      .getByText(/^Check-in de /)
      .first()
      .waitFor();
    expect(await window.getByText(/relatório podem estar desatualizados/).count()).toBe(0);
  }, 120_000);

  it('"Ver reservas em aberto" leva os dois hotéis', async () => {
    const { window } = launched;
    await openReports(window);
    await window.getByRole('button', { name: 'Ver reservas em aberto' }).click();
    await waitForReservationRows(window, 4);
  }, 120_000);

  it('servidor fora do ar: números com a hora e ações desabilitadas; volta com "Atualizar dados"', async () => {
    const { window } = launched;
    await openReports(window);
    await tls.stop();
    await window.getByText('Servidor indisponível', { exact: true }).waitFor({ timeout: 40_000 });
    await window.getByText(/dados de \d{2}:\d{2} — servidor indisponível/).waitFor();
    expect(await window.getByRole('button', { name: 'Atualizar dados' }).isDisabled()).toBe(true);
    expect(await window.getByRole('button', { name: 'Ver reservas em aberto' }).isDisabled()).toBe(
      true,
    );
    expect(
      await window.getByRole('button', { name: `Abrir o detalhe de ${PRAIA.name}` }).isDisabled(),
    ).toBe(true);
    expect(await window.getByText('5 reservas no recorte').isVisible()).toBe(true);

    await tls.start();
    await window
      .getByText('Servidor indisponível', { exact: true })
      .waitFor({ state: 'hidden', timeout: 30_000 });
    await window.getByRole('button', { name: 'Atualizar dados' }).click();
    await window.getByText('Dados atualizados').waitFor({ timeout: 20_000 });
  }, 180_000);

  it('perfil consulta: o mesmo relatório e a ida para Reservas', async () => {
    await launched.close();
    launched = await launchApp();
    await configureApp(launched, {
      serverUrl: tls.url,
      certificatePem: certificates.authority.certificatePem,
      apiKey: server.reader.apiKey,
    });
    const { window } = launched;
    const menu = window.getByRole('navigation');
    expect(await menu.getByText('Executar', { exact: true }).count()).toBe(0);
    await openReports(window);
    const open = window.getByRole('region', { name: 'Valor em aberto' });
    expect((await open.innerText()).replace(/\s/g, ' ')).toContain('R$ 1.700,00');
    await window.getByRole('button', { name: `Abrir o detalhe de ${PRAIA.name}` }).click();
    await window
      .getByTestId('report-hotel-drawer')
      .getByRole('button', { name: 'Ver as 3 reservas em Reservas' })
      .click();
    await waitForReservationRows(window, 3);
  }, 180_000);
});
