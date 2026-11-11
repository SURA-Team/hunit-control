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
import { ConfigError, loadConfig, type AppConfig } from './config.js';
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
    const runner = new ExecutionRunner({
      db: database.db,
      events,
      evidence,
      secrets,
      createGateway:
        options.createGateway ??
        createPlaywrightGatewayFactory({
          webUrl: config.hunit.webUrl,
          apiUrl: config.hunit.apiUrl,
          logger,
        }),
      accountKeySecret: config.accountKeySecret,
      twoFactorTimeoutMs: config.hunit.twoFactorTimeoutSeconds * 1000,
      maxPeriodDays: config.hunit.maxPeriodDays,
      hotelConcurrency: config.hunit.hotelConcurrency,
      logger,
    });

    const app = await buildApp({ db: database.db, logger, events, runner, evidence });
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

  const server = await startServer({ config });
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
