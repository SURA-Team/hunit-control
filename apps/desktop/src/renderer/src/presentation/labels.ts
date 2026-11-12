/**
 * Nomes em português e tons de cor de cada valor dos enums da API (specs/002, FR-023, data-model
 * §6). As tabelas são tipadas por `Record<Enum, ...>` com os tipos do contrato: um valor novo na
 * API quebra a compilação do app até ganhar nome e tom. Os tons são decisão de apresentação.
 */
import type {
  AppError,
  Classification,
  ErrorCode,
  ExecutionEndReason,
  ExecutionStatus,
  HotelRunStatus,
  ReservationStatus,
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
  not_virtual_card: { name: 'Não é cartão virtual (situação antiga)', tone: 'neutral' },
};

/** Ordem de exibição das situações de cobrança (as que pedem ação primeiro). */
export const CLASSIFICATION_ORDER: Classification[] = [
  'virtual_card_pending_charge',
  'charge_at_terminal',
  'virtual_card_validated_only',
  'virtual_card_charge_error',
  'analysis_error',
  'virtual_card_already_charged',
  'invoiced',
  'cancelled_no_charge',
  'ignored_hotelbeds_258',
  'not_virtual_card',
];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, Label> = {
  active: { name: 'Ativa', tone: 'neutral' },
  cancelled: { name: 'Cancelada', tone: 'neutral' },
  unknown: { name: 'Não identificada', tone: 'warning' },
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
