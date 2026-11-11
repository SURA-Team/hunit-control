import { chromium, type Browser } from 'playwright';

/**
 * Abre o Chromium para os testes do projeto `server-browser`.
 *
 * Se o navegador não estiver instalado, explica como instalar (a mensagem original do
 * Playwright sugere `npx`, que não usa a versão do projeto).
 */
export async function launchTestBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      throw new Error(
        'O Chromium do Playwright não está instalado nesta máquina. Instale com:\n' +
          '  pnpm --filter @hunit/server exec playwright install chromium',
        { cause: error },
      );
    }
    throw error;
  }
}

export type Rgb = [red: number, green: number, blue: number];

/** Executado dentro do navegador: decodifica o PNG e lê a cor dos pontos pedidos. */
const READ_PIXELS = `async ({ base64, points }) => {
  const image = new Image();
  image.src = 'data:image/png;base64,' + base64;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return points.map(({ x, y }) => {
    const [red, green, blue] = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [red, green, blue];
  });
}`;

/**
 * Lê a cor de pontos de uma imagem PNG. Usa o próprio navegador para decodificar a imagem,
 * sem depender de uma biblioteca de imagens.
 */
export async function readPixels(
  browser: Browser,
  png: Buffer,
  points: ReadonlyArray<{ x: number; y: number }>,
): Promise<Rgb[]> {
  const page = await browser.newPage();
  try {
    const input = JSON.stringify({ base64: png.toString('base64'), points });
    return await page.evaluate<Rgb[]>(`(${READ_PIXELS})(${input})`);
  } finally {
    await page.close();
  }
}
