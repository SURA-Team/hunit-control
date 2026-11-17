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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectDatabase,
  runMigrations,
  type DatabaseConnection,
} from '../../src/persistence/db.js';
import { ensureLegacyAuthor } from '../../src/persistence/legacy-import-repo.js';
import {
  legacyImports,
  legacyReservations,
  treatmentDocuments,
} from '../../src/persistence/schema.js';
import { saveTreatmentFile } from '../../src/persistence/treatment-files-repo.js';
import { registerDocuments, setManualAmount } from '../../src/persistence/treatments-repo.js';
import { MemorySheetGateway } from '../../src/commercial-sheet/memory-sheet-gateway.js';
import { CommercialSheetSync } from '../../src/commercial-sheet/sync.js';
import {
  insertCommercialReservation,
  insertDispatch,
  insertLine,
  insertReturn,
  seedTestHotels,
} from '../helpers/commercial-fixtures.js';
import { insertClient, insertExecution, insertReservation } from '../helpers/factories.js';
import { captureLogs } from '../helpers/log-capture.js';

const POSTGRES_IMAGE = 'postgres:17';
const SCRIPTS_DIR = fileURLToPath(new URL('../../../../deploy/backup', import.meta.url));
const PASSPHRASE = 'frase-secreta-das-copias-de-teste';
const GUEST_NAME = 'Hóspede Fictício da Cópia';
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Documento de uma tratativa (specs/003, FR-010, SC-007): um "PDF" com todos os valores de byte,
 * para conferir que o conteúdo binário atravessa a cópia e a restauração sem mudar.
 */
const DOCUMENT = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from(Array.from({ length: 256 }, (_unused, index) => index)),
]);
const DOCUMENT_SHA256 = createHash('sha256').update(DOCUMENT).digest('hex');
const BACKUP_NAME = /^hunit-\d{8}-\d{6}\.dump\.gpg$/;
/** Reserva enviada ao Comercial, com retorno confirmado (specs/005, T059). */
const COMMERCIAL_KEY = { hotelCode: 'hml_um', reservationNumber: '900001' };

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
  const second = await insertReservation(source.db, {
    reservationNumber: '9002',
    guestName: null,
    lastExecutionId: execution.id,
  });

  // Uma tratativa completa: arquivo, documento, evento e valor informado à mão (specs/003).
  const key = { hotelCode: second.hotelCode, reservationNumber: second.reservationNumber };
  const now = new Date();
  const treatmentFile = await saveTreatmentFile(source.db, {
    sha256: DOCUMENT_SHA256,
    content: DOCUMENT,
    mediaType: 'application/pdf',
    clientId: client.id,
    now,
  });
  await registerDocuments(source.db, {
    kind: 'proof',
    file: treatmentFile,
    fileName: 'comprovante-ficticio.pdf',
    keys: [key],
    clientId: client.id,
    batchId: '00000000-0000-4000-8000-000000000001',
    now,
  });
  await setManualAmount(source.db, { key, amount: '123.45', clientId: client.id, now });

  // Uma reserva importada do sistema anterior, com a origem e um documento importado (specs/004,
  // FR-023): ainda não verificada pelo HUNIT Control (sem execução).
  const author = await ensureLegacyAuthor(source.db);
  const [legacyImport] = await source.db
    .insert(legacyImports)
    .values({ kind: 'simulation', fingerprint: 'f', status: 'completed', finishedAt: now })
    .returning({ id: legacyImports.id });
  const imported = await insertReservation(source.db, {
    hotelCode: second.hotelCode,
    reservationNumber: 'L-9003',
    classification: 'not_virtual_card',
    reservationStatus: 'unknown',
    lastExecutionId: null,
  });
  await source.db.insert(legacyReservations).values({
    hotelCode: imported.hotelCode,
    reservationNumber: imported.reservationNumber,
    legacyHotelKey: 'legacy_hml_um',
    originalClassification: 'not_virtual_card',
    firstVerifiedAt: now,
    lastVerifiedAt: now,
    verificationCount: 2,
    merged: false,
    appliedCount: 2,
    rowHash: 'h',
    firstImportId: legacyImport!.id,
    lastImportId: legacyImport!.id,
  });
  await source.db.insert(treatmentDocuments).values({
    hotelCode: imported.hotelCode,
    reservationNumber: imported.reservationNumber,
    kind: 'request',
    fileSha256: DOCUMENT_SHA256,
    originalName: 'pedido-importado.pdf',
    sizeBytes: DOCUMENT.length,
    mediaType: 'application/pdf',
    attachedAt: now,
    attachedByClientId: author,
    legacyImportId: legacyImport!.id,
  });

  // Envio ao Comercial (specs/005, T059): uma reserva enviada com retorno confirmado, o envio e a
  // linha já escrita na planilha (sem pendência).
  await seedTestHotels(source.db);
  await insertCommercialReservation(source.db, 1, { lastExecutionId: execution.id });
  const dispatch = await insertDispatch(source.db, { clientId: client.id });
  await insertLine(source.db, COMMERCIAL_KEY, {
    state: 'concluded',
    dispatchId: dispatch.id,
    clientId: client.id,
  });
  await source.db.execute(sql`update commercial_lines set synced_version = version`);
  await insertReturn(source.db, COMMERCIAL_KEY, { state: 'confirmed', chargedAmount: '1200.00' });
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
      `select name, role from api_clients order by name; ` +
      // Tratativas (specs/003): o SHA-256 é recalculado sobre o conteúdo guardado.
      `select sha256, encode(sha256(content), 'hex'), size_bytes, media_type from treatment_files; ` +
      `select id, reservation_number, kind, state, original_name, file_sha256 ` +
      `from treatment_documents; ` +
      `select id, type, document_id, amount from treatment_events order by id; ` +
      `select reservation_number, amount from reservation_manual_amounts; ` +
      // Importação do histórico (specs/004, FR-023).
      `select reservation_number, coalesce(last_execution_id::text, 'sem-execucao') ` +
      `from reservations order by reservation_number; ` +
      `select reservation_number, original_classification, merged, applied_count ` +
      `from legacy_reservations; ` +
      `select kind, status, fingerprint from legacy_imports; ` +
      // Envio ao Comercial (specs/005, T059).
      `select status, account_key from commercial_dispatches order by id; ` +
      `select reservation_number, state, version, synced_version from commercial_lines; ` +
      `select reservation_number, state, charged_amount, authorization_code from commercial_returns; ` +
      `select reservation_number, legacy_import_id is not null from treatment_documents ` +
      `order by reservation_number"`,
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
    // O documento da tratativa está na cópia, com o conteúdo intacto (specs/003, SC-007).
    expect(original).toContain(
      `${DOCUMENT_SHA256}|${DOCUMENT_SHA256}|${DOCUMENT.length}|application/pdf`,
    );
    expect(original).toContain('comprovante-ficticio.pdf');
    expect(original).toContain('9002|123.45');
    // A reserva importada volta com a origem e o documento importado (specs/004, FR-023).
    expect(original).toContain('L-9003|sem-execucao');
    expect(original).toContain('L-9003|not_virtual_card|f|2');
    expect(original).toContain('L-9003|t');
    // O envio, a linha e o retorno confirmado do Comercial (specs/005, T059).
    expect(original).toContain('900001|concluded');
    expect(original).toContain('900001|confirmed|1200.00|AUT123');
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
      // 2 do HUNIT Control + 1 importada (specs/004) + 1 enviada ao Comercial (specs/005).
      expect(result.rows[0]?.count).toBe('4');

      // Planilha nova e vazia: a primeira rodada a reconstrói a partir do banco (research R-15).
      const sheet = new MemorySheetGateway();
      const sync = new CommercialSheetSync({
        db: connection.db,
        gateway: sheet,
        logger: captureLogs().logger,
        doneRetentionDays: 90,
      });
      expect((await sync.runRound()).ok).toBe(true);
      expect(sheet.rows('done').map((row) => row[1])).toEqual([COMMERCIAL_KEY.reservationNumber]);
      expect(sheet.rows('toCharge')).toEqual([]);
    } finally {
      await connection.close();
    }
  });
});

/**
 * Modo contínuo, o do serviço `backup` em produção (homologação T062). Antes da correção, o laço
 * rodava a verificação em `(check_once) || log ...`, contexto em que o bash ignora o `set -e`: uma
 * falha no meio não impedia o arquivo de receber o nome final.
 */
describe('modo contínuo (produção)', () => {
  /** Roda o laço por alguns segundos: a primeira verificação acontece logo ao iniciar. */
  async function backupLoop(env: Record<string, string>, seconds = 10) {
    // --foreground: sem ele, o timeout manda o sinal ao grupo de processos inteiro e acaba
    // derrubando um processo do PostgreSQL deste mesmo container, que reinicia em recuperação.
    return run(['timeout', '--foreground', String(seconds), 'bash', '/scripts/backup.sh'], env);
  }

  it('banco fora do ar: nenhuma cópia ganha o nome final e a falha vai para o log', async () => {
    await reset();
    const previous = backupNameFor(3);
    await shell(`echo anterior > /backups/${previous}`);

    const result = await backupLoop(backupEnv({ PGPORT: '1' }));

    expect(await listBackups()).toEqual([previous]);
    expect(result.output).toContain('a verificação falhou');
    expect(result.output).not.toContain('concluída');
  });

  it('banco no ar: grava a cópia e segue no laço', async () => {
    await reset();

    const result = await backupLoop(backupEnv());

    const files = await listBackups();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(BACKUP_NAME);
    expect(result.output).toContain('concluída');
    expect(result.output).not.toContain('a verificação falhou');
  });

  it('cópia grande: a conferência lê a cópia inteira, sem "Broken pipe" no gpg', async () => {
    await reset();
    // ~2 MB de texto pouco compressível: o dump passa bem do buffer de um pipe (64 KB).
    await shell(
      `psql -U ${container.getUsername()} -d ${container.getDatabase()} -c ` +
        `"update reservations set reason = (select string_agg(md5(random()::text), '') ` +
        `from generate_series(1, 60000)) where reservation_number = '9002'"`,
    );
    try {
      const result = await backupOnce();

      expect(result.exitCode, result.output).toBe(0);
      expect(result.output).not.toContain('Broken pipe');
      expect(await listBackups()).toHaveLength(1);
    } finally {
      await shell(
        `psql -U ${container.getUsername()} -d ${container.getDatabase()} -c ` +
          `"update reservations set reason = 'pré-pagamento sem registro de cobrança' ` +
          `where reservation_number = '9002'"`,
      );
    }
  });
});
