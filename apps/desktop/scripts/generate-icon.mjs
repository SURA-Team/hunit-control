// Gera o ícone do app a partir da marca da nova identidade (specs/006, FR-003, research R-04):
// resources/icon.ico com 16, 24, 32, 48, 64, 128 e 256 px (PNG dentro do ICO, aceito pelo Windows
// desde o Vista; cada tamanho desenhado do SVG, para os pequenos não borrarem) e resources/icon.png
// (256 px). A marca (resources/brand.svg) vem do Figma ("Marca/Ícone — nova identidade", node 24:70)
// e é rasterizada pelo Chromium do Playwright, que o projeto já usa nos testes. Os arquivos gerados
// são versionados.
//   node apps/desktop/scripts/generate-icon.mjs
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

const resources = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const brand = readFileSync(join(resources, 'brand.svg'), 'utf8');

/** A marca em `size` × `size` px, com fundo transparente fora dos cantos arredondados. */
async function rasterize(page, size) {
  const svg = brand
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO com uma imagem PNG por tamanho (largura e altura 0 = 256). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ícone
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // sem paleta
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const images = [];
  for (const size of ICON_SIZES) images.push({ size, png: await rasterize(page, size) });
  const largest = images.at(-1);
  writeFileSync(join(resources, 'icon.ico'), ico(images));
  writeFileSync(join(resources, 'icon.png'), largest.png);
  stdout.write(
    `gerados: icon.ico (${ICON_SIZES.join(', ')} px) e icon.png (256 px) em ${resources}\n`,
  );
} finally {
  await browser.close();
}
