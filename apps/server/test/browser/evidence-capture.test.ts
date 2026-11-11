import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { capturePageEvidence } from '../../src/evidence/capture.js';
import { launchTestBrowser, readPixels, type Rgb } from '../helpers/browser.js';

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const USERNAME = 'operador@hotel.test';
const PASSWORD = 'S3nh@Digitada!';
const TOKEN = '482913';

/**
 * Tela parecida com a de login/token. Os campos sensíveis têm fundo verde e texto vermelho:
 * sem a máscara, nenhum ponto deles é preto; com a máscara, todos são.
 */
const LOGIN_PAGE = `
  <html>
    <head>
      <style>
        body { margin: 0; padding: 20px; background: #ffffff; font: 16px sans-serif; }
        input, textarea, [contenteditable], .sensitive {
          display: block; width: 300px; height: 40px; margin: 10px 0;
          background: rgb(0, 200, 0); color: rgb(255, 0, 0); border: 0;
        }
      </style>
    </head>
    <body>
      <h1 id="title">Entrar na sua conta</h1>
      <div id="attempted-username" class="sensitive">${USERNAME}</div>
      <label for="username">Endereço de e-mail</label>
      <input id="username" name="username" value="${USERNAME}">
      <label for="password">Senha</label>
      <input id="password" name="password" type="password">
      <label for="otp">Código de uso único</label>
      <input id="otp" name="otp">
      <input type="hidden" name="credentialId" value="valor-oculto">
      <textarea id="notes"></textarea>
      <div id="editable" contenteditable="true"></div>
      <div id="public" class="sensitive">Texto que pode aparecer</div>
    </body>
  </html>`;

const SENSITIVE_ELEMENTS = [
  '#username',
  '#password',
  '#otp',
  '#notes',
  '#editable',
  '#attempted-username',
];

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(LOGIN_PAGE);
  await page.fill('#password', PASSWORD);
  await page.fill('#otp', TOKEN);
  await page.fill('#notes', `anotação com ${PASSWORD}`);
  await page.fill('#editable', `texto com ${TOKEN}`);
});

afterEach(async () => {
  await page.close();
});

/** Ponto central de cada elemento, em pixels da página. */
async function centersOf(selectors: readonly string[]) {
  const centers = [];
  for (const selector of selectors) {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`elemento ${selector} não encontrado`);
    centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return centers;
}

describe('capturePageEvidence (T023, research R-12)', () => {
  it('cobre na captura de tela todos os campos de entrada e os textos sensíveis', async () => {
    const centers = await centersOf(SENSITIVE_ELEMENTS);
    const unmasked = await page.screenshot({ fullPage: true });

    const { screenshot } = await capturePageEvidence(page, { sensitiveTexts: [USERNAME] });

    expect(screenshot?.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    // Controle: sem a máscara, esses pontos não são pretos (o teste distingue os dois casos).
    for (const color of await readPixels(browser, unmasked, centers)) {
      expect(color).not.toEqual(BLACK);
    }
    expect(await readPixels(browser, screenshot ?? Buffer.alloc(0), centers)).toEqual(
      SENSITIVE_ELEMENTS.map(() => BLACK),
    );
  });

  it('não cobre o resto da tela', async () => {
    const [publicText] = await centersOf(['#public']);
    const corner = { x: 790, y: 5 };

    const { screenshot } = await capturePageEvidence(page, { sensitiveTexts: [USERNAME] });

    const [publicColor, cornerColor] = await readPixels(browser, screenshot ?? Buffer.alloc(0), [
      publicText ?? corner,
      corner,
    ]);
    expect(publicColor).not.toEqual(BLACK);
    expect(cornerColor).toEqual(WHITE);
  });

  it('cobre os campos de entrada mesmo sem textos sensíveis informados', async () => {
    const centers = await centersOf(['#username', '#password', '#otp']);

    const { screenshot } = await capturePageEvidence(page);

    expect(await readPixels(browser, screenshot ?? Buffer.alloc(0), centers)).toEqual([
      BLACK,
      BLACK,
      BLACK,
    ]);
  });

  it('devolve o HTML sem o valor dos campos, digitado ou preenchido pelo site', async () => {
    const { html } = await capturePageEvidence(page, { sensitiveTexts: [USERNAME] });

    expect(html).toContain('<h1 id="title">Entrar na sua conta</h1>');
    expect(html).toContain('<input id="username" name="username">');
    expect(html).not.toMatch(/<input[^>]*\svalue=/i);
    expect(html).not.toContain('valor-oculto');
    // O que foi digitado nos campos <input> não faz parte do HTML da página.
    expect(html).not.toContain(PASSWORD.slice(0, 8));
  });

  it('ignora texto sensível vazio ou que não aparece na tela', async () => {
    const material = await capturePageEvidence(page, {
      sensitiveTexts: ['', '   ', 'texto-que-nao-existe-na-tela'],
    });

    expect(material.screenshot?.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(material.html).toContain('Entrar na sua conta');
  });

  it('nunca lança erro: com a página fechada, devolve material vazio', async () => {
    const closed = await browser.newPage();
    await closed.close();

    await expect(capturePageEvidence(closed, { timeoutMs: 2_000 })).resolves.toEqual({});
  });
});
