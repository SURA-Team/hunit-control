/**
 * Fila "Cobradas no Hunit" de ponta a ponta (specs/008, T026; US3, FR-012 a FR-017), com o app
 * compilado contra a API com o Hunit simulado e a planilha do Comercial em memória: o Comercial
 * informa "Cobrada no Hunit" em duas reservas → as duas entram na fila "Aguardando verificação" →
 * "Verificar agora" pede o acesso e o token, como o envio → no Hunit, uma mostra a cobrança
 * ("Confirmada no Hunit") e a outra continua pendente ("Não encontrada no Hunit"), e a planilha
 * mostra a recusa do Financeiro só nesta. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertDispatch, insertLine } from '../../../server/test/helpers/commercial-fixtures.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { reservationDetails } from '../../../server/test/helpers/fake-hunit-gateway.js';
import { createTestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  daysFromToday,
  isoDate,
  launchApp,
  type LaunchedApp,
  type Page,
} from './app-fixture.js';

const VALID_TOKEN = '246813';
const CHECK_IN = isoDate(daysFromToday(2));
const HOTEL = { code: '31', name: 'Hotel Praia' };
/** 3201 aparece cobrada no Hunit; 3202 continua pendente. */
const CHARGED = '3201';
const PENDING = '3202';

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
          ...HOTEL,
          reservations: [
            {
              reservationNumber: CHARGED,
              listing: { checkIn: CHECK_IN },
              detail: reservationDetails.alreadyCharged(),
            },
            { reservationNumber: PENDING, listing: { checkIn: CHECK_IN } },
          ],
        },
      ],
    },
  });
  await server.insertHotel(HOTEL.code, HOTEL.name);
  const execution = await server.insertExecution({
    clientId: server.operator.id,
    status: 'completed',
    finishedAt: new Date(),
  });
  // As duas enviadas ao Comercial (direto no banco) e escritas na planilha.
  const { db } = server.test.database;
  const dispatch = await insertDispatch(db);
  for (const reservationNumber of [CHARGED, PENDING]) {
    const key = { hotelCode: HOTEL.code, reservationNumber };
    await server.insertReservation({
      ...key,
      lastExecutionId: execution.id,
      checkIn: CHECK_IN,
      totalAmount: '655.00',
    });
    await insertLine(db, key, { dispatchId: dispatch.id, clientId: dispatch.clientId });
  }
  expect((await server.test.sync?.runRound())?.ok).toBe(true);
  // O Comercial escolhe "Cobrada no Hunit": o responsável e a data da cobrança (FR-007a; a data é
  // obrigatória desde a homologação, R-19), como o Google devolve (número de série: 19/11/2026).
  for (const reservationNumber of [CHARGED, PENDING]) {
    server.sheet?.fillReturn(HOTEL.name, reservationNumber, [
      '',
      '',
      '',
      'Paula (Comercial)',
      'Cobrada no Hunit',
      46345,
    ]);
  }
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

/** A situação da reserva na fila (o selo da coluna "Situação"). */
async function statusOf(window: Page, reservationNumber: string): Promise<string> {
  const row = window
    .getByRole('table', { name: 'Cobradas no Hunit' })
    .locator('tbody tr')
    .filter({ has: window.getByText(reservationNumber, { exact: true }) });
  return ((await row.locator('td[data-col="hunitCheck"]').textContent()) ?? '').replace(
    /\s+/g,
    ' ',
  );
}

describe('fila "Cobradas no Hunit" (US3)', () => {
  it('relato na planilha → "Aguardando" → "Verificar agora" com token → uma confirmada e uma pendente', async () => {
    const { window } = launched;
    await window.getByRole('navigation').getByText('Comercial', { exact: true }).click();
    await window.getByRole('tab', { name: /^Cobradas no Hunit/ }).click();
    const table = window.getByRole('table', { name: 'Cobradas no Hunit' });
    await table.waitFor({ timeout: 15_000 });
    await expect.poll(() => table.locator('tbody tr').count()).toBe(2);
    for (const number of [CHARGED, PENDING]) {
      expect(await statusOf(window, number)).toContain('Aguardando verificação');
    }

    // "Verificar agora": sem acesso guardado, o diálogo pede usuário e senha.
    await window.getByRole('button', { name: 'Verificar agora' }).click();
    const access = window.getByRole('dialog', { name: 'Verificar no Hunit' });
    await access.getByLabel('Usuário do Hunit').fill('operador@hotel.test');
    await access.getByLabel('Senha do Hunit').fill('SENHA-MARCADOR-E2E-VERIFICAR');
    await access.getByRole('button', { name: 'Verificar agora' }).click();

    // O mesmo aviso do token, identificado como verificação.
    const tokenDialog = window.getByRole('dialog', { name: /O Hunit pediu o token/ });
    await tokenDialog.waitFor({ timeout: 15_000 });
    await tokenDialog.getByText('Verificação no Hunit').first().waitFor();
    await tokenDialog.getByLabel('Token do autenticador').fill(VALID_TOKEN);
    await tokenDialog.getByRole('button', { name: 'Enviar token' }).click();
    await tokenDialog.getByText(/^Token aceito pelo Hunit\./).waitFor({ timeout: 15_000 });
    await tokenDialog.getByRole('button', { name: 'Fechar', exact: true }).click();

    // A verificação termina e a fila mostra o que o Hunit informou.
    const drawer = window.getByRole('dialog', { name: 'Verificação no Hunit' });
    await drawer.getByText('Concluído', { exact: true }).waitFor({ timeout: 30_000 });
    await drawer.getByRole('button', { name: 'Fechar verificação' }).click();
    await expect
      .poll(() => statusOf(window, CHARGED), { timeout: 15_000 })
      .toContain('Confirmada no Hunit');
    expect(await statusOf(window, PENDING)).toContain('Não encontrada no Hunit');

    // A planilha mostra a recusa só na que não foi encontrada (FR-017).
    expect((await server.test.sync?.runRound())?.ok).toBe(true);
    const sheet = JSON.stringify([
      ...(server.sheet?.rows('toCharge') ?? []),
      ...(server.sheet?.rows('done') ?? []),
    ]);
    expect(sheet).toContain('cobrança não encontrada no Hunit');
    expect(sheet.match(/cobrança não encontrada no Hunit/g)).toHaveLength(1);
  });
});
