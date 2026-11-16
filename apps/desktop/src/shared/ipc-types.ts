/**
 * Tipos da ponte entre a interface e o processo principal (specs/002, contracts/ipc.md).
 *
 * A interface só enxerga o que está aqui: nada de chave da API nem de senha do Hunit. O token 2FA
 * vai da interface para o principal, nunca o contrário (research R-02).
 */
import type { components } from '@hunit/contracts';

type Schemas = components['schemas'];

export type ClientIdentity = Schemas['ClientIdentity'];
export type ClientRole = Schemas['ClientRole'];
export type Execution = Schemas['Execution'];
export type ExecutionSummary = Schemas['ExecutionSummary'];
export type ExecutionStatus = Schemas['ExecutionStatus'];
export type ExecutionEndReason = Schemas['ExecutionEndReason'];
export type ExecutionEvent = Schemas['ExecutionEvent'];
export type HotelRunStatus = Schemas['HotelRunStatus'];
export type Hotel = Schemas['Hotel'];
export type Reservation = Schemas['Reservation'];
export type ReservationStatus = Schemas['ReservationStatus'];
export type Classification = Schemas['Classification'];
export type ClassificationCounts = Schemas['ClassificationCounts'];
export type EvidenceSummary = Schemas['EvidenceSummary'];
export type TreatmentDocumentKind = Schemas['TreatmentDocumentKind'];
export type TreatmentStatus = Schemas['TreatmentStatus'];
export type ReservationSituation = Schemas['ReservationSituation'];
export type TreatmentDocumentState = Schemas['TreatmentDocumentState'];
export type TreatmentDocument = Schemas['TreatmentDocument'];
export type ReservationTreatment = Schemas['ReservationTreatment'];
export type TreatmentEvent = Schemas['TreatmentEvent'];
export type ReservationOutcome = Schemas['ReservationOutcome'];

/** Códigos de erro da API (`Problem.code`). */
export type ApiErrorCode = Schemas['Problem']['code'];

/** Códigos de erro do próprio app (data-model §6.5). */
export type AppErrorCode =
  | 'offline'
  | 'untrusted_server'
  | 'not_configured'
  | 'credentials_missing'
  | 'credentials_expired'
  | 'key_storage_unavailable'
  | 'invalid_input';

export type ErrorCode = ApiErrorCode | AppErrorCode;

export interface AppError {
  code: ErrorCode;
  /** Explicação para o operador. Nunca contém senha, token nem chave (FR-007). */
  detail?: string;
  /** Status HTTP, quando o erro veio da API. */
  status?: number;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Conexão e configuração
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  'not_configured' | 'connecting' | 'online' | 'offline' | 'untrusted_server' | 'unauthorized';

export interface ConnectionState {
  status: ConnectionStatus;
  /** Nome e perfil da chave, quando `online`. */
  client: ClientIdentity | null;
  /** Última verificação (ISO 8601). */
  checkedAt: string;
}

export interface CertificateInfo {
  fingerprint256: string;
  subject: string;
  issuer: string;
  /** Fim da validade (ISO 8601). */
  validTo: string;
  isCertificateAuthority: boolean;
}

export interface Preferences {
  soundEnabled: boolean;
  /** Horas sem ação do operador para esvaziar o cofre (1 a 24). */
  idleHours: number;
}

/** O que a interface pode ver da configuração: a chave nunca sai do principal. */
export interface PublicConfig {
  serverUrl: string;
  /** Certificado raiz guardado (público): permite testar de novo sem escolher o arquivo. */
  certificatePem: string;
  certificate: CertificateInfo;
  hasApiKey: boolean;
  preferences: Preferences;
}

export interface ConnectionInput {
  serverUrl: string;
  certificatePem: string;
  /** Omitida = usa a chave já guardada. */
  apiKey?: string | undefined;
}

export interface PreferencesInput {
  soundEnabled?: boolean | undefined;
  idleHours?: number | undefined;
}

export interface PickedCertificate {
  pem: string;
  info: CertificateInfo;
}

// ---------------------------------------------------------------------------
// Acesso ao Hunit (cofre em memória do principal)
// ---------------------------------------------------------------------------

export interface CredentialsStatus {
  username: string | null;
  hasPassword: boolean;
}

export interface CredentialsInput {
  username: string;
  password: string;
}

export type CredentialsClearReason = 'idle' | 'manual';

// ---------------------------------------------------------------------------
// Execuções e pedido de token
// ---------------------------------------------------------------------------

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ExecutionListInput {
  active?: boolean | undefined;
  status?: ExecutionStatus | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface StartExecutionInput {
  period: { from: string; to: string };
  /** `null` = todos os hotéis do catálogo. */
  hotelCodes: string[] | null;
}

export interface SendTokenInput {
  executionId: string;
  token: string;
}

export interface TwoFactorRequest {
  executionId: string;
  /** `twoFactorDeadline` do servidor (ISO 8601). */
  deadline: string;
  /** Relógio do servidor menos o relógio local, em milissegundos. */
  clockOffsetMs: number;
}

export type TwoFactorCloseReason =
  'accepted' | 'rejected' | 'expired' | 'finished' | 'answered_elsewhere';

export interface TwoFactorClosed {
  executionId: string;
  reason: TwoFactorCloseReason;
}

export interface ExecutionChanged {
  executionId: string;
}

// ---------------------------------------------------------------------------
// Reservas e evidências
// ---------------------------------------------------------------------------

export interface ReservationListInput {
  executionId?: string | undefined;
  hotelCode?: string[] | undefined;
  classification?: Classification[] | undefined;
  reservationStatus?: ReservationStatus[] | undefined;
  notFound?: boolean | undefined;
  checkInFrom?: string | undefined;
  checkInTo?: string | undefined;
  q?: string | undefined;
  channel?: string | undefined;
  /** Formato da API: "1234.56". */
  amount?: string | undefined;
  /** Situação dos documentos (specs/003): sem tratativa, só tratativa, com comprovante. */
  treatmentStatus?: TreatmentStatus[] | undefined;
  /** "Falta cobrar" (specs/003, FR-002): a regra é do servidor. */
  pendingCharge?: boolean | undefined;
  /** Situação da reserva (specs/003, FR-002, FR-015): a mesma da coluna da lista. */
  situation?: ReservationSituation[] | undefined;
  /** "A verificar" (specs/003, FR-002a): só as reservas com o alerta. */
  needsReview?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface ReservationKey {
  hotelCode: string;
  reservationNumber: string;
}

export type EvidenceFile = 'screenshot' | 'html' | 'response';

export interface EvidenceSaveInput {
  evidenceId: string;
  file: EvidenceFile;
  /** Hotel ou início do id da execução, para o nome padrão do arquivo. */
  label?: string | undefined;
}

// ---------------------------------------------------------------------------
// Tratativas manuais (specs/003, contracts/ipc.md)
// ---------------------------------------------------------------------------

/** Anexo de um e-mail: só o que a lista mostra; o anexo nunca é aberto (FR-018a). */
export interface EmailAttachmentInfo {
  name: string | null;
  mediaType: string | null;
  sizeBytes: number | null;
}

/**
 * O que a interface mostra do arquivo escolhido antes da confirmação (FR-018). Montado no
 * processo principal, só em memória; a interface nunca recebe o caminho do arquivo.
 */
export type DocumentPreview =
  | { type: 'pdf'; bytes: Uint8Array }
  | { type: 'image'; bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' }
  | {
      type: 'email';
      from: string | null;
      to: string[];
      cc: string[];
      subject: string | null;
      /** ISO 8601, quando o e-mail tem data válida. */
      date: string | null;
      /** Corpo em texto, quando existe. */
      text: string | null;
      /** Corpo em HTML, só quando não há texto; exibido isolado (research R-08). */
      html: string | null;
      attachments: EmailAttachmentInfo[];
    }
  | { type: 'unavailable'; reason: 'unreadable' };

/** Arquivo escolhido pelo operador, guardado na memória do principal até confirmar ou cancelar. */
export interface PickedFile {
  selectionId: string;
  fileName: string;
  sizeBytes: number;
  mediaType: string;
  preview: DocumentPreview;
}

/** Máximo de reservas num lote; é também o limite da seleção na tela (FR-006a). */
export const MAX_TREATMENT_RESERVATIONS = 2000;

export interface PickFileInput {
  kind: TreatmentDocumentKind;
}

export interface TreatmentCheckInput {
  kind: TreatmentDocumentKind;
  reservations: ReservationKey[];
}

/** Resposta da conferência do servidor, somada entre as partes de 200 reservas. */
export interface TreatmentCheck {
  items: ReservationOutcome[];
  acceptedCount: number;
  replacingCount: number;
  ignoredCount: number;
  /** Soma do valor das aceitas, no formato da API: "1234.56". */
  acceptedTotalAmount: string;
}

export interface TreatmentApplyInput {
  selectionId: string;
  kind: TreatmentDocumentKind;
  reservations: ReservationKey[];
}

export interface TreatmentApplyResult {
  /** Desfecho das reservas já processadas, de todas as partes. */
  items: ReservationOutcome[];
  /** Reservas que não ficaram com o documento por erro: continuam selecionadas (FR-006a). */
  failedKeys: ReservationKey[];
  /**
   * `true` = o envio parou por falta de conexão; o arquivo continua na memória (mesmo
   * `selectionId`) para "Tentar de novo" com as reservas de `failedKeys`.
   */
  retryable: boolean;
  /** Erro que interrompeu o envio, quando `retryable`. */
  error?: AppError | undefined;
}

export interface TreatmentDetail {
  treatment: ReservationTreatment;
  documents: TreatmentDocument[];
  events: TreatmentEvent[];
}

export interface ManualAmountInput extends ReservationKey {
  /** Formato da API: "1234.56", maior que zero. */
  amount: string;
}

// ---------------------------------------------------------------------------
// A ponte: window.hunit
// ---------------------------------------------------------------------------

export interface HunitApi {
  app: {
    info: () => Promise<Result<{ version: string }>>;
  };
  connection: {
    getState: () => Promise<Result<ConnectionState>>;
    getConfig: () => Promise<Result<PublicConfig | null>>;
    pickCertificate: () => Promise<Result<PickedCertificate | null>>;
    test: (input: ConnectionInput) => Promise<Result<ClientIdentity>>;
    save: (input: ConnectionInput) => Promise<Result<PublicConfig>>;
    remove: () => Promise<Result<void>>;
    onState(callback: (state: ConnectionState) => void): Unsubscribe;
  };
  preferences: {
    set: (input: PreferencesInput) => Promise<Result<Preferences>>;
  };
  attention: {
    test: () => Promise<Result<void>>;
    onPlaySound(callback: () => void): Unsubscribe;
  };
  credentials: {
    status: () => Promise<Result<CredentialsStatus>>;
    set: (input: CredentialsInput) => Promise<Result<CredentialsStatus>>;
    clear: () => Promise<Result<CredentialsStatus>>;
    onCleared(callback: (event: { reason: CredentialsClearReason }) => void): Unsubscribe;
  };
  activity: {
    ping: () => void;
  };
  hotels: {
    list: () => Promise<Result<Hotel[]>>;
  };
  executions: {
    list: (input: ExecutionListInput) => Promise<Result<Page<ExecutionSummary>>>;
    get: (executionId: string) => Promise<Result<Execution>>;
    start: (input: StartExecutionInput) => Promise<Result<Execution>>;
    resume: (executionId: string) => Promise<Result<Execution>>;
    cancel: (executionId: string) => Promise<Result<Execution>>;
    sendToken: (input: SendTokenInput) => Promise<Result<void>>;
    watch: (executionId: string) => Promise<Result<void>>;
    unwatch: (executionId: string) => Promise<Result<void>>;
    onChanged(callback: (event: ExecutionChanged) => void): Unsubscribe;
  };
  twoFactor: {
    onRequested(callback: (request: TwoFactorRequest) => void): Unsubscribe;
    onClosed(callback: (event: TwoFactorClosed) => void): Unsubscribe;
  };
  evidence: {
    list: (executionId: string) => Promise<Result<EvidenceSummary[]>>;
    save: (input: EvidenceSaveInput) => Promise<Result<{ savedTo: string } | null>>;
  };
  reservations: {
    list: (input: ReservationListInput) => Promise<Result<Page<Reservation>>>;
    get: (input: ReservationKey) => Promise<Result<Reservation>>;
    channels: () => Promise<Result<string[]>>;
  };
  treatments: {
    /** Abre "Abrir arquivo"; `null` = cancelado. O arquivo fica na memória do principal. */
    pickFile: (input: PickFileInput) => Promise<Result<PickedFile | null>>;
    /** Cancelar na pré-visualização: libera a memória; nada é enviado (FR-018). */
    discardFile: (selectionId: string) => Promise<Result<void>>;
    check: (input: TreatmentCheckInput) => Promise<Result<TreatmentCheck>>;
    apply: (input: TreatmentApplyInput) => Promise<Result<TreatmentApplyResult>>;
    get: (input: ReservationKey) => Promise<Result<TreatmentDetail>>;
    remove: (documentId: string) => Promise<Result<void>>;
    revert: (documentId: string) => Promise<Result<ReservationTreatment>>;
    setManualAmount: (input: ManualAmountInput) => Promise<Result<ReservationTreatment>>;
    clearManualAmount: (input: ReservationKey) => Promise<Result<ReservationTreatment>>;
    /** Confirma o alerta "Verificar" (FR-002a): só tira o alerta e registra no histórico. */
    confirmReview: (input: ReservationKey) => Promise<Result<ReservationTreatment>>;
    /** Baixa e abre "Salvar como" com o nome original; `null` = cancelado. */
    saveDocument: (documentId: string) => Promise<Result<{ savedTo: string } | null>>;
  };
}
