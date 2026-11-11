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
 *   pnpm --filter @hunit/server build
 *   pnpm --filter @hunit/server hunit:login-check --save-dir test/fixtures/hunit/raw
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
    options: { 'save-dir': { type: 'string' } },
  });
  const saveDir = values['save-dir'] ? path.resolve(values['save-dir']) : null;

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
  try {
    process.stdout.write('Abrindo o Hunit e enviando usuário e senha...\n');
    const outcome = await gateway.login({ username, password });
    if (outcome === 'two_factor_required') {
      const token = await askHidden('Token do autenticador (não aparece): ');
      secrets.register(token);
      process.stdout.write('Enviando o token...\n');
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
  if (saveDir) process.stdout.write(`\nTelas salvas em: ${saveDir}\n`);
  return exitCode;
}

process.exitCode = await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
});
