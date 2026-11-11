/**
 * Cópia de segurança e restauração (T066, research R-21): os scripts de `deploy/backup/` rodando
 * na mesma imagem do banco (`postgres:17`), como no serviço `backup` do Docker Compose.
 *
 * - a cópia sai cifrada e restaura as mesmas linhas num banco vazio (SC-011, FR-030/FR-031);
 * - só refaz a cópia quando a mais nova passou do intervalo (SC-012, FR-029);
 * - apaga as cópias com mais de BACKUP_RETENTION_DAYS dias, e nada além delas (FR-030).
 *
 * Usa um container próprio (não o banco compartilhado dos testes), porque os scripts rodam
 * dentro dele.
 */
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectDatabase,
  runMigrations,
  type DatabaseConnection,
} from '../../src/persistence/db.js';
import { insertClient, insertExecution, insertReservation } from '../helpers/factories.js';

const POSTGRES_IMAGE = 'postgres:17';
const SCRIPTS_DIR = fileURLToPath(new URL('../../../../deploy/backup', import.meta.url));
const PASSPHRASE = 'frase-secreta-das-copias-de-teste';
const GUEST_NAME = 'Hóspede Fictício da Cópia';
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_NAME = /^hunit-\d{8}-\d{6}\.dump\.gpg$/;

let container: StartedPostgreSqlContainer;
let source: DatabaseConnection;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCopyDirectoriesToContainer([{ source: SCRIPTS_DIR, target: '/scripts' }])
    .start();
  source = connectDatabase(container.getConnectionUri());
  await runMigrations(source);

  const client = await insertClient(source.db, { name: 'desktop' });
  const execution = await insertExecution(source.db, { clientId: client.id, status: 'completed' });
  await insertReservation(source.db, {
    reservationNumber: '9001',
    guestName: GUEST_NAME,
    lastExecutionId: execution.id,
  });
  await insertReservation(source.db, {
    reservationNumber: '9002',
    guestName: null,
    lastExecutionId: execution.id,
  });
}, 180_000);

afterAll(async () => {
  await source?.close();
  await container?.stop();
});

/** Variáveis do serviço `backup` (o banco fica no próprio container). */
function backupEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PGHOST: 'localhost',
    PGPORT: '5432',
    PGUSER: container.getUsername(),
    PGPASSWORD: container.getPassword(),
    PGDATABASE: container.getDatabase(),
    BACKUP_PASSPHRASE: PASSPHRASE,
    ...overrides,
  };
}

async function run(command: string[], env: Record<string, string> = backupEnv()) {
  return container.exec(command, { env });
}

async function shell(script: string) {
  const result = await run(['bash', '-c', script]);
  if (result.exitCode !== 0) throw new Error(`falhou: ${script}\n${result.output}`);
  return result.stdout;
}

async function backupOnce(env?: Record<string, string>) {
  return run(['bash', '/scripts/backup.sh', 'once'], env);
}

async function listBackups(): Promise<string[]> {
  return (await shell('mkdir -p /backups && ls -1A /backups'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

/** Nome de uma cópia feita há `daysAgo` dias (horário UTC, como o script grava). */
function backupNameFor(daysAgo: number): string {
  const stamp = new Date(Date.now() - daysAgo * DAY_MS)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return `hunit-${stamp}.dump.gpg`;
}

async function reset() {
  await shell('rm -rf /backups && mkdir -p /backups');
}

async function dumpOf(database: string) {
  const rows = await shell(
    `psql -U ${container.getUsername()} -d ${database} -At -c "` +
      `select hotel_code, reservation_number, coalesce(guest_name, '-'), total_amount ` +
      `from reservations order by reservation_number; ` +
      `select id, status from executions order by id; ` +
      `select name, role from api_clients order by name"`,
  );
  return rows.trim();
}

describe('backup.sh once (FR-030, SC-011)', () => {
  let backupFile: string;

  beforeAll(async () => {
    await reset();
    const result = await backupOnce();
    if (result.exitCode !== 0) throw new Error(result.output);
    const files = await listBackups();
    expect(files).toHaveLength(1);
    backupFile = files[0] ?? '';
  });

  it('grava uma cópia com o nome hunit-AAAAMMDD-HHMMSS.dump.gpg', () => {
    expect(backupFile).toMatch(BACKUP_NAME);
  });

  it('a cópia está cifrada: não é um dump legível e só abre com a frase certa', async () => {
    const header = await shell(`head -c 5 /backups/${backupFile}`);
    expect(header).not.toBe('PGDMP');
    expect(await shell(`grep -c "${GUEST_NAME}" /backups/${backupFile} || true`)).toBe('0\n');

    const wrong = await run([
      'bash',
      '-c',
      `gpg --batch --quiet --pinentry-mode loopback --passphrase errada --decrypt /backups/${backupFile} > /dev/null`,
    ]);
    expect(wrong.exitCode).not.toBe(0);

    const right = await shell(
      `gpg --batch --quiet --pinentry-mode loopback --passphrase "${PASSPHRASE}" ` +
        `--decrypt /backups/${backupFile} | head -c 5`,
    );
    expect(right).toBe('PGDMP');
  });

  it('não escreve a frase das cópias nem a senha do banco na saída', async () => {
    await reset();
    const result = await backupOnce();
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain(PASSPHRASE);
    expect(result.output).not.toContain(container.getPassword());
    backupFile = (await listBackups())[0] ?? '';
  });

  it('não deixa arquivo temporário para trás', async () => {
    expect(await listBackups()).toEqual([backupFile]);
  });

  it('restore.sh recupera num banco vazio as mesmas reservas, execuções e clientes (SC-011)', async () => {
    await shell(`createdb -U ${container.getUsername()} restaurado`);

    const restored = await run(
      ['bash', '/scripts/restore.sh', `/backups/${backupFile}`],
      backupEnv({ PGDATABASE: 'restaurado' }),
    );

    expect(restored.exitCode, restored.output).toBe(0);
    expect(restored.output).not.toContain(PASSPHRASE);
    const original = await dumpOf(container.getDatabase());
    expect(original).toContain(GUEST_NAME);
    expect(await dumpOf('restaurado')).toBe(original);
  });

  it('restore.sh aceita só o nome do arquivo, procurando em /backups', async () => {
    await shell(`createdb -U ${container.getUsername()} restaurado2`);

    const restored = await run(
      ['bash', '/scripts/restore.sh', backupFile],
      backupEnv({ PGDATABASE: 'restaurado2' }),
    );

    expect(restored.exitCode, restored.output).toBe(0);
    expect(await dumpOf('restaurado2')).toBe(await dumpOf(container.getDatabase()));
  });

  it('restore.sh recusa arquivo inexistente', async () => {
    const result = await run(['bash', '/scripts/restore.sh', 'hunit-19990101-000000.dump.gpg']);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('quando fazer a cópia (FR-029, SC-012)', () => {
  it('não refaz a cópia se a mais nova for recente', async () => {
    await reset();
    expect((await backupOnce()).exitCode).toBe(0);
    const first = await listBackups();

    expect((await backupOnce()).exitCode).toBe(0);

    expect(await listBackups()).toEqual(first);
  });

  it('refaz a cópia quando a mais nova passou do intervalo (servidor desligado por dias)', async () => {
    await reset();
    const stale = backupNameFor(2);
    await shell(`echo antiga > /backups/${stale}`);

    expect((await backupOnce()).exitCode).toBe(0);

    const files = await listBackups();
    expect(files).toHaveLength(2);
    expect(files).toContain(stale);
  });

  it('respeita BACKUP_INTERVAL_HOURS', async () => {
    await reset();
    const recent = backupNameFor(0.25); // 6 h atrás
    await shell(`echo recente > /backups/${recent}`);

    expect((await backupOnce(backupEnv({ BACKUP_INTERVAL_HOURS: '12' }))).exitCode).toBe(0);
    expect(await listBackups()).toEqual([recent]);

    expect((await backupOnce(backupEnv({ BACKUP_INTERVAL_HOURS: '4' }))).exitCode).toBe(0);
    expect(await listBackups()).toHaveLength(2);
  });

  it('recusa rodar sem BACKUP_PASSPHRASE e não grava nada', async () => {
    await reset();
    const env = backupEnv();
    delete env['BACKUP_PASSPHRASE'];

    const result = await backupOnce(env);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('BACKUP_PASSPHRASE');
    expect(await listBackups()).toEqual([]);
  });

  it('não grava cópia quando o banco não responde, e mantém as anteriores', async () => {
    await reset();
    const previous = backupNameFor(3);
    await shell(`echo anterior > /backups/${previous}`);

    const result = await backupOnce(backupEnv({ PGPORT: '1' }));

    expect(result.exitCode).not.toBe(0);
    expect(await listBackups()).toEqual([previous]);
  });
});

describe('retenção das cópias (FR-030)', () => {
  it('apaga as cópias com mais de BACKUP_RETENTION_DAYS dias e mais nada', async () => {
    await reset();
    const old = backupNameFor(40);
    const kept = backupNameFor(10);
    await shell(
      `echo velha > /backups/${old} && echo guardada > /backups/${kept} && ` +
        `echo pessoal > /backups/notas.txt && echo outra > /backups/hunit-qualquer.gpg`,
    );

    expect((await backupOnce()).exitCode).toBe(0);

    const files = await listBackups();
    expect(files).not.toContain(old);
    expect(files).toContain(kept);
    expect(files).toContain('notas.txt');
    expect(files).toContain('hunit-qualquer.gpg');
    expect(files.filter((file) => BACKUP_NAME.test(file))).toHaveLength(2);
  });

  it('nunca apaga a cópia mais nova, mesmo vencida, se a nova cópia falhar', async () => {
    await reset();
    const only = backupNameFor(45);
    await shell(`echo unica > /backups/${only}`);

    const result = await backupOnce(backupEnv({ PGPORT: '1' }));

    expect(result.exitCode).not.toBe(0);
    expect(await listBackups()).toEqual([only]);
  });

  it('respeita BACKUP_RETENTION_DAYS', async () => {
    await reset();
    const tenDays = backupNameFor(10);
    await shell(`echo dez > /backups/${tenDays}`);

    expect((await backupOnce(backupEnv({ BACKUP_RETENTION_DAYS: '7' }))).exitCode).toBe(0);

    expect(await listBackups()).not.toContain(tenDays);
  });
});

describe('restauração completa', () => {
  it('o banco restaurado aceita as migrations do servidor sem mudanças (mesma versão)', async () => {
    await reset();
    expect((await backupOnce()).exitCode).toBe(0);
    const [file] = await listBackups();
    await shell(`createdb -U ${container.getUsername()} restaurado3`);
    const restored = await run(
      ['bash', '/scripts/restore.sh', `/backups/${file}`],
      backupEnv({ PGDATABASE: 'restaurado3' }),
    );
    expect(restored.exitCode, restored.output).toBe(0);

    const url = new URL(container.getConnectionUri());
    url.pathname = '/restaurado3';
    const connection = connectDatabase(url.toString());
    try {
      await runMigrations(connection);
      const result = await connection.db.execute<{ count: string }>(
        sql`select count(*)::text as count from reservations`,
      );
      expect(result.rows[0]?.count).toBe('2');
    } finally {
      await connection.close();
    }
  });
});
