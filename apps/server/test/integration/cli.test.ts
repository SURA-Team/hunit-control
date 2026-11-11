import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { hashApiKey } from '../../src/http/auth.js';
import { findActiveClientByKeyHash } from '../../src/persistence/clients-repo.js';
import { apiClients } from '../../src/persistence/schema.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

/** Executa o CLI como o `node dist/cli.js` faria, capturando o que ele escreve. */
async function cli(args: string[], env?: Record<string, string | undefined>) {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    env: env ?? { DATABASE_URL: database.url },
  });
  return { exitCode, stdout, stderr };
}

function apiKeyFrom(stdout: string): string {
  const apiKey = /^hunit_\S+$/m.exec(stdout)?.[0];
  if (!apiKey) throw new Error('a saída do comando não mostrou a chave de API');
  return apiKey;
}

describe('create-client (T017)', () => {
  it('cadastra o cliente, mostra a chave uma vez e guarda só o hash', async () => {
    const result = await cli(['create-client', '--name', 'desktop', '--role', 'operator']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Cliente "desktop" criado com o nível "operator".');
    expect(result.stdout).toContain('não será mostrada de novo');

    const apiKey = apiKeyFrom(result.stdout);
    const [stored] = await database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.name, 'desktop'));

    expect(stored).toMatchObject({
      role: 'operator',
      keyHash: hashApiKey(apiKey),
      revokedAt: null,
    });
    expect(JSON.stringify(stored)).not.toContain(apiKey);
    expect(await findActiveClientByKeyHash(database.db, hashApiKey(apiKey))).toMatchObject({
      name: 'desktop',
      role: 'operator',
    });
  });

  it('gera uma chave diferente para cada cliente', async () => {
    const first = await cli(['create-client', '--name', 'leitura-1', '--role', 'reader']);
    const second = await cli(['create-client', '--name', 'leitura-2', '--role', 'reader']);

    expect(apiKeyFrom(first.stdout)).not.toBe(apiKeyFrom(second.stdout));
    expect(apiKeyFrom(first.stdout).length).toBeGreaterThanOrEqual(40);
  });

  it('recusa nome já usado', async () => {
    await cli(['create-client', '--name', 'repetido', '--role', 'reader']);

    const result = await cli(['create-client', '--name', 'repetido', '--role', 'operator']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Já existe um cliente chamado "repetido".');
  });

  it.each([
    [['create-client', '--role', 'reader'], 'Informe o nome do cliente com --name.'],
    [['create-client', '--name', 'sem-nivel'], 'Informe o nível de acesso'],
    [['create-client', '--name', 'x-admin', '--role', 'admin'], 'Informe o nível de acesso'],
    [['create-client', '--name', 'Nome Com Espaço', '--role', 'reader'], 'Nome inválido'],
    [['create-client', '--name', 'a', '--role', 'reader'], 'Nome inválido'],
    [['create-client', '--name', 'ok-nome', '--role', 'reader', '--extra', '1'], '--extra'],
  ])('recusa %j', async (args, message) => {
    const result = await cli(args);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
  });
});

describe('revoke-client (T017)', () => {
  it('revoga o cliente: a chave deixa de ser aceita', async () => {
    const created = await cli(['create-client', '--name', 'a-revogar', '--role', 'operator']);
    const keyHash = hashApiKey(apiKeyFrom(created.stdout));

    const result = await cli(['revoke-client', '--name', 'a-revogar']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Cliente "a-revogar" revogado');
    expect(await findActiveClientByKeyHash(database.db, keyHash)).toBeNull();
  });

  it('avisa quando o cliente já estava revogado', async () => {
    await cli(['create-client', '--name', 'ja-revogado', '--role', 'reader']);
    await cli(['revoke-client', '--name', 'ja-revogado']);

    const result = await cli(['revoke-client', '--name', 'ja-revogado']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('já estava revogado');
  });

  it('falha quando o cliente não existe', async () => {
    const result = await cli(['revoke-client', '--name', 'nao-existe']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Não existe cliente chamado "nao-existe".');
  });
});

describe('uso geral do CLI', () => {
  it('mostra a ajuda quando nenhum comando é informado', async () => {
    const result = await cli([]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('create-client --name <nome> --role <operator|reader>');
    expect(result.stderr).toContain('revoke-client --name <nome>');
  });

  it('recusa comando desconhecido', async () => {
    const result = await cli(['apagar-tudo']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Comando desconhecido: apagar-tudo');
  });

  it('explica quando DATABASE_URL não está definida', async () => {
    const result = await cli(['create-client', '--name', 'sem-banco', '--role', 'reader'], {});

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL: é obrigatória');
  });

  it('não repete a senha do banco quando a conexão falha', async () => {
    const url = new URL(database.url);
    url.password = 'SENHA-ERRADA-DO-BANCO';

    const result = await cli(['create-client', '--name', 'senha-errada', '--role', 'reader'], {
      DATABASE_URL: url.toString(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Falha ao executar "create-client"');
    expect(result.stderr).not.toContain('SENHA-ERRADA-DO-BANCO');
  });
});
