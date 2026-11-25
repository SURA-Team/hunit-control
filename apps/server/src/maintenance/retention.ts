/**
 * Rotina diária de manutenção (specs/001, T058, research R-16):
 *
 * - remove as evidências cujo prazo de retenção venceu, arquivos e registro (FR-025);
 * - anonimiza o nome do hóspede das reservas com check-in há mais de
 *   `RESERVATION_RETENTION_YEARS` anos, preenchendo `anonymized_at` (FR-026/FR-027);
 * - apaga os arquivos das tratativas que venceram (specs/003, research R-07): documentos
 *   substituídos ou desfeitos há mais de 30 dias, documentos de reservas anonimizadas e arquivos
 *   enviados que ficaram sem nenhum documento. O registro e o histórico ficam.
 *
 * Roda ao iniciar o servidor e depois a cada 24 h. Como cada rodada trata tudo o que está
 * vencido, e não só o que venceu desde a anterior, o que atrasou com o servidor desligado é
 * feito logo que ele volta (FR-029).
 */
import { rm, rmdir } from 'node:fs/promises';
import { TREATMENT_REVERT_DAYS } from '@hunit/domain';
import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { evidenceFolderOf, type EvidenceStore } from '../evidence/store.js';
import type { Logger } from '../logging.js';
import type { Database } from '../persistence/db.js';
import {
  evidence,
  reservations,
  commercialEvents,
  commercialLines,
  commercialReports,
  commercialReturns,
  noChargeMarks,
  treatmentDocuments,
  treatmentFiles,
} from '../persistence/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tempo que um arquivo enviado pode ficar sem nenhum documento antes de ser apagado: cobre o
 * intervalo entre o envio e o registro (specs/003, research R-02).
 */
const ORPHAN_FILE_GRACE_MS = DAY_MS;

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
  /** Documentos de tratativas que tiveram o arquivo e o nome apagados (specs/003, FR-013, FR-016). */
  treatmentDocumentsPurged: number;
  /** Arquivos de tratativas apagados por não terem mais nenhum documento. */
  treatmentFilesRemoved: number;
  /**
   * Linhas da planilha do Comercial de reservas anonimizadas que tiveram os textos livres apagados
   * e vão sair da planilha na próxima rodada (specs/005, research R-15).
   */
  commercialLinesAnonymized: number;
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
      dispatchId: evidence.dispatchId,
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
      // A pasta é a do dono: a execução ou o envio ao Comercial (specs/005).
      folders.add(evidenceFolderOf(row));
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

/**
 * Purga dos documentos das tratativas (specs/003, research R-07): o documento perde o arquivo e
 * o nome (que pode ter dados pessoais), mas o registro fica — inclusive como vigente, quando era
 * o vigente de uma reserva anonimizada, para a situação exibida não mudar (FR-016).
 */
async function purgeTreatmentDocuments(db: Database, now: Date): Promise<number> {
  const purged = { state: 'purged' as const, fileSha256: null, originalName: null, purgedAt: now };

  // Substituídos ou desfeitos há 30 dias ou mais: acabou o prazo de reversão (FR-013).
  const revertCutoff = new Date(now.getTime() - TREATMENT_REVERT_DAYS * DAY_MS);
  const expired = await db
    .update(treatmentDocuments)
    .set(purged)
    .where(
      and(
        inArray(treatmentDocuments.state, ['replaced', 'removed']),
        lte(treatmentDocuments.endedAt, revertCutoff),
      ),
    );

  // Reservas anonimizadas: o conteúdo de um documento não pode ser anonimizado, então é apagado.
  const anonymized = await db
    .update(treatmentDocuments)
    .set(purged)
    .where(
      and(
        ne(treatmentDocuments.state, 'purged'),
        sql`exists (select 1 from ${reservations} where ${reservations.hotelCode} = ${treatmentDocuments.hotelCode} and ${reservations.reservationNumber} = ${treatmentDocuments.reservationNumber} and ${reservations.anonymizedAt} is not null)`,
      ),
    );

  return (expired.rowCount ?? 0) + (anonymized.rowCount ?? 0);
}

/**
 * Apaga os arquivos sem nenhum documento: os dos documentos purgados e os enviados que nunca
 * foram registrados. Os enviados há menos de 24 h ficam, para não apagar um arquivo entre o
 * envio e o registro.
 */
async function removeOrphanTreatmentFiles(db: Database, now: Date): Promise<number> {
  const result = await db
    .delete(treatmentFiles)
    .where(
      and(
        lte(treatmentFiles.createdAt, new Date(now.getTime() - ORPHAN_FILE_GRACE_MS)),
        sql`not exists (select 1 from ${treatmentDocuments} where ${treatmentDocuments.fileSha256} = ${treatmentFiles.sha256})`,
      ),
    );
  return result.rowCount ?? 0;
}

/**
 * Envio ao Comercial das reservas anonimizadas (specs/005, research R-15): apaga os textos livres
 * que podem ter dado pessoal — o motivo da recusa (no retorno e no histórico) e o último retorno
 * lido — e deixa a linha pendente, para a rodada a tirar da planilha. O código de autorização, o
 * valor e o responsável ficam, como os dados de cobrança do Hunit.
 *
 * Desde a 008 (research R-08, data-model §1): também a observação da marcação "Cancelada sem
 * cobrança", a situação da cobrança escrita como texto livre (tipo `other`) e o texto dos relatos,
 * que passa a ser o nome da situação reconhecida.
 */
async function anonymizeCommercialData(db: Database, now: Date): Promise<number> {
  const anonymizedReservation = (table: { hotelCode: unknown; reservationNumber: unknown }) =>
    sql`exists (select 1 from ${reservations} r where r.hotel_code = ${table.hotelCode} and r.reservation_number = ${table.reservationNumber} and r.anonymized_at is not null)`;
  await db
    .update(commercialReturns)
    .set({ rejectionReason: null })
    .where(
      and(isNotNull(commercialReturns.rejectionReason), anonymizedReservation(commercialReturns)),
    );
  await db
    .update(commercialEvents)
    .set({ reason: null })
    .where(
      and(
        inArray(commercialEvents.type, [
          'return_rejected',
          'report_received',
          'report_changed',
          'report_cleared',
        ]),
        isNotNull(commercialEvents.reason),
        anonymizedReservation(commercialEvents),
      ),
    );
  await db
    .update(noChargeMarks)
    .set({ note: null })
    .where(and(isNotNull(noChargeMarks.note), anonymizedReservation(noChargeMarks)));
  await db
    .update(commercialReturns)
    .set({ chargeSituationText: null, chargeSituationKind: null })
    .where(
      and(
        eq(commercialReturns.chargeSituationKind, 'other'),
        anonymizedReservation(commercialReturns),
      ),
    );
  await db
    .update(commercialReports)
    .set({
      situationText: sql`(case when ${commercialReports.kind} = 'charged_in_hunit' then 'Cobrada no Hunit' else 'Cancelada' end)`,
      // O motivo da recusa da "Cancelada" pode citar o hóspede (homologação, R-19).
      rejectionReason: null,
    })
    .where(anonymizedReservation(commercialReports));
  const lines = await db
    .update(commercialLines)
    .set({
      lastReadReturn: null,
      returnProblem: null,
      version: sql`${commercialLines.version} + 1`,
      changedAt: now,
    })
    .where(and(isNull(commercialLines.removedFromSheetAt), anonymizedReservation(commercialLines)));
  return lines.rowCount ?? 0;
}

/** Faz uma rodada da manutenção. */
export async function runRetention(options: RetentionOptions): Promise<RetentionResult> {
  const now = (options.now ?? (() => new Date()))();
  const evidenceResult = await removeExpiredEvidence(options, now);
  const reservationsAnonymized = await anonymizeOldReservations(options, now);
  // Depois da anonimização: os documentos das reservas anonimizadas nesta rodada já entram.
  const treatmentDocumentsPurged = await purgeTreatmentDocuments(options.db, now);
  const treatmentFilesRemoved = await removeOrphanTreatmentFiles(options.db, now);
  const commercialLinesAnonymized = await anonymizeCommercialData(options.db, now);
  return {
    ...evidenceResult,
    reservationsAnonymized,
    treatmentDocumentsPurged,
    treatmentFilesRemoved,
    commercialLinesAnonymized,
  };
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
