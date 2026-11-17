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
export type ReservationDetailedSituation = Schemas['ReservationDetailedSituation'];
// Envio ao Comercial (specs/005).
export type CommercialSummary = Schemas['CommercialSummary'];
export type CommercialReturnBrief = Schemas['CommercialReturnBrief'];
export type CommercialLine = Schemas['CommercialLine'];
export type CommercialLineState = Schemas['CommercialLineState'];
export type CommercialReturn = Schemas['CommercialReturn'];
export type CommercialReturnState = Schemas['CommercialReturnState'];
export type CommercialEvent = Schemas['CommercialEvent'];
export type CommercialDetail = Schemas['CommercialDetail'];
export type CommercialDispatch = Schemas['CommercialDispatch'];
export type CommercialDispatchSummary = Schemas['CommercialDispatchSummary'];
export type CommercialDispatchItem = Schemas['CommercialDispatchItem'];
export type CommercialDispatchCheck = Schemas['CommercialDispatchCheck'];
export type CommercialDispatchIgnored = Schemas['CommercialDispatchIgnored'];
export type CommercialSheetStatus = Schemas['CommercialSheetStatus'];
export type CommercialSheetProblem = Schemas['CommercialSheetProblem'];
export type CommercialSheetRead = Schemas['CommercialSheetRead'];
export type ConfirmationBatchResult = Schemas['ConfirmationBatchResult'];
export type ReservationSelection = Schemas['ReservationSelection'];
export type SelectionItem = Schemas['SelectionItem'];
export type ChargedAmountOrigin = NonNullable<ReservationTreatment['chargedAmountOrigin']>;

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

/** Execução ou envio ao Comercial: os dois pedem o token do Hunit (specs/005, research R-14). */
export type JobKind = 'execution' | 'dispatch';

export interface JobRef {
  kind: JobKind;
  id: string;
}

export interface TwoFactorRequest {
  job: JobRef;
  /** `twoFactorDeadline` do servidor (ISO 8601). */
  deadline: string;
  /** Relógio do servidor menos o relógio local, em milissegundos. */
  clockOffsetMs: number;
}

export type TwoFactorCloseReason =
  'accepted' | 'rejected' | 'expired' | 'finished' | 'answered_elsewhere';

export interface TwoFactorClosed {
  job: JobRef;
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
  /** Origem (specs/004, FR-011): `true` = só as do sistema anterior; `false` = só as outras. */
  fromLegacy?: boolean | undefined;
  /**
   * Situação com o detalhe do Comercial (specs/005): os valores de `situation` e "Validar
   * comprovante" (`return_pending`). A tela usa este no lugar de `situation`.
   */
  detailedSituation?: ReservationDetailedSituation[] | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** Os filtros da lista, sem paginação: "selecionar todas do filtro" e a cópia (specs/005). */
export type ReservationFilters = Omit<ReservationListInput, 'cursor' | 'limit'>;

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
// Envio ao Comercial pela planilha (specs/005, contracts/ipc.md)
// ---------------------------------------------------------------------------

/** Máximo de reservas num envio, numa confirmação em lote e numa cópia (FR-001, FR-029). */
export const MAX_COMMERCIAL_RESERVATIONS = 2000;

export interface ReservationsInput {
  reservations: ReservationKey[];
}

export interface CommercialDispatchListInput {
  active?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface DispatchTokenInput {
  dispatchId: string;
  token: string;
}

/** "Ler retornos agora": `round` nulo = passou de 50 s e a rodada continua no servidor (202). */
export interface SheetReadResult {
  sheet: CommercialSheetStatus;
  round: CommercialSheetRead['round'] | null;
}

export interface DispatchChanged {
  dispatchId: string;
}

export interface RejectReturnInput {
  returnId: string;
  /** Aparece para o Comercial na planilha (FR-017). */
  reason: string;
}

/**
 * Uma reserva copiada para o e-mail (FR-027): só as colunas da cópia. Não existe campo de hóspede
 * de propósito; o principal recusa qualquer campo a mais.
 */
export interface CopyRow {
  hotelName: string;
  reservationNumber: string;
  checkIn: string | null;
  channel: string | null;
  totalAmount: string | null;
  classification: Classification;
  reservationStatus: ReservationStatus;
  detailedSituation: ReservationDetailedSituation;
}

export type CopyReservationsInput =
  | {
      source: 'selection';
      rows: CopyRow[];
    }
  | {
      source: 'filter';
      filters: ReservationFilters;
      /** Os filtros em português, para a linha de descrição da cópia. */
      description?: string | undefined;
    };

export interface CopyResult {
  /** Reservas copiadas. */
  copied: number;
  /** Quantas o filtro encontrou (`source: 'filter'`); igual a `copied` na seleção. */
  total: number;
  /** `true` = o filtro trouxe mais de 2 000; só as 2 000 primeiras foram copiadas. */
  truncated: boolean;
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
    /** "Selecionar todas do filtro" (specs/005, FR-030): até 2 000, na ordem da lista. */
    selectAll: (filters: ReservationFilters) => Promise<Result<ReservationSelection>>;
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
    /** "Verificar" em lote (specs/005, FR-029): até 2 000 reservas. */
    confirmReviews: (input: ReservationsInput) => Promise<Result<ConfirmationBatchResult>>;
  };
  dispatches: {
    /** Quem aceita o envio, sem gravar nada e sem acessar o Hunit (FR-001). */
    check: (input: ReservationsInput) => Promise<Result<CommercialDispatchCheck>>;
    /** Usa as credenciais do cofre, como `executions.start`. */
    start: (input: ReservationsInput) => Promise<Result<CommercialDispatch>>;
    list: (input: CommercialDispatchListInput) => Promise<Result<Page<CommercialDispatchSummary>>>;
    get: (dispatchId: string) => Promise<Result<CommercialDispatch>>;
    resume: (dispatchId: string) => Promise<Result<CommercialDispatch>>;
    cancel: (dispatchId: string) => Promise<Result<CommercialDispatch>>;
    sendToken: (input: DispatchTokenInput) => Promise<Result<void>>;
    watch: (dispatchId: string) => Promise<Result<void>>;
    unwatch: (dispatchId: string) => Promise<Result<void>>;
    onChanged(callback: (event: DispatchChanged) => void): Unsubscribe;
  };
  commercial: {
    /** Linha, retornos e histórico do Comercial de uma reserva. */
    get: (input: ReservationKey) => Promise<Result<CommercialDetail>>;
    cancelLine: (input: ReservationKey) => Promise<Result<CommercialLine>>;
    restoreLine: (input: ReservationKey) => Promise<Result<CommercialLine>>;
    confirmReturn: (returnId: string) => Promise<Result<ReservationTreatment>>;
    rejectReturn: (input: RejectReturnInput) => Promise<Result<ReservationTreatment>>;
    undoConfirmation: (returnId: string) => Promise<Result<ReservationTreatment>>;
    confirmReturns: (input: ReservationsInput) => Promise<Result<ConfirmationBatchResult>>;
    sheetStatus: () => Promise<Result<CommercialSheetStatus>>;
    readNow: () => Promise<Result<SheetReadResult>>;
  };
  clipboard: {
    /** Monta a tabela (HTML e texto com tabulação) no principal e grava na área de transferência. */
    copyReservations: (input: CopyReservationsInput) => Promise<Result<CopyResult>>;
  };
}
