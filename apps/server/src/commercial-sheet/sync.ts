/**
 * Sincronizador da planilha do Comercial (specs/005, FR-008 a FR-014, FR-026; research R-06, R-07,
 * R-15). A planilha é uma projeção do banco: cada rodada lê as duas abas, entrega os retornos do
 * Comercial ao processador (US2), compara cada linha com o estado desejado e aplica todas as
 * diferenças num único pedido.
 *
 * Regras que protegem o que o Comercial digita:
 * - numa linha que continua em "A cobrar", só as colunas do sistema (A a J) são escritas;
 * - as colunas de retorno (K a P; O e P desde a 008) só são escritas ao criar a linha ou ao movê-la
 *   para "Concluídas" (cópia do que foi lido).
 *
 * Uma rodada por vez, neste processo (o servidor é um só, constitution V). Gatilhos: mudanças
 * pendentes (verificadas a cada 30 s), a leitura a cada 10 min, "Ler retornos agora" e as novas
 * tentativas depois de uma falha (1, 2, 4 e 5 min, depois a cada 5 min — SC-010).
 */
import {
  amountToCharge,
  detailedSituation,
  effectiveClassification,
  HUNIT_NOT_FOUND_REASON,
  hunitChargeStatus,
  RETURN_COLUMN_FIELDS,
  sheetHotelNames,
  sheetSystemRow,
  SYSTEM_COLUMN_COUNT,
  treatmentStatus,
  type CommercialReturnCells,
  type FinanceValidation,
  type SheetCellValue,
} from '@hunit/domain';
import { asc } from 'drizzle-orm';
import type { Logger } from '../logging.js';
import {
  commercialKeyOf,
  getSheetState,
  listSheetLines,
  markLinesRemovedFromSheet,
  markLinesSynced,
  pendingLines,
  setSheetIssue,
  updateSheetState,
  type ReservationKey,
  type SheetLineSource,
  type SheetRoundProblem,
} from '../persistence/commercial-repo.js';
import type { Database } from '../persistence/db.js';
import { hotels } from '../persistence/schema.js';
import {
  loadTreatmentSummaries,
  reservationKeyOf,
  treatmentFlags,
} from '../persistence/treatments-repo.js';
import {
  SHEET_TABS,
  SheetError,
  type CommercialSheetGateway,
  type SheetChange,
  type SheetErrorCode,
  type SheetSnapshot,
  type SheetTab,
} from './gateway.js';
import { layoutProblems } from './layout.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Uma linha de "A cobrar" lida na rodada, já associada à reserva. */
export interface ReturnRowRead {
  key: ReservationKey;
  cells: CommercialReturnCells;
}

/** O que o processador de retornos fez na rodada (US2). */
export interface ReturnsRoundSummary {
  received: number;
  changed: number;
  problems: number;
}

/** Processador dos retornos (`returns.ts`, US2): roda antes de montar as linhas desejadas. */
export type ReturnsProcessor = (
  rows: readonly ReturnRowRead[],
  now: Date,
) => Promise<ReturnsRoundSummary>;

export interface RoundResult {
  ok: boolean;
  errorCode: SheetErrorCode | null;
  returnsReceived: number;
  returnsChanged: number;
  problems: number;
  linesWritten: number;
}

export interface CommercialSheetSyncOptions {
  db: Database;
  gateway: CommercialSheetGateway;
  logger: Logger;
  /** Dias de uma linha concluída em "Concluídas" (FR-026). */
  doneRetentionDays: number;
  processReturns?: ReturnsProcessor;
  now?: () => Date;
  /** Intervalos, em milissegundos (os testes usam outros). */
  intervals?: {
    /** Verificação de pendências. Padrão: 30 s. */
    pollMs?: number;
    /** Leitura dos retornos sem pendências (FR-014). Padrão: 10 min. */
    readEveryMs?: number;
    /** Agrupa mudanças próximas antes de uma rodada pedida. Padrão: 5 s. */
    debounceMs?: number;
    /** Esperas depois de falhas seguidas; a última se repete. Padrão: 1, 2, 4 e 5 min. */
    retryMs?: readonly number[];
  };
}

const DEFAULT_RETRY_MS = [MINUTE_MS, 2 * MINUTE_MS, 4 * MINUTE_MS, 5 * MINUTE_MS];

/** Uma linha encontrada na planilha. */
interface SheetEntry {
  tab: SheetTab;
  rowIndex: number;
  row: SheetCellValue[];
}

const asText = (value: SheetCellValue): string =>
  value === null || value === undefined ? '' : String(value);

/** Células de retorno (K a P) de uma linha da planilha. */
function returnCellsOf(row: readonly SheetCellValue[]): CommercialReturnCells {
  const cells: CommercialReturnCells = {};
  RETURN_COLUMN_FIELDS.forEach((field, offset) => {
    cells[field] = row[SYSTEM_COLUMN_COUNT + offset];
  });
  return cells;
}

const returnCellsSlice = (row: readonly SheetCellValue[]) =>
  row.slice(SYSTEM_COLUMN_COUNT, SYSTEM_COLUMN_COUNT + RETURN_COLUMN_FIELDS.length);

const hasAnyReturn = (row: readonly SheetCellValue[]) =>
  returnCellsSlice(row).some((cell) => asText(cell).trim() !== '');

/** "2026-11-19" → número de série das datas do Google (dias desde 30/12/1899). */
function serialDate(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / DAY_MS);
}

/** A linha toda vazia (o Google pode devolver linhas vazias no meio). */
const isBlankRow = (row: readonly SheetCellValue[]) =>
  row.every((cell) => asText(cell).trim() === '');

/** As colunas do sistema da linha lida, com as vazias completadas. */
function systemCellsOf(row: readonly SheetCellValue[]): string[] {
  return Array.from({ length: SYSTEM_COLUMN_COUNT }, (_unused, index) => asText(row[index]));
}

export class CommercialSheetSync {
  private readonly now: () => Date;
  private readonly pollMs: number;
  private readonly readEveryMs: number;
  private readonly debounceMs: number;
  private readonly retryMs: readonly number[];
  private tail: Promise<unknown> = Promise.resolve();
  private pollTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly options: CommercialSheetSyncOptions) {
    this.now = options.now ?? (() => new Date());
    this.pollMs = options.intervals?.pollMs ?? 30_000;
    this.readEveryMs = options.intervals?.readEveryMs ?? 10 * MINUTE_MS;
    this.debounceMs = options.intervals?.debounceMs ?? 5_000;
    this.retryMs = options.intervals?.retryMs ?? DEFAULT_RETRY_MS;
  }

  /** Começa a verificar pendências e a ler os retornos periodicamente. */
  start(): void {
    this.stopped = false;
    const tick = () => {
      if (this.stopped) return;
      void this.tickOnce().finally(() => {
        if (this.stopped) return;
        this.pollTimer = setTimeout(tick, this.pollMs);
        this.pollTimer.unref();
      });
    };
    tick();
  }

  /** Para os timers e espera a rodada em andamento terminar. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pollTimer = null;
    this.debounceTimer = null;
    await this.tail.catch(() => undefined);
  }

  /** Pede uma rodada em breve (agrupa mudanças próximas, research R-06). */
  requestRound(): void {
    if (this.stopped || this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runRound();
    }, this.debounceMs);
    this.debounceTimer.unref();
  }

  /**
   * Faz uma rodada completa agora (ou logo depois da que está em andamento) e devolve o
   * resultado. Usada por "Ler retornos agora" e pelos testes.
   */
  runRound(): Promise<RoundResult> {
    const round = this.tail.then(
      () => this.round(),
      () => this.round(),
    );
    this.tail = round.catch(() => undefined);
    return round;
  }

  /** Decide se a verificação periódica deve fazer uma rodada. */
  private async tickOnce(): Promise<void> {
    try {
      const now = this.now();
      const state = await getSheetState(this.options.db);
      if (state.consecutiveFailures > 0) {
        if (state.nextAttemptAt === null || state.nextAttemptAt.getTime() <= now.getTime()) {
          await this.runRound();
        }
        return;
      }
      const pending = await pendingLines(this.options.db);
      const lastRead = state.lastReadOkAt?.getTime() ?? 0;
      if (pending.count > 0 || now.getTime() - lastRead >= this.readEveryMs) {
        await this.runRound();
      }
    } catch (error) {
      this.options.logger.error({ err: error }, 'falha ao verificar as pendências da planilha');
    }
  }

  private async round(): Promise<RoundResult> {
    const { db, gateway, logger } = this.options;
    const now = this.now();
    const result: RoundResult = {
      ok: false,
      errorCode: null,
      returnsReceived: 0,
      returnsChanged: 0,
      problems: 0,
      linesWritten: 0,
    };

    try {
      await updateSheetState(db, { lastRoundAt: now });
      const snapshot = await gateway.read();
      const layout = layoutProblems(snapshot);
      if (layout.length > 0) {
        logger.warn(
          { problems: layout },
          'formato da planilha do Comercial alterado; nada escrito',
        );
        throw new SheetError('sheet_layout_invalid', null);
      }

      const hotelNames = await this.hotelNames();
      const codeByName = new Map([...hotelNames].map(([code, name]) => [name, code]));
      const entries = this.entriesOf(snapshot, codeByName);

      // 1. Retornos do Comercial (US2), antes de montar as linhas: a coluna J já sai atualizada.
      if (this.options.processReturns) {
        const rows: ReturnRowRead[] = [];
        for (const [mapKey, found] of entries.byKey) {
          const first = found.find((entry) => entry.tab === 'toCharge');
          if (!first) continue;
          const [hotelCode = '', reservationNumber = ''] = mapKey.split('\u0000');
          rows.push({ key: { hotelCode, reservationNumber }, cells: returnCellsOf(first.row) });
        }
        const summary = await this.options.processReturns(rows, now);
        result.returnsReceived = summary.received;
        result.returnsChanged = summary.changed;
        result.problems += summary.problems;
      }

      // 2. Estado desejado e as diferenças.
      const lines = await listSheetLines(db);
      const plan = await this.plan(lines, entries, hotelNames, now);
      result.problems += plan.roundProblems.length;

      // 3. Tudo num pedido só.
      if (plan.changes.length > 0) await gateway.apply(plan.changes);
      result.linesWritten = plan.changes.length;

      await markLinesSynced(
        db,
        lines.map((line) => ({ key: line, version: line.version })),
        now,
      );
      await markLinesRemovedFromSheet(db, plan.removed, now);
      for (const issue of plan.issues) await setSheetIssue(db, issue.key, issue.text, now);
      await updateSheetState(db, {
        lastRoundOkAt: now,
        lastReadOkAt: now,
        lastErrorCode: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
        nextAttemptAt: null,
        roundProblems: plan.roundProblems,
      });
      result.ok = true;
      return result;
    } catch (error) {
      const code: SheetErrorCode = error instanceof SheetError ? error.code : 'sheet_unavailable';
      result.errorCode = code;
      if (!(error instanceof SheetError)) {
        // Erro do próprio servidor (ex.: banco): vai para o log, sem o objeto de erro da planilha.
        logger.error({ err: error }, 'falha inesperada na rodada da planilha do Comercial');
      } else {
        logger.warn({ code, status: error.status }, 'rodada da planilha do Comercial falhou');
      }
      await this.recordFailure(code, now).catch((stateError: unknown) => {
        logger.error({ err: stateError }, 'não foi possível registrar a falha da planilha');
      });
      return result;
    }
  }

  private async recordFailure(code: SheetErrorCode, now: Date): Promise<void> {
    const state = await getSheetState(this.options.db);
    const failures = state.consecutiveFailures + 1;
    const wait = this.retryMs[Math.min(failures - 1, this.retryMs.length - 1)] ?? 5 * MINUTE_MS;
    await updateSheetState(this.options.db, {
      lastErrorCode: code,
      lastErrorAt: now,
      consecutiveFailures: failures,
      nextAttemptAt: new Date(now.getTime() + wait),
    });
  }

  private async hotelNames(): Promise<Map<string, string>> {
    const rows = await this.options.db
      .select({ code: hotels.code, name: hotels.name })
      .from(hotels)
      .orderBy(asc(hotels.code));
    return sheetHotelNames(rows);
  }

  /** As linhas da planilha, agrupadas pela reserva; as que não casam com nenhum hotel à parte. */
  private entriesOf(
    snapshot: SheetSnapshot,
    codeByName: ReadonlyMap<string, string>,
  ): { byKey: Map<string, SheetEntry[]>; unmatched: SheetEntry[] } {
    const byKey = new Map<string, SheetEntry[]>();
    const unmatched: SheetEntry[] = [];
    for (const tab of SHEET_TABS) {
      const rows = snapshot[tab]?.rows ?? [];
      rows.forEach((row, rowIndex) => {
        if (rowIndex === 0 || isBlankRow(row)) return;
        const code = codeByName.get(asText(row[0]).trim());
        const reservationNumber = asText(row[1]).trim();
        const entry: SheetEntry = { tab, rowIndex, row };
        if (code === undefined || reservationNumber === '') {
          unmatched.push(entry);
          return;
        }
        const mapKey = commercialKeyOf({ hotelCode: code, reservationNumber });
        byKey.set(mapKey, [...(byKey.get(mapKey) ?? []), entry]);
      });
    }
    return { byKey, unmatched };
  }

  /** Compara a planilha com o banco e monta as mudanças (research R-06, R-07, R-15). */
  private async plan(
    lines: readonly SheetLineSource[],
    entries: { byKey: Map<string, SheetEntry[]>; unmatched: SheetEntry[] },
    hotelNames: ReadonlyMap<string, string>,
    now: Date,
  ): Promise<{
    changes: SheetChange[];
    removed: ReservationKey[];
    issues: Array<{ key: ReservationKey; text: string }>;
    roundProblems: SheetRoundProblem[];
  }> {
    const changes: SheetChange[] = [];
    const removed: ReservationKey[] = [];
    const issues: Array<{ key: ReservationKey; text: string }> = [];
    const roundProblems: SheetRoundProblem[] = [];
    const appends: Record<SheetTab, SheetCellValue[][]> = { toCharge: [], done: [] };
    const summaries = await loadTreatmentSummaries(this.options.db, lines);
    const retentionCutoff = now.getTime() - this.options.doneRetentionDays * DAY_MS;
    const handled = new Set<string>();

    for (const line of lines) {
      const mapKey = commercialKeyOf(line);
      handled.add(mapKey);
      const found = entries.byKey.get(mapKey) ?? [];
      // 90 dias em "Concluídas" ou reserva anonimizada: sai da planilha (FR-026, R-15).
      const expired =
        line.anonymized ||
        (line.state !== 'open' &&
          line.concludedAt !== null &&
          line.concludedAt.getTime() <= retentionCutoff);

      if (expired) {
        // 90 dias em "Concluídas": sai da planilha e continua no sistema (FR-026).
        for (const entry of found)
          changes.push({ kind: 'delete', tab: entry.tab, rowIndex: entry.rowIndex });
        removed.push(line);
        continue;
      }

      const target: SheetTab = line.state === 'open' ? 'toCharge' : 'done';
      const desired = sheetSystemRow({
        hotelName: hotelNames.get(line.hotelCode) ?? line.hotelCode,
        reservationNumber: line.reservationNumber,
        checkIn: line.checkIn,
        channel: line.channel,
        // Valor a cobrar: R$ 0,00 com a marcação "Cancelada sem cobrança" (specs/008, FR-020).
        totalAmount: amountToCharge(line.totalAmount, line.noChargeMarked),
        classification: line.classification,
        reservationStatus: line.reservationStatus,
        detailedSituation: this.situationOf(line, summaries),
        lineState: line.state,
        lastSentAt: line.lastSentAt,
        validation: this.validationOf(line, summaries),
      });

      const inTarget = found.filter((entry) => entry.tab === target);
      const elsewhere = found.filter((entry) => entry.tab !== target);
      const [kept, ...duplicates] = inTarget;
      for (const duplicate of duplicates) {
        changes.push({ kind: 'delete', tab: duplicate.tab, rowIndex: duplicate.rowIndex });
        roundProblems.push({
          kind: 'duplicate_line',
          hotelCode: line.hotelCode,
          reservationNumber: line.reservationNumber,
          message: 'Linha repetida na planilha: a cópia foi apagada.',
          at: now.toISOString(),
        });
      }

      if (kept) {
        const current = systemCellsOf(kept.row);
        if (desired.some((value, index) => current[index] !== value)) {
          changes.push({
            kind: 'update',
            tab: target,
            rowIndex: kept.rowIndex,
            columnIndex: 0,
            values: desired,
          });
          // Sem mudança nossa pendente, a diferença veio de fora: alguém mexeu na célula (FR-011).
          if (line.version === line.syncedVersion) {
            issues.push({
              key: line,
              text: 'Célula do sistema alterada na planilha e restaurada.',
            });
          }
        }
        for (const entry of elsewhere)
          changes.push({ kind: 'delete', tab: entry.tab, rowIndex: entry.rowIndex });
        continue;
      }

      // Linha nova na aba (envio novo, mudança de aba ou linha apagada por alguém).
      const source = elsewhere[0];
      const returnCells: SheetCellValue[] = source
        ? returnCellsSlice(source.row)
        : this.lastReadCells(line);
      appends[target].push([...desired, ...returnCells]);
      for (const entry of elsewhere)
        changes.push({ kind: 'delete', tab: entry.tab, rowIndex: entry.rowIndex });
      if (!source && line.syncedVersion > 0) {
        issues.push({ key: line, text: 'Linha apagada da planilha e reconstruída.' });
      }
    }

    // Linhas sem correspondência no sistema (R-07).
    for (const [mapKey, found] of entries.byKey) {
      if (handled.has(mapKey)) continue;
      entries.unmatched.push(...found);
    }
    for (const entry of entries.unmatched) {
      if (!hasAnyReturn(entry.row)) continue;
      roundProblems.push({
        kind: 'orphan_line',
        hotelCode: null,
        reservationNumber: asText(entry.row[1]).trim() || null,
        message: 'Linha com retorno preenchido sem envio correspondente no sistema.',
        at: now.toISOString(),
      });
    }

    for (const tab of SHEET_TABS) {
      if (appends[tab].length > 0) changes.push({ kind: 'append', tab, rows: appends[tab] });
    }
    return { changes, removed, issues, roundProblems };
  }

  private situationOf(
    line: SheetLineSource,
    summaries: Awaited<ReturnType<typeof loadTreatmentSummaries>>,
  ) {
    const summary = summaries.get(reservationKeyOf(line));
    const flags = summary
      ? treatmentFlags(summary)
      : { hasCurrentRequest: false, hasCurrentProof: false, hasReturnAwaiting: false };
    return detailedSituation(
      effectiveClassification(line.classification, line.noChargeMarked),
      treatmentStatus(flags),
      flags.hasReturnAwaiting,
    );
  }

  /**
   * O que a coluna "Validação do Financeiro" mostra (FR-010; specs/008, contracts/sheet-layout.md):
   * o problema do retorno; a marcação "Cancelada sem cobrança"; o retorno a validar ou confirmado; o
   * relato "Cobrada no Hunit" pela situação derivada da última leitura no Hunit (R-07) ou a
   * "Cancelada" aguardando ou recusada pelo Financeiro (R-19); e, sem nada disso, o de antes.
   */
  private validationOf(
    line: SheetLineSource,
    summaries: Awaited<ReturnType<typeof loadTreatmentSummaries>>,
  ): FinanceValidation {
    if (line.state === 'open' && line.returnProblem !== null) {
      return { kind: 'problem', text: line.returnProblem };
    }
    if (line.noChargeMarked && line.state !== 'cancelled') return { kind: 'no_charge' };
    const current = summaries.get(reservationKeyOf(line))?.commercial?.currentReturn ?? null;
    if (current?.state === 'awaiting_validation') return { kind: 'awaiting' };
    if (current?.state === 'confirmed') return { kind: 'confirmed' };
    if (line.report !== null && line.state !== 'cancelled') {
      if (line.report.kind === 'cancelled') {
        // Confirmada, a reserva está marcada ("no_charge", acima); aguardando ou recusada, aqui.
        if (line.state === 'open' && line.report.validationState === 'awaiting_validation') {
          return { kind: 'cancellation_awaiting' };
        }
        if (line.state === 'open' && line.report.validationState === 'rejected') {
          return {
            kind: 'rejected',
            reason: line.report.rejectionReason ?? 'sem motivo informado',
          };
        }
      } else {
        const status = hunitChargeStatus({
          readAt: line.report.readAt,
          lastVerifiedAt: line.lastVerifiedAt,
          hunitClassification: line.classification,
        });
        if (status === 'awaiting') return { kind: 'hunit_awaiting' };
        if (status === 'confirmed') return { kind: 'hunit_confirmed' };
        return { kind: 'rejected', reason: HUNIT_NOT_FOUND_REASON };
      }
    }
    if (line.state !== 'open') return { kind: 'none' };
    if (current?.state === 'rejected') {
      return { kind: 'rejected', reason: current.rejectionReason ?? 'sem motivo informado' };
    }
    // Enviada e sem retorno (ou com o retorno encerrado): a "nova tratativa", em lima (FR-010a).
    return { kind: 'awaiting_return' };
  }

  /**
   * Retorno ou relato já lido, para reconstruir uma linha apagada sem perder o que o Comercial
   * informou (a data volta como data da planilha, não como texto).
   */
  private lastReadCells(line: SheetLineSource): SheetCellValue[] {
    if (line.report !== null) {
      return [
        '',
        '',
        '',
        line.report.chargedBy ?? '',
        line.report.situationText,
        line.report.chargeDate === null ? '' : serialDate(line.report.chargeDate),
      ];
    }
    const values = line.lastReadReturn;
    if (!values) return [];
    return [
      values.authorizationCode,
      values.chargeHotel,
      Number(values.chargedAmount),
      values.chargedBy,
      values.chargeSituation ?? '',
      values.chargeDate === undefined ? '' : serialDate(values.chargeDate),
    ];
  }
}
