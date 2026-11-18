/**
 * Nomes em português e tons de cor de cada valor dos enums da API (specs/002, FR-023, data-model
 * §6). As tabelas são tipadas por `Record<Enum, ...>` com os tipos do contrato: um valor novo na
 * API quebra a compilação do app até ganhar nome e tom. Os tons são decisão de apresentação.
 */
import type {
  AppError,
  ChargedAmountOrigin,
  Classification,
  CommercialDispatchIgnored,
  CommercialDispatchItem,
  CommercialEvent,
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
  ReservationDetailedSituation,
  ReservationOutcome,
  ReservationSituation,
  ReservationStatus,
  TreatmentDocumentKind,
  TreatmentDocumentState,
  TreatmentEvent,
  TreatmentStatus,
} from '../../../shared/ipc-types';

/** sucesso (verde), atenção (amarelo), erro (vermelho), informação (azul) e neutro (cinza). */
export const TONES = ['success', 'warning', 'error', 'info', 'neutral'] as const;
export type Tone = (typeof TONES)[number];

export interface Label {
  name: string;
  tone: Tone;
}

/** Cor do Mantine de cada tom. */
export const TONE_COLORS: Record<Tone, string> = {
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  neutral: 'gray',
};

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
  running: { name: 'Em andamento', tone: 'info' },
  awaiting_2fa: { name: 'Aguardando token', tone: 'warning' },
  completed: { name: 'Concluída', tone: 'success' },
  failed: { name: 'Falhou', tone: 'error' },
  cancelled: { name: 'Cancelada', tone: 'neutral' },
};

export const HOTEL_STATUS_LABELS: Record<HotelRunStatus, Label> = {
  pending: { name: 'Pendente', tone: 'neutral' },
  running: { name: 'Em andamento', tone: 'info' },
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
  running: { name: 'Em andamento', tone: 'info' },
  awaiting_2fa: { name: 'Aguardando token', tone: 'warning' },
  completed: { name: 'Concluído', tone: 'success' },
  failed: { name: 'Falhou', tone: 'error' },
  cancelled: { name: 'Cancelado', tone: 'neutral' },
};

/** Onde está a linha da reserva na planilha. */
export const LINE_STATE_LABELS: Record<CommercialLineState, Label> = {
  open: { name: 'A cobrar', tone: 'info' },
  concluded: { name: 'Concluída', tone: 'success' },
  cancelled: { name: 'Pedido cancelado pelo Financeiro', tone: 'neutral' },
};

export const SHEET_TAB_NAMES: Record<NonNullable<CommercialLine['tab']>, string> = {
  to_charge: 'A cobrar',
  done: 'Concluídas',
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
