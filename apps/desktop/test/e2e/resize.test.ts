/**
 * Roteiro de redimensionamento (specs/006, T022, SC-008, FR-048, research R-07): com a tela aberta e
 * o trabalho em andamento, a janela vai de 1 440 para 960 e depois para 1 920 px; a tela se ajusta
 * sem recarregar a página e sem perder nada do que a pessoa fez. As quebras do layout são só CSS,
 * então nenhum componente é montado de novo ao cruzar uma delas. App compilado contra a API da 001
 * com o Hunit simulado.
 *
 * Cada história do redesenho acrescenta aqui o estado dela (filtros, seleção, gaveta aberta, aba
 * ativa, texto de diálogo): um `it` que monta o estado, `keepsAcrossSizes` e a leitura do estado.
 * Hoje: Executar (US1), um diálogo aberto, Reservas (US2: busca, filtro do painel e filtro rápido)
 * e a seleção com a gaveta "Reservas selecionadas" aberta (US4), a gaveta da reserva com um valor
 * digitado em "Corrigir o valor" (US5) e, na área Comercial, a aba ativa com o motivo da recusa
 * digitado (US8).
 */
import { insertDispatch, insertLine } from '../../../server/test/helpers/commercial-fixtures.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCertificates } from '../helpers/certificates.js';
import { pdfFile } from '../helpers/synthetic-files.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  daysFromToday,
  launchApp,
  openReservationFilters,
  pickPeriod,
  resizeWindow,
  searchReservations,
  waitForReservationRows,
  type LaunchedApp,
  type WindowSize,
} from './app-fixture.js';

/** Hotéis fictícios (o repositório é público). */
const HOTELS = [
  { code: '201', name: 'Hotel Praia Azul' },
  { code: '202', name: 'Pousada Serra Verde' },
  { code: '203', name: 'Resort Lagoa Clara' },
];

const START: WindowSize = { width: 1440, height: 900 };
/** A mínima suportada (002) e a de monitor grande. */
const SIZES: WindowSize[] = [
  { width: 960, height: 640 },
  { width: 1920, height: 1080 },
];

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer({ scenario: { hotels: [] }, commercialSheet: true });
  for (const hotel of HOTELS) await server.insertHotel(hotel.code, hotel.name);
  for (const [index, guestName] of ['Ana Ribeiro', 'Ana Costa', 'Bruno Carvalho'].entries()) {
    await server.insertReservation({
      hotelCode: HOTELS[index % 2]?.code ?? '201',
      reservationNumber: `R-${index + 1}`,
      guestName,
      channel: index === 0 ? 'Expedia' : 'Booking.com',
    });
  }
  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp({ window: START });
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

/**
 * Lê o estado com `read`, passa a janela por 960 e 1 920 px e confere que o estado continua igual
 * e que a página não recarregou (uma marca posta na página antes continua lá).
 */
async function keepsAcrossSizes<T>(read: () => Promise<T>): Promise<void> {
  const { app, window } = launched;
  const before = await read();
  await window.evaluate(() => {
    (globalThis as Record<string, unknown>)['__hunitResizeMark'] = true;
  });
  try {
    for (const size of SIZES) {
      await resizeWindow(app, window, size, 1);
      const where = `${size.width} × ${size.height}`;
      expect(await read(), `estado depois de ir para ${where}`).toEqual(before);
      expect(
        await window.evaluate(() => (globalThis as Record<string, unknown>)['__hunitResizeMark']),
        `a página recarregou em ${where}`,
      ).toBe(true);
    }
  } finally {
    await resizeWindow(app, window, START, 1);
  }
}

describe('redimensionar sem perder nada (US9, SC-008)', () => {
  it('Executar: acesso digitado, período e hotéis escolhidos continuam', async () => {
    const { window } = launched;
    await window.getByLabel('Usuário do Hunit').fill('operador@exemplo.com.br');
    await window.getByLabel('Senha do Hunit').fill('senha-ficticia-digitada');
    await pickPeriod(window, daysFromToday(0), daysFromToday(6));
    await window.getByRole('radio', { name: 'Escolher hotéis' }).check();
    const hotels = window.getByRole('combobox', { name: 'Hotéis escolhidos' });
    await hotels.click();
    for (const hotel of HOTELS.slice(0, 2)) {
      await window.getByRole('option', { name: `${hotel.name} (${hotel.code})` }).click();
    }
    await hotels.fill('Lagoa');
    await window.keyboard.press('Escape');

    const read = async () => ({
      username: await window.getByLabel('Usuário do Hunit').inputValue(),
      password: await window.getByLabel('Senha do Hunit').inputValue(),
      period: await window.getByLabel('Período de check-in').textContent(),
      someHotels: await window.getByRole('radio', { name: 'Escolher hotéis' }).isChecked(),
      chosen: await window.locator('.mantine-MultiSelect-pill').allTextContents(),
      search: await hotels.inputValue(),
    });
    const filled = await read();
    expect(filled).toMatchObject({
      username: 'operador@exemplo.com.br',
      password: 'senha-ficticia-digitada',
      someHotels: true,
      chosen: HOTELS.slice(0, 2).map((hotel) => `${hotel.name} (${hotel.code})`),
      search: 'Lagoa',
    });
    expect(filled.period).toMatch(/\d/);

    await keepsAcrossSizes(read);
  });

  it('um diálogo aberto continua aberto', async () => {
    const { window } = launched;
    await window.getByRole('navigation').getByRole('button', { name: 'Configuração' }).click();
    await window.getByRole('button', { name: 'Remover a configuração desta máquina' }).click();
    const dialog = window.getByRole('dialog', { name: 'Remover a configuração?' });
    await dialog.waitFor();

    await keepsAcrossSizes(async () => ({ open: await dialog.isVisible() }));

    await dialog.getByRole('button', { name: 'Não', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  });

  it('Reservas: busca digitada, filtro do painel aberto e filtro rápido continuam', async () => {
    const { window } = launched;
    await window.getByRole('navigation').getByRole('button', { name: 'Reservas' }).click();
    await waitForReservationRows(window, 3);
    await searchReservations(window, 'Ana');
    await waitForReservationRows(window, 2);
    const panel = await openReservationFilters(window);
    await panel.getByPlaceholder('Todos os canais').click();
    await window.getByRole('option', { name: 'Expedia' }).click();
    await waitForReservationRows(window, 1);
    const quick = window
      .getByRole('group', { name: 'Filtros rápidos' })
      .getByRole('button', { name: /^Falta cobrar/ });
    await quick.click();

    const read = async () => ({
      search: await window.getByRole('textbox', { name: 'Buscar reservas' }).inputValue(),
      panelOpen: await panel.isVisible(),
      channel: await panel.getByPlaceholder('Todos os canais').inputValue(),
      applied: await window.getByRole('group', { name: 'Filtros aplicados' }).innerText(),
      quick: await quick.getAttribute('aria-pressed'),
      rows: await window.locator('table[aria-label="Reservas"] tbody tr').count(),
    });
    expect(await read()).toMatchObject({
      search: 'Ana',
      panelOpen: true,
      channel: 'Expedia',
      quick: 'true',
      rows: 1,
    });

    await keepsAcrossSizes(read);
  });

  it('Reservas: a seleção feita e a gaveta da seleção aberta continuam (US4, T043)', async () => {
    const { window } = launched;
    // Volta a lista ao início (o caso anterior deixou busca, painel e filtro rápido).
    await window
      .getByRole('group', { name: 'Filtros aplicados' })
      .getByRole('button', { name: 'Limpar busca e filtros' })
      .click();
    await window.getByRole('button', { name: 'Fechar os filtros' }).click();
    await waitForReservationRows(window, 3);
    for (const number of ['R-1', 'R-3']) {
      await window.getByRole('checkbox', { name: `Selecionar a reserva ${number}` }).check();
    }
    const bar = window.getByTestId('selection-bar');
    await bar.getByRole('button', { name: 'Ver seleção' }).click();
    const drawer = window.getByRole('dialog', { name: 'Reservas selecionadas' });
    const list = drawer.getByRole('list', { name: 'Reservas selecionadas' });
    await list.waitFor();

    const read = async () => ({
      drawerOpen: await drawer.isVisible(),
      selected: await list.getByRole('listitem').allInnerTexts(),
      bar: await bar.innerText(),
      checked: await Promise.all(
        ['R-1', 'R-2', 'R-3'].map((number) =>
          window.getByRole('checkbox', { name: `Selecionar a reserva ${number}` }).isChecked(),
        ),
      ),
    });
    const before = await read();
    expect(before).toMatchObject({ drawerOpen: true, checked: [true, false, true] });
    expect(before.selected).toHaveLength(2);
    expect(before.bar).toMatch(/2\s+reservas selecionadas/);

    await keepsAcrossSizes(read);

    await window.getByRole('button', { name: 'Fechar seleção' }).click();
    await drawer.waitFor({ state: 'hidden' });
    await bar.getByRole('button', { name: 'Desmarcar todas' }).click();
  });

  it('Reservas: a gaveta aberta e o valor digitado em "Corrigir o valor" continuam (US5, T046)', async () => {
    const { window } = launched;
    // O campo só aparece com comprovante: registrado pela API, como o operador faria pelo app.
    const upload = await server.test.app.inject({
      method: 'POST',
      url: `/v1/treatment-files?name=${encodeURIComponent('comprovante-r1.pdf')}`,
      headers: { ...server.operator.headers, 'content-type': 'application/octet-stream' },
      payload: pdfFile('Comprovante R-1'),
    });
    const { fileId } = upload.json<{ fileId: string }>();
    await server.test.app.inject({
      method: 'POST',
      url: '/v1/treatment-documents',
      headers: server.operator.headers,
      payload: {
        kind: 'proof',
        fileId,
        fileName: 'comprovante-r1.pdf',
        reservations: [{ hotelCode: '201', reservationNumber: 'R-1' }],
      },
    });

    await window.getByRole('button', { name: 'Abrir a reserva R-1' }).click();
    const drawer = window.getByRole('dialog', { name: 'Detalhe da reserva' });
    const field = drawer.getByLabel('Corrigir o valor cobrado (R$)');
    await field.waitFor({ timeout: 15_000 });
    await field.fill('1.234,56');

    const read = async () => ({
      drawerOpen: await drawer.isVisible(),
      reservation: await drawer.getByRole('heading', { name: /Reserva R-1/ }).innerText(),
      typed: await field.inputValue(),
      proof: await drawer
        .getByRole('list', { name: 'Documentos da tratativa' })
        .getByText(/comprovante-r1\.pdf/)
        .isVisible(),
    });
    expect(await read()).toMatchObject({ drawerOpen: true, typed: '1.234,56', proof: true });

    await keepsAcrossSizes(read);

    await drawer.getByRole('button', { name: 'Fechar detalhe' }).click();
    await drawer.waitFor({ state: 'hidden' });
  });

  it('Comercial: a aba ativa e o motivo da recusa digitado continuam (US8, T054)', async () => {
    const { window } = launched;
    // R-3 na planilha, com o retorno preenchido pelo Comercial (direto no banco e na planilha em
    // memória, sem passar pelo Hunit).
    const { db } = server.test.database;
    const dispatch = await insertDispatch(db);
    await insertLine(
      db,
      { hotelCode: '201', reservationNumber: 'R-3' },
      { dispatchId: dispatch.id, clientId: dispatch.clientId },
    );
    await server.test.sync?.runRound();
    server.sheet?.fillReturn('Hotel Praia Azul', 'R-3', [
      'AUT-55210',
      'Maquininha Centro',
      '90,00',
      'Responsável Fictícia',
    ]);
    await server.test.sync?.runRound();

    await window.getByRole('navigation').getByRole('button', { name: 'Comercial' }).click();
    const returnsTab = window.getByRole('tab', { name: /^Retornos a validar/ });
    await returnsTab.click();
    const returns = window.getByRole('table', { name: 'Retornos a validar' });
    await returns.getByRole('button', { name: 'Recusar', exact: true }).click({ timeout: 15_000 });
    const dialog = window.getByRole('dialog', { name: 'Recusar o retorno do Comercial' });
    const reason = dialog.getByLabel('Motivo da recusa');
    await reason.fill('Código de autorização não confere com o extrato');

    const read = async () => ({
      tab: await returnsTab.getAttribute('aria-selected'),
      dialogOpen: await dialog.isVisible(),
      reason: await reason.inputValue(),
    });
    expect(await read()).toEqual({
      tab: 'true',
      dialogOpen: true,
      reason: 'Código de autorização não confere com o extrato',
    });

    await keepsAcrossSizes(read);

    await dialog.getByRole('button', { name: 'Voltar' }).click();
    await dialog.waitFor({ state: 'detached' });
  });
});
