/**
 * Comandos administrativos do servidor (research R-10).
 *
 *   node dist/cli.js create-client --name <nome> --role <operator|reader>
 *   node dist/cli.js revoke-client --name <nome>
 *
 * No Docker: docker compose exec server node dist/cli.js create-client --name desktop --role operator
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ConfigError, loadDatabaseUrl } from './config.js';
import { generateApiKey, hashApiKey } from './http/auth.js';
import { ClientNameTakenError, createClient, revokeClient } from './persistence/clients-repo.js';
import { connectDatabase, runMigrations, type DatabaseConnection } from './persistence/db.js';
import { findDatabaseError } from './persistence/errors.js';
import { clientRoleEnum, type ClientRole } from './persistence/schema.js';

const USAGE = `Uso:
  create-client --name <nome> --role <operator|reader>   Cadastra um cliente e mostra a chave de API
  revoke-client --name <nome>                             Revoga um cliente (a chave deixa de valer)

Níveis de acesso:
  operator   inicia, cancela e retoma execuções, envia o token e consulta resultados
  reader     somente acompanha execuções e consulta resultados
`;

/** Nome curto, sem espaços: aparece em logs e nas respostas da API. */
const CLIENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,49}$/;

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
}

/** Erro de uso do comando: mostra a mensagem e termina com código 1. */
class UsageError extends Error {}

function isClientRole(value: string): value is ClientRole {
  return (clientRoleEnum.enumValues as readonly string[]).includes(value);
}

function readName(value: string | undefined): string {
  if (value === undefined) throw new UsageError('Informe o nome do cliente com --name.');
  if (!CLIENT_NAME_PATTERN.test(value)) {
    throw new UsageError(
      'Nome inválido: use de 2 a 50 caracteres, só letras minúsculas, números, "-" e "_".',
    );
  }
  return value;
}

async function createClientCommand(
  args: string[],
  io: CliIo,
  connection: DatabaseConnection,
): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { name: { type: 'string' }, role: { type: 'string' } },
  });
  const name = readName(values.name);
  const role = values.role;
  if (role === undefined || !isClientRole(role)) {
    throw new UsageError('Informe o nível de acesso com --role operator ou --role reader.');
  }

  const apiKey = generateApiKey();
  await createClient(connection.db, { name, role, keyHash: hashApiKey(apiKey) });

  io.stdout(
    [
      `Cliente "${name}" criado com o nível "${role}".`,
      '',
      'Chave de API (guarde agora: ela não é armazenada e não será mostrada de novo):',
      apiKey,
      '',
    ].join('\n'),
  );
}

async function revokeClientCommand(
  args: string[],
  io: CliIo,
  connection: DatabaseConnection,
): Promise<void> {
  const { values } = parseArgs({ args, options: { name: { type: 'string' } } });
  const name = readName(values.name);

  const result = await revokeClient(connection.db, name);
  if (result === 'not_found') throw new UsageError(`Não existe cliente chamado "${name}".`);

  io.stdout(
    result === 'revoked'
      ? `Cliente "${name}" revogado: a chave dele não é mais aceita.\n`
      : `O cliente "${name}" já estava revogado.\n`,
  );
}

const COMMANDS = {
  'create-client': createClientCommand,
  'revoke-client': revokeClientCommand,
} as const;

function isCommand(value: string | undefined): value is keyof typeof COMMANDS {
  return value !== undefined && value in COMMANDS;
}

/** Executa um comando e devolve o código de saída do processo (0 = sucesso). */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [commandName, ...args] = argv;

  if (!isCommand(commandName)) {
    io.stderr(
      commandName === undefined ? USAGE : `Comando desconhecido: ${commandName}\n\n${USAGE}`,
    );
    return 1;
  }

  let connection: DatabaseConnection | undefined;
  try {
    connection = connectDatabase(loadDatabaseUrl(io.env));
    await runMigrations(connection);
    await COMMANDS[commandName](args, io, connection);
    return 0;
  } catch (error) {
    if (
      error instanceof UsageError ||
      error instanceof ConfigError ||
      error instanceof ClientNameTakenError
    ) {
      io.stderr(`${error.message}\n`);
    } else if (error instanceof TypeError && 'code' in error) {
      // Erro do parseArgs: opção desconhecida ou sem valor.
      io.stderr(`${error.message}\n\n${USAGE}`);
    } else {
      // Em erros de banco, mostra a mensagem do PostgreSQL (a do Drizzle repete os parâmetros).
      const reason = findDatabaseError(error) ?? error;
      io.stderr(
        `Falha ao executar "${commandName}": ${reason instanceof Error ? reason.message : String(reason)}\n`,
      );
    }
    return 1;
  } finally {
    await connection?.close();
  }
}

/** Verdadeiro quando este arquivo é o programa executado (`node dist/cli.js`), e não um import. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    env: process.env,
  });
}
