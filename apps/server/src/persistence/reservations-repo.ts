import {
  CLASSIFICATIONS_ACCEPTING_TREATMENT,
  CLASSIFICATIONS_REQUIRING_CHARGE,
  QUICK_FILTER_SITUATIONS,
  markNotFound,
  mergeVerification,
  selectNotFound,
  type Classification,
  type Period,
  type QuickFilter,
  type ReservationData,
  type ReservationDetailedSituation,
  type ReservationRecord,
  type ReservationSituation,
  type ReservationStatus,
  type TreatmentDocumentKind,
  type TreatmentStatus,
} from '@hunit/domain';
import {
  and,
  asc,
  between,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Database } from './db.js';
import type { HotelProgress } from './execution-hotels-repo.js';
import { InvalidCursorError } from './executions-repo.js';
import { noChargeMarkedCondition, qualified, refreshCommercialLinesOf } from './commercial-repo.js';
import {
  commercialLines,
  commercialReturns,
  executionHotels,
  hotels,
  legacyReservations,
  noChargeMarks,
  reservationManualAmounts,
  reservationObservations,
  reservations,
  treatmentDocuments,
  treatmentEvents,
} from './schema.js';

export type ReservationRow = typeof reservations.$inferSelect;
type ReservationInsert = typeof reservations.$inferInsert;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Linhas por comando de inserção (o PostgreSQL aceita no máximo 65 535 parâmetros por comando). */
const INSERT_BATCH = 500;

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += INSERT_BATCH) {
    result.push(items.slice(start, start + INSERT_BATCH));
  }
  return result;
}

/**
 * Linha do banco → registro do domínio (data do pagamento em ISO, como no domínio). Colunas que
 * o domínio não usa (ex.: `last_execution_id`) seguem junto e são ignoradas por ele.
 */
export function toReservationRecord(row: ReservationRow): ReservationRecord {
  const { chargedAt, ...rest } = row;
  return { ...rest, chargedAt: chargedAt ? chargedAt.toISOString() : null };
}

function toInsert(record: ReservationRecord, executionId: string): ReservationInsert {
  return {
    ...record,
    chargedAt: record.chargedAt ? new Date(record.chargedAt) : null,
    lastExecutionId: executionId,
  };
}

/**
 * Colunas atualizadas quando a reserva já existe: todas, menos a chave e a referência do outro
 * verificador — uma execução não apaga o último envio que verificou a reserva, nem um envio apaga a
 * última execução (specs/005, research R-02).
 */
function upsertSetWithout(
  keep: keyof ReservationInsert,
): Partial<Record<keyof ReservationInsert, SQL>> {
  return Object.fromEntries(
    Object.entries(getTableColumns(reservations))
      .filter(([key]) => key !== 'hotelCode' && key !== 'reservationNumber' && key !== keep)
      .map(([key, column]) => [key, sql.raw(`excluded.${column.name}`)]),
  );
}

const UPSERT_SET = upsertSetWithout('lastDispatchId');
const DISPATCH_UPSERT_SET = upsertSetWithout('lastExecutionId');

export interface HotelResult {
  executionId: string;
  hotelCode: string;
  /** Período consultado na execução (todo ele, não os blocos). */
  period: Period;
  /** Reservas vistas no hotel, uma por número (sem repetições). */
  reservations: readonly ReservationData[];
  progress: HotelProgress;
  now: Date;
}

export interface CommitSummary {
  inserted: number;
  updated: number;
  /** Reservas marcadas agora como "não encontradas na última verificação" (FR-018a). */
  markedNotFound: number;
}

/**
 * Grava o resultado de um hotel concluído numa única transação (FR-019, research R-15):
 * 1. inclui ou atualiza cada reserva com o histórico de verificação (FR-017, FR-018);
 * 2. registra o que esta execução observou (`reservation_observations`, FR-020);
 * 3. marca como "não encontradas" as reservas gravadas do hotel, com check-in no período, que
 *    não apareceram (FR-018a);
 * 4. marca o hotel como `completed`, com o andamento final.
 *
 * Se qualquer passo falhar, nada é gravado.
 */
export async function commitHotel(db: Database, result: HotelResult): Promise<CommitSummary> {
  const { executionId, hotelCode, period, now } = result;
  const numbers = [...new Set(result.reservations.map((item) => item.reservationNumber))];
  if (numbers.length !== result.reservations.length) {
    throw new Error('commitHotel recebeu a mesma reserva mais de uma vez.');
  }

  return db.transaction(async (tx) => {
    const existing = await lockHotelReservations(tx, hotelCode, numbers, period);
    const byNumber = new Map(existing.map((record) => [record.reservationNumber, record]));

    const merged = result.reservations.map((observed) =>
      mergeVerification(byNumber.get(observed.reservationNumber) ?? null, observed, now),
    );
    for (const batch of batches(merged)) {
      await tx
        .insert(reservations)
        .values(batch.map((record) => toInsert(record, executionId)))
        .onConflictDoUpdate({
          target: [reservations.hotelCode, reservations.reservationNumber],
          set: UPSERT_SET,
        });
    }

    for (const batch of batches(result.reservations)) {
      await tx.insert(reservationObservations).values(
        batch.map((observed) => ({
          executionId,
          hotelCode,
          reservationNumber: observed.reservationNumber,
          classification: observed.classification,
          reservationStatus: observed.reservationStatus,
          observedAt: now,
        })),
      );
    }

    const newlyMissing = selectNotFound(existing, new Set(numbers), period)
      .filter((record) => record.notFoundSince === null)
      .map((record) => markNotFound(record, now));
    for (const batch of batches(newlyMissing)) {
      await tx
        .update(reservations)
        .set({ notFoundSince: now })
        .where(
          and(
            eq(reservations.hotelCode, hotelCode),
            inArray(
              reservations.reservationNumber,
              batch.map((record) => record.reservationNumber),
            ),
            isNull(reservations.notFoundSince),
          ),
        );
    }

    // Reserva enviada ao Comercial que a execução mostra cobrada (ou que volta a exigir cobrança)
    // muda de aba na planilha (specs/005, FR-009).
    await refreshCommercialLinesOf(tx, hotelCode, numbers, now);

    await tx
      .update(executionHotels)
      .set({
        ...result.progress,
        counts: { ...result.progress.counts },
        status: 'completed',
        failureReason: null,
        finishedAt: now,
      })
      .where(
        and(eq(executionHotels.executionId, executionId), eq(executionHotels.hotelCode, hotelCode)),
      );

    const updated = merged.filter((record) => record.verificationCount > 1).length;
    return {
      inserted: merged.length - updated,
      updated,
      markedNotFound: newlyMissing.length,
    };
  });
}

/**
 * Grava uma reserva verificada por um envio ao Comercial (specs/005, FR-004; research R-02): a
 * mesma atualização de dados e de histórico de uma execução (FR-016 a FR-018b da 001), numa
 * transação com a reserva travada. Diferenças: grava `last_dispatch_id` (e não mexe em
 * `last_execution_id`), não cria `reservation_observations` e não marca "não encontrada".
 *
 * `within` roda na mesma transação, com a reserva já gravada: é onde o envio registra o desfecho
 * da reserva, a linha da planilha e o histórico (FR-007: cada reserva por inteiro ou nada).
 */
export async function commitVerifiedReservation(
  db: Database,
  input: {
    data: ReservationData;
    dispatchId: string;
    now: Date;
    within?: (tx: Transaction, record: ReservationRecord) => Promise<void>;
  },
): Promise<ReservationRecord> {
  const { data, dispatchId, now } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.hotelCode, data.hotelCode),
          eq(reservations.reservationNumber, data.reservationNumber),
        ),
      )
      .for('update');
    const merged = mergeVerification(row ? toReservationRecord(row) : null, data, now);
    await tx
      .insert(reservations)
      .values({
        ...merged,
        chargedAt: merged.chargedAt ? new Date(merged.chargedAt) : null,
        lastExecutionId: row?.lastExecutionId ?? null,
        lastDispatchId: dispatchId,
      })
      .onConflictDoUpdate({
        target: [reservations.hotelCode, reservations.reservationNumber],
        set: DISPATCH_UPSERT_SET,
      });
    if (input.within) await input.within(tx, merged);
    return merged;
  });
}

/**
 * Reservas gravadas do hotel que esta verificação pode alterar: as vistas agora e as com
 * check-in no período (candidatas a "não encontradas"). Ficam bloqueadas até o fim da transação.
 */
async function lockHotelReservations(
  tx: Transaction,
  hotelCode: string,
  numbers: readonly string[],
  period: Period,
): Promise<ReservationRecord[]> {
  const inPeriod = between(reservations.checkIn, period.from, period.to);
  const scope =
    numbers.length > 0
      ? or(inArray(reservations.reservationNumber, [...numbers]), inPeriod)
      : inPeriod;
  const rows = await tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.hotelCode, hotelCode), scope))
    .for('update');
  return rows.map(toReservationRecord);
}

// ---------------------------------------------------------------------------
// Consultas (FR-020)
// ---------------------------------------------------------------------------

export interface ReservationFilters {
  /** Somente reservas observadas nesta execução. */
  executionId?: string | undefined;
  hotelCodes?: readonly string[] | undefined;
  classifications?: readonly Classification[] | undefined;
  reservationStatuses?: readonly ReservationStatus[] | undefined;
  /** `true` = só as "não encontradas na última verificação"; `false` = só as encontradas. */
  notFound?: boolean | undefined;
  checkInFrom?: string | undefined;
  checkInTo?: string | undefined;
  /**
   * Busca livre (specs/002, FR-020a), já sem espaços nas pontas: número da reserva, transação,
   * código de autorização ou referência da operadora iguais ao texto, sem diferenciar
   * maiúsculas; ou o nome do hóspede contendo o texto, sem diferenciar maiúsculas e acentos.
   */
  q?: string | undefined;
  /** Canal exatamente igual (specs/002, FR-020). */
  channel?: string | undefined;
  /**
   * Valor total, valor cobrado ou valor cobrado informado à mão (specs/003) iguais, no formato da
   * API: "1234.56" (specs/002, FR-020b).
   */
  amount?: string | undefined;
  /** Situação da tratativa (specs/003, FR-015): qualquer uma das informadas. */
  treatmentStatuses?: readonly TreatmentStatus[] | undefined;
  /**
   * "Falta cobrar" (specs/003, FR-002): `true` = classificação que exige cobrança e sem
   * comprovante; `false` = o contrário.
   */
  pendingCharge?: boolean | undefined;
  /** Situação da reserva (specs/003, FR-002, research R-14): qualquer uma das informadas. */
  situations?: readonly ReservationSituation[] | undefined;
  /** Alerta "Verificar" (specs/003, FR-002a): `true` = só com o alerta; `false` = o contrário. */
  needsReview?: boolean | undefined;
  /**
   * Origem "Sistema anterior" (specs/004, FR-011): `true` = só as importadas, mesmo verificadas
   * depois; `false` = só as que não vieram de lá.
   */
  fromLegacy?: boolean | undefined;
  /** Situação detalhada, com "Validar comprovante" (specs/005, R-09): qualquer uma das informadas. */
  detailedSituations?: readonly ReservationDetailedSituation[] | undefined;
  /** Filtro rápido (specs/006, FR-016, research R-09): só as reservas do grupo. */
  quickFilter?: QuickFilter | undefined;
}

/**
 * Ordem da lista (specs/006, research R-18): `hotel_number` = hotel e número (a da 1.7.0);
 * `hotel_check_in` = hotel, check-in e número.
 */
/**
 * `amount_desc` (specs/007, research R-07): valor total do maior para o menor (sem valor no fim),
 * depois hotel e número. Nas reservas em aberto, o total é o valor a cobrar (a marcação "Cancelada
 * sem cobrança" tira a reserva de "Falta cobrar").
 */
export type ReservationOrder = 'hotel_number' | 'hotel_check_in' | 'amount_desc';

export interface ListReservationsOptions extends ReservationFilters {
  limit: number;
  /** Valor de `nextCursor` de uma página anterior, gerado com a mesma `order`. */
  cursor?: string | undefined;
  /** Sem ela, `hotel_number`. */
  order?: ReservationOrder | undefined;
}

export interface ReservationPageResult {
  items: ReservationRow[];
  nextCursor: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Posição de uma página na lista (specs/006, data-model §5): a ordem em que foi gerada e a chave da
 * última reserva nessa ordem.
 */
type CursorPosition =
  | { order: 'hotel_number'; hotelCode: string; reservationNumber: string }
  | { order: 'hotel_check_in'; hotelCode: string; checkIn: string; reservationNumber: string }
  | { order: 'amount_desc'; amount: string; hotelCode: string; reservationNumber: string };

/** Sem valor = −1: fica depois de qualquer valor na ordem decrescente. */
const NO_AMOUNT_KEY = '-1';
const AMOUNT_KEY = /^-?\d+(\.\d{1,2})?$/;

/** Chave da ordem `amount_desc`: o total, ou −1 sem valor. */
function amountKeySql(): SQL {
  return sql`coalesce(${reservations.totalAmount}, ${NO_AMOUNT_KEY}::numeric)`;
}

function encodeCursor(row: ReservationRow, order: ReservationOrder): string {
  const value =
    order === 'hotel_check_in'
      ? [order, row.hotelCode, row.checkIn, row.reservationNumber]
      : order === 'amount_desc'
        ? [order, row.totalAmount ?? NO_AMOUNT_KEY, row.hotelCode, row.reservationNumber]
        : [order, row.hotelCode, row.reservationNumber];
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Lê o cursor; o formato da 1.7.0 (`[hotel, número]`) vale como `hotel_number`. */
function decodeCursor(cursor: string): CursorPosition {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
      const parts = value;
      if (parts.length === 2) {
        const [hotelCode = '', reservationNumber = ''] = parts;
        return { order: 'hotel_number', hotelCode, reservationNumber };
      }
      if (parts.length === 3 && parts[0] === 'hotel_number') {
        const [, hotelCode = '', reservationNumber = ''] = parts;
        return { order: 'hotel_number', hotelCode, reservationNumber };
      }
      if (parts.length === 4 && parts[0] === 'amount_desc' && AMOUNT_KEY.test(parts[1] ?? '')) {
        const [, amount = '', hotelCode = '', reservationNumber = ''] = parts;
        return { order: 'amount_desc', amount, hotelCode, reservationNumber };
      }
      if (parts.length === 4 && parts[0] === 'hotel_check_in' && ISO_DATE.test(parts[2] ?? '')) {
        const [, hotelCode = '', checkIn = '', reservationNumber = ''] = parts;
        return { order: 'hotel_check_in', hotelCode, checkIn, reservationNumber };
      }
    }
  } catch {
    // Cai no erro abaixo.
  }
  throw new InvalidCursorError();
}

/** Reservas depois da posição do cursor, na ordem dele. */
function afterCursor(position: CursorPosition): SQL {
  if (position.order === 'amount_desc') {
    const key = amountKeySql();
    return sql`(${key} < ${position.amount}::numeric or (${key} = ${position.amount}::numeric and (${reservations.hotelCode}, ${reservations.reservationNumber}) > (${position.hotelCode}, ${position.reservationNumber})))`;
  }
  if (position.order === 'hotel_check_in') {
    return sql`(${reservations.hotelCode}, ${reservations.checkIn}, ${reservations.reservationNumber}) > (${position.hotelCode}, ${position.checkIn}::date, ${position.reservationNumber})`;
  }
  return sql`(${reservations.hotelCode}, ${reservations.reservationNumber}) > (${position.hotelCode}, ${position.reservationNumber})`;
}

/** Colunas do `order by` de cada ordem (a última coluna desempata: a chave é única). */
function orderColumns(order: ReservationOrder): SQL[] {
  if (order === 'amount_desc') {
    return [
      sql`${amountKeySql()} desc`,
      asc(reservations.hotelCode),
      asc(reservations.reservationNumber),
    ];
  }
  return order === 'hotel_check_in'
    ? [asc(reservations.hotelCode), asc(reservations.checkIn), asc(reservations.reservationNumber)]
    : [asc(reservations.hotelCode), asc(reservations.reservationNumber)];
}

/**
 * Condição da busca livre (specs/002, FR-020a). Os códigos comparam o texto inteiro, sem
 * diferenciar maiúsculas. O nome usa `strpos` em vez de `like`: assim `%` e `_` digitados são
 * texto, não curinga. Nome nulo (anonimizado, FR-026 da 001) nunca coincide.
 */
function freeTextCondition(text: string): SQL {
  return sql`(lower(${reservations.reservationNumber}) = lower(${text})
    or lower(${reservations.transactionId}) = lower(${text})
    or lower(${reservations.authorizationCode}) = lower(${text})
    or lower(${reservations.processorReference}) = lower(${text})
    or ${confirmedReturnCodeCondition(text)}
    or (${reservations.anonymizedAt} is null
      and strpos(unaccent(lower(${reservations.guestName})), unaccent(lower(${text}))) > 0))`;
}

/**
 * O código de autorização do retorno do Comercial confirmado pelo Financeiro é o texto inteiro, sem
 * diferenciar maiúsculas, como o código do Hunit (specs/008, US7, FR-029). Retorno aguardando
 * validação, recusado, substituído ou com a confirmação desfeita não conta.
 *
 * Subconsulta sem correlação: o banco monta uma vez o conjunto das reservas com aquele código (um
 * "hashed SubPlan"), em vez de procurar o retorno de cada reserva. As colunas da reserva vão com o
 * nome da tabela, como nas outras condições usadas dentro de subconsultas.
 */
function confirmedReturnCodeCondition(text: string): SQL {
  return sql`(${qualified(reservations.hotelCode)}, ${qualified(reservations.reservationNumber)}) in (
    select cr.hotel_code, cr.reservation_number from ${commercialReturns} cr
    where cr.state = 'confirmed' and lower(cr.authorization_code) = lower(${text}))`;
}

/** A reserva tem um documento vigente desse tipo? (specs/003: `ended_at` nulo = vigente.) */
function hasVigenteDocument(kind: TreatmentDocumentKind): SQL {
  return sql`exists (select 1 from ${treatmentDocuments} td where td.hotel_code = ${reservations.hotelCode} and td.reservation_number = ${reservations.reservationNumber} and td.kind = ${kind} and td.ended_at is null)`;
}

/**
 * A reserva tem tratativa? Documento de tratativa vigente (specs/003) ou linha na planilha do
 * Comercial que não foi cancelada (specs/005, research R-09; mesma regra de `treatmentFlags`).
 */
function hasRequestCondition(): SQL {
  return sql`(${hasVigenteDocument('request')} or exists (select 1 from ${commercialLines} cl where cl.hotel_code = ${reservations.hotelCode} and cl.reservation_number = ${reservations.reservationNumber} and cl.state <> 'cancelled'))`;
}

/**
 * A reserva tem comprovante? Documento de comprovante vigente (specs/003) ou retorno do Comercial
 * confirmado pelo Financeiro (specs/005, FR-016).
 */
function hasProofCondition(): SQL {
  return sql`(${hasVigenteDocument('proof')} or ${commercialReturnCondition('confirmed')})`;
}

function commercialReturnCondition(state: 'confirmed' | 'awaiting_validation'): SQL {
  return sql`exists (select 1 from ${commercialReturns} cr where cr.hotel_code = ${reservations.hotelCode} and cr.reservation_number = ${reservations.reservationNumber} and cr.state = ${state})`;
}

/** Condição de cada situação da tratativa (specs/003, FR-002; mesma regra de `treatmentStatus`). */
function treatmentStatusCondition(status: TreatmentStatus): SQL {
  const hasProof = hasProofCondition();
  const hasRequest = hasRequestCondition();
  if (status === 'charged') return hasProof;
  if (status === 'sent') return sql`(${hasRequest} and not ${hasProof})`;
  return sql`(not ${hasRequest} and not ${hasProof})`;
}

/**
 * "Falta cobrar" (specs/003, FR-002; mesma regra de `isPendingCharge`): a classificação exige
 * cobrança — a lista vem do domínio, sem "A revisar (sistema anterior)" (specs/004, FR-007a) — e
 * a reserva não tem comprovante. "Validar comprovante" continua aqui (specs/005, clarify Q1).
 */
function pendingChargeCondition(): SQL {
  return sql`(${requiresChargeCondition()} and not ${hasProofCondition()})`;
}

/**
 * Classificação efetiva (specs/008, research R-08; mesma regra de `effectiveClassification`): com a
 * marcação "Cancelada sem cobrança" ativa, `cancelled_no_charge`; senão, a do Hunit. Vale para
 * situação, pendências, filtros rápidos e contagens; o filtro `classification` continua sendo o do
 * Hunit.
 */
function effectiveClassificationSql(): SQL {
  return sql`(case when ${noChargeMarkedCondition()} then 'cancelled_no_charge' else ${reservations.classification}::text end)`;
}

function classificationListSql(list: readonly Classification[]): SQL {
  return sql.join(
    list.map((value) => sql`${value}`),
    sql`, `,
  );
}

/** A classificação (efetiva) aceita tratativa? (Lista do domínio, FR-003.) */
function acceptsTreatmentCondition(): SQL {
  return sql`${effectiveClassificationSql()} in (${classificationListSql(CLASSIFICATIONS_ACCEPTING_TREATMENT)})`;
}

/** A classificação (efetiva) exige cobrança? (Mesma regra de `requiresCharge`, specs/004, R-04.) */
function requiresChargeCondition(): SQL {
  return sql`${effectiveClassificationSql()} in (${classificationListSql(CLASSIFICATIONS_REQUIRING_CHARGE)})`;
}

/** A reserva veio do sistema anterior? (specs/004, FR-011.) */
function fromLegacyCondition(): SQL {
  return sql`exists (select 1 from ${legacyReservations} lr where lr.hotel_code = ${reservations.hotelCode} and lr.reservation_number = ${reservations.reservationNumber})`;
}

/**
 * Condição de cada situação da reserva (specs/003, FR-002; mesma regra de
 * `reservationSituation`): exatamente as reservas que a coluna mostra com essa situação.
 */
function situationCondition(situation: ReservationSituation): SQL {
  const hasProof = hasProofCondition();
  const hasRequest = hasRequestCondition();
  if (situation === 'proof_sent') return hasProof;
  if (situation === 'treatment_sent') {
    return sql`(${hasRequest} and not ${hasProof} and ${requiresChargeCondition()})`;
  }
  // Uma classificação que exige cobrança só aparece sem tratativa; as outras, com ou sem.
  const shown = CLASSIFICATIONS_REQUIRING_CHARGE.includes(situation)
    ? sql`(not ${hasProof} and not ${hasRequest})`
    : sql`(not ${hasProof})`;
  return sql`(${effectiveClassificationSql()} = ${situation} and ${shown})`;
}

/**
 * Alerta "Verificar" (specs/003, FR-002a; mesma regra de `needsReview`): só tratativa,
 * classificação que não aceita tratativa (por isso "A revisar (sistema anterior)" fica de fora,
 * specs/004) e nenhuma confirmação desde a última mudança de situação.
 */
function needsReviewCondition(): SQL {
  // Marcada como cancelada sem cobrança: o Financeiro já decidiu, sem alerta (specs/008).
  return sql`(${hasRequestCondition()} and not ${hasProofCondition()} and not ${acceptsTreatmentCondition()} and not ${reviewedSinceChangeCondition()} and not ${noChargeMarkedCondition()})`;
}

/** Alguém confirmou o "Verificar" depois da última mudança de situação no Hunit? (specs/003.) */
function reviewedSinceChangeCondition(): SQL {
  return sql`exists (select 1 from ${treatmentEvents} te where te.hotel_code = ${reservations.hotelCode} and te.reservation_number = ${reservations.reservationNumber} and te.type = 'review_confirmed' and te.at >= coalesce(${reservations.statusChangedAt}, '-infinity'::timestamptz))`;
}

/**
 * Condição de cada situação detalhada (specs/005, research R-09; mesma regra de
 * `detailedSituation`): "Validar comprovante" é a parte de "Tratativa enviada" com retorno do
 * Comercial aguardando validação.
 */
function detailedSituationCondition(situation: ReservationDetailedSituation): SQL {
  const awaiting = commercialReturnCondition('awaiting_validation');
  if (situation === 'return_pending') {
    return sql`(${situationCondition('treatment_sent')} and ${awaiting})`;
  }
  if (situation === 'treatment_sent') {
    return sql`(${situationCondition('treatment_sent')} and not ${awaiting})`;
  }
  return situationCondition(situation);
}

/**
 * Fatos da tratativa de que os filtros rápidos dependem (specs/006, research R-09). Na lista, são as
 * subconsultas de cada reserva; nas contagens, colunas calculadas uma vez por reserva (cada grupo
 * repetiria as mesmas subconsultas, e a contagem de 20 000 reservas passaria de 1 s).
 */
export interface TreatmentFacts {
  /** Classificação efetiva (specs/008). */
  classification: SQL;
  hasRequest: SQL;
  hasProof: SQL;
  awaitingReturn: SQL;
  reviewedSinceChange: SQL;
  /** Marcação "Cancelada sem cobrança" ativa (specs/008). */
  noChargeMarked: SQL;
}

function inlineFacts(): TreatmentFacts {
  return {
    classification: effectiveClassificationSql(),
    hasRequest: hasRequestCondition(),
    hasProof: hasProofCondition(),
    awaitingReturn: commercialReturnCondition('awaiting_validation'),
    reviewedSinceChange: reviewedSinceChangeCondition(),
    noChargeMarked: noChargeMarkedCondition(),
  };
}

/** A classificação está na lista? */
function classificationIn(facts: TreatmentFacts, list: readonly Classification[]): SQL {
  return sql`${facts.classification} in (${sql.join(
    list.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/**
 * Situação detalhada como expressão SQL (mesma regra de `detailedSituation` do domínio):
 * comprovante → "Tratativa enviada" (ou "Validar comprovante", com retorno aguardando) enquanto a
 * classificação exige cobrança → a própria classificação.
 */
function detailedSituationExpression(facts: TreatmentFacts): SQL {
  return sql`(case
    when ${facts.hasProof} then 'proof_sent'
    when ${facts.hasRequest} and ${classificationIn(facts, CLASSIFICATIONS_REQUIRING_CHARGE)}
      then (case when ${facts.awaitingReturn} then 'return_pending' else 'treatment_sent' end)
    else ${facts.classification}::text
  end)`;
}

/**
 * Condição de cada filtro rápido sobre os fatos da tratativa (specs/006, research R-09; mesma regra
 * de `quickFiltersOf`): as listas de situações vêm do domínio, e o teste de paridade confere
 * contagens × lista × domínio.
 */
function quickFilterOver(filter: QuickFilter, facts: TreatmentFacts): SQL {
  // "Falta cobrar": exige cobrança e sem comprovante (`isPendingCharge`).
  if (filter === 'pending_charge') {
    return sql`(${classificationIn(facts, CLASSIFICATIONS_REQUIRING_CHARGE)} and not ${facts.hasProof})`;
  }
  const situations = QUICK_FILTER_SITUATIONS[filter].map((value) => sql`${value}`);
  const inGroup = sql`${detailedSituationExpression(facts)} in (${sql.join(situations, sql`, `)})`;
  if (filter !== 'to_review') return inGroup;
  // Alerta "Verificar" (`needsReview`): só tratativa, classificação que não aceita tratativa e
  // nenhuma confirmação desde a última mudança de situação.
  const needsReview = sql`(${facts.hasRequest} and not ${facts.hasProof} and not ${classificationIn(facts, CLASSIFICATIONS_ACCEPTING_TREATMENT)} and not ${facts.reviewedSinceChange} and not ${facts.noChargeMarked})`;
  return sql`(${needsReview} or ${inGroup})`;
}

function quickFilterCondition(filter: QuickFilter): SQL {
  return quickFilterOver(filter, inlineFacts());
}

/**
 * Reservas com filtros combináveis (FR-020), em ordem de hotel e número, paginadas por cursor.
 * Os filtros de classificação e situação valem para o estado atual da reserva.
 *
 * @throws InvalidCursorError
 */
/** As condições SQL dos filtros combináveis (FR-020), comuns à lista e à seleção do filtro. */
/**
 * Condições dos filtros da lista (FR-020). Exportada para o relatório usar os mesmos filtros
 * (specs/007, FR-005a, research R-14).
 */
export function filterConditions(options: ReservationFilters): SQL[] {
  const conditions: SQL[] = [];
  const has = <T>(values: readonly T[] | undefined): values is readonly T[] =>
    values !== undefined && values.length > 0;

  if (options.executionId !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${reservationObservations} o where o.execution_id = ${options.executionId} and o.hotel_code = ${reservations.hotelCode} and o.reservation_number = ${reservations.reservationNumber})`,
    );
  }
  if (has(options.hotelCodes))
    conditions.push(inArray(reservations.hotelCode, [...options.hotelCodes]));
  if (has(options.classifications)) {
    conditions.push(inArray(reservations.classification, [...options.classifications]));
  }
  if (has(options.reservationStatuses)) {
    conditions.push(inArray(reservations.reservationStatus, [...options.reservationStatuses]));
  }
  if (options.notFound === true) conditions.push(isNotNull(reservations.notFoundSince));
  if (options.notFound === false) conditions.push(isNull(reservations.notFoundSince));
  if (options.checkInFrom !== undefined) {
    conditions.push(sql`${reservations.checkIn} >= ${options.checkInFrom}`);
  }
  if (options.checkInTo !== undefined) {
    conditions.push(sql`${reservations.checkIn} <= ${options.checkInTo}`);
  }
  if (options.q !== undefined) conditions.push(freeTextCondition(options.q));
  if (options.channel !== undefined) conditions.push(eq(reservations.channel, options.channel));
  if (options.amount !== undefined) {
    const amountCondition = or(
      eq(reservations.totalAmount, options.amount),
      eq(reservations.chargedAmount, options.amount),
      sql`exists (select 1 from ${reservationManualAmounts} ma where ma.hotel_code = ${reservations.hotelCode} and ma.reservation_number = ${reservations.reservationNumber} and ma.amount = ${options.amount})`,
      // Valor informado pelo Comercial e confirmado (specs/005, FR-024).
      sql`exists (select 1 from ${commercialReturns} cr where cr.hotel_code = ${reservations.hotelCode} and cr.reservation_number = ${reservations.reservationNumber} and cr.state = 'confirmed' and cr.charged_amount = ${options.amount})`,
    );
    if (amountCondition) conditions.push(amountCondition);
  }
  if (has(options.treatmentStatuses)) {
    const anyStatus = or(...options.treatmentStatuses.map(treatmentStatusCondition));
    if (anyStatus) conditions.push(anyStatus);
  }
  if (options.pendingCharge === true) conditions.push(pendingChargeCondition());
  if (options.pendingCharge === false) conditions.push(not(pendingChargeCondition()));
  if (has(options.situations)) {
    const anySituation = or(...options.situations.map(situationCondition));
    if (anySituation) conditions.push(anySituation);
  }
  if (options.needsReview === true) conditions.push(needsReviewCondition());
  if (options.needsReview === false) conditions.push(not(needsReviewCondition()));
  if (has(options.detailedSituations)) {
    const anyDetailed = or(...options.detailedSituations.map(detailedSituationCondition));
    if (anyDetailed) conditions.push(anyDetailed);
  }
  if (options.fromLegacy === true) conditions.push(fromLegacyCondition());
  if (options.fromLegacy === false) conditions.push(not(fromLegacyCondition()));
  if (options.quickFilter !== undefined) conditions.push(quickFilterCondition(options.quickFilter));
  return conditions;
}

export async function listReservations(
  db: Database,
  options: ListReservationsOptions,
): Promise<ReservationPageResult> {
  const order = options.order ?? 'hotel_number';
  const conditions = filterConditions(options);
  if (options.cursor !== undefined) {
    const position = decodeCursor(options.cursor);
    // Cursor gerado com outra ordem: a posição não vale nesta (specs/006, R-18).
    if (position.order !== order) throw new InvalidCursorError();
    conditions.push(afterCursor(position));
  }

  // Lê um registro a mais para saber se existe uma próxima página.
  const rows = await db
    .select()
    .from(reservations)
    .where(and(...conditions))
    .orderBy(...orderColumns(order))
    .limit(options.limit + 1);

  const items = rows.slice(0, options.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > options.limit && last ? encodeCursor(last, order) : null,
  };
}

/**
 * Todas as reservas de um filtro, até `max`, na ordem da lista, e quantas o filtro encontrou
 * (specs/005, FR-030 — "selecionar todas do filtro" e a cópia para e-mail, FR-027). Desde a 006,
 * na ordem pedida (research R-18).
 */
export async function selectReservations(
  db: Database,
  filters: ReservationFilters,
  max: number,
  order: ReservationOrder = 'hotel_number',
): Promise<{ rows: Array<ReservationRow & { hotelName: string }>; total: number }> {
  const where = and(...filterConditions(filters));
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(reservations)
    .where(where);
  const rows = await db
    .select({ reservation: reservations, hotelName: hotels.name })
    .from(reservations)
    .innerJoin(hotels, eq(hotels.code, reservations.hotelCode))
    .where(where)
    .orderBy(...orderColumns(order))
    .limit(max);
  return {
    rows: rows.map(({ reservation, hotelName }) => ({ ...reservation, hotelName })),
    total: count?.total ?? 0,
  };
}

/** Contagem de cada filtro rápido (specs/006, FR-017): `all` = "Todas". */
export interface QuickFilterCounts {
  all: number;
  pendingCharge: number;
  toReview: number;
  withError: number;
  done: number;
}

/**
 * Reservas de cada filtro rápido com os mesmos filtros da lista, numa consulta só (specs/006,
 * FR-017, research R-09). O `quickFilter` dos filtros, se vier, é ignorado: cada grupo é contado.
 *
 * Os fatos da tratativa saem de junções com os documentos, as linhas, os retornos e as revisões já
 * agrupados por reserva, uma vez por reserva, numa CTE materializada (sem o `materialized`, o
 * PostgreSQL repetiria as expressões em cada `filter`). As regras são as de `hasRequestCondition`,
 * `hasProofCondition`, `commercialReturnCondition` e `reviewedSinceChangeCondition`, que a lista
 * usa; o teste de paridade confere contagens × lista × domínio. Com subconsultas por reserva, a
 * contagem de 20 000 reservas levava 0,6 s.
 */
export async function countQuickFilters(
  db: Database,
  filters: ReservationFilters,
): Promise<QuickFilterCounts> {
  const where = and(...filterConditions({ ...filters, quickFilter: undefined })) ?? sql`true`;
  const columns = treatmentFactsColumns();
  const count = (filter: QuickFilter) =>
    sql`(count(*) filter (where ${quickFilterOver(filter, columns)}))::int`;
  const result = await db.execute<{ [K in keyof QuickFilterCounts]: number }>(sql`
    ${treatmentFactsCte(where)}
    select count(*)::int as "all",
      ${count('pending_charge')} as "pendingCharge",
      ${count('to_review')} as "toReview",
      ${count('with_error')} as "withError",
      ${count('done')} as "done"
    from facts`);
  return result.rows[0] ?? { all: 0, pendingCharge: 0, toReview: 0, withError: 0, done: 0 };
}

/** Os fatos da tratativa como colunas da CTE `facts` (`treatmentFactsCte`). */
export function treatmentFactsColumns(): TreatmentFacts {
  return {
    classification: sql.raw('facts.classification'),
    hasRequest: sql.raw('facts.has_request'),
    hasProof: sql.raw('facts.has_proof'),
    awaitingReturn: sql.raw('facts.awaiting_return'),
    reviewedSinceChange: sql.raw('facts.reviewed_since_change'),
    noChargeMarked: sql.raw('facts.no_charge_marked'),
  };
}

/** Expressão da situação detalhada sobre os fatos (a mesma da lista). */
export function factsDetailedSituation(facts: TreatmentFacts): SQL {
  return detailedSituationExpression(facts);
}

/**
 * CTE `facts` com os fatos da tratativa de cada reserva que atende a `where`, uma linha por
 * reserva (specs/006, research R-09; extraída na specs/007, research R-04, para o relatório usar a
 * mesma regra das contagens). Os fatos saem de junções com os documentos, as linhas, os retornos,
 * as revisões, as marcações e o valor informado à mão já agrupados por reserva, numa CTE
 * materializada (sem o `materialized`, o PostgreSQL repetiria as expressões em cada `filter`). As
 * regras são as de `hasRequestCondition`, `hasProofCondition`, `commercialReturnCondition`,
 * `reviewedSinceChangeCondition` e `noChargeMarkedCondition`, que a lista usa; o teste de paridade
 * confere contagens × lista × domínio. Com subconsultas por reserva, a contagem de 20 000 reservas
 * levava 0,6 s.
 *
 * Colunas além dos fatos (specs/007): `hotel_code`, `check_in`, `last_verified_at`,
 * `total_amount`, `amount_to_charge` (R$ 0,00 com a marcação, `amountToCharge`) e
 * `charged_amount_shown` (a regra de `chargedAmountWithOrigin`: o do Hunit, se maior que zero; o
 * informado à mão, com comprovante; o do retorno do Comercial confirmado).
 */
export function treatmentFactsCte(where: SQL): SQL {
  const sameReservation = (alias: string) =>
    sql`${sql.raw(alias)}.hotel_code = ${reservations.hotelCode} and ${sql.raw(alias)}.reservation_number = ${reservations.reservationNumber}`;
  return sql`
    with qf_documents as (
      select hotel_code, reservation_number,
        bool_or(kind = 'request') as has_request, bool_or(kind = 'proof') as has_proof
      from ${treatmentDocuments}
      where ended_at is null
      group by hotel_code, reservation_number
    ),
    qf_lines as (
      select distinct hotel_code, reservation_number
      from ${commercialLines}
      where state <> 'cancelled'
    ),
    qf_returns as (
      select hotel_code, reservation_number,
        bool_or(state = 'confirmed') as confirmed,
        bool_or(state = 'awaiting_validation') as awaiting,
        max(charged_amount) filter (where state = 'confirmed') as confirmed_amount
      from ${commercialReturns}
      group by hotel_code, reservation_number
    ),
    qf_reviews as (
      select hotel_code, reservation_number, max(at) as last_at
      from ${treatmentEvents}
      where type = 'review_confirmed'
      group by hotel_code, reservation_number
    ),
    qf_marks as (
      select distinct hotel_code, reservation_number
      from ${noChargeMarks}
      where undone_at is null
    ),
    facts as materialized (
      select ${reservations.hotelCode} as hotel_code,
        ${reservations.checkIn} as check_in,
        ${reservations.lastVerifiedAt} as last_verified_at,
        ${reservations.totalAmount} as total_amount,
        (case when qm.hotel_code is not null then 0::numeric(12, 2)
          else ${reservations.totalAmount} end) as amount_to_charge,
        (case
          when ${reservations.chargedAmount} > 0 then ${reservations.chargedAmount}
          when (coalesce(qd.has_proof, false) or coalesce(qr.confirmed, false)) and qa.amount is not null
            then qa.amount
          else qr.confirmed_amount
        end) as charged_amount_shown,
        (case when qm.hotel_code is not null then 'cancelled_no_charge'
          else ${reservations.classification}::text end) as classification,
        (qm.hotel_code is not null) as no_charge_marked,
        (coalesce(qd.has_request, false) or ql.hotel_code is not null) as has_request,
        (coalesce(qd.has_proof, false) or coalesce(qr.confirmed, false)) as has_proof,
        coalesce(qr.awaiting, false) as awaiting_return,
        coalesce(qv.last_at >= coalesce(${reservations.statusChangedAt}, '-infinity'::timestamptz), false)
          as reviewed_since_change
      from ${reservations}
      left join qf_documents qd on ${sameReservation('qd')}
      left join qf_lines ql on ${sameReservation('ql')}
      left join qf_returns qr on ${sameReservation('qr')}
      left join qf_reviews qv on ${sameReservation('qv')}
      left join qf_marks qm on ${sameReservation('qm')}
      left join ${reservationManualAmounts} qa on ${sameReservation('qa')}
      where ${where}
    )`;
}

/** Canais presentes nas reservas gravadas, em ordem alfabética (specs/002, filtro da FR-020). */
export async function listChannels(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ channel: reservations.channel })
    .from(reservations)
    .orderBy(asc(reservations.channel));
  return rows.map((row) => row.channel);
}

export async function findReservation(
  db: Database,
  hotelCode: string,
  reservationNumber: string,
): Promise<ReservationRow | null> {
  const [row] = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.hotelCode, hotelCode),
        eq(reservations.reservationNumber, reservationNumber),
      ),
    );
  return row ?? null;
}
