/**
 * Schema do banco de dados (specs/001, data-model.md) — PostgreSQL é a fonte da verdade
 * (constitution, princípio VI).
 *
 * Nenhuma tabela guarda senha, token 2FA, usuário ou sessão do Hunit (FR-005).
 *
 * Este arquivo é lido pelo drizzle-kit para gerar as migrations, por isso só importa do
 * drizzle-orm. Os valores de `classification` e `reservation_status` repetem as listas de
 * `@hunit/domain`; um teste confere que continuam iguais.
 *
 * Mudou o schema? Gere uma nova migration: `pnpm --filter @hunit/server db:generate`.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const isoDate = (name: string) => date(name, { mode: 'string' });
/** Valores monetários em BRL: `numeric(12,2)`, lidos como string decimal (research R-17). */
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

// ---------------------------------------------------------------------------
// Enumerações
// ---------------------------------------------------------------------------

/** Nível de acesso de um cliente autorizado (FR-007). */
export const clientRoleEnum = pgEnum('client_role', ['operator', 'reader']);

/** Estados de uma execução (constitution, princípio IV). */
export const executionStatusEnum = pgEnum('execution_status', [
  'queued',
  'running',
  'awaiting_2fa',
  'completed',
  'failed',
  'cancelled',
]);

/** Motivo de encerramento de uma execução que falhou ou foi cancelada (FR-003). */
export const executionEndReasonEnum = pgEnum('execution_end_reason', [
  'invalid_credentials',
  'invalid_token',
  'two_factor_timeout',
  'hunit_unavailable',
  'hunit_screen_not_recognized',
  'session_expired',
  'server_restarted',
  'cancelled_by_client',
  'internal_error',
]);

/** Situação de um hotel dentro de uma execução (FR-021). */
export const hotelRunStatusEnum = pgEnum('hotel_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Situação de cobrança de uma reserva (FR-013). `not_virtual_card` é obsoleta (research R-22): não
 * é mais gravada, mas fica no tipo para os registros anteriores.
 */
export const classificationEnum = pgEnum('classification', [
  'ignored_hotelbeds_258',
  'invoiced',
  'charge_at_terminal',
  'cancelled_no_charge',
  'not_virtual_card',
  'virtual_card_charge_error',
  'virtual_card_already_charged',
  'virtual_card_validated_only',
  'virtual_card_pending_charge',
  'analysis_error',
]);

/** Situação da reserva no Hunit (FR-014a). */
export const reservationStatusEnum = pgEnum('reservation_status', [
  'active',
  'cancelled',
  'unknown',
]);

/** Tipo de evidência de falha (FR-024). */
export const evidenceKindEnum = pgEnum('evidence_kind', [
  'navigation_failure',
  'classification_failure',
  'screen_not_recognized',
  'reservation_status_unknown',
]);

export type ClientRole = (typeof clientRoleEnum.enumValues)[number];
export type ExecutionStatus = (typeof executionStatusEnum.enumValues)[number];
export type ExecutionEndReason = (typeof executionEndReasonEnum.enumValues)[number];
export type HotelRunStatus = (typeof hotelRunStatusEnum.enumValues)[number];
export type EvidenceKind = (typeof evidenceKindEnum.enumValues)[number];

/** Estados em que uma execução conta como ativa para a regra "uma por conta" (FR-006). */
export const ACTIVE_EXECUTION_STATUSES = [
  'queued',
  'running',
  'awaiting_2fa',
] as const satisfies readonly ExecutionStatus[];

export function isActiveExecutionStatus(status: ExecutionStatus): boolean {
  return (ACTIVE_EXECUTION_STATUSES as readonly ExecutionStatus[]).includes(status);
}

/** Quantidade de reservas por classificação. Classificações sem reservas podem faltar. */
export type ClassificationCounts = Partial<
  Record<(typeof classificationEnum.enumValues)[number], number>
>;

// ---------------------------------------------------------------------------
// Tabelas
// ---------------------------------------------------------------------------

/** Cliente autorizado a usar a API (FR-007). A chave em si nunca é guardada, só o hash. */
export const apiClients = pgTable('api_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  role: clientRoleEnum('role').notNull(),
  /** SHA-256 (hexadecimal) da chave de API. */
  keyHash: text('key_hash').notNull().unique(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  /** Preenchido = cliente revogado; a chave deixa de ser aceita. */
  revokedAt: timestamptz('revoked_at'),
});

/** Catálogo de hotéis da conta do Hunit (FR-008). */
export const hotels = pgTable('hotels', {
  /** Identificador do hotel no Hunit. */
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  firstSeenAt: timestamptz('first_seen_at').notNull().defaultNow(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  /** `true` enquanto alguma conta do Hunit acessar o hotel (linha em `account_hotels`). */
  available: boolean('available').notNull().default(true),
});

/**
 * Catálogo de cada conta do Hunit: contas diferentes podem acessar hotéis diferentes (FR-008,
 * FR-009a). A conta é o mesmo HMAC de `executions.account_key` (research R-11).
 */
export const accountHotels = pgTable(
  'account_hotels',
  {
    accountKey: text('account_key').notNull(),
    hotelCode: text('hotel_code')
      .notNull()
      .references(() => hotels.code),
    /** Última leitura do catálogo da conta que trouxe o hotel. */
    lastSeenAt: timestamptz('last_seen_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountKey, table.hotelCode] })],
);

/** Execução: uma solicitação de consulta (FR-001 a FR-006, FR-021 a FR-023). */
export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** HMAC do usuário do Hunit: identifica a conta sem guardar o usuário (research R-11). */
    accountKey: text('account_key').notNull(),
    /** Cliente que iniciou a execução. */
    clientId: uuid('client_id')
      .notNull()
      .references(() => apiClients.id),
    /** Preenchido nas retomadas: execução original (FR-023). */
    parentExecutionId: uuid('parent_execution_id').references((): AnyPgColumn => executions.id),
    periodFrom: isoDate('period_from').notNull(),
    periodTo: isoDate('period_to').notNull(),
    /** `null` = todos os hotéis do catálogo (FR-009). */
    requestedHotelCodes: text('requested_hotel_codes').array(),
    status: executionStatusEnum('status').notNull().default('queued'),
    endReason: executionEndReasonEnum('end_reason'),
    /** Prazo para o operador enviar o token; preenchido ao entrar em `awaiting_2fa` (FR-004). */
    twoFactorDeadline: timestamptz('two_factor_deadline'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    /** Cliente que cancelou a execução, para auditoria (FR-007). */
    cancelledByClientId: uuid('cancelled_by_client_id').references(() => apiClients.id),
  },
  (table) => [
    check('executions_period_check', sql`${table.periodFrom} <= ${table.periodTo}`),
    check(
      'executions_end_reason_check',
      sql`${table.status} not in ('failed', 'cancelled') or ${table.endReason} is not null`,
    ),
    // No máximo uma execução ativa por conta do Hunit (FR-006).
    uniqueIndex('executions_one_active_per_account')
      .on(table.accountKey)
      .where(sql`${table.status} in ('queued', 'running', 'awaiting_2fa')`),
    // Cada execução é retomada no máximo uma vez; a retomada seguinte parte da última da
    // sequência, para nenhum hotel concluído ser consultado de novo (FR-023, SC-007).
    uniqueIndex('executions_one_resume_per_parent').on(table.parentExecutionId),
  ],
);

/** Processamento de um hotel dentro de uma execução (FR-019, FR-021, FR-021a). */
export const executionHotels = pgTable(
  'execution_hotels',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    hotelCode: text('hotel_code')
      .notNull()
      .references(() => hotels.code),
    status: hotelRunStatusEnum('status').notNull().default('pending'),
    /** Descoberto a partir do próprio resultado da consulta (FR-011). */
    pagesTotal: integer('pages_total'),
    pagesDone: integer('pages_done'),
    /**
     * Reservas que o Hunit informou na listagem (soma dos blocos do período já consultados);
     * base das "reservas ainda não processadas" da estimativa (research R-08a).
     */
    reservationsTotal: integer('reservations_total').notNull().default(0),
    reservationsSeen: integer('reservations_seen').notNull().default(0),
    /** Reservas efetivamente lidas (exclui as "258-"); base do tempo médio (research R-08a). */
    reservationsOpened: integer('reservations_opened').notNull().default(0),
    counts: jsonb('counts').$type<ClassificationCounts>().notNull().default({}),
    failureReason: text('failure_reason'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
  },
  (table) => [primaryKey({ columns: [table.executionId, table.hotelCode] })],
);

/** Eventos de uma execução, para acompanhamento em tempo real (FR-021). */
export const executionEvents = pgTable(
  'execution_events',
  {
    /** Ordem dos eventos; usado como `id` das mensagens SSE. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    at: timestamptz('at').notNull().defaultNow(),
    /** Ex.: `status_changed`, `hotel_started`, `page_done`, `reservation_classified`. */
    type: text('type').notNull(),
    /** Novo estado da execução, nos eventos `status_changed`. */
    status: executionStatusEnum('status'),
    hotelCode: text('hotel_code'),
    reservationNumber: text('reservation_number'),
    /** Nunca contém credenciais nem nome de hóspede. */
    message: text('message').notNull(),
  },
  (table) => [index('execution_events_execution_id_idx').on(table.executionId, table.id)],
);

/** Reserva, com a situação atual e o histórico de verificações (FR-016 a FR-018a, FR-026). */
export const reservations = pgTable(
  'reservations',
  {
    hotelCode: text('hotel_code')
      .notNull()
      .references(() => hotels.code),
    reservationNumber: text('reservation_number').notNull(),
    /** `null` depois da anonimização (FR-026). */
    guestName: text('guest_name'),
    channel: text('channel').notNull(),
    checkIn: isoDate('check_in').notNull(),
    checkOut: isoDate('check_out').notNull(),
    /** Período da hospedagem como exibido no Hunit. */
    stayPeriod: text('stay_period').notNull(),
    totalAmount: money('total_amount').notNull(),
    reservationStatus: reservationStatusEnum('reservation_status').notNull(),
    classification: classificationEnum('classification').notNull(),
    /** Motivo que determinou a classificação (FR-014). */
    reason: text('reason').notNull(),
    prePaymentFound: boolean('pre_payment_found').notNull(),
    /** Último evento de pagamento: "Cobrado em" ou, se só validou o cartão, "Validado em". */
    chargedAt: timestamptz('charged_at'),
    chargedBy: text('charged_by'),
    chargedAmount: money('charged_amount'),
    transactionId: text('transaction_id'),
    authorizationCode: text('authorization_code'),
    processorReference: text('processor_reference'),
    isInstallment: boolean('is_installment'),
    installmentCount: integer('installment_count'),
    installmentAmount: money('installment_amount'),
    prePaymentState: text('pre_payment_state'),
    prePaymentMessage: text('pre_payment_message'),
    /** Apenas um sinal para a classificação; a ação nunca é acionada (FR-012). */
    chargeActionVisible: boolean('charge_action_visible').notNull(),
    /** Forma de pagamento como o Hunit informa; `null` = não informada (FR-016, research R-22). */
    paymentForm: text('payment_form'),
    firstVerifiedAt: timestamptz('first_verified_at').notNull(),
    lastVerifiedAt: timestamptz('last_verified_at').notNull(),
    verificationCount: integer('verification_count').notNull().default(1),
    /** Campos alterados na última verificação. */
    changedFields: text('changed_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** A classificação ou a situação da reserva mudou na última verificação. */
    statusChanged: boolean('status_changed').notNull().default(false),
    previousClassification: classificationEnum('previous_classification'),
    previousReservationStatus: reservationStatusEnum('previous_reservation_status'),
    statusChangedAt: timestamptz('status_changed_at'),
    /** Preenchido = "não encontrada na última verificação" (FR-018a). */
    notFoundSince: timestamptz('not_found_since'),
    lastExecutionId: uuid('last_execution_id')
      .notNull()
      .references(() => executions.id),
    anonymizedAt: timestamptz('anonymized_at'),
  },
  (table) => [
    primaryKey({ columns: [table.hotelCode, table.reservationNumber] }),
    check('reservations_verification_count_check', sql`${table.verificationCount} >= 1`),
    index('reservations_classification_idx').on(table.classification),
    index('reservations_reservation_status_idx').on(table.reservationStatus),
    index('reservations_hotel_check_in_idx').on(table.hotelCode, table.checkIn),
    index('reservations_not_found_since_idx')
      .on(table.notFoundSince)
      .where(sql`${table.notFoundSince} is not null`),
    // Usado pela rotina de anonimização (FR-026/FR-027).
    index('reservations_check_in_not_anonymized_idx')
      .on(table.checkIn)
      .where(sql`${table.anonymizedAt} is null`),
  ],
);

/** O que cada execução observou em cada reserva (FR-020, consulta "por execução"). */
export const reservationObservations = pgTable(
  'reservation_observations',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    classification: classificationEnum('classification').notNull(),
    reservationStatus: reservationStatusEnum('reservation_status').notNull(),
    observedAt: timestamptz('observed_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.executionId, table.hotelCode, table.reservationNumber] }),
    foreignKey({
      name: 'reservation_observations_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
  ],
);

/** Evidência de uma falha (FR-024), guardada por tempo limitado (FR-025). */
export const evidence = pgTable(
  'evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id),
    hotelCode: text('hotel_code'),
    reservationNumber: text('reservation_number'),
    kind: evidenceKindEnum('kind').notNull(),
    reason: text('reason').notNull(),
    // Caminhos relativos à pasta de evidências (EVIDENCE_DIR).
    screenshotPath: text('screenshot_path'),
    htmlPath: text('html_path'),
    /** Resposta do Hunit que não foi reconhecida (falhas da coleta pela rede). */
    responsePath: text('response_path'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** `created_at` + dias de retenção; depois disso a rotina diária remove a evidência. */
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    check(
      'evidence_has_file_check',
      sql`num_nonnulls(${table.screenshotPath}, ${table.htmlPath}, ${table.responsePath}) >= 1`,
    ),
    index('evidence_expires_at_idx').on(table.expiresAt),
  ],
);
