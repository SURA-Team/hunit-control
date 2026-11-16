/**
 * Auxiliares dos testes do comando `legacy-import` (specs/004): roda o comando em processo,
 * capturando a saída, e conta as linhas gravadas.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { count } from 'drizzle-orm';
import { runCli, type CliOptions } from '../../src/cli.js';
import {
  legacyImports,
  legacyReservations,
  reservationManualAmounts,
  reservations,
  treatmentDocuments,
  treatmentEvents,
  treatmentFiles,
} from '../../src/persistence/schema.js';
import type { TestDatabase } from './db.js';

export interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Roda `legacy-import <args>` como o `node dist/cli.js` faria. */
export async function legacyImport(
  database: TestDatabase,
  args: string[],
  options: CliOptions['legacyImport'] = {},
): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(
    ['legacy-import', ...args],
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      env: { DATABASE_URL: database.url },
    },
    { legacyImport: options },
  );
  return { exitCode, stdout, stderr };
}

/** Id da simulação ou importação mostrado na primeira linha do relatório. */
export function reportId(output: string): string {
  const id = /^(?:Simulação|Importação) ([0-9a-f-]{36})/m.exec(output)?.[1];
  if (!id) throw new Error(`relatório sem id:\n${output}`);
  return id;
}

/** Pasta temporária com `planilha.xlsx` e `anexos/`; `cleanup` apaga tudo. */
export function legacyWorkspace(): {
  dir: string;
  xlsx: string;
  files: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'legacy-import-'));
  return {
    dir,
    xlsx: path.join(dir, 'planilha.xlsx'),
    files: path.join(dir, 'anexos'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Quantidade de linhas de cada tabela que a importação grava. */
export async function writtenRows(database: TestDatabase): Promise<Record<string, number>> {
  const tables = {
    reservations,
    legacyReservations,
    treatmentFiles,
    treatmentDocuments,
    treatmentEvents,
    reservationManualAmounts,
    legacyImports,
  };
  const result: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await database.db.select({ value: count() }).from(table);
    result[name] = row?.value ?? 0;
  }
  return result;
}
