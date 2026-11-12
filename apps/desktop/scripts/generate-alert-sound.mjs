// Gera resources/sounds/token-alert.wav: dois bipes curtos, sem áudio de terceiros
// (specs/002, T006). Rode de novo só se quiser mudar o som:
//   node apps/desktop/scripts/generate-alert-sound.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44_100;
const VOLUME = 0.5;
// [frequência em Hz, duração em segundos]; frequência 0 = silêncio.
const PARTS = [
  [880, 0.15],
  [0, 0.08],
  [1175, 0.2],
];
const FADE_SECONDS = 0.01; // evita estalos no começo e no fim de cada bipe

const samples = [];
for (const [frequency, seconds] of PARTS) {
  const count = Math.round(seconds * SAMPLE_RATE);
  const fade = Math.round(FADE_SECONDS * SAMPLE_RATE);
  for (let i = 0; i < count; i += 1) {
    if (frequency === 0) {
      samples.push(0);
      continue;
    }
    const envelope = Math.min(1, i / fade, (count - 1 - i) / fade);
    samples.push(Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * envelope * VOLUME);
  }
}

// WAV PCM 16 bits, mono.
const dataSize = samples.length * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0, 'ascii');
wav.writeUInt32LE(36 + dataSize, 4);
wav.write('WAVE', 8, 'ascii');
wav.write('fmt ', 12, 'ascii');
wav.writeUInt32LE(16, 16); // tamanho do bloco fmt
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // mono
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes por segundo
wav.writeUInt16LE(2, 32); // bytes por amostra
wav.writeUInt16LE(16, 34); // bits por amostra
wav.write('data', 36, 'ascii');
wav.writeUInt32LE(dataSize, 40);
samples.forEach((value, index) => {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), 44 + index * 2);
});

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'resources',
  'sounds',
  'token-alert.wav',
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, wav);
stdout.write(`gerado: ${target} (${wav.length} bytes)\n`);
