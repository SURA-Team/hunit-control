/**
 * Captura das telas do app para o espelho no Figma (skill `figma-screens-sync`).
 *
 * Não é um teste: fica desligado nas rodadas normais e só roda com `HUNIT_SCREENS_DIR` definida
 * (pasta onde os prints são gravados). Abre o app compilado contra a API da 001 com o Hunit
 * simulado e dados fictícios, percorre os estados e grava um PNG por tela, com o mesmo número da
 * tela no Figma (ex.: `2.4-executar-pedido-de-token.png`). Passos que falham não interrompem a
 * captura; ficam em `falhas.txt` na mesma pasta (o console do Vitest não mostra o `console.log`).
 *
 * Mudou a lista de telas? Atualize também `.claude/skills/figma-screens-sync/references/screens.md`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { InvalidCredentialsError } from '../../../server/src/hunit/errors.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import {
  reservationDetails,
  type FakeScenario,
} from '../../../server/test/helpers/fake-hunit-gateway.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  daysFromToday,
  isoDate,
  launchApp,
  pickPeriod,
  stubMessageBox,
  stubOpenDialog,
  type LaunchedApp,
} from './app-fixture.js';

const OUT = process.env['HUNIT_SCREENS_DIR'];
const TOKEN = '246810';
/** Janela de referência das telas no Figma. */
const WINDOW = { width: 1440, height: 900 };

const GUESTS = [
  'Ana Ribeiro',
  'Bruno Carvalho',
  'Carla Mendes',
  'Diego Fernandes',
  'Elisa Martins',
  'Fábio Rocha',
  'Gabriela Lima',
  'Henrique Alves',
  'Isabela Costa',
  'João Pereira',
];
const CHANNELS = ['Booking.com', 'Expedia', 'Decolar', 'Site próprio', 'Airbnb'];
/** Uma reserva de cada situação de cobrança, em ciclo. */
const DETAILS = [
  reservationDetails.pendingCharge(),
  reservationDetails.alreadyCharged({ chargedAmount: '1280.00', authorizationCode: 'AUT-7741' }),
  reservationDetails.chargeError('Cartão recusado pela operadora'),
  reservationDetails.validatedOnly(),
  reservationDetails.invoiced(),
  reservationDetails.chargeAtTerminal(),
  reservationDetails.noCardNoForm(),
];

function hotel(code: string, name: string, count: number, offset: number) {
  return {
    code,
    name,
    reservations: Array.from({ length: count }, (_, i) => {
      const n = offset + i;
      return {
        reservationNumber: `${code}-${1000 + n}`,
        listing: {
          guestName: GUESTS[n % GUESTS.length],
          channel: CHANNELS[n % CHANNELS.length],
          checkIn: isoDate(daysFromToday(1 + (n % 5))),
          checkOut: isoDate(daysFromToday(3 + (n % 5))),
          totalAmount: (380 + n * 137.5).toFixed(2),
        },
        detail: DETAILS[n % DETAILS.length],
      };
    }),
  };
}

/** Hotéis fictícios (nunca use nomes reais: o repositório é público). */
const SCENARIO: FakeScenario = {
  validToken: TOKEN,
  hotels: [
    hotel('101', 'Hotel Praia Azul', 6, 0),
    hotel('102', 'Pousada Serra Verde', 4, 6),
    hotel('103', 'Hotel Centro Histórico', 5, 10),
    hotel('104', 'Resort Lagoa Clara', 7, 15),
  ],
};
/** A leitura das reservas deste hotel fica travada para capturar a execução em andamento. */
const HELD_HOTEL = '103';

describe.skipIf(!OUT)('captura das telas para o Figma', () => {
  const outDir = OUT ?? '';
  let certificates: TestCertificates;
  let server: E2eServer;
  let tls: TlsTerminator;
  let launched: LaunchedApp;
  const failures: string[] = [];
  let gate: { reached: () => void; released: Promise<void> } | null = null;

  async function sizeWindow(app: LaunchedApp['app']) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(size.width, size.height);
      window?.center();
    }, WINDOW);
  }

  /** Grava a tela `id` (número no Figma). `fullPage` para telas mais altas que a janela. */
  async function shot(id: string, slug: string, fullPage = false) {
    await launched.window.waitForTimeout(400);
    await launched.window.screenshot({ path: path.join(outDir, `${id}-${slug}.png`), fullPage });
  }

  async function step(name: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message.slice(0, 800)}`);
      await closeOverlays().catch(() => undefined);
    }
  }

  async function closeOverlays() {
    const { window } = launched;
    for (let i = 0; i < 3; i++) {
      if ((await window.locator('.mantine-Overlay-root').count()) === 0) return;
      await window.keyboard.press('Escape');
      await window.waitForTimeout(400);
    }
  }

  async function goTo(area: string) {
    await closeOverlays();
    await launched.window.getByRole('navigation').getByText(area, { exact: true }).click();
  }

  async function connect(apiKey: string, profile: 'Operador' | 'Consulta', capture: boolean) {
    const { app, window } = launched;
    const certificateFile = path.join(launched.userDataDir, 'hunit-raiz.crt');
    await writeFile(certificateFile, certificates.authority.certificatePem);
    await stubOpenDialog(app, certificateFile);
    await window.getByLabel('Endereço do servidor').waitFor();
    if (capture) await shot('1.1', 'configuracao-primeiro-uso');
    await window.getByLabel('Endereço do servidor').fill(tls.url);
    await window.getByRole('button', { name: /escolher certificado/i }).click();
    await window.getByText('Impressão digital (SHA-256):', { exact: false }).waitFor();
    await window.getByLabel('Chave de acesso').fill(apiKey);
    await window.getByRole('button', { name: 'Testar conexão' }).click();
    await window.getByText('Conexão confirmada').waitFor();
    if (capture) await shot('1.2', 'configuracao-conexao-confirmada', true);
    await window.getByRole('button', { name: 'Salvar conexão' }).click();
    await window
      .getByRole('banner')
      .getByText(profile, { exact: true })
      .waitFor({ timeout: 15_000 });
  }

  async function answerToken(capture: boolean) {
    const dialog = launched.window.getByRole('dialog', { name: 'O Hunit pediu o token' });
    await dialog.waitFor({ timeout: 15_000 });
    if (capture) await shot('2.4', 'executar-pedido-de-token');
    await dialog.getByLabel('Token do autenticador').fill(TOKEN);
    await dialog.getByRole('button', { name: 'Enviar token' }).click();
    await dialog.getByText(/token aceito/i).waitFor({ timeout: 10_000 });
    if (capture) await shot('2.5', 'executar-token-aceito');
    await dialog.getByRole('button', { name: 'Fechar' }).click();
  }

  beforeAll(async () => {
    await mkdir(outDir, { recursive: true });
    certificates = await createTestCertificates();
    server = await startE2eServer({ scenario: SCENARIO, twoFactorTimeoutMs: 120_000 });
    for (const item of SCENARIO.hotels ?? []) await server.insertHotel(item.code, item.name ?? '');
    const pool = server.test.database.pool;
    const rename = 'update api_clients set name = $1 where id = $2';
    await pool.query(rename, ['Recepção — PC 1', server.operator.id]);
    await pool.query(rename, ['Financeiro — consulta', server.reader.id]);
    server.hunit.before('readReservation', async (call) => {
      const current = gate;
      if (!current || call.hotelCode !== HELD_HOTEL) return;
      current.reached();
      await current.released;
    });
    tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
    launched = await launchApp();
    await sizeWindow(launched.app);
  });

  afterAll(async () => {
    gate = null;
    await launched?.close();
    await tls?.close();
    await server?.close();
    if (outDir)
      await writeFile(path.join(outDir, 'falhas.txt'), failures.join('\n\n') || 'nenhuma');
  });

  it('percorre as telas', async () => {
    const { window } = launched;

    await step('1.1 e 1.2 configuração', () => connect(server.operator.apiKey, 'Operador', true));

    await step('2.1 a 2.3 executar', async () => {
      await window.getByRole('button', { name: 'Iniciar execução' }).waitFor();
      await shot('2.1', 'executar-vazio');
      await window.getByLabel('Usuário do Hunit').fill('operador@exemplo.com.br');
      await window.getByLabel('Senha do Hunit').fill('senha-ficticia');
      await window.getByLabel('Período de check-in').click();
      await pickPeriod(window, daysFromToday(0), daysFromToday(6));
      await window.getByLabel('Período de check-in').click();
      await shot('2.2', 'executar-escolhendo-o-periodo');
      await window.keyboard.press('Escape');
      await window.getByLabel('Escolher hotéis').click();
      await shot('2.3', 'executar-escolher-hoteis');
      await window.getByLabel('Todos os hotéis do catálogo').click();
    });

    let release: () => void = () => undefined;
    await step('2.4 a 2.6 execução em andamento', async () => {
      let reached: () => void = () => undefined;
      const released = new Promise<void>((resolve) => (release = resolve));
      const reachedHotel = new Promise<void>((resolve) => (reached = resolve));
      gate = { reached, released };
      await window.getByRole('button', { name: 'Iniciar execução' }).click();
      await answerToken(true);
      await reachedHotel;
      await window.waitForTimeout(1500);
      await shot('2.6', 'executar-execucao-em-andamento', true);
    });

    await step('3.1 a 3.3 execuções em andamento', async () => {
      await goTo('Execuções');
      await window.locator('tbody tr').first().waitFor();
      await shot('3.1', 'execucoes-lista');
      await window.locator('tbody tr').first().click();
      await window.getByText('Detalhe da execução').waitFor();
      await shot('3.2', 'execucoes-detalhe-em-andamento');
      await window.getByRole('button', { name: 'Cancelar execução' }).click();
      await shot('3.3', 'execucoes-confirmar-cancelamento');
      await window.getByRole('button', { name: 'Não' }).click();
      await closeOverlays();
    });

    await step('3.4 execução concluída', async () => {
      gate = null;
      release();
      await window.waitForTimeout(4000);
      await goTo('Executar');
      await goTo('Execuções');
      await window.locator('tbody tr').first().click();
      await window.getByText('Detalhe da execução').waitFor();
      await shot('3.4', 'execucoes-detalhe-concluida');
    });

    await step('4.1 a 4.3 reservas', async () => {
      await goTo('Reservas');
      await window.locator('tbody tr').first().waitFor({ timeout: 15_000 });
      await shot('4.1', 'reservas-lista');
      await window.locator('tbody tr').nth(2).click();
      await window.getByTestId('reservation-detail').waitFor();
      await shot('4.2', 'reservas-detalhe-da-reserva');
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();
      await window.getByLabel('Busca livre').fill('Maria Oliveira');
      await window.getByRole('button', { name: 'Buscar' }).click();
      await window.getByText('Nenhuma reserva encontrada com estes filtros.').waitFor();
      await shot('4.3', 'reservas-nenhum-resultado');
      await window.getByRole('button', { name: 'Limpar' }).click();
    });

    await step('1.3 configuração conectada', async () => {
      await goTo('Configuração');
      await window.getByRole('heading', { name: 'Preferências' }).waitFor();
      await shot('1.3', 'configuracao-conectado-operador', true);
    });

    await step('2.8 senha errada', async () => {
      server.setScenario({ ...SCENARIO, login: new InvalidCredentialsError() });
      try {
        await goTo('Executar');
        await window.getByRole('button', { name: 'Limpar acesso' }).click();
        await window.getByLabel('Usuário do Hunit').fill('operador@exemplo.com.br');
        await window.getByLabel('Senha do Hunit').fill('senha-errada');
        await window.getByRole('button', { name: 'Iniciar execução' }).click();
        await window
          .getByText('Usuário ou senha do Hunit incorretos.')
          .waitFor({ timeout: 15_000 });
        await shot('2.8', 'executar-usuario-ou-senha-incorretos');
      } finally {
        server.setScenario(SCENARIO);
      }
    });

    await step('2.9 e 2.10 token recusado', async () => {
      // Depois da senha errada o acesso continua guardado; só preenche se o formulário voltou.
      const username = window.getByLabel('Usuário do Hunit');
      if (await username.isVisible()) {
        await username.fill('operador@exemplo.com.br');
        await window.getByLabel('Senha do Hunit').fill('senha-ficticia');
      }
      await window.getByRole('button', { name: 'Iniciar execução' }).click();
      const dialog = window.getByRole('dialog', { name: 'O Hunit pediu o token' });
      await dialog.waitFor({ timeout: 15_000 });
      await dialog.getByLabel('Token do autenticador').fill('111111');
      await dialog.getByRole('button', { name: 'Enviar token' }).click();
      await dialog.getByText('O Hunit recusou o token.').waitFor({ timeout: 10_000 });
      await shot('2.9', 'executar-token-recusado-dialogo');
      await dialog.getByRole('button', { name: 'Fechar' }).click();
      await window.getByRole('button', { name: 'Iniciar de novo' }).waitFor();
      await shot('2.10', 'executar-falhou-com-iniciar-de-novo');
    });

    // O resultado só aparece na tela Executar enquanto ela não é trocada por outra área.
    await step('2.7 resultado', async () => {
      await window.getByRole('button', { name: 'Iniciar de novo' }).click();
      await answerToken(false);
      await window.getByText('Resultado da execução').waitFor({ timeout: 30_000 });
      await window.waitForTimeout(1000);
      await shot('2.7', 'executar-resultado-concluida', true);
    });

    await step('5.1 servidor indisponível', async () => {
      await goTo('Execuções');
      await tls.close();
      await window
        .getByText('Servidor indisponível', { exact: true })
        .first()
        .waitFor({ timeout: 45_000 });
      await shot('5.1', 'servidor-indisponivel');
    });

    await step('6.1 e 6.2 perfil consulta', async () => {
      await stubMessageBox(launched.app, 0);
      await launched.close();
      tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
      launched = await launchApp();
      await sizeWindow(launched.app);
      await connect(server.reader.apiKey, 'Consulta', false);
      await launched.window.locator('tbody tr').first().waitFor({ timeout: 15_000 });
      await shot('6.1', 'consulta-execucoes');
      await goTo('Reservas');
      await launched.window.locator('tbody tr').first().waitFor({ timeout: 15_000 });
      await shot('6.2', 'consulta-reservas');
    });
  }, 600_000);
});
