/**
 * Perguntas no terminal para os comandos de verificação manual do Hunit (`hunit-*-check`).
 * Senha e token são lidos sem aparecer na tela e ficam só na memória do processo.
 */
import { createInterface } from 'node:readline/promises';

export async function ask(question: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

/** Lê uma linha sem mostrar o que é digitado. */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();

    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Cancelado.'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

/** Argumentos do comando, sem o "--" literal que o pnpm repassa (`pnpm ... -- --opcao x`). */
export function commandArgs(): string[] {
  const argv = process.argv.slice(2);
  return argv[0] === '--' ? argv.slice(1) : argv;
}
