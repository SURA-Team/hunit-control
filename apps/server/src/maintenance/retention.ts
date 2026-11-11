/**
 * Rotina diária de manutenção (specs/001, T058, research R-16):
 *
 * - remove as evidências cujo prazo de retenção venceu, arquivos e registro (FR-025);
 * - anonimiza o nome do hóspede das reservas com check-in há mais de
 *   `RESERVATION_RETENTION_YEARS` anos, preenchendo `anonymized_at` (FR-026/FR-027).
 *
 * Roda ao iniciar o servidor e depois a cada 24 h. Como cada rodada trata tudo o que está
 * vencido, e não só o que venceu desde a anterior, o que atrasou com o servidor desligado é
 * feito logo que ele volta (FR-029).
 */
import { rm, rmdir } from 'node:fs/promises';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { EvidenceStore } from '../evidence/store.js';
import type { Logger } from '../logging.js';
import type { Database } from '../persistence/db.js';
import { evidence, reservations } from '../persistence/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fuso usado para saber "que dia é hoje" ao contar os anos desde o check-in. */
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

export interface RetentionOptions {
  db: Database;
  /** Loja de evidências: resolve os caminhos dos arquivos dentro de `EVIDENCE_DIR`. */
  evidence: EvidenceStore;
  /** Anos após o check-in em que o nome do hóspede é apagado (RESERVATION_RETENTION_YEARS). */
  reservationRetentionYears: number;
  logger: Logger;
  /** Relógio; os testes informam um fixo. */
  now?: () => Date;
}

export interface RetentionResult {
  evidenceRemoved: number;
  /** Evidências vencidas que não puderam ser removidas; ficam para a próxima rodada. */
  evidenceFailed: number;
  reservationsAnonymized: number;
}

/** Data (AAAA-MM-DD) de `date` no fuso de São Paulo. */
function businessDate(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: BUSINESS_TIME_ZONE });
}

async function removeExpiredEvidence(
  options: RetentionOptions,
  now: Date,
): Promise<Pick<RetentionResult, 'evidenceRemoved' | 'evidenceFailed'>> {
  const { db, logger } = options;
  const expired = await db
    .select({
      id: evidence.id,
      executionId: evidence.executionId,
      screenshotPath: evidence.screenshotPath,
      htmlPath: evidence.htmlPath,
      responsePath: evidence.responsePath,
    })
    .from(evidence)
    .where(lte(evidence.expiresAt, now));

  let evidenceRemoved = 0;
  let evidenceFailed = 0;
  const folders = new Set<string>();
  for (const row of expired) {
    try {
      // Arquivos primeiro: se a remoção falhar, o registro fica e a próxima rodada tenta de novo.
      for (const file of [row.screenshotPath, row.htmlPath, row.responsePath]) {
        if (file) await rm(options.evidence.resolve(file), { force: true });
      }
      await db.delete(evidence).where(eq(evidence.id, row.id));
      folders.add(row.executionId);
      evidenceRemoved += 1;
    } catch (error) {
      evidenceFailed += 1;
      logger.error({ err: error, evidenceId: row.id }, 'falha ao remover uma evidência vencida');
    }
  }

  // A pasta da execução só é apagada se ficou vazia: o rmdir recusa pasta com arquivos (outras
  // evidências ainda no prazo) e a que já não existe também não é erro.
  for (const executionId of folders) {
    await rmdir(options.evidence.resolve(executionId)).catch(() => undefined);
  }

  return { evidenceRemoved, evidenceFailed };
}

async function anonymizeOldReservations(options: RetentionOptions, now: Date): Promise<number> {
  const today = businessDate(now);
  // Mantida por N anos "após o check-in": no aniversário de N anos o nome ainda fica; some no
  // dia seguinte. O PostgreSQL ajusta 29/02 para 28/02 em anos não bissextos.
  const cutoff = sql`(${today}::date - make_interval(years => ${options.reservationRetentionYears}))::date`;
  const result = await options.db
    .update(reservations)
    .set({ guestName: null, anonymizedAt: now })
    .where(and(isNull(reservations.anonymizedAt), sql`${reservations.checkIn} < ${cutoff}`));
  return result.rowCount ?? 0;
}

/** Faz uma rodada da manutenção. */
export async function runRetention(options: RetentionOptions): Promise<RetentionResult> {
  const now = (options.now ?? (() => new Date()))();
  const evidenceResult = await removeExpiredEvidence(options, now);
  const reservationsAnonymized = await anonymizeOldReservations(options, now);
  return { ...evidenceResult, reservationsAnonymized };
}

export interface RetentionScheduleOptions extends RetentionOptions {
  /** Intervalo entre rodadas. Padrão: 24 h. */
  intervalMs?: number;
}

export interface RetentionSchedule {
  /** Cancela as próximas rodadas e espera a rodada em andamento terminar. */
  stop(): Promise<void>;
}

/**
 * Agenda a manutenção: uma rodada imediata (FR-029) e depois uma a cada `intervalMs`, contado a
 * partir do fim da anterior. A falha de uma rodada é registrada e não interrompe as próximas.
 */
export function startRetentionSchedule(options: RetentionScheduleOptions): RetentionSchedule {
  const intervalMs = options.intervalMs ?? DAY_MS;
  const { logger } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | null = null;

  const tick = (): void => {
    running = runRetention(options)
      .then(
        (result) => logger.info(result, 'rotina de manutenção concluída'),
        (error: unknown) => logger.error({ err: error }, 'falha na rotina de manutenção'),
      )
      .finally(() => {
        running = null;
        if (stopped) return;
        timer = setTimeout(tick, intervalMs);
        // Não segura o processo aberto só por causa da próxima rodada.
        timer.unref();
      });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
