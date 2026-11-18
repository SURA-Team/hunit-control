/**
 * Tratativas manuais de ponta a ponta (specs/003, T030, T035, T040, T048 e T051), com o app
 * compilado contra o servidor de teste:
 *
 * - US1: comprovante com pré-visualização → "Comprovante enviado"; valor informado à mão; substituir e
 *   reverter; recusas (reserva faturada, arquivo de 26 MB, executável renomeado); baixar;
 * - US2: tratativa `.eml` e `.msg` → "Tratativa enviada"; comprovante → "Comprovante enviado";
 *   desfazer → "Tratativa enviada";
 * - US3: 10 reservas marcadas em 10 pesquisas diferentes continuam marcadas; lote com aceitas e
 *   ignoradas;
 * - US4: com a chave de consulta, filtrar, ver documentos e baixar, sem ações de registro;
 * - SC-011: a pré-visualização não acessa a rede nem deixa cópia do documento no disco.
 *
 * Reservas e arquivos são fictícios, criados aqui.
 */
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startE2eServer, type E2eServer } from '../../../server/test/helpers/e2e-server.js';
import { attach, emlFile as serverEmlFile } from '../../../server/test/helpers/treatments.js';
import { createTestCertificates, type TestCertificates } from '../helpers/certificates.js';
import { emlFile, msgFile, pdfFile, pngFile } from '../helpers/synthetic-files.js';
import { startTlsTerminator, type TlsTerminator } from '../helpers/tls-terminator.js';
import {
  configureApp,
  launchApp,
  stubOpenDialog,
  stubSaveDialog,
  type LaunchedApp,
  type Page,
} from './app-fixture.js';

/** Texto único dentro dos documentos, procurado depois no disco (SC-011). */
const MARKER = 'MARCADOR-DOCUMENTO-7781';
const TRACKER = 'https://rastreador.exemplo.test/pixel.gif';
const BATCH = Array.from(
  { length: 10 },
  (_unused, index) => `B${String(index + 1).padStart(2, '0')}`,
);
const MB = 1024 * 1024;

let certificates: TestCertificates;
let server: E2eServer;
let tls: TlsTerminator;
let launched: LaunchedApp;
let inputDir: string;
let startedAt: number;
const files: Record<string, string> = {};

async function inputFile(name: string, content: Buffer): Promise<void> {
  const file = path.join(inputDir, name);
  await writeFile(file, content);
  files[name] = file;
}

const fileOf = (name: string): string => {
  const file = files[name];
  if (!file) throw new Error(`arquivo de teste não criado: ${name}`);
  return file;
};

beforeAll(async () => {
  startedAt = Date.now();
  certificates = await createTestCertificates();
  server = await startE2eServer();
  await server.insertHotel('H1', 'Hotel Praia');
  const execution = await server.insertExecution({
    clientId: server.operator.id,
    status: 'completed',
    finishedAt: new Date(),
  });
  const base = { lastExecutionId: execution.id, hotelCode: 'H1' };
  await server.insertReservation({ ...base, reservationNumber: 'R-PEND', totalAmount: '540.00' });
  await server.insertReservation({ ...base, reservationNumber: 'R-ENV', totalAmount: '310.00' });
  await server.insertReservation({
    ...base,
    reservationNumber: 'R-FAT',
    classification: 'invoiced',
  });
  for (const [index, number] of BATCH.entries()) {
    // As duas últimas já foram cobradas pelo Hunit: não aceitam documentos.
    await server.insertReservation({
      ...base,
      reservationNumber: number,
      totalAmount: '100.00',
      ...(index >= 8 && { classification: 'virtual_card_already_charged' as const }),
    });
  }

  inputDir = await mkdtemp(path.join(tmpdir(), 'hunit-tratativas-entrada-'));
  await inputFile('comprovante.pdf', pdfFile(MARKER));
  await inputFile('comprovante-2.pdf', pdfFile(`${MARKER} segundo`));
  await inputFile('lote.pdf', pdfFile(`${MARKER} lote`));
  await inputFile('tela.png', pngFile());
  await inputFile(
    'pedido.eml',
    emlFile({
      subject: `Pedido de cobranca ${MARKER}`,
      html:
        `<p>Favor cobrar a reserva de teste. ${MARKER}</p><img src="${TRACKER}">` +
        '<script>document.title = "script do e-mail executou"</script>',
    }),
  );
  await inputFile(
    'pedido.msg',
    msgFile({ subject: `Mensagem do Outlook ${MARKER}`, body: 'Favor cobrar a reserva de teste.' }),
  );
  await inputFile(
    'pedido-grande.eml',
    emlFile({
      subject: 'Pedido com anexo grande',
      text: 'Segue em anexo.',
      attachment: { name: 'anexo-grande.txt', content: 'A'.repeat(20 * MB) },
    }),
  );
  const tooLarge = Buffer.alloc(26 * MB, 0x20);
  pdfFile().copy(tooLarge);
  await inputFile('grande.pdf', tooLarge);
  await inputFile(
    'boleto.pdf',
    Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(200, 0x20)]),
  );

  tls = await startTlsTerminator({ certificate: certificates.server, targetPort: server.port });
  launched = await launchApp();
  // Toda requisição que a interface tentar fazer fica registrada (SC-011).
  await launched.app.evaluate(({ session }) => {
    const hooks = ((globalThis as Record<string, unknown>)['__hunitTest'] ??= {}) as {
      requests?: string[];
    };
    hooks.requests = [];
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      hooks.requests?.push(details.url);
      callback({});
    });
  });
  await configureApp(launched, {
    serverUrl: tls.url,
    certificatePem: certificates.authority.certificatePem,
    apiKey: server.operator.apiKey,
  });
  await goTo(launched.window, 'Reservas');
}, 240_000);

afterAll(async () => {
  await launched?.close();
  await tls?.close();
  await server?.close();
  if (inputDir) await rm(inputDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Passos repetidos
// ---------------------------------------------------------------------------

async function goTo(window: Page, area: string) {
  await window.getByRole('navigation').getByText(area, { exact: true }).click();
}

async function searchFor(window: Page, number: string) {
  await window.getByLabel('Busca livre').fill(number);
  await window.getByRole('button', { name: 'Buscar', exact: true }).click();
  await window.getByRole('cell', { name: number, exact: true }).waitFor();
}

const rowOf = (window: Page, number: string) =>
  window
    .locator('tbody tr')
    .filter({ has: window.getByRole('cell', { name: number, exact: true }) });

async function openDetail(window: Page, number: string) {
  await searchFor(window, number);
  await window.getByRole('cell', { name: number, exact: true }).click();
  await section(window).waitFor();
}

async function closeDetail(window: Page) {
  await window.getByRole('button', { name: 'Fechar detalhe' }).click();
  await section(window).waitFor({ state: 'detached' });
}

const section = (window: Page) => window.getByTestId('treatment-section');
const attachDialog = (window: Page) => window.getByRole('dialog', { name: /^Anexar / });

/** Clica no botão de anexar ou substituir do detalhe, com o arquivo já "escolhido". */
async function startAttach(window: Page, button: string, file: string) {
  await stubOpenDialog(launched.app, fileOf(file));
  await section(window).getByRole('button', { name: button }).click();
  await attachDialog(window).getByTestId('document-preview').waitFor();
}

async function confirmAttach(window: Page, message: string | RegExp) {
  const dialog = attachDialog(window);
  await dialog.getByTestId('attach-summary').waitFor();
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await dialog.getByText(message).waitFor({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

interface TreatmentBody {
  treatment: {
    status: string;
    manualChargedAmount: string | null;
    request: { id: string; fileName: string | null } | null;
    proof: { id: string; fileName: string | null } | null;
  };
  documents: Array<{ id: string; state: string; fileName: string | null }>;
  events: Array<{ type: string }>;
}

async function treatmentOf(number: string): Promise<TreatmentBody> {
  const response = await server.test.app.inject({
    method: 'GET',
    url: `/v1/reservations/H1/${number}/treatment`,
    headers: server.reader.headers,
  });
  return response.json();
}

async function documentCount(): Promise<number> {
  const { rows } = await server.test.database.pool.query<{ total: number }>(
    'select count(*)::int as total from treatment_documents',
  );
  return rows[0]?.total ?? 0;
}

// ---------------------------------------------------------------------------

describe('US1 — comprovante', () => {
  it('mostra a pré-visualização; cancelar não registra nada (cenário 8)', async () => {
    const { window } = launched;
    await openDetail(window, 'R-PEND');

    await startAttach(window, 'Anexar comprovante', 'comprovante.pdf');

    const dialog = attachDialog(window);
    await dialog.getByText('comprovante.pdf').waitFor();
    // O PDF foi desenhado: o canvas tem tamanho e algum ponto que não é branco.
    const canvas = dialog.getByRole('img', { name: 'Pré-visualização de comprovante.pdf' });
    await expect
      .poll(
        () =>
          canvas.evaluate((element) => {
            const target = element as HTMLCanvasElement;
            const context = target.getContext('2d');
            if (!context || target.width === 0) return false;
            const { data } = context.getImageData(0, 0, target.width, target.height);
            for (let index = 0; index < data.length; index += 4) {
              if ((data[index] ?? 255) < 128 && (data[index + 3] ?? 0) > 0) return true;
            }
            return false;
          }),
        { timeout: 15_000 },
      )
      .toBe(true);

    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await dialog.waitFor({ state: 'detached' });

    expect(await documentCount()).toBe(0);
    expect((await treatmentOf('R-PEND')).treatment.status).toBe('none');
  });

  it('confirmar registra o comprovante e a reserva fica "Comprovante enviado" (cenário 1)', async () => {
    const { window } = launched;

    await startAttach(window, 'Anexar comprovante', 'comprovante.pdf');
    await confirmAttach(window, 'Comprovante registrado.');

    await section(window).getByText('Comprovante enviado', { exact: true }).waitFor();
    const row = section(window).getByRole('row').filter({ hasText: 'comprovante.pdf' });
    await row.getByText('Atual', { exact: true }).waitFor();
    await row.getByText(`por ${server.operator.name}`).waitFor();

    await closeDetail(window);
    await rowOf(window, 'R-PEND').getByText('Comprovante enviado', { exact: true }).waitFor();
    // Uma coluna só (FR-002, FR-017): o status do Hunit fica no detalhe, não na lista.
    expect(await rowOf(window, 'R-PEND').getByText('Pendente de cobrança').count()).toBe(0);
  });

  it('informa o valor cobrado à mão e volta ao valor do Hunit (cenário 3)', async () => {
    const { window } = launched;
    await openDetail(window, 'R-PEND');

    await section(window).getByLabel('Valor que foi cobrado (R$)').fill('1.234,56');
    await section(window).getByRole('button', { name: 'Informar valor' }).click();
    await section(window)
      .getByText(/1\.234,56 \(informado à mão\)/)
      .waitFor();
    expect((await treatmentOf('R-PEND')).treatment.manualChargedAmount).toBe('1234.56');

    await section(window).getByRole('button', { name: 'Remover valor' }).click();
    await expect
      .poll(async () => (await treatmentOf('R-PEND')).treatment.manualChargedAmount)
      .toBeNull();
  });

  it('substitui mostrando o documento atual, e reverte em menos de 30 s (cenários 7 e 9, SC-009)', async () => {
    const { window } = launched;

    await startAttach(window, 'Substituir comprovante', 'comprovante-2.pdf');
    const summary = attachDialog(window).getByTestId('attach-summary');
    await summary.getByText('Substitui o comprovante atual').waitFor();
    await summary.getByText(/comprovante\.pdf, anexado por/).waitFor();
    await confirmAttach(window, 'Comprovante registrado.');
    await section(window)
      .getByRole('row')
      .filter({ hasText: 'comprovante-2.pdf' })
      .getByText('Atual', { exact: true })
      .waitFor();

    const revertStarted = Date.now();
    await section(window)
      .getByRole('row')
      .filter({ hasText: 'Comprovante anterior' })
      .getByRole('button', { name: 'Reverter' })
      .click();
    await section(window).getByText('Documento revertido.').waitFor();
    await section(window)
      .getByRole('row')
      .filter({ hasText: 'comprovante.pdf' })
      .getByText('Atual', { exact: true })
      .waitFor();
    expect(Date.now() - revertStarted).toBeLessThan(30_000);

    const { treatment, events } = await treatmentOf('R-PEND');
    expect(treatment.proof?.fileName).toBe('comprovante.pdf');
    expect(events[0]?.type).toBe('reverted');
  });

  it('baixa o documento idêntico ao enviado, com o nome original (FR-009)', async () => {
    const { window } = launched;
    const target = path.join(inputDir, 'baixado.pdf');
    await stubSaveDialog(launched.app, target);

    await section(window)
      .getByRole('row')
      .filter({ hasText: 'comprovante.pdf' })
      .getByRole('button', { name: 'Baixar' })
      .click();
    await section(window).getByText(`Salvo em ${target}`).waitFor();

    expect((await readFile(target)).equals(await readFile(fileOf('comprovante.pdf')))).toBe(true);
    await rm(target, { force: true });
    await closeDetail(window);
  });

  it('recusa arquivo de 26 MB e executável renomeado, sem gravar nada (cenário 6)', async () => {
    const { window } = launched;
    await openDetail(window, 'R-ENV');
    const before = await documentCount();

    // Grande demais: recusado na escolha, antes de qualquer envio.
    await stubOpenDialog(launched.app, fileOf('grande.pdf'));
    await section(window).getByRole('button', { name: 'Anexar comprovante' }).click();
    const dialog = attachDialog(window);
    await dialog.getByText('O arquivo tem mais de 25 MB.').waitFor();
    await expect
      .poll(() => dialog.getByRole('button', { name: 'Confirmar' }).isDisabled())
      .toBe(true);

    // Executável com extensão .pdf: a pré-visualização falha e o servidor recusa pelo conteúdo.
    await stubOpenDialog(launched.app, fileOf('boleto.pdf'));
    await dialog.getByRole('button', { name: 'Escolher outro arquivo' }).click();
    await dialog.getByText('Não foi possível pré-visualizar este arquivo').waitFor();
    await dialog.getByTestId('attach-summary').waitFor();
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await dialog.getByText(/Tipo não aceito\./).waitFor();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });

    expect(await documentCount()).toBe(before);
    expect((await treatmentOf('R-ENV')).treatment.status).toBe('none');
    await closeDetail(window);
  });

  it('reserva faturada não aceita documentos (cenário 5)', async () => {
    const { window } = launched;
    await openDetail(window, 'R-FAT');

    await section(window)
      .getByText(/não exige cobrança, por isso ela não aceita/)
      .waitFor();
    expect(
      await section(window).getByRole('button', { name: 'Anexar comprovante' }).isDisabled(),
    ).toBe(true);
    expect(
      await section(window).getByRole('button', { name: 'Anexar tratativa' }).isDisabled(),
    ).toBe(true);
    await closeDetail(window);
  });
});

describe('US2 — tratativa', () => {
  it('e-mail .eml: mostra a mensagem isolada, sem carregar nada de fora, e a reserva fica "Tratativa enviada"', async () => {
    const { window } = launched;
    await openDetail(window, 'R-ENV');

    await startAttach(window, 'Anexar tratativa', 'pedido.eml');

    const dialog = attachDialog(window);
    await dialog.getByText('Financeiro Teste <financeiro@exemplo.test>').waitFor();
    await dialog.getByText(`Pedido de cobranca ${MARKER}`).waitFor();
    const frame = dialog.locator('iframe[title="Mensagem do e-mail"]');
    expect(await frame.getAttribute('sandbox')).toBe('');
    await dialog
      .frameLocator('iframe[title="Mensagem do e-mail"]')
      .getByText('Favor cobrar a reserva de teste.', { exact: false })
      .waitFor();
    // O script do e-mail não rodou (nem na mensagem, nem na página do app).
    expect(await window.title()).not.toContain('script do e-mail');

    await confirmAttach(window, 'Tratativa registrada.');

    await section(window).getByText('Tratativa enviada', { exact: true }).waitFor();
    // O status do Hunit continua no detalhe (US2 cenário 1).
    await window.getByTestId('hunit-status').getByText('Pendente de cobrança').waitFor();
    await closeDetail(window);
    await rowOf(window, 'R-ENV').getByText('Tratativa enviada', { exact: true }).waitFor();
  });

  it('e-mail .msg do Outlook: mostra assunto e texto, e substitui a tratativa', async () => {
    const { window } = launched;
    await openDetail(window, 'R-ENV');

    await startAttach(window, 'Substituir tratativa', 'pedido.msg');

    const dialog = attachDialog(window);
    await dialog.getByText(`Mensagem do Outlook ${MARKER}`).waitFor();
    await dialog.getByText('Favor cobrar a reserva de teste.').waitFor();
    await confirmAttach(window, 'Tratativa registrada.');

    expect((await treatmentOf('R-ENV')).treatment.request?.fileName).toBe('pedido.msg');
  });

  it('comprovante depois da tratativa → "Comprovante enviado"; desfazer → "Tratativa enviada" (cenários 2 e 4)', async () => {
    const { window } = launched;

    await startAttach(window, 'Anexar comprovante', 'tela.png');
    await attachDialog(window).getByRole('img', { name: 'Pré-visualização de tela.png' }).waitFor();
    await confirmAttach(window, 'Comprovante registrado.');
    await section(window).getByText('Comprovante enviado', { exact: true }).waitFor();

    await section(window)
      .getByRole('row')
      .filter({ hasText: 'tela.png' })
      .getByRole('button', { name: 'Desfazer' })
      .click();
    const confirm = window.getByRole('dialog', { name: 'Desfazer o comprovante?' });
    await confirm.getByRole('button', { name: 'Desfazer' }).click();
    await section(window).getByText('Comprovante desfeito.').waitFor();
    await section(window).getByText('Tratativa enviada', { exact: true }).waitFor();

    const { treatment, documents, events } = await treatmentOf('R-ENV');
    expect(treatment.status).toBe('sent');
    expect(documents.find((document) => document.fileName === 'tela.png')?.state).toBe('removed');
    expect(events[0]?.type).toBe('removed');
    await closeDetail(window);
  });

  it('e-mail com anexo de 20 MB: a pré-visualização aparece em menos de 3 s (SC-010)', async () => {
    const { window } = launched;
    await openDetail(window, 'R-ENV');
    await stubOpenDialog(launched.app, fileOf('pedido-grande.eml'));

    const clickedAt = Date.now();
    await section(window).getByRole('button', { name: 'Substituir tratativa' }).click();
    const dialog = attachDialog(window);
    await dialog.getByText('Pedido com anexo grande').waitFor();
    const elapsedMs = Date.now() - clickedAt;

    await dialog
      .getByRole('list', { name: 'Anexos do e-mail' })
      .getByText(/anexo-grande\.txt/)
      .waitFor();
    expect(elapsedMs).toBeLessThan(3_000);

    await dialog.getByTestId('attach-summary').waitFor();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await dialog.waitFor({ state: 'detached' });
    await closeDetail(window);
  });
});

describe('US3 — lote com seleção entre pesquisas', () => {
  it('10 reservas marcadas em 10 pesquisas continuam marcadas (cenários 4 e 5, SC-002)', async () => {
    const { window } = launched;

    for (const number of BATCH) {
      await searchFor(window, number);
      await window.getByRole('checkbox', { name: `Selecionar a reserva ${number}` }).check();
    }

    const bar = window.getByTestId('selection-bar');
    await bar.getByText('10').waitFor();
    await bar.getByText(/reservas selecionadas/).waitFor();
    // Só a última pesquisada está na lista; as outras nove estão na seleção mesmo assim.
    expect(await window.locator('tbody tr').count()).toBe(1);

    await bar.getByRole('button', { name: 'Ver seleção' }).click();
    const list = window.getByRole('table', { name: 'Reservas selecionadas' });
    for (const number of BATCH) {
      await list.getByRole('cell', { name: number, exact: true }).waitFor();
    }
    await window.getByRole('button', { name: 'Fechar seleção' }).click();
    await list.waitFor({ state: 'detached' });
  });

  it('aplica o comprovante: 8 com comprovante, 2 ignoradas com o motivo, seleção vazia (cenários 1, 2 e 6)', async () => {
    const { window } = launched;
    await stubOpenDialog(launched.app, fileOf('lote.pdf'));

    await window
      .getByTestId('selection-bar')
      .getByRole('button', { name: 'Anexar comprovante' })
      .click();

    const dialog = window.getByRole('dialog', { name: 'Anexar comprovante a 10 reservas' });
    await dialog.getByTestId('document-preview').getByText('lote.pdf').waitFor();
    const summary = dialog.getByTestId('attach-summary');
    await summary.getByText(/reservas aceitam o documento/).waitFor();
    expect(await summary.innerText()).toMatch(
      /8\s+reservas aceitam o documento — total de\s+R\$\s800,00/,
    );
    expect(await summary.innerText()).toMatch(/2\s+serão ignoradas/);
    await summary
      .getByRole('row')
      .filter({ hasText: 'B09' })
      .getByText('Esta reserva não exige cobrança.')
      .waitFor();

    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await dialog.getByText('Documento registrado em 8 reservas.').waitFor({ timeout: 20_000 });
    await dialog.getByTestId('attach-result').getByRole('row').filter({ hasText: 'B10' }).waitFor();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });

    await window.getByTestId('selection-bar').waitFor({ state: 'detached' });

    // No servidor: as 8 têm o mesmo arquivo, guardado uma vez só (SC-005, research R-01).
    const { rows } = await server.test.database.pool.query<{ documents: number; files: number }>(
      `select count(*)::int as documents, count(distinct file_sha256)::int as files
       from treatment_documents where original_name = 'lote.pdf'`,
    );
    expect(rows[0]).toEqual({ documents: 8, files: 1 });
    expect((await treatmentOf('B01')).treatment.status).toBe('charged');
    expect((await treatmentOf('B09')).treatment.status).toBe('none');
  });
});

describe('SC-011 — a pré-visualização não acessa a rede nem deixa cópia no disco', () => {
  const recordedRequests = () =>
    launched.app.evaluate(() => {
      const hooks = (globalThis as Record<string, unknown>)['__hunitTest'] as
        { requests?: string[] } | undefined;
      return hooks?.requests ?? [];
    });

  it('a interface não pediu nada à rede: nem o rastreador do e-mail', async () => {
    const requests = await recordedRequests();

    expect(requests.filter((url) => /^(https?|wss?|ftp):/i.test(url))).toEqual([]);
    expect(requests.join(' ')).not.toContain('rastreador.exemplo.test');

    // Controle: o registro funciona — ao recarregar a página, ele vê os arquivos do próprio app.
    await launched.window.reload();
    await launched.window.getByRole('navigation').waitFor();
    const afterReload = await recordedRequests();
    expect(afterReload.some((url) => url.startsWith('file:') && url.includes('index'))).toBe(true);
    expect(afterReload.filter((url) => /^(https?|wss?|ftp):/i.test(url))).toEqual([]);
  });

  it('nenhum arquivo da pasta de dados do app nem da pasta temporária tem o conteúdo dos documentos', async () => {
    const marker = Buffer.from(MARKER);
    const found: string[] = [];

    async function scan(directory: string, depth: number, onlyRecent: boolean): Promise<void> {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (full === inputDir) continue;
        const info = await stat(full).catch(() => null);
        if (!info) continue;
        if (onlyRecent && info.mtimeMs < startedAt) continue;
        if (entry.isDirectory()) {
          if (depth > 0) await scan(full, depth - 1, onlyRecent);
        } else if (info.size > 0 && info.size <= 64 * MB) {
          const content = await readFile(full).catch(() => null);
          if (content?.includes(marker)) found.push(full);
        }
      }
    }

    // Toda a pasta de dados do app (configuração, cache e sessão do Chromium, minidumps).
    await scan(launched.userDataDir, 8, false);
    // E o que apareceu na pasta temporária do usuário durante o teste.
    await scan(tmpdir(), 3, true);

    expect(found).toEqual([]);
  });
});

describe('Verificar — o Hunit mudou a situação depois da tratativa (FR-002a, FR-017a)', () => {
  beforeAll(async () => {
    const execution = await server.insertExecution({
      clientId: server.operator.id,
      status: 'completed',
      finishedAt: new Date(),
    });
    await server.insertReservation({
      lastExecutionId: execution.id,
      hotelCode: 'H1',
      reservationNumber: 'R-VER',
      totalAmount: '250.00',
    });
    // Seis registros da tratativa (o primeiro e cinco substituições): mais que os 5 do histórico.
    const key = { hotelCode: 'H1', reservationNumber: 'R-VER' };
    for (let index = 0; index < 6; index += 1) {
      await attach(
        server.test,
        server.operator,
        key,
        'request',
        'pedido.eml',
        serverEmlFile(`v${index}`),
      );
    }
    // Uma nova verificação no Hunit passou a reserva para "Já cobrada".
    await server.test.database.pool.query(
      `update reservations set classification = 'virtual_card_already_charged',
         previous_classification = classification, status_changed = true, status_changed_at = now()
       where hotel_code = 'H1' and reservation_number = 'R-VER'`,
    );
  });

  it('a lista mostra a situação do Hunit com o alerta, e "A verificar" a encontra', async () => {
    const { window } = launched;
    await goTo(window, 'Reservas');
    await searchFor(window, 'R-VER');

    const row = rowOf(window, 'R-VER');
    await row.getByText('Já cobrada', { exact: true }).waitFor();
    await row.getByText('Verificar', { exact: true }).waitFor();
    expect(await row.getByText('Tratativa enviada').count()).toBe(0);

    await window.getByLabel('Busca livre').fill('');
    const shortcut = window.getByRole('button', { name: 'A verificar' });
    await shortcut.click();
    await window.getByRole('cell', { name: 'R-PEND', exact: true }).waitFor({ state: 'detached' });
    await window.getByRole('cell', { name: 'R-VER', exact: true }).waitFor();
    expect(await window.locator('tbody tr').count()).toBe(1);
    await shortcut.click();
    await window.getByRole('cell', { name: 'R-PEND', exact: true }).waitFor();
  });

  it('confirmar tira o alerta e fica no histórico, que mostra 5 itens e "Mostrar mais"', async () => {
    const { window } = launched;
    await openDetail(window, 'R-VER');

    const alert = section(window).getByTestId('review-alert');
    await alert.getByText(/o Hunit passou a mostrar esta reserva como/).waitFor();
    const history = section(window).getByRole('list', { name: 'Histórico da tratativa' });
    await expect.poll(() => history.getByRole('listitem').count()).toBe(5);

    await alert.getByRole('button', { name: 'Confirmar' }).click();
    await section(window).getByText('Verificação confirmada.').waitFor();
    await alert.waitFor({ state: 'detached' });
    await history.getByText(/Confirmou a verificação: Já cobrada/).waitFor();

    await section(window).getByRole('button', { name: 'Mostrar mais' }).click();
    await expect.poll(() => history.getByRole('listitem').count()).toBe(7);
    // A tratativa continua registrada (relatório de recuperadas).
    expect((await treatmentOf('R-VER')).treatment.status).toBe('sent');

    await closeDetail(window);
    await rowOf(window, 'R-VER')
      .getByText('Verificar', { exact: true })
      .waitFor({ state: 'detached' });
    await rowOf(window, 'R-VER').getByText('Já cobrada', { exact: true }).waitFor();
  });
});

describe('US4 — consulta com a chave de perfil consulta', () => {
  let reader: LaunchedApp;

  beforeAll(async () => {
    reader = await launchApp();
    await configureApp(reader, {
      serverUrl: tls.url,
      certificatePem: certificates.authority.certificatePem,
      apiKey: server.reader.apiKey,
    });
    await goTo(reader.window, 'Reservas');
  }, 120_000);

  afterAll(async () => {
    await reader?.close();
  });

  it('"Falta cobrar" traz as pendentes sem comprovante, inclusive a "Tratativa enviada" (FR-002)', async () => {
    const { window } = reader;
    await window.getByRole('cell', { name: 'R-PEND', exact: true }).waitFor();

    await window.getByRole('button', { name: 'Falta cobrar' }).click();

    await window.getByRole('cell', { name: 'R-ENV', exact: true }).waitFor();
    await rowOf(window, 'R-ENV').getByText('Tratativa enviada', { exact: true }).waitFor();
    // As cobradas (R-PEND e B01 a B08), a faturada e as já cobradas pelo Hunit ficam de fora.
    await window.getByRole('cell', { name: 'R-PEND', exact: true }).waitFor({ state: 'detached' });
    expect(await window.locator('tbody tr').count()).toBe(1);

    await window.getByRole('button', { name: 'Falta cobrar' }).click();
    await window.getByRole('cell', { name: 'R-PEND', exact: true }).waitFor();
  });

  it('filtra por "Comprovante enviado", vê documentos e histórico e baixa, sem ações de registro (cenários 2 a 4)', async () => {
    const { window } = reader;
    await window.getByPlaceholder('Todas as situações').click();
    await window.getByRole('option', { name: 'Comprovante enviado' }).click();
    // A lista de situações é longa: fechada, ela não cobre o botão "Buscar".
    await window.keyboard.press('Escape');
    await window.getByRole('button', { name: 'Buscar', exact: true }).click();

    await window.getByRole('cell', { name: 'R-PEND', exact: true }).waitFor();
    await window.getByRole('cell', { name: 'R-ENV', exact: true }).waitFor({ state: 'detached' });
    expect(await window.locator('tbody tr').count()).toBe(9);
    // Sem seleção de lote para o perfil consulta.
    expect(await window.getByRole('checkbox', { name: /Selecionar/ }).count()).toBe(0);

    await window.getByRole('cell', { name: 'R-PEND', exact: true }).click();
    const treatment = section(window);
    await treatment.getByText('Comprovante enviado', { exact: true }).waitFor();
    await treatment
      .getByRole('row')
      .filter({ hasText: 'comprovante-2.pdf' })
      .getByText('Substituído')
      .waitFor();
    await treatment
      .getByRole('list', { name: 'Histórico da tratativa' })
      .getByText(/Reverteu comprovante/)
      .waitFor();
    for (const name of [/Anexar/, /Substituir/, 'Desfazer', 'Reverter', 'Informar valor']) {
      expect(await treatment.getByRole('button', { name }).count()).toBe(0);
    }

    const target = path.join(inputDir, 'baixado-consulta.pdf');
    await stubSaveDialog(reader.app, target);
    await treatment
      .getByRole('row')
      .filter({ hasText: 'comprovante.pdf' })
      .getByRole('button', { name: 'Baixar' })
      .click();
    await treatment.getByText(`Salvo em ${target}`).waitFor();
    expect((await readFile(target)).equals(await readFile(fileOf('comprovante.pdf')))).toBe(true);
  });
});
