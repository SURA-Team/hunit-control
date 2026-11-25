/**
 * Área Comercial no perfil consulta (homologação da 008, cenário 3.15): sem a coluna de ações, a
 * última coluna de "Retornos a validar" ("Responsável e cobrança") some em conteúdo estreito; a
 * coluna que passa a ser a última visível tem de manter o espaço do fim da linha (antes, a diferença
 * encostava na borda do card e era cortada), e a situação e a data da cobrança continuam na linha da
 * reserva. Confere as quatro abas com listas em 960, 1 280 e 1 440 px, com uma "Cancelada" do
 * Comercial em "Retornos a validar" (R-19). Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertDispatch, insertLine } from '../../../server/test/helpers/commercial-fixtures.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import { configureApp, launchApp, resizeWindow, type LaunchedApp } from './app-fixture.js';
import { cellOverflows } from './layout-checks.js';

const HOTEL = 'Pousada Homologação Serra';
const WIDTHS = [960, 1280, 1440];

let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  const certificates = await createTestCertificates();
  server = await startE2eServer({ scenario: { hotels: [] }, commercialSheet: true });
  await server.insertHotel('102', HOTEL);
  const { db } = server.test.database;
  const dispatch = await insertDispatch(db);
  for (const reservationNumber of ['200001', '200002', '200003', '200004', '200005']) {
    const key = { hotelCode: '102', reservationNumber };
    await server.insertReservation({ ...key, totalAmount: '655.00' });
    await insertLine(db, key, { dispatchId: dispatch.id, clientId: dispatch.clientId });
  }
  await server.test.sync?.runRound();
  // Dois retornos a validar, um relato "Cobrada no Hunit", um retorno incompleto e uma "Cancelada".
  // A data vai como o Google devolve (número de série: 19/11/2026).
  server.sheet?.fillReturn(HOTEL, '200001', [
    'AUT-1',
    'Maquininha Centro de Convenções',
    '700,00',
    'Paula (Comercial)',
    'Cobrada na maquininha',
    46345,
  ]);
  server.sheet?.fillReturn(HOTEL, '200002', [
    'AUT-2',
    HOTEL,
    '655,00',
    'Paula (Comercial)',
    'Cobrada na maquininha',
    46345,
  ]);
  server.sheet?.fillReturn(HOTEL, '200003', [
    '',
    '',
    '',
    'Paula (Comercial)',
    'Cobrada no Hunit',
    46345,
  ]);
  server.sheet?.fillReturn(HOTEL, '200004', ['AUT-4', '', '', '']);
  server.sheet?.fillReturn(HOTEL, '200005', ['', '', '', '', 'Cancelada na Expedia']);
  await server.test.sync?.runRound();

  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp();
  await configureApp(launched, {
    serverUrl: tls.url,
    certificatePem: certificates.authority.certificatePem,
    apiKey: server.reader.apiKey,
  });
}, 240_000);

afterAll(async () => {
  await launched?.close();
  await tls?.close();
  await server?.close();
});

/**
 * Em cada tabela da página, quanto espaço sobra entre o fim do conteúdo da última célula visível de
 * cada linha e a borda direita do card (px de CSS).
 */
async function rowEndGaps(): Promise<number[]> {
  return launched.window.evaluate(() =>
    [...document.querySelectorAll('table')].flatMap((table) => {
      const card = (table.parentElement as HTMLElement).getBoundingClientRect();
      return [...table.querySelectorAll('tr')].map((row) => {
        const visible = [...row.children].filter(
          (cell) => getComputedStyle(cell).display !== 'none',
        );
        const last = visible.at(-1) as HTMLElement | undefined;
        if (!last) return Infinity;
        const style = getComputedStyle(last);
        const contentEnd = last.getBoundingClientRect().right - parseFloat(style.paddingRight);
        return card.right - contentEnd;
      });
    }),
  );
}

describe('perfil consulta na área Comercial (cenário 3.15)', () => {
  it('nenhuma célula vaza e a última coluna visível mantém o espaço do fim da linha', async () => {
    const { app, window } = launched;
    await window.getByRole('navigation').getByRole('button', { name: 'Comercial' }).click();
    const problems: string[] = [];
    for (const tab of [
      'Envios',
      'Retornos a validar',
      'Retornos com problema',
      'Cobradas no Hunit',
    ]) {
      await window.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      await window.locator('table tbody tr').first().waitFor({ timeout: 15_000 });
      for (const width of WIDTHS) {
        await resizeWindow(app, window, { width, height: 820 }, 1);
        for (const cell of await cellOverflows(window))
          problems.push(`${tab}, ${width} px: ${cell}`);
        const tight = (await rowEndGaps()).filter((gap) => gap < 16);
        if (tight.length > 0) {
          problems.push(`${tab}, ${width} px: conteúdo a ${Math.min(...tight)} px da borda`);
        }
      }
    }
    await resizeWindow(app, window, { width: 1280, height: 820 }, 1);
    expect(problems).toEqual([]);
  }, 300_000);

  it('em conteúdo estreito, a situação e a data da cobrança vêm para a linha da reserva', async () => {
    const { app, window } = launched;
    await window.getByRole('tab', { name: /^Retornos a validar/ }).click();
    const returns = window.getByRole('table', { name: 'Retornos a validar' });
    await returns.waitFor({ timeout: 15_000 });
    await resizeWindow(app, window, { width: 960, height: 820 }, 1);
    try {
      await returns
        .getByText(/^Paula \(Comercial\) · Cobrada na maquininha em 19\/11\/2026/)
        .first()
        .waitFor();
    } finally {
      await resizeWindow(app, window, { width: 1280, height: 820 }, 1);
    }
  });
});
