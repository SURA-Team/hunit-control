import type { LogLevel } from '../../src/config.js';
import { createLogger, type Logger } from '../../src/logging.js';
import type { SecretRegistry } from '../../src/secrets.js';

export interface CapturedLogs {
  logger: Logger;
  /** Linhas de log exatamente como seriam escritas na saída. */
  lines: string[];
  /** As mesmas linhas, já interpretadas como JSON. */
  records(): Array<Record<string, unknown>>;
  /** Todo o texto registrado, para procurar por valores que não podem aparecer. */
  text(): string;
}

/** Cria um logger que guarda as linhas em memória, para os testes inspecionarem. */
export function captureLogs(
  options: { level?: LogLevel; secrets?: SecretRegistry } = {},
): CapturedLogs {
  const lines: string[] = [];
  const logger = createLogger({
    level: options.level ?? 'trace',
    destination: { write: (line: string) => void lines.push(line) },
    ...(options.secrets && { secrets: options.secrets }),
  });

  return {
    logger,
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    text: () => lines.join(''),
  };
}
