/**
 * Estado da conexão com o servidor (specs/002, FR-001, FR-002, FR-005, data-model §4.1, research
 * R-08). O processo principal mantém o estado e o envia à interface a cada mudança:
 *
 *   não configurado ──(configuração salva)──► conectando
 *   conectando ──(health + /me)──► online
 *   conectando / online ──(rede)──► indisponível ──(health a cada 5 s volta)──► conectando
 *   conectando / online ──(certificado)──► servidor não confirmado
 *   conectando / online ──(401)──► chave recusada
 *
 * Em "servidor não confirmado" e "chave recusada" o app não tenta de novo sozinho: o operador
 * precisa corrigir a configuração (FR-002 — não existe "continuar mesmo assim").
 */
import type {
  AppError,
  ClientIdentity,
  ConnectionState,
  ConnectionStatus,
  Result,
} from '../shared/ipc-types.js';

/** O que o estado da conexão usa do cliente da API. */
export interface ConnectionApi {
  getHealth(): Promise<Result<{ status: 'ok' }>>;
  getMe(): Promise<Result<ClientIdentity>>;
  close(): Promise<void>;
}

export interface ConnectionManagerOptions<Config, Api extends ConnectionApi> {
  /** Configuração atual; `null` = não configurado. */
  loadConfig(): Promise<Config | null>;
  createApi(config: Config): Api;
  onState(state: ConnectionState): void;
  /** Intervalo entre os testes quando o servidor está indisponível. Padrão: 5 s. */
  retryIntervalMs?: number;
  /**
   * Intervalo entre os testes com o servidor no ar: a queda é percebida mesmo sem nenhuma tela
   * consultando (FR-005). Padrão: 30 s.
   */
  onlineCheckIntervalMs?: number;
}

export class ConnectionManager<Config = unknown, Api extends ConnectionApi = ConnectionApi> {
  private state: ConnectionState = {
    status: 'not_configured',
    client: null,
    checkedAt: new Date().toISOString(),
  };
  private api: Api | null = null;
  private config: Config | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Aumenta a cada reconexão: respostas de uma tentativa antiga são ignoradas. */
  private generation = 0;
  private readonly retryIntervalMs: number;
  private readonly onlineCheckIntervalMs: number;

  constructor(private readonly options: ConnectionManagerOptions<Config, Api>) {
    this.retryIntervalMs = options.retryIntervalMs ?? 5_000;
    this.onlineCheckIntervalMs = options.onlineCheckIntervalMs ?? 30_000;
  }

  getState(): ConnectionState {
    return this.state;
  }

  /** Cliente da API da configuração atual, mesmo fora do ar; `null` = não configurado. */
  getApi(): Api | null {
    return this.api;
  }

  /** Lê a configuração e conecta. */
  async start(): Promise<void> {
    await this.reconnect();
  }

  /** Configuração salva ou removida: recria o cliente e conecta de novo. */
  async reconnect(): Promise<void> {
    this.generation += 1;
    this.stopRetrying();
    const previous = this.api;
    this.api = null;
    this.config = await this.options.loadConfig();
    if (previous) await previous.close();

    if (this.config === null) {
      this.setState('not_configured', null);
      return;
    }
    this.api = this.options.createApi(this.config);
    await this.check(this.generation);
  }

  /**
   * Outro módulo recebeu erro de rede, de certificado ou de chave numa chamada à API: o estado
   * passa a refletir isso (indisponível volta sozinho).
   */
  reportFailure(error: AppError): void {
    if (this.api === null) return;
    if (error.code === 'offline') this.goOffline();
    else if (error.code === 'untrusted_server') this.setState('untrusted_server', null);
    else if (error.code === 'unauthorized') this.setState('unauthorized', null);
  }

  /** Para o teste periódico (o app está fechando). */
  async dispose(): Promise<void> {
    this.generation += 1;
    this.stopRetrying();
    const api = this.api;
    this.api = null;
    if (api) await api.close();
  }

  private async check(generation: number): Promise<void> {
    const api = this.api;
    if (api === null) return;
    this.setState('connecting', null);

    const health = await api.getHealth();
    if (generation !== this.generation) return;
    if (!health.ok) {
      this.fail(health.error);
      return;
    }
    const me = await api.getMe();
    if (generation !== this.generation) return;
    if (!me.ok) {
      this.fail(me.error);
      return;
    }
    this.setState('online', me.data);
    this.scheduleOnlineCheck(generation);
  }

  /** Com o servidor no ar, testa `/health` de tempos em tempos para perceber uma queda. */
  private scheduleOnlineCheck(generation: number): void {
    this.stopRetrying();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.onlineCheck(generation);
    }, this.onlineCheckIntervalMs);
  }

  private async onlineCheck(generation: number): Promise<void> {
    const api = this.api;
    if (api === null || generation !== this.generation || this.state.status !== 'online') return;
    const health = await api.getHealth();
    if (generation !== this.generation || this.state.status !== 'online') return;
    if (health.ok) this.scheduleOnlineCheck(generation);
    else this.fail(health.error);
  }

  private fail(error: AppError): void {
    if (error.code === 'untrusted_server') this.setState('untrusted_server', null);
    else if (error.code === 'unauthorized') this.setState('unauthorized', null);
    else this.goOffline();
  }

  private goOffline(): void {
    this.setState('offline', null);
    this.stopRetrying();
    this.scheduleRetry();
  }

  /** Em indisponível, testa `/health` a cada intervalo; quando volta, reconecta (health + /me). */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const generation = this.generation;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retry(generation);
    }, this.retryIntervalMs);
  }

  private async retry(generation: number): Promise<void> {
    const api = this.api;
    if (api === null || generation !== this.generation || this.state.status !== 'offline') return;
    const health = await api.getHealth();
    if (generation !== this.generation) return;
    if (health.ok) {
      await this.check(generation);
    } else if (health.error.code === 'offline') {
      this.scheduleRetry();
    } else {
      this.fail(health.error);
    }
  }

  private stopRetrying(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setState(status: ConnectionStatus, client: ClientIdentity | null): void {
    const unchanged =
      this.state.status === status &&
      this.state.client?.name === client?.name &&
      this.state.client?.role === client?.role;
    if (unchanged) return;
    this.state = { status, client, checkedAt: new Date().toISOString() };
    this.options.onState(this.state);
  }
}
