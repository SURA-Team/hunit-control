/**
 * Sessão do Hunit de uma automação — a execução da consulta (specs/001) ou o envio ao Comercial
 * (specs/005, research R-01): login, espera do token 2FA informado pelo operador, proteção dos
 * segredos e o motivo de encerramento de cada falha do Hunit.
 *
 * Extraído do `ExecutionRunner` sem mudança de comportamento (tasks.md, T018): as duas automações
 * usam exatamente a mesma regra para credenciais e token (constitution, princípios IV e VI).
 */
import { TwoFactorTimeoutError, type HunitErrorCode } from '../hunit/errors.js';
import type { HunitCredentials, HunitGateway } from '../hunit/gateway.js';
import type { ExecutionEndReason } from '../persistence/schema.js';
import type { SecretRegistry } from '../secrets.js';

/** Motivo de encerramento de cada falha da camada do Hunit (FR-003 da 001). */
export const END_REASON_BY_HUNIT_ERROR: Readonly<Record<HunitErrorCode, ExecutionEndReason>> = {
  invalid_credentials: 'invalid_credentials',
  invalid_token: 'invalid_token',
  two_factor_timeout: 'two_factor_timeout',
  hunit_unavailable: 'hunit_unavailable',
  screen_not_recognized: 'hunit_screen_not_recognized',
  session_expired: 'session_expired',
};

/** Hora de Brasília, para as mensagens ao operador (ex.: prazo do token). */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Funções que removem do `SecretRegistry` os segredos de uma automação. */
export interface RunSecrets {
  /** Usuário: fica registrado até o fim da automação. */
  releaseUsername: () => void;
  /** Senha e token: removidos assim que o acesso é concluído. */
  releaseAccess: Array<() => void>;
}

/**
 * Registra usuário e senha antes de qualquer gravação: uma falha logo no início não leva os
 * valores ao log (FR-005 da 001).
 */
export function registerRunSecrets(
  secrets: SecretRegistry,
  credentials: HunitCredentials,
): RunSecrets {
  return {
    releaseUsername: secrets.register(credentials.username),
    releaseAccess: [secrets.register(credentials.password)],
  };
}

/** Acesso concluído: senha e token não são mais necessários (FR-005 da 001). */
export function releaseAccess(secrets: RunSecrets): void {
  for (const release of secrets.releaseAccess.splice(0)) release();
}

export function releaseAll(secrets: RunSecrets): void {
  releaseAccess(secrets);
  secrets.releaseUsername();
}

/**
 * Espera do token 2FA (FR-002 e FR-004 da 001). Só o primeiro token entregue vale; a espera
 * termina no prazo (`TwoFactorTimeoutError`) ou quando a automação é interrompida (`abort`).
 */
export class TokenGate {
  private waiter: { resolve(token: string): void; reject(error: Error): void } | null = null;

  /** A automação está esperando o token neste momento. */
  get waiting(): boolean {
    return this.waiter !== null;
  }

  /**
   * Começa a esperar e chama `announce` com o prazo (é quem muda o estado para `awaiting_2fa` e
   * avisa o operador). Resolve com o token; rejeita no fim do prazo ou se a espera for interrompida.
   */
  async wait(options: {
    timeoutMs: number;
    now: Date;
    announce: (deadline: Date) => Promise<void>;
  }): Promise<string> {
    const deadline = new Date(options.now.getTime() + options.timeoutMs);
    let timer: NodeJS.Timeout | undefined;
    const token = new Promise<string>((resolve, reject) => {
      this.waiter = { resolve, reject };
      timer = setTimeout(() => {
        this.waiter = null;
        reject(new TwoFactorTimeoutError());
      }, options.timeoutMs);
    });
    // Evita o aviso de "rejeição não tratada" se o prazo acabar antes de começarmos a esperar.
    token.catch(() => undefined);

    try {
      await options.announce(deadline);
      return await token;
    } finally {
      clearTimeout(timer);
      this.waiter = null;
    }
  }

  /** Entrega o token. `false` se ninguém está esperando (prazo acabou, já recebeu um ou parou). */
  submit(token: string): boolean {
    const waiter = this.waiter;
    if (!waiter) return false;
    this.waiter = null;
    waiter.resolve(token);
    return true;
  }

  /** Interrompe a espera (cancelamento, servidor desligando). */
  abort(error: Error): void {
    this.waiter?.reject(error);
    this.waiter = null;
  }
}

export interface AuthenticateInput {
  gateway: HunitGateway;
  credentials: HunitCredentials;
  secrets: SecretRegistry;
  runSecrets: RunSecrets;
  tokenGate: TokenGate;
  timeoutMs: number;
  now: () => Date;
  /** Lança se a parada foi pedida (cancelamento, servidor desligando). */
  throwIfStopping: () => void;
  /** O Hunit pediu o token: muda o estado para `awaiting_2fa` e avisa o operador. */
  announceAwaiting: (deadline: Date) => Promise<void>;
  /** O token chegou: volta para `running` antes de concluir o acesso. */
  announceTokenReceived: () => Promise<void>;
}

/**
 * Faz o login e, se o Hunit pedir, espera o token do operador e o entrega. Ao terminar sem erro, o
 * acesso está concluído e a senha e o token já saíram do `SecretRegistry`.
 */
export async function authenticate(input: AuthenticateInput): Promise<void> {
  const outcome = await input.gateway.login(input.credentials);
  input.throwIfStopping();
  if (outcome === 'two_factor_required') {
    const token = await input.tokenGate.wait({
      timeoutMs: input.timeoutMs,
      now: input.now(),
      announce: input.announceAwaiting,
    });
    input.runSecrets.releaseAccess.push(input.secrets.register(token));
    await input.announceTokenReceived();
    await input.gateway.submitToken(token);
  }
  releaseAccess(input.runSecrets);
  input.throwIfStopping();
}
