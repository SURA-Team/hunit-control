import {
  buildReservationData,
  classifyReservation,
  isHotelbeds258,
  splitPeriod,
  type Classification,
  type Period,
  type ReservationData,
  type ReservationSnapshot,
} from '@hunit/domain';
import type { EvidenceMaterial } from '../evidence/material.js';
import type { EvidenceStore } from '../evidence/store.js';
import { HunitError, ScreenNotRecognizedError, SessionExpiredError } from '../hunit/errors.js';
import type { HunitGateway, HunitHotel, ReservationListItem } from '../hunit/gateway.js';
import type { Logger } from '../logging.js';
import type { Database } from '../persistence/db.js';
import {
  emptyHotelProgress,
  finishExecutionHotelWithoutResults,
  registerExecutionHotels,
  startExecutionHotel,
  updateExecutionHotelProgress,
  type HotelProgress,
} from '../persistence/execution-hotels-repo.js';
import { commitHotel } from '../persistence/reservations-repo.js';
import type { EvidenceKind } from '../persistence/schema.js';
import type { ExecutionEventBus } from './events.js';
import { StopRequestedError } from './stop.js';

/** Nome de cada classificação nas mensagens ao operador. */
export const CLASSIFICATION_LABELS: Readonly<Record<Classification, string>> = {
  ignored_hotelbeds_258: 'ignorada (Hotelbeds 258)',
  not_virtual_card: 'não é cartão virtual',
  virtual_card_charge_error: 'erro na cobrança',
  virtual_card_already_charged: 'já cobrada',
  virtual_card_validated_only: 'cartão validado (não cobrado)',
  virtual_card_pending_charge: 'pendente de cobrança',
  analysis_error: 'erro de análise',
};

export interface HotelCollectionContext {
  executionId: string;
  /** Período de check-in da execução. */
  period: Period;
  /** Hotéis pedidos; `null` = todos os do catálogo (FR-009). */
  requestedHotelCodes: readonly string[] | null;
  /** Catálogo lido nesta execução. */
  catalog: readonly HunitHotel[];
  gateway: HunitGateway;
  db: Database;
  events: ExecutionEventBus;
  evidence: EvidenceStore;
  logger: Logger;
  now: () => Date;
  /** Tamanho máximo de cada consulta ao Hunit, em dias (research R-09). */
  maxPeriodDays: number | null;
  /** Indica que a execução deve parar (ex.: servidor desligando). */
  isStopping: () => boolean;
}

export interface HotelCollectionSummary {
  completed: number;
  failed: number;
  reservations: number;
}

/** Falha que encerra a execução inteira (e não só o hotel). */
function endsExecution(error: unknown, context: HotelCollectionContext): boolean {
  return (
    context.isStopping() ||
    error instanceof StopRequestedError ||
    error instanceof SessionExpiredError
  );
}

/**
 * Percorre os hotéis da execução, um por vez (research R-08: o paralelismo só será ligado depois
 * de verificado no Hunit real), e grava cada hotel concluído (FR-009 a FR-019).
 *
 * - Hotel com falha: evidência, hotel `failed` sem gravar reservas, e segue para o próximo (edge
 *   case "falha repetida em um hotel").
 * - Sessão expirada ou parada da execução: o hotel em andamento não grava nada e o erro sobe;
 *   os hotéis restantes ficam pendentes, para a retomada (FR-023).
 */
export async function collectHotels(
  context: HotelCollectionContext,
): Promise<HotelCollectionSummary> {
  const { catalog, db, executionId } = context;
  const names = new Map(catalog.map((hotel) => [hotel.code, hotel.name]));
  const requested = [...new Set(context.requestedHotelCodes ?? catalog.map((hotel) => hotel.code))];
  const registered = new Set(await registerExecutionHotels(db, executionId, requested));

  const summary: HotelCollectionSummary = { completed: 0, failed: 0, reservations: 0 };
  for (const hotelCode of requested.filter((code) => !names.has(code))) {
    summary.failed += 1;
    const reason = 'O hotel não está no catálogo atual da conta do Hunit; não foi consultado.';
    if (registered.has(hotelCode)) {
      await finishExecutionHotelWithoutResults(
        db,
        executionId,
        hotelCode,
        { status: 'failed', reason },
        context.now(),
      );
    }
    await context.events.publish({
      executionId,
      type: 'hotel_failed',
      hotelCode,
      message: `Hotel ${hotelCode}: ${reason}`,
    });
  }

  for (const hotelCode of requested.filter((code) => names.has(code))) {
    if (context.isStopping()) throw new StopRequestedError();
    const collected = await new HotelRun(
      context,
      hotelCode,
      names.get(hotelCode) ?? hotelCode,
    ).run();
    if (collected === null) {
      summary.failed += 1;
    } else {
      summary.completed += 1;
      summary.reservations += collected;
    }
  }
  return summary;
}

/** O processamento de um hotel dentro da execução. */
class HotelRun {
  private readonly progress: HotelProgress = emptyHotelProgress();
  /** Reservas vistas, uma por número: a listagem pode repetir reservas entre páginas. */
  private readonly records = new Map<string, ReservationData>();
  private readonly label: string;

  constructor(
    private readonly context: HotelCollectionContext,
    private readonly hotelCode: string,
    hotelName: string,
  ) {
    this.label = hotelName === hotelCode ? `Hotel ${hotelCode}` : `${hotelName} (${hotelCode})`;
  }

  /** @returns quantidade de reservas gravadas, ou `null` se o hotel falhou. */
  async run(): Promise<number | null> {
    const { context, hotelCode } = this;
    await startExecutionHotel(context.db, context.executionId, hotelCode, context.now());
    await this.publish('hotel_started', `${this.label}: consultando as reservas.`);

    try {
      for (const block of splitPeriod(context.period, context.maxPeriodDays)) {
        await this.collectBlock(block);
      }
      const committed = await commitHotel(context.db, {
        executionId: context.executionId,
        hotelCode,
        period: context.period,
        reservations: [...this.records.values()],
        progress: this.progress,
        now: context.now(),
      });
      const missing =
        committed.markedNotFound > 0
          ? ` ${committed.markedNotFound} reservas gravadas não apareceram e foram marcadas como não encontradas.`
          : '';
      await this.publish(
        'hotel_completed',
        `${this.label}: concluído com ${this.records.size} reservas (${this.describeCounts()}).${missing}`,
      );
      return this.records.size;
    } catch (error) {
      await this.handleFailure(error);
      return null;
    }
  }

  /** Todas as páginas de um bloco do período (FR-011). */
  private async collectBlock(block: Period): Promise<void> {
    const { context, hotelCode } = this;
    // Desconhecido até a primeira página; depois, vem do próprio resultado.
    let totalPages: number | null = null;

    for (let page = 1; totalPages === null || page <= totalPages; page += 1) {
      if (context.isStopping()) throw new StopRequestedError();
      const result = await context.gateway.searchReservations(hotelCode, block, page);

      // Se a listagem crescer durante a leitura (reservas novas no Hunit), o total acompanha.
      if (totalPages === null || result.totalPages > totalPages) {
        this.progress.pagesTotal += result.totalPages - (totalPages ?? 0);
        totalPages = result.totalPages;
      }

      for (const item of result.items) {
        if (this.records.has(item.reservationNumber)) continue;
        this.records.set(item.reservationNumber, await this.analyze(item));
      }

      if (page <= totalPages) this.progress.pagesDone += 1;
      await updateExecutionHotelProgress(context.db, context.executionId, hotelCode, this.progress);
      await this.publish(
        'page_done',
        totalPages === 0
          ? `${this.label}: nenhuma reserva de ${block.from} a ${block.to}.`
          : `${this.label}: página ${page} de ${totalPages} lida (${this.records.size} reservas até agora).`,
      );
    }
  }

  /** Abre (se preciso) e classifica uma reserva da listagem (FR-013 a FR-016). */
  private async analyze(item: ReservationListItem): Promise<ReservationData> {
    const { context, hotelCode } = this;
    this.progress.reservationsSeen += 1;

    let snapshot: ReservationSnapshot | null = null;
    let material: EvidenceMaterial | null = null;
    let failure: ScreenNotRecognizedError | null = null;

    if (!isHotelbeds258(item.reservationNumber)) {
      this.progress.reservationsOpened += 1;
      try {
        const detail = await context.gateway.readReservation(hotelCode, item);
        snapshot = detail.snapshot;
        material = detail.evidence;
      } catch (error) {
        // Só o detalhe desta reserva é desconhecido: erro de análise e segue (edge case "falha
        // ao abrir uma reserva"). Qualquer outra falha é do hotel ou da execução.
        if (!(error instanceof ScreenNotRecognizedError)) throw error;
        failure = error;
        material = error.evidence;
      }
    }

    const result = classifyReservation(item.reservationNumber, snapshot, item.reservationStatus);
    const counts = this.progress.counts;
    counts[result.classification] = (counts[result.classification] ?? 0) + 1;

    if (material && result.classification === 'analysis_error') {
      await this.recordEvidence(
        'classification_failure',
        failure?.message ?? result.reason,
        material,
        item,
      );
    } else if (material && result.reservationStatus === 'unknown') {
      await this.recordEvidence(
        'reservation_status_unknown',
        `Situação da reserva ${item.reservationNumber} não identificada (nem ativa nem cancelada).`,
        material,
        item,
      );
    }

    const cancelled = result.reservationStatus === 'cancelled' ? ' (cancelada)' : '';
    await this.publish(
      'reservation_classified',
      `${this.label}: reserva ${item.reservationNumber}${cancelled} — ${CLASSIFICATION_LABELS[result.classification]}.`,
      item.reservationNumber,
    );

    return buildReservationData({
      hotelCode,
      reservationNumber: item.reservationNumber,
      listing: item.listing,
      snapshot,
      result,
    });
  }

  /** Hotel não concluído: nada é gravado (FR-019); só o motivo e a evidência. */
  private async handleFailure(error: unknown): Promise<void> {
    const { context, hotelCode } = this;
    const now = context.now();

    if (endsExecution(error, context)) {
      const outcome =
        error instanceof SessionExpiredError
          ? { status: 'failed' as const, reason: error.message }
          : context.isStopping()
            ? { status: 'failed' as const, reason: 'A execução foi interrompida no meio do hotel.' }
            : {
                status: 'cancelled' as const,
                reason: 'A execução foi encerrada no meio do hotel.',
              };
      await finishExecutionHotelWithoutResults(
        context.db,
        context.executionId,
        hotelCode,
        outcome,
        now,
        this.progress,
      );
      throw error;
    }

    const hunitError = error instanceof HunitError ? error : null;
    if (hunitError) {
      context.logger.info({ hotelCode, err: error }, 'hotel encerrado com falha');
    } else {
      context.logger.error({ hotelCode, err: error }, 'falha inesperada ao processar o hotel');
    }
    const reason = hunitError?.message ?? 'Erro interno ao processar o hotel.';
    if (hunitError?.evidence) {
      await this.recordEvidence(
        hunitError instanceof ScreenNotRecognizedError
          ? 'screen_not_recognized'
          : 'navigation_failure',
        reason,
        hunitError.evidence,
      );
    }

    await finishExecutionHotelWithoutResults(
      context.db,
      context.executionId,
      hotelCode,
      { status: 'failed', reason },
      now,
      this.progress,
    );
    await this.publish('hotel_failed', `${this.label}: falhou, nada foi gravado. ${reason}`);
  }

  private async recordEvidence(
    kind: EvidenceKind,
    reason: string,
    material: EvidenceMaterial,
    item?: ReservationListItem,
  ): Promise<void> {
    const { context, hotelCode } = this;
    try {
      const stored = await context.evidence.save({
        executionId: context.executionId,
        hotelCode,
        reservationNumber: item?.reservationNumber ?? null,
        kind,
        reason,
        material,
      });
      if (stored) {
        await this.publish(
          'evidence_recorded',
          `Evidência registrada (${stored.id}): ${reason}`,
          item?.reservationNumber,
        );
      }
    } catch (error) {
      // A classificação e o hotel seguem mesmo sem a evidência.
      context.logger.error({ err: error, hotelCode }, 'não foi possível gravar a evidência');
    }
  }

  private describeCounts(): string {
    const parts = Object.entries(this.progress.counts)
      .filter(([, count]) => count > 0)
      .map(
        ([classification, count]) =>
          `${count} ${CLASSIFICATION_LABELS[classification as Classification]}`,
      );
    return parts.length > 0 ? parts.join(', ') : 'nenhuma reserva no período';
  }

  private async publish(
    type:
      | 'hotel_started'
      | 'page_done'
      | 'reservation_classified'
      | 'hotel_completed'
      | 'hotel_failed'
      | 'evidence_recorded',
    message: string,
    reservationNumber?: string,
  ): Promise<void> {
    await this.context.events.publish({
      executionId: this.context.executionId,
      type,
      hotelCode: this.hotelCode,
      reservationNumber: reservationNumber ?? null,
      message,
    });
  }
}
