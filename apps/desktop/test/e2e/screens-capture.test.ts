/**
 * Captura das telas do app para comparar com o design no Figma (spec da feature; a skill
 * `figma-screens-sync` só marca as telas em uso depois).
 *
 * Não é um teste: fica desligado nas rodadas normais e só roda com `HUNIT_SCREENS_DIR` definida
 * (pasta onde os prints são gravados). Abre o app compilado contra a API da 001 com o Hunit
 * simulado e dados fictícios, percorre os estados e grava um PNG por tela, com o mesmo número da
 * tela no Figma (ex.: `2.4-executar-pedido-de-token.png`). Passos que falham não interrompem a
 * captura; ficam em `falhas.txt` na mesma pasta (o console do Vitest não mostra o `console.log`).
 *
 * Mudou a lista de telas? Atualize também o catálogo em
 * `.claude/skills/figma-screens-sync/references/screens.md`.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { InvalidCredentialsError } from '../../../server/src/hunit/errors.js';
import { setHotelMapping } from '../../../server/src/persistence/legacy-import-repo.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import {
  reservationDetails,
  type FakeScenario,
} from '../../../server/test/helpers/fake-hunit-gateway.js';
import {
  legacyAttachmentPath,
  legacyFile,
  legacyReservationRow,
  legacyTreatmentRow,
  writeLegacyAttachments,
  writeLegacyWorkbook,
} from '../../../server/test/helpers/legacy-fixtures.js';
import {
  legacyImport,
  legacyWorkspace,
  reportId,
} from '../../../server/test/helpers/legacy-import.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { emlFile, pdfFile, pngFile } from '../helpers/synthetic-files.js';
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
    // Planilha do Comercial em memória (specs/005): telas do envio e da área Comercial.
    server = await startE2eServer({
      scenario: SCENARIO,
      twoFactorTimeoutMs: 120_000,
      commercialSheet: true,
    });
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
      // O pickPeriod abre o calendário sozinho; o clique seguinte o reabre com o intervalo marcado.
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

    // Tratativas (specs/003): documentos fictícios registrados pela API antes das telas.
    await step('4.4 a 4.8 tratativas', async () => {
      const files = await mkdtemp(path.join(tmpdir(), 'hunit-telas-arquivos-'));
      const write = async (name: string, content: Buffer) => {
        const target = path.join(files, name);
        await writeFile(target, content);
        return target;
      };
      const comprovante = await write('comprovante-cobranca.png', pngFile());
      const pedido = await write(
        'pedido-de-cobranca.eml',
        emlFile({
          subject: 'Pedido de cobrança — reserva 101-1005',
          text:
            'Olá, equipe do Comercial.\n\nFavor cobrar na maquininha a reserva 101-1005 ' +
            '(Fábio Rocha), check-out amanhã.\n\nObrigado,\nFinanceiro',
          attachment: { name: 'resumo-da-reserva.txt', content: 'Reserva 101-1005' },
        }),
      );

      const api = (method: 'POST', url: string, payload: unknown, headers = {}) =>
        server.test.app.inject({
          method,
          url,
          headers: { ...server.operator.headers, ...headers },
          payload: payload as string,
        });
      const register = async (
        number: string,
        kind: 'request' | 'proof',
        name: string,
        content: Buffer,
      ) => {
        const upload = await api(
          'POST',
          `/v1/treatment-files?name=${encodeURIComponent(name)}`,
          content,
          {
            'content-type': 'application/octet-stream',
          },
        );
        const { fileId } = upload.json<{ fileId: string }>();
        await api('POST', '/v1/treatment-documents', {
          kind,
          fileId,
          fileName: name,
          reservations: [{ hotelCode: number.slice(0, 3), reservationNumber: number }],
        });
      };
      await register(
        '101-1000',
        'request',
        'pedido-ao-comercial.eml',
        emlFile({ subject: 'Pedido 101-1000' }),
      );
      await register('101-1000', 'proof', 'comprovante-antigo.pdf', pdfFile('Comprovante antigo'));
      await register(
        '101-1000',
        'proof',
        'comprovante-101-1000.pdf',
        pdfFile('Comprovante 101-1000'),
      );
      await register(
        '101-1003',
        'request',
        'pedido-101-1003.eml',
        emlFile({ subject: 'Pedido 101-1003' }),
      );
      // Valor informado, removido e informado de novo: o histórico passa de 5 itens e a tela
      // 4.7 mostra "Mostrar mais" (FR-017a).
      for (const method of ['PUT', 'DELETE', 'PUT'] as const) {
        await server.test.app.inject({
          method,
          url: '/v1/reservations/101/101-1000/manual-amount',
          headers: server.operator.headers,
          ...(method === 'PUT' && { payload: { amount: '380.00' } }),
        });
      }
      // Tratativa enviada e, depois, o Hunit passou a mostrar "Já cobrada": alerta "Verificar"
      // (FR-002a, tela 4.9).
      await register(
        '102-1007',
        'request',
        'pedido-102-1007.eml',
        emlFile({ subject: 'Pedido 102-1007' }),
      );
      await server.test.database.pool.query(
        `update reservations set classification = 'virtual_card_already_charged',
           previous_classification = classification, status_changed = true,
           status_changed_at = now()
         where hotel_code = '102' and reservation_number = '102-1007'`,
      );

      await goTo('Reservas');
      await window.getByRole('button', { name: 'Limpar' }).first().click();
      await window.locator('tbody tr').first().waitFor({ timeout: 15_000 });
      for (const number of ['101-1002', '101-1003', '101-1005']) {
        await window.getByRole('checkbox', { name: `Selecionar a reserva ${number}` }).check();
      }
      await window.getByLabel('Busca livre').fill('104-1015');
      await window.getByRole('button', { name: 'Buscar' }).click();
      await window.getByRole('checkbox', { name: 'Selecionar a reserva 104-1015' }).check();
      await window.getByLabel('Busca livre').fill('');
      await window.getByRole('button', { name: 'Buscar' }).click();
      await window.getByRole('checkbox', { name: 'Selecionar a reserva 101-1002' }).waitFor();
      await shot('4.4', 'reservas-selecao-do-lote');

      await window.getByRole('button', { name: 'Ver seleção' }).click();
      await window.getByRole('table', { name: 'Reservas selecionadas' }).waitFor();
      await shot('4.5', 'reservas-reservas-selecionadas');
      await window.getByRole('button', { name: 'Fechar seleção' }).click();

      await stubOpenDialog(launched.app, comprovante);
      await window
        .getByTestId('selection-bar')
        .getByRole('button', { name: 'Anexar comprovante' })
        .click();
      const batch = window.getByRole('dialog', { name: /Anexar comprovante a 4 reservas/ });
      await batch.getByTestId('attach-summary').waitFor({ timeout: 15_000 });
      await shot('4.6', 'reservas-anexar-comprovante-em-lote', true);
      await batch.getByRole('button', { name: 'Cancelar' }).click();
      await batch.waitFor({ state: 'detached' });
      await window
        .getByTestId('selection-bar')
        .getByRole('button', { name: 'Desmarcar todas' })
        .click();

      await window.getByRole('cell', { name: '101-1000', exact: true }).click();
      await window
        .getByTestId('treatment-section')
        .getByText('Histórico')
        .waitFor({ timeout: 15_000 });
      await shot('4.7', 'reservas-detalhe-com-tratativa', true);
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();

      await window.getByRole('cell', { name: '101-1005', exact: true }).click();
      await stubOpenDialog(launched.app, pedido);
      await window
        .getByTestId('treatment-section')
        .getByRole('button', { name: 'Anexar tratativa' })
        .click();
      const single = window.getByRole('dialog', { name: /Anexar tratativa/ });
      await single.getByTestId('attach-summary').waitFor({ timeout: 15_000 });
      await shot('4.8', 'reservas-anexar-tratativa-email');
      await single.getByRole('button', { name: 'Cancelar' }).click();
      await single.waitFor({ state: 'detached' });
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();

      await window.getByRole('cell', { name: '102-1007', exact: true }).click();
      await window.getByTestId('review-alert').waitFor({ timeout: 15_000 });
      await shot('4.9', 'reservas-detalhe-verificar', true);
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();
    });

    // Importação do histórico (specs/004): reservas importadas pelo comando real, com dados
    // fictícios, para as telas da origem "Sistema anterior".
    await step('4.10 e 4.11 sistema anterior', async () => {
      const workspace = legacyWorkspace();
      try {
        await writeLegacyWorkbook(workspace.xlsx, {
          reservations: [
            legacyReservationRow({ Reserva: 'SA-2001', Hospede: 'Lúcia Barros' }, 1),
            legacyReservationRow(
              {
                Reserva: 'SA-2002',
                Hospede: 'Marcos Teixeira',
                'Codigo status': 'not_virtual_card',
                Status: 'Sem cartao virtual',
              },
              2,
            ),
          ],
          treatments: [
            legacyTreatmentRow('SA-2002', {
              'Tratativa - arquivo no Dropbox': legacyAttachmentPath('pedido_sa_2002.pdf'),
              'Tratativa - nome original': 'Pedido de cobrança SA-2002.pdf',
              'Tratativa anexada em': '2026-05-02T09:30:00',
            }),
          ],
        });
        writeLegacyAttachments(workspace.files, {
          [legacyAttachmentPath('pedido_sa_2002.pdf')]: legacyFile.pdf('sa-2002'),
        });
        const args = ['--xlsx', workspace.xlsx, '--files', workspace.files];
        await legacyImport(server.test.database, ['simulate', ...args]);
        await setHotelMapping(server.test.database.db, 'legacy_hml_um', '101');
        const simulation = await legacyImport(server.test.database, ['simulate', ...args]);
        await legacyImport(server.test.database, [
          'run',
          '--simulation',
          reportId(simulation.stdout),
          ...args,
        ]);
      } finally {
        workspace.cleanup();
      }

      await goTo('Reservas');
      await window.getByRole('button', { name: 'Limpar' }).first().click();
      const origin = window.getByLabel('Origem').and(window.locator('input'));
      await origin.click();
      await window.getByRole('option', { name: 'Sistema anterior' }).click();
      await window.getByRole('button', { name: 'Buscar' }).click();
      await window.getByTestId('legacy-badge').first().waitFor({ timeout: 15_000 });
      await shot('4.10', 'reservas-filtro-sistema-anterior');

      await window.getByRole('cell', { name: 'SA-2002 Sistema anterior', exact: true }).click();
      await window.getByTestId('legacy-origin').waitFor({ timeout: 15_000 });
      await window
        .getByTestId('treatment-section')
        .getByText('Histórico')
        .waitFor({ timeout: 15_000 });
      await shot('4.11', 'reservas-detalhe-sistema-anterior', true);
      await window.getByRole('button', { name: 'Fechar detalhe' }).click();
      await window.getByRole('button', { name: 'Limpar' }).first().click();
    });

    // Envio ao Comercial (specs/005): envio com token, retornos na planilha em memória, validação,
    // área "Comercial" e as ações novas da lista de reservas.
    await step('7.1 a 7.4 envio ao Comercial', async () => {
      await goTo('Reservas');
      await window.getByRole('button', { name: 'Limpar' }).first().click();
      await window.getByRole('button', { name: 'Falta cobrar' }).click();
      await window.locator('tbody tr').first().waitFor({ timeout: 15_000 });
      await window.getByRole('checkbox', { name: 'Selecionar todas as reservas listadas' }).check();
      await window.getByRole('button', { name: 'Enviar ao Comercial' }).click();
      const dialog = window.getByRole('dialog', { name: 'Enviar ao Comercial' });
      await dialog.getByTestId('dispatch-summary').waitFor({ timeout: 15_000 });
      const username = dialog.getByLabel('Usuário do Hunit');
      if (await username.isVisible()) {
        await username.fill('operador@exemplo.com.br');
        await dialog.getByLabel('Senha do Hunit').fill('senha-ficticia');
      }
      await shot('7.1', 'envio-conferencia');

      // A leitura de uma reserva do hotel 103 fica travada para mostrar o envio em andamento.
      let release: () => void = () => undefined;
      let reached: () => void = () => undefined;
      const released = new Promise<void>((resolve) => (release = resolve));
      const reachedHotel = new Promise<void>((resolve) => (reached = resolve));
      gate = { reached, released };
      await dialog.getByRole('button', { name: /^Enviar \d+ ao Comercial$/ }).click();
      const token = window.getByRole('dialog', { name: 'O Hunit pediu o token' });
      await token.waitFor({ timeout: 15_000 });
      await shot('7.3', 'envio-pedido-de-token');
      await token.getByLabel('Token do autenticador').fill(TOKEN);
      await token.getByRole('button', { name: 'Enviar token' }).click();
      await token.getByText(/token aceito/i).waitFor({ timeout: 10_000 });
      await token.getByRole('button', { name: 'Fechar' }).click();
      await Promise.race([reachedHotel, window.waitForTimeout(15_000)]);
      await window.waitForTimeout(1000);
      await shot('7.2', 'envio-em-andamento', true);
      gate = null;
      release();
      await dialog.getByTestId('dispatch-view').getByText('Concluído', { exact: true }).waitFor({
        timeout: 30_000,
      });
      await shot('7.4', 'envio-concluido', true);
      await dialog.getByRole('button', { name: 'Fechar' }).last().click();
    });

    await step('7.5 a 7.10 retornos e área Comercial', async () => {
      // A planilha recebe as linhas; o Comercial preenche dois retornos (um completo, com a
      // maquininha de outro estabelecimento, e um incompleto).
      await server.test.sync?.runRound();
      const lines = await server.test.database.pool.query<{ number: string; hotel: string }>(
        `select l.reservation_number as number, h.name as hotel from commercial_lines l
         join hotels h on h.code = l.hotel_code where l.state = 'open'
         order by l.reservation_number limit 3`,
      );
      const [first, second, third] = lines.rows;
      if (first) {
        server.sheet?.fillReturn(first.hotel, first.number, [
          'AUT-55210',
          'Maquininha Centro de Convenções',
          '1280,00',
          'Paula (Comercial)',
        ]);
      }
      if (second) {
        server.sheet?.fillReturn(second.hotel, second.number, [
          'AUT-55211',
          second.hotel,
          '515,00',
          'Paula (Comercial)',
        ]);
      }
      if (third) server.sheet?.fillReturn(third.hotel, third.number, ['AUT-55212', '', '', '']);
      await server.test.sync?.runRound();

      await goTo('Reservas');
      await window.getByRole('button', { name: 'Limpar' }).first().click();
      if (first) await window.getByLabel('Busca livre').fill(first.number);
      await window.getByRole('button', { name: 'Buscar' }).click();
      await window.locator('tbody tr').first().click();
      await window.getByTestId('commercial-return').waitFor({ timeout: 15_000 });
      await shot('7.5', 'reservas-detalhe-validar-comprovante', true);
      await window
        .getByTestId('commercial-return')
        .getByRole('button', { name: 'Recusar' })
        .click();
      await window.getByText('Valor diferente').click();
      await shot('7.6', 'reservas-recusar-retorno');
      // Fecha o diálogo e a gaveta do detalhe.
      await closeOverlays();

      await goTo('Comercial');
      await window.getByRole('table', { name: 'Envios ao Comercial' }).waitFor();
      await shot('7.7', 'comercial-envios');
      await window.getByRole('tab', { name: 'Retornos a validar' }).click();
      await window.getByRole('table', { name: 'Retornos a validar' }).waitFor({ timeout: 15_000 });
      await shot('7.8', 'comercial-retornos-a-validar');
      await window.getByRole('tab', { name: 'Retornos com problema' }).click();
      await window
        .getByRole('table', { name: 'Retornos com problema' })
        .waitFor({ timeout: 15_000 });
      await shot('7.9', 'comercial-retornos-com-problema');
      await window.getByRole('tab', { name: 'Planilha' }).click();
      await window.getByTestId('sheet-status').waitFor({ timeout: 15_000 });
      await shot('7.10', 'comercial-planilha');
    });

    await step('7.11 a 7.14 ações da seleção e cópia para e-mail', async () => {
      await goTo('Reservas');
      await window.getByRole('button', { name: 'Limpar' }).first().click();
      await window.getByRole('button', { name: 'Buscar' }).click();
      await window.locator('tbody tr').first().waitFor({ timeout: 15_000 });
      await window
        .getByRole('button', { name: 'Desmarcar todas' })
        .click()
        .catch(() => undefined);
      await window.getByRole('button', { name: 'Selecionar todas do filtro' }).click();
      await window.getByText(/selecionadas do filtro/).waitFor({ timeout: 15_000 });
      await shot('7.11', 'reservas-selecionar-todas-do-filtro');

      await window.getByRole('button', { name: 'Confirmar retornos' }).click();
      await window.getByTestId('batch-summary').waitFor();
      await shot('7.12', 'reservas-confirmar-retornos-em-lote');
      await closeOverlays();

      await window.getByRole('button', { name: 'Confirmar "Verificar"' }).click();
      await window.getByTestId('batch-summary').waitFor();
      await shot('7.13', 'reservas-confirmar-verificar-em-lote');
      await closeOverlays();

      await window.getByRole('button', { name: 'Copiar para e-mail' }).click();
      await window.getByRole('dialog', { name: 'Copiar para e-mail' }).waitFor();
      await shot('7.14', 'reservas-copiar-para-email');
      await closeOverlays();
      await window.getByRole('button', { name: 'Desmarcar todas' }).click();
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
