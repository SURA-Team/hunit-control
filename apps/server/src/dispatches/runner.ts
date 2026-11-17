/**
 * Executor dos envios ao Comercial (specs/005, FR-001 a FR-007; research R-01, R-02).
 *
 * Ciclo de um envio, com os estados de uma execução (constitution, princípio IV): `queued` →
 * `running` (login) → `awaiting_2fa` (token do operador, com o mesmo aviso) → `running` (cada
 * reserva verificada no Hunit, uma por vez, só com leituras) → `completed`; uma falha leva a
 * `failed` e o cancelamento a `cancelled`. A reserva é gravada logo depois de verificada, numa
 * transação própria (FR-007): uma falha no meio deixa claro o que foi e o que não foi enviado, e a
 * retomada processa só as não verificadas.
 *
 * Roda no mesmo processo da API, como as execuções: usuário, senha e token ficam só em memória.
 */
import {
  buildReservationData,
  classifyReservation,
  CLASSIFICATION_NAMES,
  dispatchOutcome,
  formatBrDate,
  type ReservationSnapshot,
} from '@hunit/domain';
import { and, eq } from 'drizzle-orm';
import type { EvidenceMaterial } from '../evidence/material.js';
import type { EvidenceStore } from '../evidence/store.js';
import { accountKeyFor } from '../executions/account-key.js';
import { StopRequestedError } from '../executions/stop.js';
import { HunitError, ScreenNotRecognizedError, SessionExpiredError } from '../hunit/errors.js';
import { findReservation } from '../hunit/find-reservation.js';
import type {
  CreateHunitGateway,
  HunitCredentials,
  HunitGateway,
  HunitRetryNotice,
} from '../hunit/gateway.js';
import {
  authenticate,
  END_REASON_BY_HUNIT_ERROR,
  formatTime,
  registerRunSecrets,
  releaseAll,
  TokenGate,
  type RunSecrets,
} from '../hunit-session/session.js';
import type { Logger } from '../logging.js';
import {
  insertCommercialEvent,
  openLineOnSend,
  refreshCommercialLine,
} from '../persistence/commercial-repo.js';
import type { Database } from '../persistence/db.js';
import {
  createDispatch,
  failAllActiveDispatches,
  failPendingItems,
  listDispatchItems,
  recordItemOutcome,
  transitionDispatch,
  type DispatchItemRow,
  type DispatchRow,
  type NewDispatchItem,
} from '../persistence/dispatches-repo.js';
import type { ExecutionTransition } from '../persistence/executions-repo.js';
import { commitVerifiedReservation } from '../persistence/reservations-repo.js';
import { reservations, type ExecutionEndReason } from '../persistence/schema.js';
import type { ReservationKey } from '../persistence/treatments-repo.js';
import type { SecretRegistry } from '../secrets.js';
import { checkDispatchEligibility, uniqueReservationKeys } from './eligibility.js';
import type { DispatchEventBus } from './events.js';

/** Nenhuma das reservas pedidas aceita o envio (FR-003). */
export class NoEligibleReservationsError extends Error {
  constructor() {
    super('Nenhuma das reservas aceita o envio ao Comercial.');
    this.name = 'NoEligibleReservationsError';
  }
}

export interface StartDispatchInput {
  clientId: string;
  /** Usadas só em memória, durante o acesso. */
  credentials: HunitCredentials;
  reservations: readonly ReservationKey[];
  /** Envio original, nas retomadas. */
  parentDispatchId?: string | null;
}

export interface DispatchRunnerOptions {
  db: Database;
  events: DispatchEventBus;
  evidence: EvidenceStore;
  secrets: SecretRegistry;
  createGateway: CreateHunitGateway;
  accountKeySecret: string;
  twoFactorTimeoutMs: number;
  logger: Logger;
  /** Chamado quando linhas da planilha mudaram (pede uma rodada ao sincronizador). */
  onLinesChanged?: () => void;
  cancelGraceMs?: number;
  now?: () => Date;
}

export type DispatchCancelOutcome = 'requested' | 'already_finished';

const DEFAULT_CANCEL_GRACE_MS = 10_000;

/** Motivos das reservas não verificadas (sem dado pessoal). */
export const NOT_VERIFIED_REASONS = {
  cancelled: 'envio cancelado antes da verificação',
  serverRestarted: 'o servidor foi reiniciado antes da verificação',
  failed: 'o envio parou antes da verificação',
  notFound: (checkIn: string) =>
    `não encontrada no Hunit no check-in registrado (${formatBrDate(checkIn)})`,
  missing: 'a reserva não está mais gravada no sistema',
  unrecognized: 'detalhe da reserva não reconhecido',
  unavailable: 'Hunit indisponível ao verificar a reserva',
} as const;

const END_MESSAGES: Readonly<Partial<Record<ExecutionEndReason, string>>> = {
  server_restarted: 'O servidor foi reiniciado; o envio foi interrompido.',
  internal_error: 'Erro interno do servidor; o envio foi interrompido.',
};

const CANCELLED_MESSAGE =
  'Envio cancelado. As reservas já verificadas ficam como estão; as restantes podem ser retomadas.';

interface ActiveDispatch {
  dispatchId: string;
  clientId: string;
  logger: Logger;
  gateway: HunitGateway | null;
  tokenGate: TokenGate;
  stopReason: ExecutionEndReason | null;
  cancelledByClientId: string | null;
  forceCloseTimer: NodeJS.Timeout | null;
  finishing: boolean;
  done: Promise<void>;
}

interface ItemCounts {
  sent: number;
  withdrawn: number;
  notVerified: number;
}

export class DispatchRunner {
  private readonly active = new Map<string, ActiveDispatch>();
  private readonly now: () => Date;

  constructor(private readonly options: DispatchRunnerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Confere a elegibilidade (FR-003), cria o envio e começa a executá-lo em segundo plano.
   *
   * @throws AccountBusyError, DispatchAlreadyResumedError, NoEligibleReservationsError
   */
  async start(input: StartDispatchInput): Promise<DispatchRow> {
    const secrets = registerRunSecrets(this.options.secrets, input.credentials);
    let dispatch: DispatchRow;
    try {
      const keys = uniqueReservationKeys(input.reservations);
      const eligibility = await checkDispatchEligibility(this.options.db, keys);
      const items: NewDispatchItem[] = eligibility.map((item) => ({
        hotelCode: item.hotelCode,
        reservationNumber: item.reservationNumber,
        classificationBefore: item.classification,
        outcome: item.eligibility.eligible ? 'pending' : 'ignored',
        reason: item.eligibility.eligible ? null : item.eligibility.reason,
      }));
      if (!items.some((item) => item.outcome === 'pending'))
        throw new NoEligibleReservationsError();

      dispatch = await createDispatch(this.options.db, {
        accountKey: accountKeyFor(input.credentials.username, this.options.accountKeySecret),
        clientId: input.clientId,
        parentDispatchId: input.parentDispatchId ?? null,
        items,
        now: this.now(),
      });
    } catch (error) {
      releaseAll(secrets);
      throw error;
    }

    const run: ActiveDispatch = {
      dispatchId: dispatch.id,
      clientId: input.clientId,
      logger: this.options.logger.child({ dispatchId: dispatch.id }),
      gateway: null,
      tokenGate: new TokenGate(),
      stopReason: null,
      cancelledByClientId: null,
      forceCloseTimer: null,
      finishing: false,
      done: Promise.resolve(),
    };
    this.active.set(dispatch.id, run);
    run.done = this.execute(run, input.credentials, secrets);
    return dispatch;
  }

  /** Entrega o token (FR-002). `false` se o envio não espera o token agora. */
  submitToken(dispatchId: string, token: string): boolean {
    return this.active.get(dispatchId)?.tokenGate.submit(token) ?? false;
  }

  isActive(dispatchId: string): boolean {
    return this.active.has(dispatchId);
  }

  async whenFinished(dispatchId: string): Promise<void> {
    await this.active.get(dispatchId)?.done;
  }

  /**
   * Cancela o envio (FR-007): a parada é entre uma reserva e outra; se a leitura em andamento não
   * terminar no prazo, o navegador é fechado à força. Um envio ativo no banco mas fora deste
   * processo é cancelado direto no banco.
   */
  async cancel(dispatchId: string, clientId: string): Promise<DispatchCancelOutcome> {
    const run = this.active.get(dispatchId);
    if (!run) return this.cancelUntracked(dispatchId, clientId);
    if (run.stopReason === 'cancelled_by_client') return 'requested';
    if (run.finishing || run.stopReason) {
      await run.done;
      return 'already_finished';
    }
    this.requestStop(run, 'cancelled_by_client', clientId);
    run.forceCloseTimer ??= setTimeout(() => {
      run.logger.warn('o envio não parou no prazo do cancelamento; fechando o navegador');
      void this.closeGateway(run);
    }, this.options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS);
    run.forceCloseTimer.unref();
    return 'requested';
  }

  /** Servidor desligando: os envios em andamento terminam como `failed/server_restarted`. */
  async shutdown(): Promise<void> {
    const runs = [...this.active.values()];
    for (const run of runs) {
      this.requestStop(run, 'server_restarted');
      await this.closeGateway(run);
    }
    await Promise.all(runs.map((run) => run.done));
  }

  private requestStop(run: ActiveDispatch, reason: ExecutionEndReason, clientId?: string): void {
    if (!run.stopReason) {
      run.stopReason = reason;
      run.cancelledByClientId = clientId ?? null;
    }
    run.tokenGate.abort(new StopRequestedError());
  }

  private throwIfStopping(run: ActiveDispatch): void {
    if (run.stopReason) throw new StopRequestedError();
  }

  private async cancelUntracked(
    dispatchId: string,
    clientId: string,
  ): Promise<DispatchCancelOutcome> {
    const now = this.now();
    const updated = await transitionDispatch(
      this.options.db,
      dispatchId,
      { to: 'cancelled', endReason: 'cancelled_by_client', cancelledByClientId: clientId },
      now,
    );
    if (!updated) return 'already_finished';
    await failPendingItems(this.options.db, dispatchId, NOT_VERIFIED_REASONS.cancelled, now);
    await this.options.events.publish({
      dispatchId,
      type: 'status_changed',
      status: 'cancelled',
      message: CANCELLED_MESSAGE,
    });
    return 'requested';
  }

  private async execute(
    run: ActiveDispatch,
    credentials: HunitCredentials,
    secrets: RunSecrets,
  ): Promise<void> {
    try {
      try {
        await this.options.events.publish({
          dispatchId: run.dispatchId,
          type: 'status_changed',
          status: 'queued',
          message: 'Envio ao Comercial criado.',
        });
        await this.changeStatus(run, { to: 'running' }, 'Acessando o Hunit.');
        const gateway = await this.openGateway(run);

        await authenticate({
          gateway,
          credentials,
          secrets: this.options.secrets,
          runSecrets: secrets,
          tokenGate: run.tokenGate,
          timeoutMs: this.options.twoFactorTimeoutMs,
          now: this.now,
          throwIfStopping: () => this.throwIfStopping(run),
          announceAwaiting: (deadline) =>
            this.changeStatus(
              run,
              { to: 'awaiting_2fa', twoFactorDeadline: deadline },
              `O Hunit pediu o token de verificação. Envie o código do autenticador até ${formatTime(deadline)}.`,
            ),
          announceTokenReceived: () =>
            this.changeStatus(run, { to: 'running' }, 'Token recebido. Concluindo o acesso.'),
        });

        const counts = await this.verifyAll(run, gateway);
        run.finishing = true;
        const late =
          run.stopReason === 'cancelled_by_client'
            ? ' O cancelamento chegou depois de todas as reservas serem verificadas.'
            : '';
        await this.changeStatus(
          run,
          { to: 'completed' },
          `Envio concluído: ${counts.sent} enviadas ao Comercial, ${counts.withdrawn} retiradas e ${counts.notVerified} não verificadas.${late}`,
        );
      } catch (error) {
        await this.fail(run, error);
      } finally {
        if (run.forceCloseTimer) clearTimeout(run.forceCloseTimer);
        await this.closeGateway(run);
        releaseAll(secrets);
        this.active.delete(run.dispatchId);
        this.options.onLinesChanged?.();
      }
    } catch (error) {
      run.logger.error({ err: error }, 'não foi possível encerrar o envio corretamente');
    }
  }

  private async openGateway(run: ActiveDispatch): Promise<HunitGateway> {
    this.throwIfStopping(run);
    const gateway = await this.options.createGateway({
      executionId: run.dispatchId,
      onRetry: (notice) => this.announceRetry(run, notice),
    });
    run.gateway = gateway;
    this.throwIfStopping(run);
    return gateway;
  }

  /** Verifica as reservas pendentes, uma por vez, na ordem do envio (FR-004, FR-005). */
  private async verifyAll(run: ActiveDispatch, gateway: HunitGateway): Promise<ItemCounts> {
    const counts: ItemCounts = { sent: 0, withdrawn: 0, notVerified: 0 };
    const items = await listDispatchItems(this.options.db, run.dispatchId);
    // Uma retomada já começa sem as verificadas: só as pendentes interessam.
    for (const item of items) {
      if (item.outcome !== 'pending') continue;
      // A coleta só para entre uma reserva e outra (FR-007).
      if (run.stopReason) break;
      const outcome = await this.verifyOne(run, gateway, item);
      counts[outcome] += 1;
    }
    this.throwIfStopping(run);
    return counts;
  }

  private async verifyOne(
    run: ActiveDispatch,
    gateway: HunitGateway,
    item: DispatchItemRow,
  ): Promise<keyof ItemCounts> {
    const key = { hotelCode: item.hotelCode, reservationNumber: item.reservationNumber };
    const [stored] = await this.options.db
      .select({ checkIn: reservations.checkIn, reservationStatus: reservations.reservationStatus })
      .from(reservations)
      .where(
        and(
          eq(reservations.hotelCode, key.hotelCode),
          eq(reservations.reservationNumber, key.reservationNumber),
        ),
      );
    if (!stored) return this.notVerified(run, item, NOT_VERIFIED_REASONS.missing);

    let found;
    try {
      found = await findReservation(gateway, { ...key, checkIn: stored.checkIn });
    } catch (error) {
      if (error instanceof ScreenNotRecognizedError) {
        const evidenceId = await this.recordEvidence(run, item, error.message, error.evidence);
        const suffix = evidenceId ? ` (evidência ${evidenceId})` : '';
        return this.notVerified(run, item, `${NOT_VERIFIED_REASONS.unrecognized}${suffix}`);
      }
      // Sessão expirada, navegador fechado no cancelamento: o envio todo para.
      if (error instanceof SessionExpiredError || run.stopReason) throw error;
      if (error instanceof HunitError && error.code === 'hunit_unavailable') {
        // As novas tentativas já se esgotaram (FR-011a da 001): segue para a próxima.
        return this.notVerified(run, item, NOT_VERIFIED_REASONS.unavailable);
      }
      throw error;
    }
    if (!found) return this.notVerified(run, item, NOT_VERIFIED_REASONS.notFound(stored.checkIn));

    const snapshot: ReservationSnapshot = found.detail.snapshot;
    const result = classifyReservation(
      found.item.reservationNumber,
      snapshot,
      found.item.reservationStatus,
    );
    if (result.classification === 'analysis_error') {
      await this.recordEvidence(run, item, result.reason, found.detail.evidence);
    }
    const data = buildReservationData({
      hotelCode: key.hotelCode,
      reservationNumber: key.reservationNumber,
      listing: found.item.listing,
      snapshot,
      result,
    });
    const decision = dispatchOutcome(result.classification);
    const now = this.now();
    const name = CLASSIFICATION_NAMES[result.classification];

    await commitVerifiedReservation(this.options.db, {
      data,
      dispatchId: run.dispatchId,
      now,
      within: async (tx) => {
        if (decision.outcome === 'sent') {
          await openLineOnSend(tx, {
            key,
            dispatchId: run.dispatchId,
            clientId: run.clientId,
            now,
          });
          await insertCommercialEvent(tx, {
            ...key,
            type: 'dispatched',
            clientId: run.clientId,
            dispatchId: run.dispatchId,
            at: now,
          });
        } else {
          await insertCommercialEvent(tx, {
            ...key,
            type: 'withdrawn',
            clientId: run.clientId,
            dispatchId: run.dispatchId,
            classification: result.classification,
            reason: name,
            at: now,
          });
        }
        await recordItemOutcome(tx, {
          dispatchId: run.dispatchId,
          ...key,
          outcome: decision.outcome,
          classificationAfter: result.classification,
          reason: decision.outcome === 'withdrawn' ? name : null,
          now,
        });
        // Linha que já existia (reenvio) muda de aba se a reserva deixou de exigir cobrança.
        await refreshCommercialLine(tx, key, now);
      },
    });
    this.options.onLinesChanged?.();

    await this.options.events.publish({
      dispatchId: run.dispatchId,
      type: 'item_processed',
      ...key,
      message:
        decision.outcome === 'sent'
          ? `Reserva ${key.reservationNumber}: enviada ao Comercial (${name}).`
          : `Reserva ${key.reservationNumber}: retirada — ${name}.`,
    });
    return decision.outcome;
  }

  private async notVerified(
    run: ActiveDispatch,
    item: DispatchItemRow,
    reason: string,
  ): Promise<'notVerified'> {
    await recordItemOutcome(this.options.db, {
      dispatchId: run.dispatchId,
      hotelCode: item.hotelCode,
      reservationNumber: item.reservationNumber,
      outcome: 'not_verified',
      classificationAfter: null,
      reason,
      now: this.now(),
    });
    await this.options.events.publish({
      dispatchId: run.dispatchId,
      type: 'item_processed',
      hotelCode: item.hotelCode,
      reservationNumber: item.reservationNumber,
      message: `Reserva ${item.reservationNumber}: não verificada — ${reason}.`,
    });
    return 'notVerified';
  }

  /** Evidência da resposta não reconhecida (constitution, princípio II). Devolve o id, se gravou. */
  private async recordEvidence(
    run: ActiveDispatch,
    item: DispatchItemRow,
    reason: string,
    material: EvidenceMaterial | null,
  ): Promise<string | null> {
    if (!material) return null;
    try {
      const stored = await this.options.evidence.save({
        dispatchId: run.dispatchId,
        hotelCode: item.hotelCode,
        reservationNumber: item.reservationNumber,
        kind: 'classification_failure',
        reason,
        material,
      });
      return stored?.id ?? null;
    } catch (error) {
      run.logger.error({ err: error }, 'não foi possível gravar a evidência do envio');
      return null;
    }
  }

  private async announceRetry(run: ActiveDispatch, notice: HunitRetryNotice): Promise<void> {
    const seconds = Math.ceil(notice.delayMs / 1_000);
    try {
      await this.options.events.publish({
        dispatchId: run.dispatchId,
        type: 'warning',
        hotelCode: notice.hotelCode,
        message: `${notice.reason}. Nova tentativa ${notice.attempt} de ${notice.maxAttempts} em ${seconds} s.`,
      });
    } catch (error) {
      run.logger.error({ err: error }, 'não foi possível publicar o aviso de nova tentativa');
    }
  }

  /** @throws StopRequestedError se a transição não é mais possível (encerrado por outro caminho). */
  private async changeStatus(
    run: ActiveDispatch,
    transition: ExecutionTransition,
    message: string,
  ): Promise<void> {
    const updated = await transitionDispatch(
      this.options.db,
      run.dispatchId,
      transition,
      this.now(),
    );
    if (!updated) throw new StopRequestedError();
    await this.options.events.publish({
      dispatchId: run.dispatchId,
      type: 'status_changed',
      status: transition.to,
      message,
    });
  }

  /** Encerra o envio interrompido: `cancelled` ou `failed`, e as pendentes ficam não verificadas. */
  private async fail(run: ActiveDispatch, error: unknown): Promise<void> {
    run.finishing = true;
    const now = this.now();
    if (run.stopReason === 'cancelled_by_client') {
      await failPendingItems(this.options.db, run.dispatchId, NOT_VERIFIED_REASONS.cancelled, now);
      const updated = await transitionDispatch(
        this.options.db,
        run.dispatchId,
        {
          to: 'cancelled',
          endReason: 'cancelled_by_client',
          cancelledByClientId: run.cancelledByClientId,
        },
        now,
      );
      if (updated) {
        await this.options.events.publish({
          dispatchId: run.dispatchId,
          type: 'status_changed',
          status: 'cancelled',
          message: CANCELLED_MESSAGE,
        });
      }
      return;
    }

    if (error instanceof StopRequestedError && !run.stopReason) {
      run.logger.info('envio encerrado por outro caminho');
      return;
    }
    const hunitError = error instanceof HunitError ? error : null;
    const endReason =
      run.stopReason ??
      (hunitError ? END_REASON_BY_HUNIT_ERROR[hunitError.code] : 'internal_error');
    if (endReason === 'internal_error')
      run.logger.error({ err: error }, 'falha inesperada no envio');
    else run.logger.info({ endReason, err: error }, 'envio encerrado com falha');

    await failPendingItems(
      this.options.db,
      run.dispatchId,
      endReason === 'server_restarted'
        ? NOT_VERIFIED_REASONS.serverRestarted
        : NOT_VERIFIED_REASONS.failed,
      now,
    );
    const message =
      (run.stopReason ? END_MESSAGES[run.stopReason] : hunitError?.message) ??
      END_MESSAGES.internal_error ??
      'O envio falhou.';
    const updated = await transitionDispatch(
      this.options.db,
      run.dispatchId,
      { to: 'failed', endReason },
      now,
    );
    if (updated) {
      await this.options.events.publish({
        dispatchId: run.dispatchId,
        type: 'status_changed',
        status: 'failed',
        message,
      });
    }
  }

  private async closeGateway(run: ActiveDispatch): Promise<void> {
    const { gateway } = run;
    if (!gateway) return;
    try {
      await gateway.close();
    } catch (error) {
      run.logger.warn({ err: error }, 'falha ao fechar o navegador do envio');
    }
  }
}

/**
 * Ao subir o servidor, os envios que estavam ativos falham como `server_restarted`: as credenciais
 * e o token existiam só na memória do processo anterior. O operador pode retomá-los.
 */
export async function failInterruptedDispatches(
  db: Database,
  events: DispatchEventBus,
  now: Date = new Date(),
): Promise<DispatchRow[]> {
  const interrupted = await failAllActiveDispatches(
    db,
    'server_restarted',
    NOT_VERIFIED_REASONS.serverRestarted,
    now,
  );
  for (const dispatch of interrupted) {
    await events.publish({
      dispatchId: dispatch.id,
      type: 'status_changed',
      status: 'failed',
      message: END_MESSAGES.server_restarted ?? 'O servidor foi reiniciado.',
    });
  }
  return interrupted;
}
