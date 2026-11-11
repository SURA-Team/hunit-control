/**
 * Gera as fixtures reais anonimizadas do Hunit (tasks.md, T021) a partir do material bruto dos
 * comandos `hunit:login-check` e `hunit:reservations-check`.
 *
 *   pnpm build                     # compila os pacotes do workspace e o servidor
 *   pnpm --filter @hunit/server hunit:anonymize-fixtures
 *
 * Lê `test/fixtures/hunit/raw/` (ignorada pelo Git) e grava `test/fixtures/hunit/html/real/`,
 * `json/real/` e `real/manifest.json`, apagando antes o que havia nessas pastas. Não mostra
 * nenhum valor das respostas: só os arquivos gerados, as classificações e os caminhos de campo
 * trocados de forma genérica. Se a conferência final achar um valor original no resultado,
 * nada é gravado.
 *
 * Opções: `--raw <pasta>` e `--out <pasta>` (padrões acima, relativos a apps/server).
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { commandArgs } from './cli-prompt.js';
import { CLASSIFICATION_LABELS } from './executions/hotel-collection.js';
import { anonymizeFixtures, FixtureLeakError, type RawFile } from './fixture-anonymizer.js';

function out(text = ''): void {
  process.stdout.write(`${text}\n`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: commandArgs(),
    options: { raw: { type: 'string' }, out: { type: 'string' } },
  });
  const rawDir = path.resolve(values.raw ?? 'test/fixtures/hunit/raw');
  const outDir = path.resolve(values.out ?? 'test/fixtures/hunit');

  let names: string[];
  try {
    names = (await readdir(rawDir)).filter((name) => /\.(html|json)$/.test(name));
  } catch {
    process.stderr.write(`Pasta do material bruto não encontrada: ${rawDir}\n`);
    return 1;
  }
  const raw: RawFile[] = await Promise.all(
    names.map(async (name) => ({ name, content: await readFile(path.join(rawDir, name), 'utf8') })),
  );

  let result;
  try {
    result = anonymizeFixtures(raw, { generatedAt: new Date().toISOString().slice(0, 10) });
  } catch (error) {
    if (error instanceof FixtureLeakError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  for (const folder of ['html/real', 'json/real', 'real']) {
    await rm(path.join(outDir, folder), { recursive: true, force: true });
  }
  for (const file of result.files) {
    const target = path.join(outDir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }

  const { manifest, report } = result;
  out(`Fixtures geradas em ${outDir}:`);
  out(`  telas: ${manifest.html.map((entry) => entry.screen).join(', ') || 'nenhuma'}`);
  out(`  catálogo: ${manifest.currentUser ? 'sim' : 'não'}`);
  out(`  páginas da listagem: ${manifest.bookings.length}`);
  out(`  detalhes de reserva: ${manifest.details.length}`);
  const counts = new Map<string, number>();
  for (const detail of manifest.details) {
    const label = CLASSIFICATION_LABELS[detail.expected.classification];
    const key = `${label} (${detail.expected.reservationStatus === 'cancelled' ? 'cancelada' : 'ativa'})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [label, count] of counts) out(`    ${label}: ${count}`);

  if (report.genericFields.length > 0) {
    out();
    out('Campos trocados por valor genérico (revise; se forem inofensivos, acrescente à lista de');
    out('permissão em src/fixture-anonymizer.ts):');
    for (const field of report.genericFields) out(`  ${field}`);
  }
  if (report.skipped.length > 0) {
    out();
    out('Arquivos brutos não usados:');
    for (const skipped of report.skipped) out(`  ${skipped.name}: ${skipped.reason}`);
  }
  out();
  out(
    'Antes do commit, revise os arquivos gerados (git diff) e confira git diff --cached --name-only.',
  );
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
});
