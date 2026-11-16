/**
 * Versão do instalador (specs/002, research R-11, "Versão do instalador").
 *
 * O `package.json` do app guarda só o major e o minor, subidos à mão a cada feature. O último
 * número é a quantidade de commits do Git: cada atualização puxada para a pasta de produção gera
 * um número maior, e o mesmo código gera sempre o mesmo número.
 */
import { execFileSync } from 'node:child_process';

/** O Windows guarda cada parte da versão do arquivo em 16 bits. */
const MAX_PART = 65_535;

/**
 * Monta a versão `major.minor.<commits>` a partir da versão do `package.json`.
 *
 * @param {string} packageVersion versão do `package.json` (ex.: `0.2.0`; o último número é ignorado)
 * @param {number} commitCount quantidade de commits do Git (`git rev-list --count HEAD`)
 * @returns {string}
 */
export function installerVersion(packageVersion, commitCount) {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(packageVersion);
  if (!match) {
    throw new Error(`Versão inválida no package.json: "${packageVersion}" (use major.minor.0).`);
  }
  if (!Number.isInteger(commitCount) || commitCount < 1 || commitCount > MAX_PART) {
    throw new Error(`Quantidade de commits inválida: ${String(commitCount)}.`);
  }
  return `${match[1]}.${match[2]}.${commitCount}`;
}

/**
 * Quantidade de commits até o `HEAD` do repositório em `cwd`.
 *
 * @param {string} cwd
 * @returns {number}
 */
export function gitCommitCount(cwd) {
  const output = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd, encoding: 'utf8' });
  return Number.parseInt(output.trim(), 10);
}
