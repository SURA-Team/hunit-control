/**
 * Verificação manual do login no Hunit REAL (tasks.md, T020 e T022).
 *
 * Quem roda é o operador, no próprio terminal: e-mail, senha e token são digitados aqui (senha e
 * token sem aparecer na tela), ficam só na memória deste processo e nunca são gravados. O
 * programa usa o mesmo gateway do servidor (com a proteção de somente leitura) e mostra:
 * - se o acesso foi concluído e quantos hotéis ativos a conta tem;
 * - as requisições ao hunit-api que a proteção bloqueou ou detectou (método e caminho, sem
 *   parâmetros) — é assim que se descobre a rota real de retorno do login (T022).
 *
 * Com `--save-dir <pasta>`, guarda nessa pasta as telas de login e do token e a evidência de uma
 * falha (HTML sem valores de campos e captura com os campos cobertos; o e-mail é apagado). Use a
 * pasta `test/fixtures/hunit/raw/`, que é ignorada pelo Git: o material ainda precisa ser
 * anonimizado antes de virar fixture (T021).
 *
 * Com `--wait-token <segundos>`, espera esse tempo com a tela do token aberta antes de pedir o
 * token: serve para medir quanto tempo a tela aceita (T022, FR-004) e para capturar a tela de
 * token expirado (T020). O tempo entre a tela abrir e o token ser enviado é sempre mostrado.
 *
 *   pnpm --filter @hunit/server build
 *   pnpm --filter @hunit/server hunit:login-check --save-dir test/fixtures/hunit/raw
 *   pnpm --filter @hunit/server hunit:login-check --wait-token 240 --save-dir test/fixtures/hunit/raw
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Page } from 'playwright';
import { ask, askHidden, commandArgs } from './cli-prompt.js';
import { capturePageEvidence } from './evidence/capture.js';
import type { EvidenceMaterial } from './evidence/material.js';
import { sanitizeHtml } from './evidence/sanitize.js';
import { HunitError } from './hunit/errors.js';
import { PlaywrightHunitGateway } from './hunit/playwright-gateway.js';
import { createLogger } from './logging.js';
import { SecretRegistry } from './secrets.js';

const DEFAULT_WEB_URL = 'https://hunit.hsystem.com.br';
const DEFAULT_API_URL = 'https://hunit-api.hsystem.com.br';

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: commandArgs(),
    options: { 'save-dir': { type: 'string' }, 'wait-token': { type: 'string' } },
  });
  const saveDir = values['save-dir'] ? path.resolve(values['save-dir']) : null;
  const waitTokenSeconds = Number(values['wait-token'] ?? 0);
  if (!Number.isInteger(waitTokenSeconds) || waitTokenSeconds < 0) {
    process.stderr.write('--wait-token deve ser um número inteiro de segundos (0 ou mais).\n');
    return 1;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write('Rode este comando num terminal interativo (ele pede senha e token).\n');
    return 1;
  }

  const webUrl = process.env['HUNIT_WEB_URL'] || DEFAULT_WEB_URL;
  const apiUrl = process.env['HUNIT_API_URL'] || DEFAULT_API_URL;
  const secrets = new SecretRegistry();
  const logger = createLogger({ level: 'warn', secrets, destination: process.stderr });
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);

  process.stdout.write(
    `Verificação do login no Hunit (${webUrl}).\n` +
      'Nada do que você digitar é gravado. Ctrl+C cancela.\n\n',
  );
  const username = await ask('E-mail do Hunit: ');
  const password = await askHidden('Senha (não aparece): ');
  secrets.register(username, password);

  const save = async (name: string, material: EvidenceMaterial) => {
    if (!saveDir) return;
    await mkdir(saveDir, { recursive: true });
    const base = path.join(saveDir, `${stamp}-${name}`);
    if (material.html) await writeFile(`${base}.html`, secrets.scrub(sanitizeHtml(material.html)));
    if (material.response) await writeFile(`${base}.json`, secrets.scrub(material.response));
    if (material.screenshot) await writeFile(`${base}.png`, material.screenshot);
  };
  const saveScreen = async (screen: string, page: Page) =>
    save(screen, await capturePageEvidence(page, { sensitiveTexts: [username] }));

  const gateway = await PlaywrightHunitGateway.open(
    { webUrl, apiUrl, logger, ...(saveDir && { onScreen: saveScreen }) },
    logger,
  );

  let exitCode = 0;
  /** Quando a tela do token abriu e quando o token foi enviado (T022). */
  let tokenScreenAt: number | null = null;
  let tokenSentAt: number | null = null;
  try {
    process.stdout.write('Abrindo o Hunit e enviando usuário e senha...\n');
    const outcome = await gateway.login({ username, password });
    if (outcome === 'two_factor_required') {
      tokenScreenAt = Date.now();
      process.stdout.write(`Tela do token aberta às ${clock(tokenScreenAt)}.\n`);
      if (waitTokenSeconds > 0) await countdown(waitTokenSeconds);
      const token = await askHidden('Token do autenticador (não aparece): ');
      secrets.register(token);
      tokenSentAt = Date.now();
      process.stdout.write(
        `Enviando o token ${seconds(tokenSentAt - tokenScreenAt)} s depois de a tela abrir...\n`,
      );
      await gateway.submitToken(token);
    }
    const hotels = await gateway.listHotels();
    process.stdout.write(`\nOK: acesso concluído. Hotéis ativos na conta: ${hotels.length}.\n`);
  } catch (error) {
    exitCode = 1;
    if (error instanceof HunitError) {
      process.stdout.write(`\nFALHOU (${error.code}): ${secrets.scrub(error.message)}\n`);
      if (error.evidence) await save(`erro-${error.code}`, error.evidence);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`\nFALHOU (erro inesperado): ${secrets.scrub(message)}\n`);
    }
  } finally {
    await gateway.close().catch(() => undefined);
  }

  const blocked = [
    ...new Set(
      gateway.blockedRequests.map(
        (request) =>
          `${request.method} ${request.path}${request.sent ? '  (redirecionamento — passou)' : ''}`,
      ),
    ),
  ];
  process.stdout.write(
    blocked.length > 0
      ? `\nRequisições ao hunit-api barradas ou detectadas pela proteção:\n  ${blocked.join('\n  ')}\n`
      : '\nNenhuma requisição ao hunit-api foi barrada pela proteção.\n',
  );
  if (tokenScreenAt !== null && tokenSentAt !== null) {
    process.stdout.write(
      `\nTempo com a tela do token aberta até o envio: ${seconds(tokenSentAt - tokenScreenAt)} s ` +
        `(${exitCode === 0 ? 'aceito' : 'não aceito'}). Registre na T022.\n`,
    );
  }
  if (saveDir) process.stdout.write(`\nTelas salvas em: ${saveDir}\n`);
  return exitCode;
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function seconds(milliseconds: number): number {
  return Math.round(milliseconds / 1000);
}

/** Espera com a tela do token aberta, avisando a cada 30 s quanto falta. */
async function countdown(total: number): Promise<void> {
  process.stdout.write(
    `Esperando ${total} s antes de pedir o token (não digite nada ainda; Ctrl+C cancela).\n`,
  );
  for (let left = total; left > 0;) {
    const step = Math.min(left, 30);
    await new Promise((resolve) => setTimeout(resolve, step * 1000));
    left -= step;
    if (left > 0) process.stdout.write(`  faltam ${left} s...\n`);
  }
  process.stdout.write('Pronto: abra o autenticador e digite o token ATUAL.\n');
}

process.exitCode = await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
});
