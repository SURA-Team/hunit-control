/**
 * Gera o instalador com a versão `major.minor.<commits do Git>` (specs/002, research R-11).
 *
 *   pnpm --filter @hunit/desktop dist
 *
 * A versão vai para o `package.json` empacotado (`extraMetadata.version`): é o que o app mostra em
 * Configuração e o que entra no nome do instalador. O `package.json` do repositório não muda.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exit, stdout } from 'node:process';
import { gitCommitCount, installerVersion } from './installer-version.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

const version = installerVersion(manifest.version, gitCommitCount(appRoot));
stdout.write(`Versão do instalador: ${version}\n`);

/** Roda um comando de `node_modules/.bin` (no Windows são `.cmd`, por isso o shell). */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: appRoot, stdio: 'inherit', shell: true });
  if (result.status !== 0) exit(result.status ?? 1);
}

run('electron-vite', ['build']);
run('electron-builder', ['--win', `--config.extraMetadata.version=${version}`]);
