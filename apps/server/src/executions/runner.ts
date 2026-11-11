import type { Period } from '@hunit/domain';
import type { EvidenceStore } from '../evidence/store.js';
import {
  HunitError,
  ScreenNotRecognizedError,
  TwoFactorTimeoutError,
  type HunitErrorCode,
} from '../hunit/errors.js';
import type {
  CreateHunitGateway,
  HunitCredentials,
  HunitGateway,
  HunitHotel,
} from '../hunit/gateway.js';
import type { Logger } from '../logging.js';
import type { Database } from '../persistence/db.js';
import {
  createExecution,
  failAllActive,
  transitionExecution,
  type ExecutionRow,
  type ExecutionTransition,
} from '../persistence/executions-repo.js';
import { failRunningExecutionHotels } from '../persistence/execution-hotels-repo.js';
import { saveCatalog } from '../persistence/hotels-repo.js';
import type { ExecutionEndReason } from '../persistence/schema.js';
import type { SecretRegistry } from '../secrets.js';
import { accountKeyFor } from './account-key.js';
import type { ExecutionEventBus } from './events.js';
import { collectHotels } from './hotel-collection.js';
import { StopRequestedError } from './stop.js';

export interface StartExecutionInput {
  /** Cliente da API que pediu a execução. */
  clientId: string;
  /** Usadas só em memória, durante o acesso (FR-005). */
  credentials: HunitCredentials;
  period: Period;
  /** `null` = todos os hotéis do catálogo (FR-009). */
  hotelCodes: string[] | null;
  /** Execução original, nas retomadas (FR-023). */
  parentExecutionId?: string | null;
}

export interface ExecutionRunnerOptions {
  db: Database;
  events: ExecutionEventBus;
  evidence: EvidenceStore;
  secrets: SecretRegistry;
  createGateway: CreateHunitGateway;
  /** Segredo do HMAC que identifica a conta (ACCOUNT_KEY_SECRET). */
  accountKeySecret: string;
  /** Quanto tempo esperar pelo token depois que o Hunit o pede (FR-004). */
  twoFactorTimeoutMs: number;
  /** Tamanho máximo de cada consulta ao Hunit, em dias; `null` = sem divisão (research R-09). */
  maxPeriodDays?: number | null;
  /** Hotéis processados ao mesmo tempo (HOTEL_CONCURRENCY, research R-08). Padrão: 1. */
  hotelConcurrency?: number;
  logger: Logger;
  /** Relógio; os testes podem informar um fixo. */
  now?: () => Date;
}

/** Motivo de encerramento de cada falha da camada do Hunit (FR-003). */
const END_REASON_BY_HUNIT_ERROR: Readonly<Record<HunitErrorCode, ExecutionEndReason>> = {
  invalid_credentials: 'invalid_credentials',
  invalid_token: 'invalid_token',
  two_factor_timeout: 'two_factor_timeout',
  hunit_unavailable: 'hunit_unavailable',
  screen_not_recognized: 'hunit_screen_not_recognized',
  session_expired: 'session_expired',
};

/** Mensagem ao operador quando a execução termina por um motivo que não veio do Hunit. */
const END_REASON_MESSAGES: Readonly<Partial<Record<ExecutionEndReason, string>>> = {
  server_restarted: 'O servidor foi reiniciado; a execução foi interrompida.',
  internal_error: 'Erro interno do servidor; a execução foi interrompida.',
};

interface TokenWaiter {
  resolve(token: string): void;
  reject(error: Error): void;
}

/** Uma execução em andamento neste processo. */
interface ActiveRun {
  executionId: string;
  period: Period;
  /** `null` = todos os hotéis do catálogo (FR-009). */
  hotelCodes: string[] | null;
  logger: Logger;
  gateway: HunitGateway | null;
  /** Preenchido enquanto a execução espera o token (estado `awaiting_2fa`). */
  tokenWaiter: TokenWaiter | null;
  /** Preenchido quando alguém pede a parada; vira o motivo de encerramento. */
  stopReason: ExecutionEndReason | null;
  /** Termina quando a execução termina (nunca falha). */
  done: Promise<void>;
}

/** Funções que removem do `SecretRegistry` os segredos de uma execução. */
interface RunSecrets {
  /** Usuário: fica registrado até o fim da execução. */
  releaseUsername: () => void;
  /** Senha e token: removidos assim que o acesso é concluído. */
  releaseAccess: Array<() => void>;
}

function releaseAll(secrets: RunSecrets): void {
  for (const release of secrets.releaseAccess.splice(0)) release();
  secrets.releaseUsername();
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Executor das execuções (FR-001 a FR-005).
 *
 * Cada execução roda em segundo plano, no mesmo processo da API (research R-02): é isso que
 * permite que usuário, senha e token fiquem só em memória, sem passar por fila ou banco.
 *
 * Ciclo de uma execução: `queued` → `running` (login) → `awaiting_2fa` (espera o token do
 * operador) → `running` (token enviado, catálogo lido, hotéis consultados e gravados um a um —
 * `hotel-collection.ts`) → `completed`; qualquer falha da execução leva a `failed` com o motivo
 * correspondente (FR-003). Hotel com falha não encerra a execução: fica marcado e ela segue.
 *
 * Proteção dos segredos (FR-005, research R-12): senha e token ficam registrados no
 * `SecretRegistry` apenas até o acesso ser concluído, e as referências a eles são descartadas
 * em seguida. O usuário continua registrado até o fim da execução, porque respostas do Hunit
 * (ex.: o usuário logado) podem trazê-lo e acabar numa evidência.
 */
export class ExecutionRunner {
  private readonly active = new Map<string, ActiveRun>();
  private readonly now: () => Date;

  constructor(private readonly options: ExecutionRunnerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Cria a execução e começa a executá-la em segundo plano.
   *
   * @throws ExecutionAlreadyActiveError se a conta já tem uma execução ativa (FR-006).
   */
  async start(input: StartExecutionInput): Promise<ExecutionRow> {
    const { credentials } = input;
    // Registrados antes de qualquer gravação: uma falha já aqui não leva os valores ao log.
    const secrets: RunSecrets = {
      releaseUsername: this.options.secrets.register(credentials.username),
      releaseAccess: [this.options.secrets.register(credentials.password)],
    };

    let execution: ExecutionRow;
    try {
      execution = await createExecution(this.options.db, {
        accountKey: accountKeyFor(credentials.username, this.options.accountKeySecret),
        clientId: input.clientId,
        period: input.period,
        requestedHotelCodes: input.hotelCodes,
        parentExecutionId: input.parentExecutionId ?? null,
      });
      await this.options.events.publish({
        executionId: execution.id,
        type: 'status_changed',
        status: 'queued',
        message: 'Execução criada.',
      });
    } catch (error) {
      releaseAll(secrets);
      throw error;
    }

    const run: ActiveRun = {
      executionId: execution.id,
      period: input.period,
      hotelCodes: input.hotelCodes,
      logger: this.options.logger.child({ executionId: execution.id }),
      gateway: null,
      tokenWaiter: null,
      stopReason: null,
      done: Promise.resolve(),
    };
    this.active.set(execution.id, run);
    run.done = this.execute(run, credentials, secrets);

    return execution;
  }

  /**
   * Entrega o token 2FA à execução (FR-002).
   *
   * @returns `false` se a execução não está esperando o token neste momento (não existe, já
   *   recebeu um token, o prazo terminou ou ela já foi encerrada).
   */
  submitToken(executionId: string, token: string): boolean {
    const run = this.active.get(executionId);
    const waiter = run?.tokenWaiter;
    if (!run || !waiter) return false;

    // Só o primeiro token é aceito: um segundo envio simultâneo recebe `false`.
    run.tokenWaiter = null;
    waiter.resolve(token);
    return true;
  }

  /** Indica se a execução está em andamento neste processo. */
  isActive(executionId: string): boolean {
    return this.active.has(executionId);
  }

  /** Espera a execução terminar (resolve na hora se ela não estiver em andamento). */
  async whenFinished(executionId: string): Promise<void> {
    await this.active.get(executionId)?.done;
  }

  /**
   * Interrompe todas as execuções em andamento (servidor desligando). Cada uma termina como
   * `failed/server_restarted`, como aconteceria se o processo caísse.
   */
  async shutdown(): Promise<void> {
    const runs = [...this.active.values()];
    for (const run of runs) {
      run.stopReason = 'server_restarted';
      run.tokenWaiter?.reject(new StopRequestedError());
      run.tokenWaiter = null;
      await this.closeGateway(run);
    }
    await Promise.all(runs.map((run) => run.done));
  }

  private async execute(
    run: ActiveRun,
    credentials: HunitCredentials,
    secrets: RunSecrets,
  ): Promise<void> {
    const releaseAccess = () => {
      for (const release of secrets.releaseAccess.splice(0)) release();
    };

    try {
      try {
        await this.changeStatus(run, { to: 'running' }, 'Acessando o Hunit.');
        const gateway = await this.openGateway(run);

        const outcome = await gateway.login(credentials);
        if (outcome === 'two_factor_required') {
          const token = await this.waitForToken(run);
          secrets.releaseAccess.push(this.options.secrets.register(token));
          await this.changeStatus(run, { to: 'running' }, 'Token recebido. Concluindo o acesso.');
          await gateway.submitToken(token);
        }
        // Acesso concluído: senha e token não são mais necessários (FR-005).
        releaseAccess();

        const catalog = await this.updateCatalog(run, gateway);
        const summary = await collectHotels({
          executionId: run.executionId,
          period: run.period,
          requestedHotelCodes: run.hotelCodes,
          catalog,
          gateway,
          db: this.options.db,
          events: this.options.events,
          evidence: this.options.evidence,
          logger: run.logger,
          now: this.now,
          maxPeriodDays: this.options.maxPeriodDays ?? null,
          hotelConcurrency: this.options.hotelConcurrency ?? 1,
          isStopping: () => run.stopReason !== null,
        });
        const failed = summary.failed > 0 ? `, ${summary.failed} com falha` : '';
        await this.changeStatus(
          run,
          { to: 'completed' },
          `Execução concluída: ${summary.completed} hotéis concluídos${failed}; ${summary.reservations} reservas gravadas.`,
        );
      } catch (error) {
        await this.fail(run, error);
      } finally {
        await this.closeGateway(run);
        releaseAll(secrets);
        this.active.delete(run.executionId);
      }
    } catch (error) {
      // Falha ao registrar a própria falha (ex.: banco fora do ar): só resta o log.
      run.logger.error({ err: error }, 'não foi possível encerrar a execução corretamente');
    }
  }

  private async openGateway(run: ActiveRun): Promise<HunitGateway> {
    const gateway = await this.options.createGateway({ executionId: run.executionId });
    run.gateway = gateway;
    // O servidor pode ter pedido a parada enquanto o navegador abria.
    if (run.stopReason) throw new StopRequestedError();
    return gateway;
  }

  /** Entra em `awaiting_2fa`, avisa o operador e espera o token até o prazo (FR-004). */
  private async waitForToken(run: ActiveRun): Promise<string> {
    const timeoutMs = this.options.twoFactorTimeoutMs;
    const deadline = new Date(this.now().getTime() + timeoutMs);

    let timer: NodeJS.Timeout | undefined;
    const token = new Promise<string>((resolve, reject) => {
      run.tokenWaiter = { resolve, reject };
      timer = setTimeout(() => {
        run.tokenWaiter = null;
        reject(new TwoFactorTimeoutError());
      }, timeoutMs);
    });
    // Evita o aviso de "rejeição não tratada" se o prazo acabar antes de começarmos a esperar.
    token.catch(() => undefined);

    try {
      // O aviso sai assim que o Hunit pede o token (SC-005: em até 5 s).
      await this.changeStatus(
        run,
        { to: 'awaiting_2fa', twoFactorDeadline: deadline },
        `O Hunit pediu o token de verificação. Envie o código do autenticador até ${formatTime(deadline)}.`,
      );
      return await token;
    } finally {
      clearTimeout(timer);
      run.tokenWaiter = null;
    }
  }

  private async updateCatalog(run: ActiveRun, gateway: HunitGateway): Promise<HunitHotel[]> {
    const catalog = await gateway.listHotels();
    await saveCatalog(this.options.db, catalog, this.now());
    await this.options.events.publish({
      executionId: run.executionId,
      type: 'catalog_updated',
      message: `Catálogo de hotéis atualizado: ${catalog.length} hotéis disponíveis.`,
    });
    return catalog;
  }

  /**
   * Muda o estado da execução e avisa quem acompanha.
   *
   * @throws StopRequestedError se a transição não é mais possível (a execução foi encerrada por
   *   outro caminho, ex.: cancelada).
   */
  private async changeStatus(
    run: ActiveRun,
    transition: ExecutionTransition,
    message: string,
  ): Promise<void> {
    const updated = await transitionExecution(
      this.options.db,
      run.executionId,
      transition,
      this.now(),
    );
    if (!updated) throw new StopRequestedError();

    await this.options.events.publish({
      executionId: run.executionId,
      type: 'status_changed',
      status: transition.to,
      message,
    });
  }

  /** Encerra a execução como `failed`, com o motivo e a evidência da falha (FR-003, FR-024). */
  private async fail(run: ActiveRun, error: unknown): Promise<void> {
    const hunitError = error instanceof HunitError ? error : null;
    const endReason =
      run.stopReason ??
      (hunitError ? END_REASON_BY_HUNIT_ERROR[hunitError.code] : 'internal_error');

    if (error instanceof StopRequestedError && !run.stopReason) {
      // A execução foi encerrada por outro caminho enquanto rodava; nada mais a registrar.
      run.logger.info('execução encerrada por outro caminho');
      return;
    }
    if (endReason === 'internal_error') {
      run.logger.error({ err: error }, 'falha inesperada na execução');
    } else {
      run.logger.info({ endReason, err: error }, 'execução encerrada com falha');
    }

    if (hunitError?.evidence && !run.stopReason) await this.recordEvidence(run, hunitError);

    const message =
      (run.stopReason ? END_REASON_MESSAGES[run.stopReason] : hunitError?.message) ??
      END_REASON_MESSAGES.internal_error ??
      'A execução falhou.';

    const updated = await transitionExecution(
      this.options.db,
      run.executionId,
      { to: 'failed', endReason },
      this.now(),
    );
    // `null`: a execução já tinha sido encerrada por outro caminho; nada a avisar.
    if (updated) {
      await this.options.events.publish({
        executionId: run.executionId,
        type: 'status_changed',
        status: 'failed',
        message,
      });
    }
  }

  private async recordEvidence(run: ActiveRun, error: HunitError): Promise<void> {
    if (!error.evidence) return;
    try {
      const stored = await this.options.evidence.save({
        executionId: run.executionId,
        kind:
          error instanceof ScreenNotRecognizedError
            ? 'screen_not_recognized'
            : 'navigation_failure',
        reason: error.message,
        material: error.evidence,
      });
      if (stored) {
        await this.options.events.publish({
          executionId: run.executionId,
          type: 'evidence_recorded',
          message: `Evidência registrada (${stored.id}): ${error.message}`,
        });
      }
    } catch (evidenceError) {
      // A falha da execução continua sendo registrada mesmo sem a evidência.
      run.logger.error({ err: evidenceError }, 'não foi possível gravar a evidência da falha');
    }
  }

  private async closeGateway(run: ActiveRun): Promise<void> {
    const { gateway } = run;
    if (!gateway) return;
    try {
      await gateway.close();
    } catch (error) {
      run.logger.warn({ err: error }, 'falha ao fechar o navegador da execução');
    }
  }
}

/**
 * Encerra as execuções que estavam ativas quando o servidor parou (data-model: "Ao iniciar, o
 * servidor marca como `failed/server_restarted` toda execução que estava ativa"). As credenciais
 * e o token existiam só na memória do processo anterior, então elas não têm como continuar; o
 * operador pode retomá-las (FR-023).
 */
export async function failInterruptedExecutions(
  db: Database,
  events: ExecutionEventBus,
): Promise<ExecutionRow[]> {
  const interrupted = await failAllActive(db, 'server_restarted');
  await failRunningExecutionHotels(
    db,
    interrupted.map((execution) => execution.id),
    'O servidor foi reiniciado no meio do hotel; nada foi gravado.',
  );
  for (const execution of interrupted) {
    await events.publish({
      executionId: execution.id,
      type: 'status_changed',
      status: 'failed',
      message: END_REASON_MESSAGES.server_restarted ?? 'O servidor foi reiniciado.',
    });
  }
  return interrupted;
}
