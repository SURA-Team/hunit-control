/**
 * Roteiro de redimensionamento (specs/006, T022, SC-008, FR-048, research R-07): com a tela aberta e
 * o trabalho em andamento, a janela vai de 1 440 para 960 e depois para 1 920 px; a tela se ajusta
 * sem recarregar a página e sem perder nada do que a pessoa fez. As quebras do layout são só CSS,
 * então nenhum componente é montado de novo ao cruzar uma delas. App compilado contra a API da 001
 * com o Hunit simulado.
 *
 * Cada história do redesenho acrescenta aqui o estado dela (filtros, seleção, gaveta aberta, aba
 * ativa, texto de diálogo): um `it` que monta o estado, `keepsAcrossSizes` e a leitura do estado.
 * Hoje: Executar (US1) e um diálogo aberto.
 */
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  daysFromToday,
  launchApp,
  pickPeriod,
  resizeWindow,
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
  server = await startE2eServer({ scenario: { hotels: [] } });
  for (const hotel of HOTELS) await server.insertHotel(hotel.code, hotel.name);
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
});
