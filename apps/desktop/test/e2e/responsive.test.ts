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
 * comprovante e valor informado).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

let certificates: TestCertificates;
let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;

beforeAll(async () => {
  certificates = await createTestCertificates();
  // Prazo do token folgado: o diálogo fica aberto enquanto a janela passa pelos quatro tamanhos.
  server = await startE2eServer({ scenario: SCENARIO, twoFactorTimeoutMs: 120_000 });
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
