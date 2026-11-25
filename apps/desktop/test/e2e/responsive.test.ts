/**
 * Roteiro de larguras (specs/006, T021, SC-007, FR-043 a FR-045 e FR-047, research R-07 e R-16): cada
 * área já no visual novo, com os diálogos dela, em 960 × 640, 1 280 × 820, 1 920 × 1 080 e em
 * 960 × 640 com zoom de 125 %. Em cada tamanho: sem rolagem horizontal da página, nada marcado como
 * "não cortar" cortado (valores, selos, rótulos de ação), as ações e informações do design ao alcance,
 * os diálogos inteiros e centralizados na área visível, com os 24 px de espaçamento (SC-009), e,
 * abaixo de 1 180 px, o menu só com os ícones e a área ativa identificável. App compilado contra a API da 001 com o Hunit simulado.
 *
 * Cada história do redesenho acrescenta aqui as telas dela (tarefas "registrar no roteiro de
 * larguras"): um `it` por estado, com `checkAllSizes`. Hoje: Configuração e Executar (US1) e
 * Reservas (US2: lista com a barra de seleção, painel "Filtros avançados" e nenhum resultado; US4: a
 * gaveta "Reservas selecionadas" e o diálogo de anexar em lote; US5: a gaveta da reserva com
 * comprovante e valor informado), Comercial (US8: as quatro abas com envio, retorno e problema, a
 * recusa do retorno e a conferência do envio) e Execuções (US6: a lista com o card da em andamento e
 * o "Histórico", a gaveta encerrada e em andamento e o "Cancelar a execução?").
 *
 * Desde a homologação da 006 (T068), também nenhuma célula de tabela transbordando para a vizinha, e
 * as listas passam por uma varredura de larguras (`sweepWidths`: janela de 960 a 1 920 px de 20 em
 * 20, e de 960 a 1 200 px com zoom de 125 %), porque os pontos de quebra das colunas ficam entre os
 * quatro tamanhos: a lista de reservas sobrepunha o hóspede ao período num segundo monitor.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { insertDispatch, insertLine } from '../../../server/test/helpers/commercial-fixtures.js';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import type { FakeScenario } from '../../../server/test/helpers/fake-hunit-gateway.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { pdfFile } from '../helpers/synthetic-files.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  daysFromToday,
  isoDate,
  launchApp,
  openReservationFilters,
  pickPeriod,
  resizeWindow,
  searchReservations,
  stubOpenDialog,
  waitForReservationRows,
  type LaunchedApp,
  type WindowSize,
} from './app-fixture.js';
import {
  cellOverflows,
  expectCardCornersClipped,
  expectCellsFit,
  expectDialogFits,
  expectDialogSpacing,
  expectNoHorizontalScroll,
  expectNothingTruncated,
  expectReachable,
  expectSideMenu,
} from './layout-checks.js';
import type { Locator } from 'playwright';

const TOKEN = '246810';

/** Hotéis fictícios (o repositório é público), com nomes longos para as pílulas do seletor. */
const HOTELS = [
  { code: '101', name: 'Hotel Praia Azul' },
  { code: '102', name: 'Pousada Serra Verde e Centro de Convenções do Vale' },
  { code: '103', name: 'Hotel Centro Histórico' },
  { code: '104', name: 'Resort Lagoa Clara' },
];

const SCENARIO: FakeScenario = {
  validToken: TOKEN,
  hotels: HOTELS.map((hotel, index) => ({
    ...hotel,
    reservations: [
      {
        reservationNumber: `${hotel.code}-1`,
        listing: { checkIn: isoDate(daysFromToday(1 + index)) },
      },
    ],
  })),
};

interface Size {
  label: string;
  window: WindowSize;
  zoom: number;
  /** Janela abaixo de 1 180 px (em px de CSS): menu só com os ícones (research R-07). */
  collapsedMenu: boolean;
}

const SIZES: Size[] = [
  { label: '960 × 640', window: { width: 960, height: 640 }, zoom: 1, collapsedMenu: true },
  { label: '1 280 × 820', window: { width: 1280, height: 820 }, zoom: 1, collapsedMenu: false },
  {
    label: '1 920 × 1 080',
    window: { width: 1920, height: 1080 },
    zoom: 1,
    collapsedMenu: false,
  },
  {
    label: '960 × 640 com zoom de 125 %',
    window: { width: 960, height: 640 },
    zoom: 1.25,
    collapsedMenu: true,
  },
];

const DEFAULT_SIZE: WindowSize = { width: 1280, height: 820 };

/** Varredura de larguras (T068): cobre o conteúdo de ~630 px (mínimo com zoom) a ~1 650 px. */
const SWEEP = [
  { zoom: 1, from: 960, to: 1920 },
  { zoom: 1.25, from: 960, to: 1200 },
] as const;

let certificates: TestCertificates;
let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  certificates = await createTestCertificates();
  // Prazo do token folgado: o diálogo fica aberto enquanto a janela passa pelos quatro tamanhos.
  server = await startE2eServer({
    scenario: SCENARIO,
    twoFactorTimeoutMs: 120_000,
    // A planilha do Comercial em memória, para a área Comercial (US8).
    commercialSheet: true,
  });
  for (const hotel of HOTELS) await server.insertHotel(hotel.code, hotel.name);
  // Reservas com nome longo, valor alto e selo comprido, para o corte e as quebras (FR-045).
  for (const [index, hotel] of HOTELS.entries()) {
    await server.insertReservation({
      hotelCode: hotel.code,
      reservationNumber: `R-${index + 1}`,
      guestName: 'Maria Aparecida de Albuquerque Figueiredo Nogueira da Silva',
      channel: 'Booking.com',
      checkIn: isoDate(daysFromToday(index)),
      checkOut: isoDate(daysFromToday(index + 2)),
      totalAmount: '123456.78',
      chargedAmount: index % 2 === 0 ? '123456.78' : null,
      classification:
        index % 2 === 0 ? 'virtual_card_already_charged' : 'virtual_card_validated_only',
    });
  }
  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp();
});

afterAll(async () => {
  await launched?.close();
  await tls?.close();
  await server?.close();
});

interface ScreenState {
  /** Nome do estado nas mensagens de falha. */
  name: string;
  /** Área ativa no menu. */
  area: string;
  /** Informações e ações do design que têm de continuar ao alcance. */
  reachable: () => Locator[];
  /** Diálogo aberto neste estado, que tem de caber na área visível. */
  dialog?: () => Locator;
}

/** Passa a janela por todos os tamanhos e confere o estado em cada um; volta ao tamanho padrão. */
async function checkAllSizes(state: ScreenState): Promise<void> {
  const { app, window } = launched;
  try {
    for (const size of SIZES) {
      await resizeWindow(app, window, size.window, size.zoom);
      const where = `— ${state.name}, ${size.label}`;
      // Confere o tamanho em px de CSS: a moldura do Windows tira alguns px e o zoom divide.
      const width = await window.evaluate(() => globalThis.innerWidth);
      expect(width, `largura da página ${where}`).toBeGreaterThan(
        (size.window.width - 40) / size.zoom,
      );
      expect(width, `largura da página ${where}`).toBeLessThanOrEqual(
        size.window.width / size.zoom,
      );
      await expectNoHorizontalScroll(window, where);
      await expectNothingTruncated(window, where);
      await expectCellsFit(window, where);
      await expectSideMenu(window, { collapsed: size.collapsedMenu, active: state.area }, where);
      if (state.dialog) {
        await expectDialogFits(state.dialog(), where);
        await expectDialogSpacing(state.dialog(), where);
      }
      for (const locator of state.reachable()) await expectReachable(locator, where);
    }
  } finally {
    await resizeWindow(app, window, DEFAULT_SIZE, 1);
  }
}

/**
 * Passa a janela por todas as larguras da varredura (`SWEEP`) e junta os problemas de cada uma: rolagem
 * horizontal, algo cortado, célula transbordando e o que `check` devolver. Falha no fim, com a lista
 * inteira, para mostrar todas as faixas de largura com problema de uma vez.
 */
async function sweepWidths(
  check: () => Promise<string[]> = () => Promise.resolve([]),
): Promise<void> {
  const { app, window } = launched;
  const problems: string[] = [];
  try {
    for (const { zoom, from, to } of SWEEP) {
      for (let width = from; width <= to; width += 20) {
        await resizeWindow(app, window, { width, height: 720 }, zoom);
        const where = `janela de ${width} px${zoom === 1 ? '' : ' com zoom de 125 %'}`;
        const found = [
          ...(await window.evaluate(() =>
            document.documentElement.scrollWidth > document.documentElement.clientWidth
              ? ['rolagem horizontal']
              : [],
          )),
          ...(await cellOverflows(window)),
          ...(await check()),
        ];
        problems.push(...found.map((problem) => `${where}: ${problem}`));
      }
    }
  } finally {
    await resizeWindow(app, window, DEFAULT_SIZE, 1);
  }
  expect(problems).toEqual([]);
}

/**
 * A coluna sem largura fixa de uma lista (o hóspede, o hotel da cobrança…) tem pelo menos `min` px de
 * conteúdo quando a lista tem `from` px ou mais, e `narrowMin` abaixo disso (T068).
 */
async function flexColumnWidth(
  table: Locator,
  column: string,
  limits: { from: number; min: number; narrowMin: number },
): Promise<string[]> {
  const { listWidth, columnWidth } = await table.evaluate((element, key) => {
    const header = element.querySelector<HTMLElement>(`th[data-col="${key}"]`);
    const style = header ? getComputedStyle(header) : null;
    return {
      listWidth: element.getBoundingClientRect().width,
      columnWidth:
        header && style
          ? header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          : 0,
    };
  }, column);
  const min = listWidth >= limits.from ? limits.min : limits.narrowMin;
  return columnWidth >= min
    ? []
    : [
        `coluna ${column} com ${Math.round(columnWidth)} px numa lista de ${Math.round(listWidth)} px (mínimo ${min})`,
      ];
}

/** A linha de uma reserva numa lista (pelo número, que só aparece na linha dela). */
function returnRow(table: Locator, reservationNumber: string): Locator {
  return table.locator('tbody tr').filter({ hasText: reservationNumber });
}

function button(name: string): Locator {
  return launched.window.getByRole('button', { name, exact: true });
}

/** Registra uma tratativa ou um comprovante pela API (como o operador faria pelo app). */
async function registerDocument(
  hotelCode: string,
  reservationNumber: string,
  kind: 'request' | 'proof',
  name: string,
  content: Buffer,
): Promise<void> {
  const upload = await server.test.app.inject({
    method: 'POST',
    url: `/v1/treatment-files?name=${encodeURIComponent(name)}`,
    headers: { ...server.operator.headers, 'content-type': 'application/octet-stream' },
    payload: content,
  });
  const { fileId } = upload.json<{ fileId: string }>();
  const registered = await server.test.app.inject({
    method: 'POST',
    url: '/v1/treatment-documents',
    headers: server.operator.headers,
    payload: { kind, fileId, fileName: name, reservations: [{ hotelCode, reservationNumber }] },
  });
  expect(registered.statusCode, registered.body).toBeLessThan(300);
}

async function goTo(area: string): Promise<void> {
  await launched.window.getByRole('navigation').getByRole('button', { name: area }).click();
}

describe('larguras: Configuração e Executar (US9, SC-007)', () => {
  it('Configuração no primeiro uso (tela 1.1)', async () => {
    const { window } = launched;
    await window.getByLabel('Endereço do servidor').waitFor();
    await checkAllSizes({
      name: 'Configuração no primeiro uso',
      area: 'Configuração',
      reachable: () => [
        window.getByLabel('Endereço do servidor'),
        button('Escolher certificado raiz…'),
        window.getByLabel('Chave de acesso'),
        button('Testar conexão'),
        button('Salvar conexão'),
        // Card do aviso com o som e o volume (specs/008, US1).
        // A chave em si é um input invisível do Mantine: confere o rótulo clicável.
        window.getByText('Tocar som do aviso', { exact: true }),
        window.getByRole('slider', { name: 'Volume do aviso' }),
        window.getByText('100 %'),
        button('Testar aviso'),
      ],
    });
  });

  it('Executar com o formulário preenchido e o seletor de hotéis (telas 2.1 e 2.3)', async () => {
    await configureApp(launched, {
      serverUrl: tls.url,
      certificatePem: certificates.authority.certificatePem,
      apiKey: server.operator.apiKey,
    });
    const { window } = launched;
    await window.getByLabel('Usuário do Hunit').fill('operador@exemplo.com.br');
    await window.getByLabel('Senha do Hunit').fill('senha-ficticia');
    await pickPeriod(window, daysFromToday(0), daysFromToday(6));
    await window.getByRole('radio', { name: 'Escolher hotéis' }).check();
    await window.getByRole('combobox', { name: 'Hotéis escolhidos' }).click();
    for (const hotel of HOTELS.slice(0, 3)) {
      await window.getByRole('option', { name: `${hotel.name} (${hotel.code})` }).click();
    }
    await window.keyboard.press('Escape');

    await checkAllSizes({
      name: 'Executar preenchido',
      area: 'Executar',
      reachable: () => [
        window.getByLabel('Usuário do Hunit'),
        window.getByLabel('Senha do Hunit'),
        button('Guardar acesso'),
        window.getByLabel('Período de check-in'),
        window.getByRole('radio', { name: 'Todos os hotéis do catálogo' }),
        window.getByRole('combobox', { name: 'Hotéis escolhidos' }),
        button('Iniciar execução'),
      ],
    });
  });

  it('Executar com o calendário do período aberto (tela 2.2)', async () => {
    const { window } = launched;
    await window.getByLabel('Período de check-in').click();
    const calendar = window.getByRole('dialog').filter({ has: window.getByRole('table') });
    await calendar.waitFor();
    try {
      await checkAllSizes({
        name: 'Executar com o calendário aberto',
        area: 'Executar',
        reachable: () => [calendar.getByRole('table').first(), calendar.getByRole('table').last()],
      });
    } finally {
      await window.keyboard.press('Escape');
    }
  });

  it('Executar com o acesso guardado (tela 2.5)', async () => {
    const { window } = launched;
    await button('Guardar acesso').click();
    await button('Limpar acesso').waitFor();
    await checkAllSizes({
      name: 'Executar com o acesso guardado',
      area: 'Executar',
      reachable: () => [window.getByText(/senha guardada/i), button('Limpar acesso')],
    });
  });

  it('Configuração com a conexão salva e as preferências (tela 1.3)', async () => {
    const { window } = launched;
    await goTo('Configuração');
    await button('Remover a configuração desta máquina').waitFor();
    await checkAllSizes({
      name: 'Configuração salva',
      area: 'Configuração',
      reachable: () => [
        window.getByText('Impressão digital (SHA-256):', { exact: false }),
        button('Testar conexão'),
        button('Salvar preferências'),
        // A chave em si é um input invisível do Mantine: confere o rótulo clicável.
        window.getByText('Tocar som do aviso', { exact: true }),
        window.getByRole('slider', { name: 'Volume do aviso' }),
        button('Testar aviso'),
        button('Remover a configuração desta máquina'),
      ],
    });
  });

  it('diálogo "Remover a configuração?"', async () => {
    const { window } = launched;
    await button('Remover a configuração desta máquina').click();
    const dialog = window.getByRole('dialog', { name: 'Remover a configuração?' });
    await dialog.waitFor();
    try {
      await checkAllSizes({
        name: 'diálogo de remover a configuração',
        area: 'Configuração',
        dialog: () => dialog,
        reachable: () => [
          dialog.getByRole('button', { name: 'Fechar o diálogo' }),
          dialog.getByRole('button', { name: 'Não', exact: true }),
          dialog.getByRole('button', { name: 'Sim, remover' }),
        ],
      });
    } finally {
      await dialog.getByRole('button', { name: 'Não', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
  });

  it('diálogo do token: pedido e desfecho (telas 2.4 e 2.5)', async () => {
    const { window } = launched;
    await goTo('Executar');
    await pickPeriod(window, daysFromToday(0), daysFromToday(6));
    await button('Iniciar execução').click();
    const dialog = window.getByRole('dialog', { name: 'O Hunit pediu o token' });
    await dialog.getByLabel('Token do autenticador').waitFor({ timeout: 15_000 });

    await checkAllSizes({
      name: 'diálogo do token',
      area: 'Executar',
      dialog: () => dialog,
      reachable: () => [
        dialog.getByText(/^\d+:\d{2}$/),
        dialog.getByLabel('Token do autenticador'),
        dialog.getByRole('button', { name: 'Enviar token' }),
      ],
    });

    await dialog.getByLabel('Token do autenticador').fill(TOKEN);
    await dialog.getByRole('button', { name: 'Enviar token' }).click();
    await dialog.getByText(/token aceito/i).waitFor({ timeout: 10_000 });
    await checkAllSizes({
      name: 'diálogo do token aceito',
      area: 'Executar',
      dialog: () => dialog,
      reachable: () => [
        dialog.getByText(/token aceito/i),
        dialog.getByRole('button', { name: 'Fechar', exact: true }),
      ],
    });
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await window.getByText('Resultado da execução').waitFor({ timeout: 20_000 });
  });
});

describe('larguras: Reservas (US2 e US4, SC-007)', () => {
  const chip = (label: string) =>
    launched.window
      .getByRole('group', { name: 'Filtros rápidos' })
      .getByRole('button', { name: new RegExp(`^${label}`) });

  it('lista com a barra de seleção (telas 4.1 e 4.4)', async () => {
    const { window } = launched;
    await goTo('Reservas');
    await window.locator('table[aria-label="Reservas"] tbody tr').first().waitFor();
    for (const number of ['R-1', 'R-2']) {
      await window.getByRole('checkbox', { name: `Selecionar a reserva ${number}` }).check();
    }
    const bar = window.getByTestId('selection-bar');
    try {
      await checkAllSizes({
        name: 'Reservas com seleção',
        area: 'Reservas',
        reachable: () => [
          button('Copiar para e-mail'),
          window.getByRole('textbox', { name: 'Buscar reservas' }),
          window.getByRole('combobox', { name: 'Origem' }),
          button('Filtros'),
          chip('Todas'),
          chip('Concluídas'),
          button('Selecionar todas do filtro'),
          bar.getByRole('button', { name: 'Ver seleção' }),
          bar.getByRole('button', { name: 'Anexar' }),
          bar.getByRole('button', { name: 'Confirmar' }),
          bar.getByRole('button', { name: 'Enviar ao Comercial' }),
          bar.getByRole('button', { name: 'Desmarcar todas' }),
          window.getByRole('checkbox', { name: 'Selecionar todas as reservas listadas' }),
          button('Abrir a reserva R-1'),
          window.getByText(/^Mostrando \d+ de \d+ reservas/),
        ],
      });
    } finally {
      await bar.getByRole('button', { name: 'Desmarcar todas' }).click();
    }
  });

  it('colunas sem sobrepor em qualquer largura da janela (homologação, T068)', async () => {
    const { window } = launched;
    await goTo('Reservas');
    const table = window.locator('table[aria-label="Reservas"]');
    await table.locator('tbody tr').first().waitFor();
    await sweepWidths(() =>
      flexColumnWidth(table, 'guest', { from: 730, min: 200, narrowMin: 150 }),
    );
  }, 240_000);

  it('destaque da linha dentro do card: uma reserva só, selecionada e com o mouse em cima (specs/008, T036)', async () => {
    const { app, window } = launched;
    await goTo('Reservas');
    await searchReservations(window, 'R-1');
    await waitForReservationRows(window, 1);
    const table = window.locator('table[aria-label="Reservas"]');
    const checkbox = window.getByRole('checkbox', { name: 'Selecionar a reserva R-1' });
    await checkbox.check();
    try {
      for (const size of SIZES) {
        await resizeWindow(app, window, size.window, size.zoom);
        await table.locator('tbody tr').first().hover();
        await expectCardCornersClipped(app, table, `— Reservas, ${size.label}`);
      }
    } finally {
      await resizeWindow(app, window, DEFAULT_SIZE, 1);
      await checkbox.uncheck();
      await searchReservations(window, '');
      await waitForReservationRows(window, 8);
    }
  }, 180_000);

  it('gaveta da seleção e anexar em lote (telas 4.5 e 4.6)', async () => {
    const { app, window } = launched;
    for (const number of ['R-1', 'R-2', 'R-3']) {
      await window.getByRole('checkbox', { name: `Selecionar a reserva ${number}` }).check();
    }
    const bar = window.getByTestId('selection-bar');
    const drawer = window.getByRole('dialog', { name: 'Reservas selecionadas' });
    const dialog = window.getByRole('dialog', { name: 'Anexar comprovante a 3 reservas' });
    try {
      await bar.getByRole('button', { name: 'Ver seleção' }).click();
      await drawer.getByRole('list', { name: 'Reservas selecionadas' }).waitFor();
      await checkAllSizes({
        name: 'gaveta da seleção',
        area: 'Reservas',
        reachable: () => [
          drawer.getByRole('button', { name: 'Fechar seleção' }),
          drawer.getByText(/^3 reservas — total de/),
          drawer.getByRole('button', { name: 'Limpar seleção' }),
          drawer.getByRole('button', { name: 'Desmarcar a reserva R-1' }),
          drawer.getByRole('button', { name: 'Desmarcar a reserva R-3' }),
        ],
      });
      await drawer.getByRole('button', { name: 'Fechar seleção' }).click();
      await drawer.waitFor({ state: 'hidden' });

      const files = await mkdtemp(path.join(tmpdir(), 'hunit-larguras-'));
      const file = path.join(files, 'comprovante-de-teste.pdf');
      await writeFile(file, pdfFile());
      await stubOpenDialog(app, file);
      await bar.getByRole('button', { name: 'Anexar' }).click();
      await window.getByRole('menuitem', { name: 'Anexar comprovante' }).click();
      await dialog.getByTestId('attach-summary').waitFor({ timeout: 15_000 });
      await checkAllSizes({
        name: 'anexar em lote',
        area: 'Reservas',
        dialog: () => dialog,
        reachable: () => [
          dialog.getByRole('button', { name: 'Fechar o diálogo' }),
          dialog.getByTestId('attach-summary'),
          dialog.getByRole('button', { name: 'Cancelar' }),
          dialog.getByRole('button', { name: 'Escolher outro arquivo' }),
          dialog.getByRole('button', { name: 'Confirmar' }),
        ],
      });
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await dialog.waitFor({ state: 'detached' });
    } finally {
      if (await drawer.isVisible()) await window.keyboard.press('Escape');
      await bar.getByRole('button', { name: 'Desmarcar todas' }).click();
    }
  });

  it('gaveta da reserva com comprovante e valor informado (telas 4.2 e 4.7, US5)', async () => {
    const { window } = launched;
    // R-2 aceita documentos ("Cartão validado (não cobrado)"): comprovante e valor pela API.
    await registerDocument('102', 'R-2', 'proof', 'comprovante-de-teste.pdf', pdfFile());
    await server.test.app.inject({
      method: 'PUT',
      url: '/v1/reservations/102/R-2/manual-amount',
      headers: server.operator.headers,
      payload: { amount: '123456.78' },
    });
    await button('Abrir a reserva R-2').click();
    const drawer = window.getByRole('dialog', { name: 'Detalhe da reserva' });
    const treatment = drawer.getByTestId('treatment-section');
    await treatment.getByRole('button', { name: 'Remover valor' }).waitFor({ timeout: 15_000 });
    try {
      await checkAllSizes({
        name: 'gaveta da reserva',
        area: 'Reservas',
        reachable: () => [
          drawer.getByRole('button', { name: 'Fechar detalhe' }),
          drawer.getByRole('heading', { name: /Reserva R-2/ }),
          drawer.getByTestId('hunit-status'),
          treatment.getByRole('button', { name: 'Anexar tratativa' }),
          treatment.getByRole('button', { name: 'Substituir comprovante' }),
          treatment.getByRole('button', { name: 'Baixar' }),
          treatment.getByRole('button', { name: 'Desfazer' }),
          treatment.getByRole('button', { name: 'Remover valor' }),
          treatment.getByLabel('Corrigir o valor cobrado (R$)'),
          treatment.getByRole('button', { name: 'Informar valor' }),
          drawer.getByText('Valor cobrado no Hunit'),
          drawer.getByRole('heading', { name: 'Verificações' }),
        ],
      });
    } finally {
      await drawer.getByRole('button', { name: 'Fechar detalhe' }).click();
      await drawer.waitFor({ state: 'hidden' });
    }
  });

  it('"Cancelada sem cobrança": o diálogo e o detalhe marcado (telas 7.17 e 7.18, specs/008)', async () => {
    const { window } = launched;
    // R-4 ("Cartão validado (não cobrado)") aceita a marcação.
    await button('Abrir a reserva R-4').click();
    const drawer = window.getByRole('dialog', { name: 'Detalhe da reserva' });
    const section = drawer.getByTestId('no-charge-section');
    const dialog = window.getByRole('dialog', { name: 'Marcar como cancelada sem cobrança?' });
    try {
      await section
        .getByRole('button', { name: 'Marcar como cancelada sem cobrança' })
        .click({ timeout: 15_000 });
      await dialog.getByLabel('Observação (opcional)').fill('Hóspede cancelou antes do check-in');
      await checkAllSizes({
        name: 'marcar como cancelada sem cobrança',
        area: 'Reservas',
        dialog: () => dialog,
        reachable: () => [
          dialog.getByRole('button', { name: 'Fechar o diálogo' }),
          dialog.getByText(/Use só quando a reserva foi cancelada/),
          dialog.getByText(/→ R\$\s0,00/),
          dialog.getByLabel('Observação (opcional)'),
          dialog.getByText('34/500'),
          dialog.getByRole('button', { name: 'Voltar' }),
          dialog.getByRole('button', { name: 'Marcar como cancelada' }),
        ],
      });
      await dialog.getByRole('button', { name: 'Marcar como cancelada' }).click();
      await dialog.waitFor({ state: 'detached' });
      await section.getByRole('button', { name: 'Desfazer' }).waitFor({ timeout: 15_000 });
      await checkAllSizes({
        name: 'detalhe cancelada sem cobrança',
        area: 'Reservas',
        reachable: () => [
          drawer.getByRole('heading', { name: /Reserva R-4/ }),
          section.getByRole('heading', { name: 'Cancelada sem cobrança' }),
          section.getByRole('button', { name: 'Desfazer' }),
          section.getByText(/^antes R\$/),
          section.getByText(/^por /),
          section.getByText('não vai mais ao Comercial'),
          section.getByTestId('no-charge-note'),
        ],
      });
    } finally {
      if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Voltar' }).click();
      // Desfaz pela interface, para as outras telas continuarem com a lista de antes.
      const undo = section.getByRole('button', { name: 'Desfazer' });
      if (await undo.isVisible()) {
        await undo.click();
        const confirm = window.getByRole('dialog', { name: 'Desfazer a marcação?' });
        await confirm.getByRole('button', { name: 'Desfazer' }).click();
        await confirm.waitFor({ state: 'detached' });
      }
      await drawer.getByRole('button', { name: 'Fechar detalhe' }).click();
      await drawer.waitFor({ state: 'hidden' });
    }
  });

  it('painel "Filtros avançados" aberto (tela 4.12)', async () => {
    const { window } = launched;
    const panel = await openReservationFilters(window);
    try {
      await checkAllSizes({
        name: 'painel de filtros',
        area: 'Reservas',
        reachable: () => [
          panel,
          panel.getByRole('button', { name: 'Fechar os filtros' }),
          panel.getByPlaceholder('Todos os hotéis'),
          panel.getByLabel('Período de check-in'),
          panel.getByPlaceholder('Todas as situações'),
          panel.getByRole('combobox', { name: 'Ativa ou cancelada' }),
          panel.getByPlaceholder('Todos os canais'),
          panel.getByRole('checkbox', { name: /não encontradas/ }),
        ],
      });
    } finally {
      await panel.getByRole('button', { name: 'Fechar os filtros' }).click();
    }
  });

  it('nenhum resultado (tela 4.3)', async () => {
    const { window } = launched;
    await searchReservations(window, 'Fulano Inexistente');
    await window.getByText('Nenhuma reserva encontrada').waitFor();
    try {
      await checkAllSizes({
        name: 'Reservas sem resultado',
        area: 'Reservas',
        reachable: () => [
          window.getByText('Nenhuma reserva encontrada'),
          button('Limpar busca e filtros'),
          chip('Todas'),
        ],
      });
    } finally {
      await button('Limpar busca e filtros').click();
      await waitForReservationRows(window, 8);
    }
  });
});

describe('larguras: Comercial e o envio (US8, SC-007)', () => {
  const tab = (name: string) => launched.window.getByRole('tab', { name: new RegExp(`^${name}`) });

  beforeAll(async () => {
    // Duas reservas pendentes de cobrança (só as que exigem cobrança ficam em "A cobrar"), num envio
    // encerrado; o Comercial preenche o retorno de C-1 (maquininha de outro estabelecimento, valor
    // diferente) e deixa o de C-2 incompleto.
    const { db } = server.test.database;
    const dispatch = await insertDispatch(db);
    for (const [hotelCode, reservationNumber] of [
      ['102', 'C-1'],
      ['104', 'C-2'],
      ['104', 'C-3'],
      ['102', 'C-4'],
    ] as const) {
      await server.insertReservation({
        hotelCode,
        reservationNumber,
        guestName: 'Maria Aparecida de Albuquerque Figueiredo Nogueira da Silva',
        totalAmount: '123456.78',
      });
      await insertLine(
        db,
        { hotelCode, reservationNumber },
        { dispatchId: dispatch.id, clientId: dispatch.clientId },
      );
    }
    await server.test.sync?.runRound();
    server.sheet?.fillReturn(HOTELS[1]?.name ?? '', 'C-1', [
      'AUT-55210',
      'Maquininha do Centro de Convenções e Eventos',
      '123000,00',
      'Responsável Fictícia do Comercial',
      // Situação e data (specs/008): texto livre longo e a data como o Google devolve.
      'Cobrada na maquininha do estabelecimento ao lado da recepção',
      46345,
    ]);
    server.sheet?.fillReturn(HOTELS[3]?.name ?? '', 'C-2', ['AUT-55211', '', '', '']);
    // "Cancelada" do Comercial (homologação da 008, R-19): vai para "Retornos a validar", no topo,
    // com o selo próprio; texto longo para conferir a quebra.
    server.sheet?.fillReturn(HOTELS[3]?.name ?? '', 'C-3', [
      '',
      '',
      '',
      'Responsável Fictícia do Comercial',
      'Cancelada pelo hóspede direto no canal de vendas, sem multa',
    ]);
    // Relato "Cobrada no Hunit" (specs/008, US3): vai para a fila "Cobradas no Hunit".
    server.sheet?.fillReturn(HOTELS[1]?.name ?? '', 'C-4', [
      '',
      '',
      '',
      'Responsável Fictícia do Comercial',
      'Cobrada no Hunit',
      46345,
    ]);
    await server.test.sync?.runRound();
  });

  it('as abas da área Comercial (telas 7.7 a 7.10 e 7.15)', async () => {
    const { window } = launched;
    await goTo('Comercial');
    await window.getByRole('table', { name: 'Envios ao Comercial' }).waitFor({ timeout: 15_000 });
    await checkAllSizes({
      name: 'Comercial — Envios',
      area: 'Comercial',
      reachable: () => [
        tab('Envios'),
        tab('Planilha'),
        window.getByRole('button', { name: /^Abrir o envio de/ }),
      ],
    });

    await tab('Retornos a validar').click();
    const returns = window.getByRole('table', { name: 'Retornos a validar' });
    await returns.waitFor({ timeout: 15_000 });
    await checkAllSizes({
      name: 'Comercial — Retornos a validar',
      area: 'Comercial',
      reachable: () => [
        window.getByRole('checkbox', { name: 'Marcar todos os retornos listados' }),
        window.getByRole('button', { name: /^Confirmar marcados/ }),
        returns.getByRole('button', { name: 'Abrir a reserva C-1' }),
        returns.getByRole('button', { name: 'Confirmar', exact: true }),
        returnRow(returns, 'C-1').getByRole('button', { name: 'Recusar', exact: true }),
        // A "Cancelada" do Comercial, no topo (homologação, R-19).
        returns.getByRole('button', { name: 'Abrir a reserva C-3' }),
        returns.getByRole('button', { name: 'Confirmar cancelamento' }),
        returnRow(returns, 'C-3').getByRole('button', { name: 'Recusar', exact: true }),
      ],
    });

    await tab('Retornos com problema').click();
    const problems = window.getByRole('table', { name: 'Retornos com problema' });
    await problems.waitFor({ timeout: 15_000 });
    await checkAllSizes({
      name: 'Comercial — Retornos com problema',
      area: 'Comercial',
      reachable: () => [problems.getByRole('button', { name: 'Abrir a reserva C-2' })],
    });

    // Fila "Cobradas no Hunit" (specs/008, T026, tela 7.15).
    await tab('Cobradas no Hunit').click();
    const hunitCharges = window.getByRole('table', { name: 'Cobradas no Hunit' });
    await hunitCharges.waitFor({ timeout: 15_000 });
    await checkAllSizes({
      name: 'Comercial — Cobradas no Hunit',
      area: 'Comercial',
      reachable: () => [
        window.getByText(/^O Comercial marcou estas reservas como/),
        button('Verificar agora'),
        hunitCharges.getByRole('button', { name: 'Abrir a reserva C-4' }),
        hunitCharges.getByText('Aguardando verificação'),
        hunitCharges.getByText('confere na próxima execução'),
      ],
    });

    await tab('Planilha').click();
    await window.getByTestId('sheet-status').waitFor({ timeout: 15_000 });
    await checkAllSizes({
      name: 'Comercial — Planilha',
      area: 'Comercial',
      reachable: () => [
        button('Ler retornos agora'),
        window.getByText('Última leitura dos retornos'),
      ],
    });
  });

  it('destaque da linha dentro do card: "Retornos a validar" com todas as linhas marcadas (specs/008, T036)', async () => {
    const { app, window } = launched;
    await goTo('Comercial');
    await tab('Retornos a validar').click();
    const returns = window.getByRole('table', { name: 'Retornos a validar' });
    await returns.waitFor({ timeout: 15_000 });
    // A "Cancelada" C-3 no topo e o retorno C-1: marcadas, as duas pintam os cantos do card.
    expect(await returns.locator('tbody tr').count()).toBe(2);
    const checkbox = window.getByRole('checkbox', { name: 'Marcar todos os retornos listados' });
    await checkbox.check();
    try {
      for (const size of SIZES) {
        await resizeWindow(app, window, size.window, size.zoom);
        await returns.locator('tbody tr').first().hover();
        await expectCardCornersClipped(app, returns, `— Retornos a validar, ${size.label}`);
      }
    } finally {
      await resizeWindow(app, window, DEFAULT_SIZE, 1);
      await checkbox.uncheck();
    }
  }, 180_000);

  it('colunas das abas sem sobrepor em qualquer largura da janela (homologação, T068)', async () => {
    const { window } = launched;
    await goTo('Comercial');
    await tab('Envios').click();
    await window.getByRole('table', { name: 'Envios ao Comercial' }).waitFor({ timeout: 15_000 });
    await sweepWidths();

    await tab('Retornos a validar').click();
    const returns = window.getByRole('table', { name: 'Retornos a validar' });
    await returns.waitFor({ timeout: 15_000 });
    await sweepWidths(() =>
      flexColumnWidth(returns, 'chargeHotel', { from: 730, min: 205, narrowMin: 140 }),
    );

    await tab('Retornos com problema').click();
    await window.getByRole('table', { name: 'Retornos com problema' }).waitFor({ timeout: 15_000 });
    await sweepWidths();

    // Fila "Cobradas no Hunit" (specs/008, tela 7.15): o hóspede fica com o que sobra.
    await tab('Cobradas no Hunit').click();
    const queue = window.getByRole('table', { name: 'Cobradas no Hunit' });
    await queue.waitFor({ timeout: 15_000 });
    await sweepWidths(() =>
      flexColumnWidth(queue, 'guest', { from: 730, min: 160, narrowMin: 120 }),
    );
  }, 600_000);

  it('recusar o retorno (tela 7.6)', async () => {
    const { window } = launched;
    await tab('Retornos a validar').click();
    const returns = window.getByRole('table', { name: 'Retornos a validar' });
    await returnRow(returns, 'C-1').getByRole('button', { name: 'Recusar', exact: true }).click();
    const dialog = window.getByRole('dialog', { name: 'Recusar o retorno do Comercial' });
    await dialog.waitFor();
    try {
      await checkAllSizes({
        name: 'recusar o retorno',
        area: 'Comercial',
        dialog: () => dialog,
        reachable: () => [
          dialog.getByRole('button', { name: 'Valor diferente' }),
          dialog.getByLabel('Motivo da recusa'),
          dialog.getByRole('button', { name: 'Voltar' }),
          dialog.getByRole('button', { name: 'Recusar retorno' }),
        ],
      });
    } finally {
      await dialog.getByRole('button', { name: 'Voltar' }).click();
      await dialog.waitFor({ state: 'detached' });
    }
  });

  it('conferência do envio (tela 7.1)', async () => {
    const { window } = launched;
    await goTo('Reservas');
    await window.getByRole('checkbox', { name: 'Selecionar a reserva R-1' }).check();
    await window.getByRole('checkbox', { name: 'Selecionar a reserva R-3' }).check();
    const bar = window.getByTestId('selection-bar');
    await bar.getByRole('button', { name: 'Enviar ao Comercial' }).click();
    const dialog = window.getByRole('dialog', { name: 'Enviar ao Comercial' });
    await dialog.getByTestId('dispatch-summary').waitFor({ timeout: 15_000 });
    try {
      await checkAllSizes({
        name: 'conferência do envio',
        area: 'Reservas',
        dialog: () => dialog,
        reachable: () => [
          dialog.getByTestId('dispatch-summary'),
          dialog.getByRole('button', { name: 'Cancelar' }),
          dialog.getByRole('button', { name: /^Enviar \d* ?ao Comercial$/ }),
        ],
      });
    } finally {
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await dialog.waitFor({ state: 'detached' });
      await bar.getByRole('button', { name: 'Desmarcar todas' }).click();
    }
  });
});

describe('larguras: Execuções (US6, SC-007)', () => {
  beforeAll(async () => {
    // Uma execução em andamento de outra conta (direto no banco), além das encerradas dos casos
    // anteriores.
    await server.insertExecution({ status: 'running' });
  });

  it('lista com o card da em andamento e o "Histórico" (tela 3.1)', async () => {
    const { window } = launched;
    await goTo('Execuções');
    const card = window.getByRole('region', { name: /^Em andamento:/ });
    await card.waitFor({ timeout: 15_000 });
    await window.getByRole('table', { name: 'Histórico das execuções' }).waitFor();
    await checkAllSizes({
      name: 'Execuções',
      area: 'Execuções',
      reachable: () => [
        card.getByRole('button', { name: 'Ver detalhes' }),
        window.getByRole('button', { name: /^Abrir a execução de/ }).first(),
        window.getByText(/execuções · as mais recentes primeiro$/),
      ],
    });
  });

  it('colunas sem sobrepor em qualquer largura da janela (homologação, T068)', async () => {
    const { window } = launched;
    await goTo('Execuções');
    await window.getByRole('table', { name: 'Histórico das execuções' }).waitFor();
    await sweepWidths();
  }, 240_000);

  it('gaveta da execução encerrada (tela 3.4)', async () => {
    const { window } = launched;
    await window
      .getByRole('button', { name: /^Abrir a execução de/ })
      .first()
      .click();
    const drawer = window.getByRole('dialog', { name: 'Detalhe da execução' });
    await drawer
      .getByTestId('execution-detail')
      .getByRole('heading', { name: 'Execução' })
      .waitFor();
    try {
      await checkAllSizes({
        name: 'gaveta da execução',
        area: 'Execuções',
        reachable: () => [
          drawer.getByRole('button', { name: 'Fechar detalhe' }),
          drawer.getByRole('heading', { name: 'Execução', exact: true }),
          drawer.getByRole('list', { name: 'Hotéis da execução' }),
        ],
      });
    } finally {
      await drawer.getByRole('button', { name: 'Fechar detalhe' }).click();
      await drawer.waitFor({ state: 'hidden' });
    }
  });

  it('gaveta da em andamento e o "Cancelar a execução?" (telas 3.2 e 3.3)', async () => {
    const { window } = launched;
    await window
      .getByRole('region', { name: /^Em andamento:/ })
      .getByRole('button', { name: 'Ver detalhes' })
      .click();
    const drawer = window.getByRole('dialog', { name: 'Detalhe da execução' });
    const cancel = drawer.getByRole('button', { name: 'Cancelar execução' });
    await cancel.waitFor({ timeout: 15_000 });
    await checkAllSizes({
      name: 'gaveta da execução em andamento',
      area: 'Execuções',
      reachable: () => [drawer.getByRole('button', { name: 'Fechar detalhe' }), cancel],
    });
    await cancel.click();
    const dialog = window.getByRole('dialog', { name: 'Cancelar a execução?' });
    await dialog.waitFor();
    try {
      await checkAllSizes({
        name: 'cancelar a execução',
        area: 'Execuções',
        dialog: () => dialog,
        reachable: () => [
          dialog.getByRole('button', { name: 'Não', exact: true }),
          dialog.getByRole('button', { name: 'Sim, cancelar' }),
        ],
      });
    } finally {
      await dialog.getByRole('button', { name: 'Não', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await drawer.getByRole('button', { name: 'Fechar detalhe' }).click();
      await drawer.waitFor({ state: 'hidden' });
    }
  });
});

describe('larguras: Relatórios (specs/007, T025)', () => {
  beforeAll(async () => {
    // Reservas em aberto e cobradas nos últimos 30 dias, em todos os hotéis (nomes longos).
    for (const [index, hotel] of HOTELS.entries()) {
      for (let n = 1; n <= 3; n += 1) {
        await server.insertReservation({
          hotelCode: hotel.code,
          reservationNumber: `REL-${index + 1}-${n}`,
          guestName: 'Maria Aparecida de Albuquerque Figueiredo Nogueira da Silva',
          channel: 'Booking.com',
          checkIn: isoDate(daysFromToday(-3 - n)),
          checkOut: isoDate(daysFromToday(-1)),
          totalAmount: `${123456 + index * 1000 + n}.78`,
          chargedAmount: n === 3 ? '123456.78' : null,
          classification: n === 3 ? 'virtual_card_already_charged' : 'virtual_card_pending_charge',
        });
      }
    }
  });

  it('visão geral (telas 8.1 e 8.6)', async () => {
    const { window } = launched;
    await goTo('Relatórios');
    await window.getByTestId('report-loaded').waitFor({ timeout: 20_000 });
    await checkAllSizes({
      name: 'Relatórios',
      area: 'Relatórios',
      reachable: () => [
        window.getByRole('region', { name: 'Valor em aberto' }),
        window.getByRole('region', { name: 'Valor já cobrado' }),
        button('Atualizar dados'),
        button('Ver reservas em aberto'),
        button('Ver todos os hotéis'),
        window.getByRole('list', { name: 'Hotéis com mais valor em aberto' }),
      ],
    });
  });

  it('sem sobrepor em qualquer largura da janela', async () => {
    await sweepWidths();
  });

  it('gaveta do hotel (tela 8.3)', async () => {
    const { window } = launched;
    await window
      .getByRole('button', { name: /^Abrir o detalhe de / })
      .first()
      .click();
    const drawer = window.getByTestId('report-hotel-drawer');
    await drawer.getByText(/^Reservas em aberto \(/).waitFor();
    try {
      await checkAllSizes({
        name: 'gaveta do hotel',
        area: 'Relatórios',
        reachable: () => [
          drawer.getByRole('button', { name: /^Ver as \d+ reservas em Reservas$/ }),
          drawer.getByRole('region', { name: 'Valor em aberto' }),
        ],
      });
    } finally {
      await window.keyboard.press('Escape');
      await drawer.waitFor({ state: 'hidden' });
    }
  });

  it('todos os hotéis (tela 8.7)', async () => {
    const { window } = launched;
    await button('Ver todos os hotéis').click();
    const drawer = window.getByTestId('report-all-hotels');
    await drawer.getByRole('list', { name: 'Todos os hotéis' }).waitFor();
    try {
      await checkAllSizes({
        name: 'todos os hotéis',
        area: 'Relatórios',
        reachable: () => [
          drawer.getByLabel('Buscar hotel pelo nome'),
          drawer.getByRole('button', { name: 'Nome A-Z' }),
          drawer.getByRole('button', {
            name: 'Abrir o detalhe de Pousada Serra Verde e Centro de Convenções do Vale',
          }),
        ],
      });
    } finally {
      await window.keyboard.press('Escape');
      await drawer.waitFor({ state: 'hidden' });
    }
  });
});
