/**
 * Ícone do app (specs/006, FR-003, US1-6, research R-04): o .ico gerado da marca tem os 7 tamanhos
 * que o Windows usa (16 a 256 px), cada um um PNG do tamanho certo, e o icon.png tem 256 × 256.
 * Gerados por scripts/generate-icon.mjs a partir de resources/brand.svg.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const resources = path.resolve(import.meta.dirname, '..', '..', 'resources');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Largura e altura de um PNG (cabeçalho IHDR). */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('ícone do app', () => {
  it('icon.ico tem exatamente os 7 tamanhos, cada um um PNG do tamanho declarado', () => {
    const ico = readFileSync(path.join(resources, 'icon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, index) => {
      const entry = 6 + index * 16;
      const declared = ico[entry] === 0 ? 256 : (ico[entry] ?? -1);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const { width, height } = pngSize(ico.subarray(offset, offset + length));
      expect(width).toBe(declared);
      expect(height).toBe(declared);
      return declared;
    });
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it('icon.png tem 256 × 256', () => {
    expect(pngSize(readFileSync(path.join(resources, 'icon.png')))).toEqual({
      width: 256,
      height: 256,
    });
  });

  it('a marca de origem é o SVG exportado do design', () => {
    const svg = readFileSync(path.join(resources, 'brand.svg'), 'utf8');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg.toLowerCase()).toContain('#d4f25a');
  });
});
