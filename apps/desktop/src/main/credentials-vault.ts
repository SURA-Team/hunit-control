/**
 * Cofre do acesso ao Hunit (specs/002, FR-006 a FR-008, research R-05, data-model §4.3).
 *
 * Usuário e senha ficam só na memória do processo principal, depois que o operador os informa; a
 * interface recebe de volta só o usuário e "senha guardada". O cofre se esvazia ao fechar o app,
 * por "Limpar acesso" ou depois de `idleHours` sem ação do operador (tecla ou clique na janela,
 * avisada pela interface). Consultas e eventos em segundo plano não contam como ação.
 *
 * Limite conhecido: em JavaScript não dá para apagar uma string da memória; esvaziar é soltar a
 * referência para o coletor de lixo. Por isso o app nunca grava a memória em disco (R-14).
 */
import type {
  CredentialsClearReason,
  CredentialsInput,
  CredentialsStatus,
  Result,
} from '../shared/ipc-types.js';

const HOUR_MS = 60 * 60 * 1000;

export interface CredentialsVaultOptions {
  idleHours: number;
  onCleared(reason: CredentialsClearReason): void;
}

export class CredentialsVault {
  private credentials: CredentialsInput | null = null;
  /** Esvaziado por inatividade: a próxima tentativa explica o motivo (FR-006). */
  private expiredByIdle = false;
  private idleMs: number;
  private lastActivityAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: CredentialsVaultOptions) {
    this.idleMs = options.idleHours * HOUR_MS;
  }

  status(): CredentialsStatus {
    return {
      username: this.credentials?.username ?? null,
      hasPassword: this.credentials !== null,
    };
  }

  set(input: CredentialsInput): CredentialsStatus {
    this.credentials = { username: input.username, password: input.password };
    this.expiredByIdle = false;
    this.activity();
    return this.status();
  }

  /** "Limpar acesso" (FR-008). */
  clear(): CredentialsStatus {
    const hadCredentials = this.credentials !== null;
    this.empty();
    this.expiredByIdle = false;
    if (hadCredentials) this.options.onCleared('manual');
    return this.status();
  }

  /** Ação do operador: renova o prazo de inatividade. */
  activity(): void {
    this.lastActivityAt = Date.now();
    this.schedule();
  }

  /** Credenciais para iniciar ou retomar uma execução; elas continuam no cofre (FR-006). */
  take(): Result<CredentialsInput> {
    if (this.credentials) return { ok: true, data: { ...this.credentials } };
    return {
      ok: false,
      error: { code: this.expiredByIdle ? 'credentials_expired' : 'credentials_missing' },
    };
  }

  setIdleHours(idleHours: number): void {
    this.idleMs = idleHours * HOUR_MS;
    this.schedule();
  }

  /** O app está fechando: esvazia sem avisar ninguém. */
  dispose(): void {
    this.empty();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.credentials === null) return;
    const remaining = this.lastActivityAt + this.idleMs - Date.now();
    this.timer = setTimeout(() => this.expire(), Math.max(0, remaining));
  }

  private expire(): void {
    this.timer = null;
    if (this.credentials === null) return;
    if (Date.now() - this.lastActivityAt < this.idleMs) {
      this.schedule();
      return;
    }
    this.empty();
    this.expiredByIdle = true;
    this.options.onCleared('idle');
  }

  private empty(): void {
    this.credentials = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
