/**
 * Nomes em português e tons de cor de cada valor dos enums da API (specs/002, FR-023, data-model
 * §6). As tabelas são tipadas por `Record<Enum, ...>` com os tipos do contrato: um valor novo na
 * API quebra a compilação do app até ganhar nome e tom. Os tons são decisão de apresentação.
 */
import type {
  AppError,
  ChargedAmountOrigin,
  ChargeSituation,
  Classification,
  CommercialDispatchIgnored,
  CommercialDispatchItem,
  CommercialEvent,
  CommercialHistoryEvent,
  CommercialLine,
  CommercialLineState,
  CommercialReturnState,
  CommercialSheetProblem,
  CommercialSheetStatus,
  ConfirmationBatchResult,
  ErrorCode,
  ExecutionEndReason,
  ExecutionStatus,
  HotelRunStatus,
  HunitChargeStatus,
  ReservationDetailedSituation,
  ReservationOutcome,
  ReservationSituation,
  ReservationStatus,
  TreatmentDocumentKind,
  TreatmentDocumentState,
  TreatmentEvent,
  TreatmentStatus,
} from '../../../shared/ipc-types';
import { formatDate, relativeDay } from './format';

/**
 * Tons de significado fixo (specs/006, FR-005): `success` verde (concluído), `warning` âmbar
 * (atenção), `error` vermelho (erro), `progress` lima (em andamento) e `info`/`neutral` cinza.
 */
export const TONES = ['success', 'warning', 'error', 'progress', 'info', 'neutral'] as const;
export type Tone = (typeof TONES)[number];

export interface Label {
  name: string;
  tone: Tone;
}

export const CLASSIFICATION_LABELS: Record<Classification, Label> = {
  virtual_card_already_charged: { name: 'Já cobrada', tone: 'success' },
  invoiced: { name: 'Faturada', tone: 'success' },
  virtual_card_pending_charge: { name: 'Pendente de cobrança', tone: 'warning' },
  virtual_card_validated_only: { name: 'Cartão validado (não cobrado)', tone: 'warning' },
  charge_at_terminal: { name: 'Cobrar na maquininha', tone: 'warning' },
  virtual_card_charge_error: { name: 'Erro na cobrança', tone: 'error' },
  analysis_error: { name: 'Erro de análise', tone: 'error' },
  cancelled_no_charge: { name: 'Cancelada sem cobrança', tone: 'neutral' },
  ignored_hotelbeds_258: { name: 'Ignorada (Hotelbeds 258)', tone: 'neutral' },
  // Reserva importada sem classificação correspondente (specs/004, FR-007a).
  not_virtual_card: { name: 'A revisar (sistema anterior)', tone: 'warning' },
};

/** Ordem de exibição das situações de cobrança (as que pedem ação primeiro). */
export const CLASSIFICATION_ORDER: Classification[] = [
  'virtual_card_pending_charge',
  'charge_at_terminal',
  'virtual_card_validated_only',
  'virtual_card_charge_error',
  'analysis_error',
  'not_virtual_card',
  'virtual_card_already_charged',
  'invoiced',
  'cancelled_no_charge',
  'ignored_hotelbeds_258',
];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, Label> = {
  active: { name: 'Ativa', tone: 'neutral' },
  cancelled: { name: 'Cancelada', tone: 'neutral' },
  unknown: { name: 'Não identificada', tone: 'warning' },
};

// ---------------------------------------------------------------------------
// Tratativas manuais (specs/003, data-model §7)
// ---------------------------------------------------------------------------

/** Situação dos documentos: "Tratativa enviada" continua pendente; "Comprovante enviado" não. */
export const TREATMENT_STATUS_LABELS: Record<TreatmentStatus, Label> = {
  none: { name: 'Sem tratativa', tone: 'neutral' },
  sent: { name: 'Tratativa enviada', tone: 'info' },
  charged: { name: 'Comprovante enviado', tone: 'success' },
};

/**
 * Situação da reserva (FR-002, FR-017): a coluna única da lista e o filtro. É a classificação
 * (status do Hunit), a não ser que a reserva tenha comprovante ou tratativa.
 */
export const SITUATION_LABELS: Record<ReservationSituation, Label> = {
  ...CLASSIFICATION_LABELS,
  treatment_sent: TREATMENT_STATUS_LABELS.sent,
  proof_sent: TREATMENT_STATUS_LABELS.charged,
};

/**
 * Situação com o detalhe do Comercial (specs/005, FR-019): "Validar comprovante" = retorno do
 * Comercial aguardando a validação do Financeiro. É a coluna da lista e o filtro desde a 005.
 */
export const DETAILED_SITUATION_LABELS: Record<ReservationDetailedSituation, Label> = {
  ...SITUATION_LABELS,
  return_pending: { name: 'Validar comprovante', tone: 'warning' },
};

/** Ordem no filtro: as que pedem ação primeiro, depois as tratadas e as que não exigem nada. */
export const SITUATION_ORDER: ReservationDetailedSituation[] = [
  'virtual_card_pending_charge',
  'charge_at_terminal',
  'virtual_card_validated_only',
  'virtual_card_charge_error',
  'analysis_error',
  'not_virtual_card',
  'treatment_sent',
  'return_pending',
  'proof_sent',
  'virtual_card_already_charged',
  'invoiced',
  'cancelled_no_charge',
  'ignored_hotelbeds_258',
];

// ---------------------------------------------------------------------------
// Importação do histórico do sistema anterior (specs/004, data-model §6)
// ---------------------------------------------------------------------------

/** Selo, autor dos registros importados e opção do filtro "Origem". */
export const LEGACY_ORIGIN_NAME = 'Sistema anterior';

/** Opções do filtro "Origem" (`fromLegacy`). */
export const ORIGIN_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'legacy', label: LEGACY_ORIGIN_NAME },
  { value: 'hunit', label: 'HUNIT Control' },
] as const;

export type OriginFilter = (typeof ORIGIN_OPTIONS)[number]['value'];

/**
 * Nome da classificação original, como o sistema anterior a mostrava. Um código desconhecido
 * aparece como veio da planilha.
 */
const LEGACY_CLASSIFICATION_NAMES: Readonly<Record<string, string>> = {
  ignored_hotelbeds_258: 'Ignorada - prefixo 258',
  virtual_card_already_charged: 'Pré-pagamento cobrado',
  virtual_card_pending_charge: 'Pré-pagamento pendente',
  virtual_card_charge_error: 'Erro na cobrança',
  analysis_error: 'Erro de análise',
  not_virtual_card: 'Sem cartão virtual',
};

export function legacyClassificationName(code: string): string {
  return LEGACY_CLASSIFICATION_NAMES[code] ?? code;
}

/** Alerta "Verificar" (FR-002a): o Hunit mudou a situação depois da tratativa. */
export const REVIEW_LABEL: Label = { name: 'Verificar', tone: 'warning' };

export const TREATMENT_KIND_NAMES: Record<TreatmentDocumentKind, string> = {
  request: 'Tratativa',
  proof: 'Comprovante',
};

export const TREATMENT_KIND_ORDER: TreatmentDocumentKind[] = ['request', 'proof'];

export const DOCUMENT_STATE_LABELS: Record<TreatmentDocumentState, Label> = {
  current: { name: 'Atual', tone: 'success' },
  replaced: { name: 'Substituído', tone: 'neutral' },
  removed: { name: 'Desfeito', tone: 'neutral' },
  purged: { name: 'Arquivo apagado pelo prazo de retenção', tone: 'neutral' },
};

export const TREATMENT_EVENT_NAMES: Record<TreatmentEvent['type'], string> = {
  attached: 'Anexou',
  replaced: 'Substituiu',
  removed: 'Desfez',
  reverted: 'Reverteu',
  amount_set: 'Informou valor',
  amount_cleared: 'Removeu valor',
  review_confirmed: 'Confirmou a verificação',
};

/** Por que uma reserva ficou de fora de um registro (data-model §5). */
export const OUTCOME_REASON_MESSAGES: Record<NonNullable<ReservationOutcome['reason']>, string> = {
  not_found: 'Reserva não encontrada.',
  not_eligible: 'Esta reserva não exige cobrança.',
  same_file: 'Esta reserva já tem este arquivo.',
};

export const OUTCOME_NAMES: Record<ReservationOutcome['outcome'], string> = {
  registered: 'Registrado',
  replaced: 'Substituiu o atual',
  ignored: 'Ignorada',
  failed: 'Falhou',
};

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, Label> = {
  queued: { name: 'Na fila', tone: 'neutral' },
  running: { name: 'Em andamento', tone: 'progress' },
  awaiting_2fa: { name: 'Aguardando token', tone: 'warning' },
  completed: { name: 'Concluída', tone: 'success' },
  failed: { name: 'Falhou', tone: 'error' },
  cancelled: { name: 'Cancelada', tone: 'neutral' },
};

export const HOTEL_STATUS_LABELS: Record<HotelRunStatus, Label> = {
  pending: { name: 'Pendente', tone: 'neutral' },
  running: { name: 'Em andamento', tone: 'progress' },
  completed: { name: 'Concluído', tone: 'success' },
  failed: { name: 'Falhou', tone: 'error' },
  cancelled: { name: 'Cancelado', tone: 'neutral' },
};

export const END_REASON_MESSAGES: Record<ExecutionEndReason, string> = {
  invalid_credentials: 'Usuário ou senha do Hunit incorretos.',
  invalid_token: 'O Hunit recusou o token.',
  two_factor_timeout: 'O prazo para informar o token terminou.',
  hunit_unavailable: 'O Hunit não respondeu.',
  hunit_screen_not_recognized:
    'Uma tela ou resposta do Hunit mudou e não foi reconhecida. Veja as evidências.',
  session_expired: 'A sessão no Hunit expirou durante a execução.',
  server_restarted: 'O servidor reiniciou durante a execução. É possível retomar.',
  cancelled_by_client: 'Cancelada por um operador.',
  internal_error: 'Erro interno do servidor.',
};

// ---------------------------------------------------------------------------
// Envio ao Comercial pela planilha (specs/005, data-model §6)
// ---------------------------------------------------------------------------

/** Origem do valor cobrado (FR-024), ao lado do valor na lista e no detalhe. */
export const CHARGED_AMOUNT_ORIGIN_NAMES: Record<ChargedAmountOrigin, string> = {
  hunit: 'Hunit',
  manual: 'manual',
  commercial: 'Comercial',
};

/** Desfecho de cada reserva num envio (FR-005 a FR-007). */
export const DISPATCH_OUTCOME_LABELS: Record<CommercialDispatchItem['outcome'], Label> = {
  pending: { name: 'Aguardando verificação', tone: 'neutral' },
  sent: { name: 'Enviada', tone: 'success' },
  withdrawn: { name: 'Retirada', tone: 'info' },
  not_verified: { name: 'Não verificada', tone: 'error' },
  ignored: { name: 'Fora do envio', tone: 'neutral' },
  // Só em verificações da fila "Cobradas no Hunit" (specs/008); o resultado vem em `checkResult`.
  checked: { name: 'Conferida no Hunit', tone: 'success' },
};

/** Por que uma reserva ficou fora do envio (FR-001). */
export const DISPATCH_IGNORED_REASONS: Record<CommercialDispatchIgnored['reason'], string> = {
  not_found: 'Reserva não encontrada.',
  not_accepting: 'A situação desta reserva não exige cobrança.',
  has_proof: 'Já tem comprovante.',
  return_awaiting_validation: 'Há retorno do Comercial aguardando validação.',
};

/** Estado do envio: os mesmos nomes das execuções, no masculino. */
export const DISPATCH_STATUS_LABELS: Record<ExecutionStatus, Label> = {
  queued: { name: 'Na fila', tone: 'neutral' },
  running: { name: 'Em andamento', tone: 'progress' },
  awaiting_2fa: { name: 'Aguardando token', tone: 'warning' },
  completed: { name: 'Concluído', tone: 'success' },
  failed: { name: 'Falhou', tone: 'error' },
  cancelled: { name: 'Cancelado', tone: 'neutral' },
};

/** Onde está a linha da reserva na planilha. */
export const LINE_STATE_LABELS: Record<CommercialLineState, Label> = {
  open: { name: 'A cobrar', tone: 'progress' },
  concluded: { name: 'Concluída', tone: 'success' },
  cancelled: { name: 'Pedido cancelado pelo Financeiro', tone: 'neutral' },
};

export const SHEET_TAB_NAMES: Record<NonNullable<CommercialLine['sheetTab']>, string> = {
  to_charge: 'A cobrar',
  // specs/009: a linha que espera o Financeiro (ou a verificação no Hunit) há 10 minutos.
  awaiting_validation: 'Aguardando validação do Financeiro',
  done: 'Concluídas',
};

/** O que a situação livre virou depois da decisão do Financeiro (specs/009). */
export const SITUATION_DECISION_NAMES: Record<'charged' | 'no_charge', string> = {
  charged: 'Confirmada como cobrada',
  no_charge: 'Confirmada como cancelada sem cobrança',
};

export const RETURN_STATE_LABELS: Record<CommercialReturnState, Label> = {
  awaiting_validation: { name: 'Aguardando validação', tone: 'warning' },
  confirmed: { name: 'Confirmado', tone: 'success' },
  rejected: { name: 'Recusado', tone: 'error' },
  superseded: { name: 'Substituído pelo Comercial', tone: 'neutral' },
  closed: { name: 'Encerrado sem validação', tone: 'neutral' },
};

export const COMMERCIAL_EVENT_NAMES: Record<CommercialEvent['type'], string> = {
  dispatched: 'Enviou ao Comercial',
  withdrawn: 'Retirou do envio (o Hunit não exige mais cobrança)',
  line_cancelled: 'Desfez o envio',
  line_restored: 'Reverteu o envio desfeito',
  line_concluded: 'Linha concluída',
  return_received: 'Retorno do Comercial recebido',
  return_changed: 'Retorno alterado pelo Comercial',
  return_ignored: 'Retorno ignorado',
  return_confirmed: 'Confirmou o retorno',
  return_rejected: 'Recusou o retorno',
  return_confirmation_undone: 'Desfez a confirmação do retorno',
  return_closed: 'Retorno encerrado sem validação',
};

/** Histórico completo do Comercial, com os eventos novos da 008 (`CommercialDetail.history`). */
export const COMMERCIAL_HISTORY_EVENT_NAMES: Record<CommercialHistoryEvent['type'], string> = {
  ...COMMERCIAL_EVENT_NAMES,
  report_received: 'Comercial informou a situação da cobrança',
  report_changed: 'Comercial alterou a situação da cobrança',
  report_cleared: 'Comercial tirou a situação da cobrança',
  hunit_checked: 'Conferiu a cobrança no Hunit',
  // A "Cancelada" do Comercial (homologação da 008, R-19).
  cancellation_confirmed: 'Confirmou a "Cancelada" do Comercial',
  cancellation_rejected: 'Recusou a "Cancelada" do Comercial',
};

/** Situação na fila "Cobradas no Hunit" (specs/008, tela 7.15). */
export const HUNIT_CHARGE_STATUS_LABELS: Record<HunitChargeStatus, Label> = {
  awaiting: { name: 'Aguardando verificação', tone: 'warning' },
  confirmed: { name: 'Confirmada no Hunit', tone: 'success' },
  not_found: { name: 'Não encontrada no Hunit', tone: 'error' },
};

/**
 * A "Cancelada" do Comercial na validação do Financeiro (homologação da 008, R-19). O selo
 * "Cancelada" é vermelho, para se destacar dos retornos de cobrança em "Retornos a validar".
 */
export const CANCELLATION_BADGE: Label = { name: 'Cancelada', tone: 'error' };

/**
 * Selo da situação livre do Comercial em "Retornos a validar" e na gaveta (specs/009, FR-006): âmbar,
 * a cor de atenção, porque cada uma pede uma decisão do Financeiro.
 */
export const SITUATION_RETURN_BADGE: Label = { name: 'Outra situação', tone: 'warning' };

/** As três decisões sobre a situação livre (specs/009, FR-007). */
export const SITUATION_RETURN_ACTIONS = {
  charged: 'Confirmar como cobrada',
  noCharge: 'Confirmar como cancelada sem cobrança',
  reject: 'Recusar',
} as const;

export const CANCELLATION_VALIDATION_LABELS: Record<
  'awaiting_validation' | 'confirmed' | 'rejected',
  Label
> = {
  awaiting_validation: { name: 'Aguardando validação', tone: 'warning' },
  confirmed: { name: 'Confirmada', tone: 'success' },
  rejected: { name: 'Recusada', tone: 'error' },
};

/** Situação da cobrança reconhecida (specs/008, FR-008); "outra" mostra o texto do Comercial. */
export const CHARGE_SITUATION_NAMES: Record<ChargeSituation['kind'], string> = {
  charged_at_terminal: 'Cobrada na maquininha',
  charged_in_hunit: 'Cobrada no Hunit',
  cancelled: 'Cancelada',
  other: 'Outra situação',
};

/** Situação ou data da cobrança vazia na planilha (FR-011). */
export const NOT_INFORMED = 'não informada';

/** A situação como o Comercial escreveu, ou "não informada". */
export function chargeSituationText(situation: ChargeSituation | null | undefined): string {
  return situation?.text ?? NOT_INFORMED;
}

/** A data da cobrança em DD/MM/AAAA, ou "não informada". */
export function chargeDateText(date: string | null | undefined): string {
  return date ? formatDate(date) : NOT_INFORMED;
}

/**
 * Linha "situação e data" de um retorno (telas 7.8 e 7.12): "Cobrada na maquininha em 19/11/2026
 * (hoje)"; o que faltar sai como "não informada" (FR-011).
 */
export function describeCharge(
  situation: ChargeSituation | null | undefined,
  date: string | null | undefined,
  now: Date = new Date(),
): string {
  const text = situation?.text ?? 'Situação não informada';
  if (!date) return `${text} · data não informada`;
  const relative = relativeDay(date, now);
  return `${text} em ${formatDate(date)}${relative ? ` (${relative})` : ''}`;
}

/** Sugestões do motivo da recusa (FR-017); o texto continua livre. */
export const REJECTION_SUGGESTIONS = [
  'Código de autorização errado',
  'Valor diferente',
  'Pagamento não encontrado',
] as const;

/** Por que uma reserva ficou de fora de uma confirmação em lote (FR-016a, FR-029). */
export const BATCH_REASON_MESSAGES: Record<
  NonNullable<ConfirmationBatchResult['items'][number]['reason']>,
  string
> = {
  not_found: 'Reserva não encontrada.',
  no_return_awaiting_validation: 'Sem retorno do Comercial aguardando validação.',
  no_review_alert: 'Sem o alerta "Verificar".',
  // "Cancelada" do Comercial no lote (homologação da 008, R-19).
  cancellation_not_accepted: 'A reserva não aceita a marcação "Cancelada sem cobrança".',
};

export const SHEET_STATUS_LABELS: Record<CommercialSheetStatus['status'], Label> = {
  ok: { name: 'Funcionando', tone: 'success' },
  failing: { name: 'Com falha', tone: 'error' },
  layout_invalid: { name: 'Formato alterado', tone: 'error' },
  not_configured: { name: 'Não configurada', tone: 'neutral' },
};

export const SHEET_PROBLEM_NAMES: Record<CommercialSheetProblem['kind'], string> = {
  incomplete: 'Retorno incompleto',
  illegible: 'Valor não entendido',
  orphan_line: 'Linha sem envio',
  duplicate_line: 'Linha repetida',
  restored_line: 'Linha restaurada',
};

/** Mensagens dos erros (data-model §6.5). Nenhuma repete senha, token ou chave (FR-007). */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  validation_error: 'Algum dado foi recusado pelo servidor.',
  unauthorized: 'Chave de acesso recusada — confira a configuração.',
  forbidden_for_role: 'Seu perfil (consulta) não permite esta ação.',
  not_found: 'Não encontrado.',
  execution_already_active: 'Já existe uma execução ativa para esta conta do Hunit.',
  not_awaiting_two_factor: 'A execução não está mais aguardando o token.',
  execution_already_finished: 'A execução já terminou.',
  nothing_to_resume: 'Não há hotéis pendentes para retomar.',
  execution_already_resumed: 'Esta execução já foi retomada.',
  evidence_expired: 'A evidência expirou e não está mais disponível.',
  empty_file: 'O arquivo está vazio.',
  file_too_large: 'O arquivo tem mais de 25 MB.',
  unsupported_file_type: 'Tipo não aceito. Use e-mail (.eml ou .msg), PDF ou imagem (.png, .jpg).',
  file_not_found: 'O servidor não tem mais o arquivo enviado. Escolha o arquivo de novo.',
  not_eligible_for_treatment: 'A situação desta reserva não exige cobrança.',
  document_not_current: 'Este documento já foi substituído ou desfeito.',
  document_not_revertible: 'Este documento não pode mais ser revertido.',
  proof_required: 'O valor só pode ser informado numa reserva com comprovante.',
  document_purged: 'O arquivo foi apagado pelo prazo de retenção.',
  account_busy:
    'A conta do Hunit está em uso por outra execução ou envio. Espere terminar e tente de novo.',
  commercial_sheet_not_configured: 'O servidor não tem a planilha do Comercial configurada.',
  commercial_sheet_unavailable:
    'A planilha do Comercial não respondeu. Nada foi perdido: o servidor tenta de novo sozinho.',
  no_eligible_reservations: 'Nenhuma das reservas aceita o envio ao Comercial.',
  dispatch_already_finished: 'O envio já terminou.',
  dispatch_already_resumed: 'Este envio já foi retomado.',
  return_awaiting_validation: 'Há retorno do Comercial aguardando validação nesta reserva.',
  return_not_awaiting_validation: 'Este retorno não aguarda mais validação.',
  return_not_confirmed: 'Este retorno não está confirmado.',
  not_in_commercial_sheet: 'Esta reserva não está na planilha do Comercial.',
  restore_expired: 'O prazo de 30 dias para reverter terminou.',
  no_charge_not_accepted: 'Esta reserva não aceita a marcação "Cancelada sem cobrança".',
  reservation_changed:
    'A situação da reserva mudou enquanto o diálogo estava aberto. Nada foi marcado: confira e tente de novo.',
  no_charge_not_active: 'Esta marcação já foi desfeita.',
  no_reports_to_check: 'Nenhuma reserva da fila precisa ser conferida agora.',
  no_cancellation_awaiting_validation:
    'Esta "Cancelada" não está mais aguardando validação (outra pessoa decidiu ou o Comercial mudou a linha).',
  // A situação livre do Comercial (specs/009, contracts/ipc.md).
  situation_return_needs_decision:
    'Este retorno tem uma situação livre do Comercial: confirme como cobrada ou como cancelada sem cobrança.',
  not_a_situation_return: 'Este retorno não é de uma situação livre. Atualize a lista.',
  charged_amount_required: 'Informe o valor cobrado: o Comercial não informou.',
  charged_amount_from_commercial:
    'O valor cobrado é o informado pelo Comercial. Para corrigir, recuse o retorno.',
  internal_error: 'Erro interno do servidor.',
  offline: 'Servidor indisponível.',
  untrusted_server: 'Não foi possível confirmar a identidade do servidor.',
  not_configured: 'Configure a conexão com o servidor.',
  credentials_missing: 'Informe usuário e senha do Hunit.',
  credentials_expired:
    'Usuário e senha do Hunit foram apagados por inatividade. Informe-os de novo.',
  key_storage_unavailable: 'O Windows não permitiu guardar a chave protegida.',
  invalid_input: 'Dado inválido.',
};

/** Mensagem para o operador: a do código e, se houver, o detalhe do servidor. */
export function errorMessage(error: Pick<AppError, 'code' | 'detail'>): string {
  const base = ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.internal_error;
  return error.detail && error.detail !== base ? `${base} ${error.detail}` : base;
}
