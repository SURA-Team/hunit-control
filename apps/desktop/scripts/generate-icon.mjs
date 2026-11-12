// Gera o ícone provisório do app: resources/icon.png (256×256) e resources/icon.ico (o mesmo PNG
// dentro de um ICO, aceito pelo Windows desde o Vista). Desenho próprio, sem marca de terceiros
// (specs/002, T006): quadrado de cantos arredondados azul com um "H" branco.
//   node apps/desktop/scripts/generate-icon.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const RADIUS = 48;
const BLUE = [28, 126, 214];
const WHITE = [255, 255, 255];

/** 0 = fora do ícone, 1 = dentro; cantos arredondados com borda suavizada. */
function coverage(x, y) {
  const cx = Math.min(Math.max(x + 0.5, RADIUS), SIZE - RADIUS);
  const cy = Math.min(Math.max(y + 0.5, RADIUS), SIZE - RADIUS);
  const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  return Math.max(0, Math.min(1, RADIUS - distance + 0.5));
}

/** O "H": duas hastes e a barra do meio. */
function isLetter(x, y) {
  const inStem = (left) => x >= left && x < left + 36 && y >= 60 && y < 196;
  const inBar = x >= 76 && x < 180 && y >= 110 && y < 146;
  return inStem(76) || inStem(144) || inBar;
}

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y += 1) {
  const row = y * (1 + SIZE * 4);
  raw[row] = 0; // filtro "nenhum"
  for (let x = 0; x < SIZE; x += 1) {
    const offset = row + 1 + x * 4;
    const [r, g, b] = isLetter(x, y) ? WHITE : BLUE;
    raw[offset] = r;
    raw[offset + 1] = g;
    raw[offset + 2] = b;
    raw[offset + 3] = Math.round(coverage(x, y) * 255);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bits por canal
header[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ICO com uma imagem PNG de 256×256 (largura e altura 0 = 256).
const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2); // ícone
ico.writeUInt16LE(1, 4); // uma imagem
ico[6] = 0;
ico[7] = 0;
ico[8] = 0; // sem paleta
ico[9] = 0;
ico.writeUInt16LE(1, 10); // planos
ico.writeUInt16LE(32, 12); // bits por pixel
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(6 + 16, 18);

const resources = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(resources, { recursive: true });
writeFileSync(join(resources, 'icon.png'), png);
writeFileSync(join(resources, 'icon.ico'), Buffer.concat([ico, png]));
stdout.write(`gerados: icon.png (${png.length} bytes) e icon.ico em ${resources}\n`);
