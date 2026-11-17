/**
 * Ponto de entrada do servidor (tasks.md, T035): config, logger, banco e migrations, execuções
 * interrompidas, executor com o Hunit real, a API HTTP e a rotina diária de manutenção (T058).
 *
 *   node dist/main.js
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import type { CommercialSheetGateway } from './commercial-sheet/gateway.js';
import { GoogleSheetGateway } from './commercial-sheet/google-sheet-gateway.js';
import { loadServiceAccountKey, ServiceAccountKeyError } from './commercial-sheet/key.js';
import { createReturnsProcessor } from './commercial-sheet/returns.js';
import { CommercialSheetSync } from './commercial-sheet/sync.js';
import { DispatchEventBus } from './dispatches/events.js';
import { DispatchRunner, failInterruptedDispatches } from './dispatches/runner.js';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import type { Database } from './persistence/db.js';
import { EvidenceStore } from './evidence/store.js';
import { ExecutionEventBus } from './executions/events.js';
import { ExecutionRunner, failInterruptedExecutions } from './executions/runner.js';
import type { CreateHunitGateway } from './hunit/gateway.js';
import { createPlaywrightGatewayFactory } from './hunit/playwright-gateway.js';
import { buildApp } from './http/app.js';
import { createLogger, type Logger } from './logging.js';
import { startRetentionSchedule } from './maintenance/retention.js';
import { connectDatabase, runMigrations } from './persistence/db.js';
import { SecretRegistry } from './secrets.js';

export interface ServerOptions {
  config: AppConfig;
  /** Sessão do Hunit de cada execução. Padrão: o Hunit real (Playwright). */
  createGateway?: CreateHunitGateway;
  /**
   * Planilha do Comercial (specs/005). Padrão: o Google Sheets, se a planilha estiver
   * configurada. Os testes de ponta a ponta passam a planilha em memória.
   */
  commercialSheetGateway?: CommercialSheetGateway;
  /** Destino do log. Padrão: a saída padrão. */
  logDestination?: DestinationStream;
  /** Endereço em que o servidor escuta. Padrão: todas as interfaces (necessário no container). */
  host?: string;
}

export interface RunningServer {
  app: FastifyInstance;
  logger: Logger;
  /** Endereço em que o servidor está escutando (ex.: http://127.0.0.1:3000). */
  url: string;
  /**
   * Desliga na ordem: para de aceitar requisições, interrompe as execuções, espera a manutenção
   * em andamento e fecha o banco.
   */
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { config } = options;
  const secrets = new SecretRegistry();
  const logger = createLogger({
    level: config.logLevel,
    secrets,
    ...(options.logDestination && { destination: options.logDestination }),
  });

  const database = connectDatabase(config.databaseUrl, {
    onPoolError: (error) => logger.error({ err: error }, 'erro numa conexão ociosa com o banco'),
  });

  try {
    await runMigrations(database);

    const events = new ExecutionEventBus({ db: database.db, secrets, logger });
    const interrupted = await failInterruptedExecutions(database.db, events);
    if (interrupted.length > 0) {
      logger.warn(
        { executions: interrupted.map((execution) => execution.id) },
        'execuções interrompidas pelo reinício do servidor marcadas como falhas',
      );
    }

    const evidence = new EvidenceStore({
      db: database.db,
      dir: config.evidence.dir,
      retentionDays: config.evidence.retentionDays,
      secrets,
    });
    const hunitGateway =
      options.createGateway ??
      createPlaywrightGatewayFactory({
        webUrl: config.hunit.webUrl,
        apiUrl: config.hunit.apiUrl,
        logger,
      });
    const runner = new ExecutionRunner({
      db: database.db,
      events,
      evidence,
      secrets,
      createGateway: hunitGateway,
      accountKeySecret: config.accountKeySecret,
      twoFactorTimeoutMs: config.hunit.twoFactorTimeoutSeconds * 1000,
      maxPeriodDays: config.hunit.maxPeriodDays,
      hotelConcurrency: config.hunit.hotelConcurrency,
      logger,
    });

    // Planilha do Comercial (specs/005, research R-04, R-06): desligada sem configuração.
    const commercialSheet = await startCommercialSheet(options, database.db, secrets, logger);

    // Envios ao Comercial (specs/005, research R-01): os ativos quando o servidor parou falham.
    const dispatchEvents = new DispatchEventBus({ db: database.db, secrets, logger });
    const interruptedDispatches = await failInterruptedDispatches(database.db, dispatchEvents);
    if (interruptedDispatches.length > 0) {
      logger.warn(
        { dispatches: interruptedDispatches.map((dispatch) => dispatch.id) },
        'envios interrompidos pelo reinício do servidor marcados como falhas',
      );
    }
    const dispatches = new DispatchRunner({
      db: database.db,
      events: dispatchEvents,
      evidence,
      secrets,
      createGateway: hunitGateway,
      accountKeySecret: config.accountKeySecret,
      twoFactorTimeoutMs: config.hunit.twoFactorTimeoutSeconds * 1000,
      logger,
      onLinesChanged: () => commercialSheet?.requestRound(),
    });

    const app = await buildApp({
      db: database.db,
      logger,
      events,
      runner,
      evidence,
      commercialSheet,
      dispatches,
      dispatchEvents,
    });
    const url = await app.listen({ port: config.port, host: options.host ?? '0.0.0.0' });

    // Roda já ao subir, para recuperar o que venceu com o servidor desligado (FR-029).
    const maintenance = startRetentionSchedule({
      db: database.db,
      evidence,
      reservationRetentionYears: config.reservationRetentionYears,
      logger,
    });

    let closing: Promise<void> | null = null;
    return {
      app,
      logger,
      url,
      close() {
        closing ??= (async () => {
          await app.close();
          await runner.shutdown();
          await dispatches.shutdown();
          await commercialSheet?.stop();
          await maintenance.stop();
          await database.close();
        })();
        return closing;
      },
    };
  } catch (error) {
    await database.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Liga a sincronização da planilha do Comercial: com a planilha injetada (testes) ou com a chave e
 * o identificador configurados. Sem nenhum dos dois, a integração fica desligada (`null`).
 *
 * @throws ServiceAccountKeyError se o arquivo da chave não puder ser lido.
 */
async function startCommercialSheet(
  options: ServerOptions,
  db: Database,
  secrets: SecretRegistry,
  logger: Logger,
): Promise<CommercialSheetSync | null> {
  const access = options.config.commercialSheet.access;
  let gateway = options.commercialSheetGateway ?? null;
  if (gateway === null && access !== null) {
    const key = await loadServiceAccountKey(access.keyFile, secrets, access.spreadsheetId);
    gateway = new GoogleSheetGateway({ spreadsheetId: access.spreadsheetId, key });
  }
  if (gateway === null) {
    logger.info('planilha do Comercial não configurada: envio ao Comercial desligado');
    return null;
  }
  const sync = new CommercialSheetSync({
    db,
    gateway,
    logger,
    doneRetentionDays: options.config.commercialSheet.doneRetentionDays,
    processReturns: createReturnsProcessor(db),
  });
  sync.start();
  return sync;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let server: RunningServer;
  try {
    server = await startServer({ config });
  } catch (error) {
    if (error instanceof ServiceAccountKeyError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  server.logger.info({ url: server.url }, 'servidor no ar');

  const shutdown = (signal: string) => {
    server.logger.info({ signal }, 'desligando o servidor');
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        server.logger.error({ err: error }, 'falha ao desligar o servidor');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

if (isMainModule()) {
  await main();
}
