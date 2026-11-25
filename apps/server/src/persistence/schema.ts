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
  customType,
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
/** Conteúdo binário (`bytea`), lido e gravado como `Buffer` (specs/003, research R-01). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

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

/**
 * Tipo de documento de uma tratativa (specs/003): `request` = tratativa (pedido de cobrança),
 * `proof` = comprovante de cobrança. Repete `TREATMENT_DOCUMENT_KINDS` de `@hunit/domain`.
 */
export const treatmentDocumentKindEnum = pgEnum('treatment_document_kind', ['request', 'proof']);

/**
 * Estado de um documento (specs/003, data-model §2): atual, substituído, desfeito ou purgado
 * (arquivo apagado pela retenção; o registro fica).
 */
export const treatmentDocumentStateEnum = pgEnum('treatment_document_state', [
  'current',
  'replaced',
  'removed',
  'purged',
]);

/**
 * Tipo de evento do histórico das tratativas (specs/003, FR-012). `review_confirmed` = o operador
 * confirmou o alerta "Verificar" (FR-002a, research R-14).
 */
export const treatmentEventTypeEnum = pgEnum('treatment_event_type', [
  'attached',
  'replaced',
  'removed',
  'reverted',
  'amount_set',
  'amount_cleared',
  'review_confirmed',
]);

/** Simulação ou importação do histórico do sistema anterior (specs/004, data-model §1.1). */
export const legacyImportKindEnum = pgEnum('legacy_import_kind', ['simulation', 'import']);

/** Situação de uma simulação ou importação (specs/004, research R-09). */
export const legacyImportStatusEnum = pgEnum('legacy_import_status', [
  'running',
  'completed',
  'failed',
  'interrupted',
]);

/** Associação de um hotel do sistema anterior ao catálogo (specs/004, FR-006a, research R-10). */
export const legacyHotelDecisionEnum = pgEnum('legacy_hotel_decision', [
  'proposed',
  'confirmed',
  'unmapped',
]);

/**
 * Desfecho de cada reserva num envio ao Comercial (specs/005, FR-005; data-model §1.2).
 * `ignored` = não aceitou o envio na conferência feita ao criá-lo; nasce assim.
 */
export const dispatchItemOutcomeEnum = pgEnum('dispatch_item_outcome', [
  'pending',
  'sent',
  'withdrawn',
  'not_verified',
  'ignored',
  // Só em verificações da fila "Cobradas no Hunit" (specs/008, research R-07): ver `check_result`.
  'checked',
]);

/**
 * Propósito de um envio (specs/008, research R-07): `send` = envio ao Comercial (005);
 * `hunit_check` = "Verificar agora" da fila "Cobradas no Hunit" (lê sem abrir linha).
 */
export const dispatchPurposeEnum = pgEnum('dispatch_purpose', ['send', 'hunit_check']);

/** Resultado de um item `checked` de uma verificação (specs/008, data-model §2). */
export const hunitCheckResultEnum = pgEnum('hunit_check_result', ['confirmed', 'not_found']);

/** Situação da cobrança reconhecida no retorno (specs/008, research R-06). Repete `ChargeSituationKind`. */
export const chargeSituationKindEnum = pgEnum('charge_situation_kind', [
  'charged_at_terminal',
  'charged_in_hunit',
  // Era `not_charged` ("Não cobrada"); renomeado na homologação (research R-19, migration 0014).
  'cancelled',
  'other',
]);

/** Relato do Comercial sem retorno de cobrança (specs/008, data-model §1.2; R-19). */
export const commercialReportKindEnum = pgEnum('commercial_report_kind', [
  'charged_in_hunit',
  'cancelled',
]);

/** Validação da "Cancelada" pelo Financeiro (homologação da 008, research R-19). */
export const commercialReportValidationEnum = pgEnum('commercial_report_validation', [
  'awaiting_validation',
  'confirmed',
  'rejected',
]);

/** Linha da reserva na planilha do Comercial (specs/005, FR-009). Repete `COMMERCIAL_LINE_STATES`. */
export const commercialLineStateEnum = pgEnum('commercial_line_state', [
  'open',
  'concluded',
  'cancelled',
]);

/** Retorno do Comercial (specs/005, data-model §1.5 e §4). */
export const commercialReturnStateEnum = pgEnum('commercial_return_state', [
  'awaiting_validation',
  'confirmed',
  'rejected',
  'superseded',
  'closed',
]);

/** Histórico do Comercial por reserva (specs/005, FR-020; data-model §1.6). */
export const commercialEventTypeEnum = pgEnum('commercial_event_type', [
  'dispatched',
  'withdrawn',
  'line_cancelled',
  'line_restored',
  'line_concluded',
  'return_received',
  'return_changed',
  'return_ignored',
  'return_confirmed',
  'return_rejected',
  'return_confirmation_undone',
  'return_closed',
  // Ajustes de cobrança (specs/008, data-model §2): relatos e a verificação no Hunit.
  'report_received',
  'report_changed',
  'report_cleared',
  'hunit_checked',
  // A "Cancelada" confirmada ou recusada pelo Financeiro (homologação, R-19).
  'cancellation_confirmed',
  'cancellation_rejected',
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
    /** `null` só em reserva importada sem total, até a primeira verificação (specs/004, FR-008). */
    totalAmount: money('total_amount'),
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
    /**
     * Última execução que verificou a reserva. `null` = reserva só do sistema anterior, ainda não
     * verificada pelo HUNIT Control (specs/004, research R-06).
     */
    lastExecutionId: uuid('last_execution_id').references(() => executions.id),
    /**
     * Último envio ao Comercial que verificou a reserva no Hunit (specs/005, research R-02).
     * "Verificada pelo HUNIT Control" = `last_execution_id` ou `last_dispatch_id` preenchido.
     */
    lastDispatchId: uuid('last_dispatch_id').references((): AnyPgColumn => commercialDispatches.id),
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
    /** Execução dona da evidência; ou o envio ao Comercial (specs/005): exatamente um dos dois. */
    executionId: uuid('execution_id').references(() => executions.id),
    dispatchId: uuid('dispatch_id').references((): AnyPgColumn => commercialDispatches.id),
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
    check('evidence_owner_check', sql`num_nonnulls(${table.executionId}, ${table.dispatchId}) = 1`),
    index('evidence_expires_at_idx').on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Tratativas manuais (specs/003, data-model.md) — camada ao lado da reserva: o coletor do Hunit
// não lê nem grava nenhuma destas tabelas (FR-007).
// ---------------------------------------------------------------------------

/**
 * Conteúdo dos arquivos das tratativas (research R-01). A chave é o SHA-256 do conteúdo: o mesmo
 * arquivo aplicado a várias reservas é guardado uma vez só. Fica no banco para entrar nas cópias
 * de segurança e ser gravado na mesma transação do registro (FR-010, FR-011).
 */
export const treatmentFiles = pgTable(
  'treatment_files',
  {
    /** SHA-256 do conteúdo, em hexadecimal minúsculo; é o `fileId` da API. */
    sha256: text('sha256').primaryKey(),
    content: bytea('content').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Decidido pelo servidor a partir do conteúdo (research R-03), nunca pelo cliente. */
    mediaType: text('media_type').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Quem enviou esse conteúdo pela primeira vez. */
    uploadedByClientId: uuid('uploaded_by_client_id')
      .notNull()
      .references(() => apiClients.id),
  },
  (table) => [
    check('treatment_files_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    // 1 byte a 25 MiB (FR-008).
    check(
      'treatment_files_size_check',
      sql`${table.sizeBytes} = octet_length(${table.content}) and ${table.sizeBytes} between 1 and 26214400`,
    ),
  ],
);

/**
 * Documento de uma reserva: a tratativa ou o comprovante (FR-001). "Vigente" = `ended_at` nulo:
 * é o documento que define a situação exibida. Um documento vigente purgado pela retenção
 * (reserva anonimizada, FR-016) continua vigente — fica o registro de que houve o documento.
 */
export const treatmentDocuments = pgTable(
  'treatment_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    kind: treatmentDocumentKindEnum('kind').notNull(),
    state: treatmentDocumentStateEnum('state').notNull().default('current'),
    /** `null` só depois da purga. */
    fileSha256: text('file_sha256').references(() => treatmentFiles.sha256),
    /** Nome como escolhido pelo operador; `null` só depois da purga (pode ter dados pessoais). */
    originalName: text('original_name'),
    // Copiados do arquivo para listar sem ler o conteúdo; mantidos depois da purga.
    sizeBytes: integer('size_bytes').notNull(),
    mediaType: text('media_type').notNull(),
    attachedAt: timestamptz('attached_at').notNull().defaultNow(),
    attachedByClientId: uuid('attached_by_client_id')
      .notNull()
      .references(() => apiClients.id),
    /** Quando deixou de ser o vigente (substituído ou desfeito). */
    endedAt: timestamptz('ended_at'),
    endedByClientId: uuid('ended_by_client_id').references(() => apiClients.id),
    purgedAt: timestamptz('purged_at'),
    /** Preenchido = importado do sistema anterior por esta importação (specs/004, FR-016). */
    legacyImportId: uuid('legacy_import_id').references((): AnyPgColumn => legacyImports.id),
  },
  (table) => [
    foreignKey({
      name: 'treatment_documents_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    check(
      'treatment_documents_state_check',
      sql`(${table.state} = 'current' and ${table.endedAt} is null)
        or (${table.state} in ('replaced', 'removed') and ${table.endedAt} is not null)
        or ${table.state} = 'purged'`,
    ),
    check(
      'treatment_documents_purged_check',
      sql`(${table.state} = 'purged') = (${table.fileSha256} is null)
        and (${table.state} = 'purged') = (${table.originalName} is null)
        and (${table.state} = 'purged') = (${table.purgedAt} is not null)`,
    ),
    check(
      'treatment_documents_ended_by_check',
      sql`(${table.endedAt} is null) = (${table.endedByClientId} is null)`,
    ),
    // No máximo um documento vigente por reserva e tipo (research R-05).
    uniqueIndex('treatment_documents_one_current')
      .on(table.hotelCode, table.reservationNumber, table.kind)
      .where(sql`${table.endedAt} is null`),
    index('treatment_documents_reservation_idx').on(table.hotelCode, table.reservationNumber),
    // Usado pela purga diária dos substituídos e desfeitos (research R-07).
    index('treatment_documents_ended_at_idx')
      .on(table.endedAt)
      .where(sql`${table.state} in ('replaced', 'removed')`),
    index('treatment_documents_file_idx').on(table.fileSha256),
  ],
);

/** Valor cobrado informado à mão (FR-005). Remover o valor apaga a linha; o histórico fica. */
export const reservationManualAmounts = pgTable(
  'reservation_manual_amounts',
  {
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    amount: money('amount').notNull(),
    setAt: timestamptz('set_at').notNull().defaultNow(),
    setByClientId: uuid('set_by_client_id')
      .notNull()
      .references(() => apiClients.id),
    /** Preenchido = valor vindo do sistema anterior (specs/004, FR-015). */
    legacyImportId: uuid('legacy_import_id').references((): AnyPgColumn => legacyImports.id),
  },
  (table) => [
    primaryKey({ columns: [table.hotelCode, table.reservationNumber] }),
    foreignKey({
      name: 'reservation_manual_amounts_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    check('reservation_manual_amounts_amount_check', sql`${table.amount} > 0`),
  ],
);

/**
 * Histórico das tratativas (FR-012): só inclusão — nenhuma ação dos operadores altera ou apaga
 * uma linha. Não guarda nome de arquivo, para a retenção apagar os nomes num lugar só (R-06).
 */
export const treatmentEvents = pgTable(
  'treatment_events',
  {
    /** Ordem dos eventos. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    type: treatmentEventTypeEnum('type').notNull(),
    /** Preenchido nos eventos de documento. */
    kind: treatmentDocumentKindEnum('kind'),
    /** Documento que ficou vigente (`attached`, `replaced`, `reverted`) ou que deixou de ser (`removed`). */
    documentId: uuid('document_id').references(() => treatmentDocuments.id),
    /** Documento que foi substituído (`replaced`, `reverted`). */
    previousDocumentId: uuid('previous_document_id').references(() => treatmentDocuments.id),
    /** Preenchido nos eventos de valor. */
    amount: money('amount'),
    /** Só em `review_confirmed`: o status do Hunit que o operador confirmou (research R-14). */
    classification: classificationEnum('classification'),
    /** Mesmo valor para tudo o que foi gravado no mesmo pedido em lote (research R-05). */
    batchId: uuid('batch_id'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => apiClients.id),
    at: timestamptz('at').notNull().defaultNow(),
    /** Preenchido = evento criado pela importação do sistema anterior (specs/004, FR-016). */
    legacyImportId: uuid('legacy_import_id').references((): AnyPgColumn => legacyImports.id),
  },
  (table) => [
    foreignKey({
      name: 'treatment_events_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    index('treatment_events_reservation_idx').on(
      table.hotelCode,
      table.reservationNumber,
      table.id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Importação do histórico do sistema anterior (specs/004, data-model.md). Nenhuma tabela guarda
// conteúdo de célula da planilha que o HUNIT Control já não guardaria numa reserva (FR-018).
// ---------------------------------------------------------------------------

/** Quantidades por desfecho (data-model §4). */
export interface LegacyOutcomeCounts {
  created: number;
  updated: number;
  ignored: number;
  rejected: number;
}

/** Contagens de uma simulação ou importação, por entidade e desfecho (data-model §1.1). */
export interface LegacyImportCounts {
  reservations: LegacyOutcomeCounts;
  requests: LegacyOutcomeCounts;
  proofs: LegacyOutcomeCounts;
  manualAmounts: LegacyOutcomeCounts;
  unreferencedFiles: number;
}

/** Entidade de um desfecho: a reserva, a tratativa, o comprovante ou o valor manual. */
export type LegacyImportEntity = 'reservation' | 'request' | 'proof' | 'manual_amount';

/** Ignorado ou recusado: só códigos, números de linha e chaves, nunca valores (FR-018). */
export interface LegacyImportIssue {
  sheet: 'Reservas' | 'Tratativas';
  row: number;
  legacyHotel: string;
  reservationNumber: string;
  entity: LegacyImportEntity;
  outcome: 'ignored' | 'rejected';
  reason: string;
  /** Nome da coluna, quando ajuda (nunca o valor). */
  column?: string;
  /** Só em `import_failed`: código do erro e regra ou tabela do banco (nunca valores). */
  detail?: string;
}

/** Aviso geral, com a quantidade de casos. */
export interface LegacyImportWarningEntry {
  code: string;
  count: number;
}

/** Desfecho que mudou entre a simulação e a importação (FR-005a). */
export interface LegacyImportDifference {
  legacyHotel: string;
  reservationNumber: string;
  entity: LegacyImportEntity;
  simulated: string;
  imported: string;
}

/** Cada simulação ou importação (FR-005, FR-005a). */
export const legacyImports = pgTable(
  'legacy_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: legacyImportKindEnum('kind').notNull(),
    /** Só em `import`: a simulação confirmada. */
    simulationId: uuid('simulation_id').references((): AnyPgColumn => legacyImports.id),
    status: legacyImportStatusEnum('status').notNull().default('running'),
    /** SHA-256 da planilha + arquivos referenciados + associação de hotéis (research R-08). */
    fingerprint: text('fingerprint').notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    counts: jsonb('counts').$type<LegacyImportCounts>(),
    issues: jsonb('issues').$type<LegacyImportIssue[]>().notNull().default([]),
    differences: jsonb('differences').$type<LegacyImportDifference[]>(),
    warnings: jsonb('warnings').$type<LegacyImportWarningEntry[]>().notNull().default([]),
    /**
     * Desfecho de cada entidade, por chave `código do hotel|reserva|entidade` (ex.: `created`,
     * `rejected:file_not_found`), para a importação apontar o que mudou desde a simulação
     * (FR-005a). Só códigos e chaves (FR-018).
     */
    outcomes: jsonb('outcomes').$type<Record<string, string>>().notNull().default({}),
  },
  (table) => [
    check(
      'legacy_imports_simulation_check',
      sql`(${table.kind} = 'import') = (${table.simulationId} is not null)`,
    ),
    check(
      'legacy_imports_finished_check',
      sql`(${table.status} = 'running') = (${table.finishedAt} is null)`,
    ),
  ],
);

/** Associação de cada hotel do sistema anterior a um hotel do catálogo (FR-006a, R-10). */
export const legacyHotelMappings = pgTable(
  'legacy_hotel_mappings',
  {
    /** "Codigo hotel" do sistema anterior (minúsculas com "_"). */
    legacyKey: text('legacy_key').primaryKey(),
    /** "Hotel" da última simulação. */
    legacyName: text('legacy_name').notNull(),
    decision: legacyHotelDecisionEnum('decision').notNull().default('proposed'),
    hotelCode: text('hotel_code').references(() => hotels.code),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'legacy_hotel_mappings_decision_check',
      sql`(${table.decision} <> 'confirmed' or ${table.hotelCode} is not null)
        and (${table.decision} <> 'unmapped' or ${table.hotelCode} is null)`,
    ),
  ],
);

/**
 * Origem "Sistema anterior" de uma reserva (FR-010, FR-011): ter linha aqui é a marcação, para
 * sempre, mesmo depois de verificada pelo HUNIT Control. Não tem dado pessoal; a retenção não a
 * apaga.
 */
export const legacyReservations = pgTable(
  'legacy_reservations',
  {
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    legacyHotelKey: text('legacy_hotel_key').notNull(),
    /** "Codigo status" como estava na planilha (pode ser um valor desconhecido). */
    originalClassification: text('original_classification').notNull(),
    originalPreviousClassification: text('original_previous_classification'),
    firstVerifiedAt: timestamptz('first_verified_at').notNull(),
    lastVerifiedAt: timestamptz('last_verified_at').notNull(),
    verificationCount: integer('verification_count').notNull(),
    /** `true` = já verificada pelo HUNIT Control quando foi importada (FR-010). */
    merged: boolean('merged').notNull(),
    /** Quanto foi somado a `reservations.verification_count` por esta origem (research R-06). */
    appliedCount: integer('applied_count').notNull(),
    /** SHA-256 dos valores normalizados da linha (FR-010a). */
    rowHash: text('row_hash').notNull(),
    firstImportId: uuid('first_import_id')
      .notNull()
      .references(() => legacyImports.id),
    lastImportId: uuid('last_import_id')
      .notNull()
      .references(() => legacyImports.id),
  },
  (table) => [
    primaryKey({ columns: [table.hotelCode, table.reservationNumber] }),
    foreignKey({
      name: 'legacy_reservations_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    check('legacy_reservations_verification_count_check', sql`${table.verificationCount} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// Envio dos pedidos de cobrança ao Comercial pela planilha (specs/005, data-model.md). Nenhuma
// tabela guarda o nome do hóspede: ele continua só em `reservations` (FR-010).
// ---------------------------------------------------------------------------

/** Envio ao Comercial: um job com os estados de uma execução (FR-001 a FR-007; research R-01). */
export const commercialDispatches = pgTable(
  'commercial_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** HMAC do usuário do Hunit, como nas execuções (research R-11 da 001). */
    accountKey: text('account_key').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => apiClients.id),
    /** Preenchido nas retomadas: o envio original (FR-007). */
    parentDispatchId: uuid('parent_dispatch_id').references(
      (): AnyPgColumn => commercialDispatches.id,
    ),
    status: executionStatusEnum('status').notNull().default('queued'),
    endReason: executionEndReasonEnum('end_reason'),
    twoFactorDeadline: timestamptz('two_factor_deadline'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    cancelledByClientId: uuid('cancelled_by_client_id').references(() => apiClients.id),
    /** Envio ao Comercial ou verificação da fila "Cobradas no Hunit" (specs/008, R-07). */
    purpose: dispatchPurposeEnum('purpose').notNull().default('send'),
  },
  (table) => [
    check(
      'commercial_dispatches_end_reason_check',
      sql`${table.status} not in ('failed', 'cancelled') or ${table.endReason} is not null`,
    ),
    // Uma automação por conta (constitution IV). Entre execuções e envios, quem garante é a trava
    // da conta na criação (research R-01); este índice garante dentro dos envios.
    uniqueIndex('commercial_dispatches_one_active_per_account')
      .on(table.accountKey)
      .where(sql`${table.status} in ('queued', 'running', 'awaiting_2fa')`),
    uniqueIndex('commercial_dispatches_one_resume_per_parent').on(table.parentDispatchId),
    index('commercial_dispatches_created_at_idx').on(table.createdAt, table.id),
  ],
);

/**
 * Cada reserva de um envio e o desfecho (data-model §1.2). Sem chave estrangeira para
 * `reservations`: uma reserva pedida que não existe fica registrada como `ignored/not_found`.
 */
export const commercialDispatchItems = pgTable(
  'commercial_dispatch_items',
  {
    dispatchId: uuid('dispatch_id')
      .notNull()
      .references(() => commercialDispatches.id),
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    /** Ordem de processamento (a da seleção), começando em 1. */
    position: integer('position').notNull(),
    outcome: dispatchItemOutcomeEnum('outcome').notNull().default('pending'),
    classificationBefore: classificationEnum('classification_before'),
    classificationAfter: classificationEnum('classification_after'),
    /** Motivo de `withdrawn`, `not_verified` ou `ignored`; nunca com dado pessoal. */
    reason: text('reason'),
    processedAt: timestamptz('processed_at'),
    /** Só em `checked` (verificação, specs/008): o Hunit mostra ou não a cobrança. */
    checkResult: hunitCheckResultEnum('check_result'),
  },
  (table) => [
    primaryKey({ columns: [table.dispatchId, table.hotelCode, table.reservationNumber] }),
    // Comparado como texto: um valor novo de enum não pode ser usado na mesma transação que o cria.
    check(
      'commercial_dispatch_items_check_result_check',
      sql`(${table.checkResult} is not null) = (${table.outcome}::text = 'checked')`,
    ),
    check('commercial_dispatch_items_position_check', sql`${table.position} >= 1`),
    check(
      'commercial_dispatch_items_processed_check',
      sql`(${table.outcome} = 'pending') = (${table.processedAt} is null)`,
    ),
    index('commercial_dispatch_items_reservation_idx').on(table.hotelCode, table.reservationNumber),
  ],
);

/** Eventos de um envio, para o acompanhamento em tempo real (SSE), como `execution_events`. */
export const commercialDispatchEvents = pgTable(
  'commercial_dispatch_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dispatchId: uuid('dispatch_id')
      .notNull()
      .references(() => commercialDispatches.id),
    at: timestamptz('at').notNull().defaultNow(),
    /** `status_changed`, `item_processed` ou `warning`. */
    type: text('type').notNull(),
    status: executionStatusEnum('status'),
    hotelCode: text('hotel_code'),
    reservationNumber: text('reservation_number'),
    /** Nunca contém credenciais nem nome de hóspede. */
    message: text('message').notNull(),
  },
  (table) => [index('commercial_dispatch_events_dispatch_id_idx').on(table.dispatchId, table.id)],
);

/** Retorno lido da planilha, já normalizado (research R-08). Só para detectar mudanças. */
export interface StoredReturnValues {
  authorizationCode: string;
  chargeHotel: string;
  chargedAmount: string;
  chargedBy: string;
  /** Situação da cobrança normalizada (specs/008); ausente nas leituras da 005. */
  chargeSituation?: string;
  /** Data da cobrança ISO (specs/008); ausente nas leituras da 005. */
  chargeDate?: string;
}

/**
 * A linha de cada reserva enviada na planilha do Comercial: o estado desejado da projeção
 * (FR-008 a FR-013; research R-06). `version > synced_version` = escrita pendente.
 */
export const commercialLines = pgTable(
  'commercial_lines',
  {
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    state: commercialLineStateEnum('state').notNull().default('open'),
    firstSentAt: timestamptz('first_sent_at').notNull(),
    lastSentAt: timestamptz('last_sent_at').notNull(),
    lastDispatchId: uuid('last_dispatch_id')
      .notNull()
      .references(() => commercialDispatches.id),
    lastSentByClientId: uuid('last_sent_by_client_id')
      .notNull()
      .references(() => apiClients.id),
    /** Quando foi para "Concluídas" (`concluded` ou `cancelled`); limpo ao voltar para "A cobrar". */
    concludedAt: timestamptz('concluded_at'),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledByClientId: uuid('cancelled_by_client_id').references(() => apiClients.id),
    /** Saiu da planilha (90 dias depois de concluída, ou anonimização; research R-15). */
    removedFromSheetAt: timestamptz('removed_from_sheet_at'),
    version: integer('version').notNull().default(1),
    syncedVersion: integer('synced_version').notNull().default(0),
    /** Última mudança que pede escrita na planilha. */
    changedAt: timestamptz('changed_at').notNull(),
    syncedAt: timestamptz('synced_at'),
    /** Últimos valores lidos das colunas de retorno, normalizados (research R-08). */
    lastReadReturn: jsonb('last_read_return').$type<StoredReturnValues>(),
    /** Problema atual do retorno (incompleto, não entendido), sem dado do hóspede (FR-018). */
    returnProblem: text('return_problem'),
    returnProblemAt: timestamptz('return_problem_at'),
    /** Último caso relatado na linha (restaurada, alterada) (FR-011). */
    sheetIssue: text('sheet_issue'),
    sheetIssueAt: timestamptz('sheet_issue_at'),
  },
  (table) => [
    primaryKey({ columns: [table.hotelCode, table.reservationNumber] }),
    foreignKey({
      name: 'commercial_lines_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    check(
      'commercial_lines_cancelled_check',
      sql`(${table.state} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.cancelledAt} is null) = (${table.cancelledByClientId} is null)`,
    ),
    check(
      'commercial_lines_concluded_check',
      sql`(${table.state} = 'open') = (${table.concludedAt} is null)`,
    ),
    check(
      'commercial_lines_version_check',
      sql`${table.version} >= 1 and ${table.syncedVersion} between 0 and ${table.version}`,
    ),
    // Linhas com escrita pendente (FR-013).
    index('commercial_lines_pending_idx')
      .on(table.changedAt)
      .where(sql`${table.syncedVersion} < ${table.version}`),
  ],
);

/** Retorno preenchido pelo Comercial na planilha (FR-014 a FR-019; data-model §1.5). */
export const commercialReturns = pgTable(
  'commercial_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    authorizationCode: text('authorization_code').notNull(),
    /** "Hotel da cobrança": o estabelecimento da maquininha, texto livre (clarify 2026-11-17). */
    chargeHotel: text('charge_hotel').notNull(),
    chargedAmount: money('charged_amount').notNull(),
    chargedBy: text('charged_by').notNull(),
    readAt: timestamptz('read_at').notNull(),
    state: commercialReturnStateEnum('state').notNull().default('awaiting_validation'),
    decidedAt: timestamptz('decided_at'),
    decidedByClientId: uuid('decided_by_client_id').references(() => apiClients.id),
    /** Motivo da recusa (FR-017); apagado na anonimização da reserva (research R-15). */
    rejectionReason: text('rejection_reason'),
    /** Mesmo valor para as confirmações gravadas no mesmo pedido em lote (FR-016a). */
    batchId: uuid('batch_id'),
    /**
     * Situação da cobrança como o Comercial escreveu (specs/008, R-06); nula = não informada. O
     * texto de tipo `other` é apagado na anonimização da reserva.
     */
    chargeSituationText: text('charge_situation_text'),
    chargeSituationKind: chargeSituationKindEnum('charge_situation_kind'),
    /** Data da cobrança informada pelo Comercial (specs/008); nula = não informada. */
    chargeDate: isoDate('charge_date'),
  },
  (table) => [
    foreignKey({
      name: 'commercial_returns_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    check(
      'commercial_returns_texts_check',
      sql`char_length(${table.authorizationCode}) between 1 and 100
        and char_length(${table.chargeHotel}) between 1 and 100
        and char_length(${table.chargedBy}) between 1 and 100`,
    ),
    check('commercial_returns_amount_check', sql`${table.chargedAmount} > 0`),
    check(
      'commercial_returns_rejection_reason_check',
      sql`${table.rejectionReason} is null or char_length(${table.rejectionReason}) between 1 and 500`,
    ),
    check(
      'commercial_returns_charge_situation_check',
      sql`${table.chargeSituationText} is null or char_length(${table.chargeSituationText}) between 1 and 100`,
    ),
    // No máximo um retorno aguardando validação ou confirmado por reserva.
    uniqueIndex('commercial_returns_one_current')
      .on(table.hotelCode, table.reservationNumber)
      .where(sql`${table.state} in ('awaiting_validation', 'confirmed')`),
    index('commercial_returns_reservation_idx').on(table.hotelCode, table.reservationNumber),
  ],
);

/**
 * Relato do Comercial sem retorno de cobrança (specs/008, data-model §1.2): "Cobrada no Hunit" ou
 * "Cancelada" (era "Não cobrada", R-19). Uma linha por reserva, o relato atual da linha da planilha;
 * trocar a situação ou apagar remove a linha. `read_at` é quando o servidor leu esta versão (base da
 * fila, R-07). A "Cancelada" tem a validação do Financeiro (`validation_state` e o resto, R-19).
 */
export const commercialReports = pgTable(
  'commercial_reports',
  {
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    kind: commercialReportKindEnum('kind').notNull(),
    situationText: text('situation_text').notNull(),
    /** Obrigatório em "Cobrada no Hunit"; na "Cancelada", só se o Comercial preencheu (R-19). */
    chargedBy: text('charged_by'),
    chargeDate: isoDate('charge_date'),
    readAt: timestamptz('read_at').notNull(),
    /**
     * Validação da "Cancelada" pelo Financeiro (R-19); nula em "Cobrada no Hunit". Cada versão nova
     * do relato volta a `awaiting_validation`.
     */
    validationState: commercialReportValidationEnum('validation_state'),
    decidedAt: timestamptz('decided_at'),
    decidedByClientId: uuid('decided_by_client_id').references(() => apiClients.id),
    /** Motivo da recusa, que o Comercial vê na coluna J; apagado na anonimização. */
    rejectionReason: text('rejection_reason'),
    /** Marcação "Cancelada sem cobrança" criada pela confirmação. */
    noChargeMarkId: uuid('no_charge_mark_id').references(() => noChargeMarks.id),
    /**
     * Resultado da leitura no Hunit que definiu a situação do relato "Cobrada no Hunit" e quando:
     * a fila mostra confirmadas e não encontradas que não exigem mais cobrança por 7 dias a partir
     * daqui (spec FR-013). Nulos enquanto aguarda a verificação; a situação continua derivada.
     */
    settledResult: hunitCheckResultEnum('settled_result'),
    settledAt: timestamptz('settled_at'),
  },
  (table) => [
    primaryKey({ columns: [table.hotelCode, table.reservationNumber] }),
    check(
      'commercial_reports_settled_check',
      sql`(${table.settledResult} is null) = (${table.settledAt} is null)`,
    ),
    foreignKey({
      name: 'commercial_reports_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    check(
      'commercial_reports_texts_check',
      sql`char_length(${table.situationText}) between 1 and 100
        and (${table.chargedBy} is null or char_length(${table.chargedBy}) between 1 and 100)
        and (${table.rejectionReason} is null or char_length(${table.rejectionReason}) between 1 and 500)`,
    ),
    // Responsável obrigatório em "Cobrada no Hunit"; validação só na "Cancelada" (R-19).
    check(
      'commercial_reports_kind_check',
      sql`(${table.kind}::text = 'charged_in_hunit' and ${table.chargedBy} is not null
          and ${table.validationState} is null)
        or (${table.kind}::text = 'cancelled' and ${table.validationState} is not null)`,
    ),
  ],
);

/**
 * Marcação "Cancelada sem cobrança" do Financeiro (specs/008, data-model §1.1; research R-08).
 * Só inclusão e o "desfazer" (preenche `undone_*`); marcar de novo cria outra linha. As linhas
 * são o histórico. A observação é apagada na anonimização da reserva.
 */
export const noChargeMarks = pgTable(
  'no_charge_marks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    /** Valor a cobrar no momento da marcação (`total_amount`), para "antes R$ …". */
    previousAmount: money('previous_amount'),
    note: text('note'),
    markedByClientId: uuid('marked_by_client_id')
      .notNull()
      .references(() => apiClients.id),
    markedAt: timestamptz('marked_at').notNull().defaultNow(),
    undoneByClientId: uuid('undone_by_client_id').references(() => apiClients.id),
    undoneAt: timestamptz('undone_at'),
  },
  (table) => [
    foreignKey({
      name: 'no_charge_marks_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    check(
      'no_charge_marks_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and 500`,
    ),
    check(
      'no_charge_marks_undone_check',
      sql`(${table.undoneAt} is null) = (${table.undoneByClientId} is null)`,
    ),
    // No máximo uma marcação ativa por reserva.
    uniqueIndex('no_charge_marks_one_active')
      .on(table.hotelCode, table.reservationNumber)
      .where(sql`${table.undoneAt} is null`),
    index('no_charge_marks_reservation_idx').on(table.hotelCode, table.reservationNumber),
  ],
);

/**
 * Histórico do Comercial (FR-020): só inclusão, como `treatment_events`. `client_id` nulo = o
 * Comercial, pela planilha.
 */
export const commercialEvents = pgTable(
  'commercial_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    hotelCode: text('hotel_code').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    type: commercialEventTypeEnum('type').notNull(),
    dispatchId: uuid('dispatch_id').references(() => commercialDispatches.id),
    returnId: uuid('return_id').references(() => commercialReturns.id),
    clientId: uuid('client_id').references(() => apiClients.id),
    /** Em `withdrawn`: a classificação lida. */
    classification: classificationEnum('classification'),
    /** Motivo da recusa ou do encerramento. */
    reason: text('reason'),
    batchId: uuid('batch_id'),
    at: timestamptz('at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'commercial_events_reservation_fk',
      columns: [table.hotelCode, table.reservationNumber],
      foreignColumns: [reservations.hotelCode, reservations.reservationNumber],
    }),
    index('commercial_events_reservation_idx').on(
      table.hotelCode,
      table.reservationNumber,
      table.id,
    ),
  ],
);

/** Problema da última rodada sem reserva do sistema (linha órfã ou repetida, FR-011). */
export interface SheetRoundProblem {
  kind: 'orphan_line' | 'duplicate_line';
  hotelCode: string | null;
  reservationNumber: string | null;
  message: string;
  at: string;
}

/** Estado da integração com a planilha (FR-013): uma linha só (`id = 1`). */
export const commercialSheetState = pgTable(
  'commercial_sheet_state',
  {
    id: integer('id').primaryKey(),
    lastRoundAt: timestamptz('last_round_at'),
    lastRoundOkAt: timestamptz('last_round_ok_at'),
    lastReadOkAt: timestamptz('last_read_ok_at'),
    /** Código da última falha (research R-04); nunca a mensagem da biblioteca. */
    lastErrorCode: text('last_error_code'),
    lastErrorAt: timestamptz('last_error_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at'),
    /** Linhas órfãs e repetidas encontradas na última rodada. */
    roundProblems: jsonb('round_problems').$type<SheetRoundProblem[]>().notNull().default([]),
  },
  (table) => [check('commercial_sheet_state_single_row_check', sql`${table.id} = 1`)],
);
