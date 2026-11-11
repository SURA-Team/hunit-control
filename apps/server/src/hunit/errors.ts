import type { EvidenceMaterial } from '../evidence/material.js';

/**
 * Falhas da camada do Hunit. São os únicos erros que essa camada deixa escapar de propósito:
 * quem a usa (o executor) decide o que fazer a partir de `code`, sem conhecer telas, rotas ou
 * formatos do Hunit (constitution, princípio II).
 *
 * As mensagens são fixas ou descrevem o que era esperado; nunca citam usuário, senha ou token.
 */
export type HunitErrorCode =
  | 'invalid_credentials'
  | 'invalid_token'
  | 'two_factor_timeout'
  | 'hunit_unavailable'
  | 'screen_not_recognized'
  | 'session_expired';

export interface HunitErrorOptions {
  /** O que foi recebido do Hunit no momento da falha, para virar evidência (FR-024). */
  evidence?: EvidenceMaterial;
  /** Erro original (ex.: do Playwright), mantido só para diagnóstico nos logs. */
  cause?: unknown;
}

export class HunitError extends Error {
  readonly code: HunitErrorCode;
  readonly evidence: EvidenceMaterial | null;

  constructor(code: HunitErrorCode, message: string, options: HunitErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.evidence = options.evidence ?? null;
  }
}

/** O Hunit recusou o usuário ou a senha. */
export class InvalidCredentialsError extends HunitError {
  constructor(options?: HunitErrorOptions) {
    super('invalid_credentials', 'O Hunit recusou o usuário ou a senha.', options);
  }
}

/** O Hunit recusou o token 2FA informado. */
export class InvalidTokenError extends HunitError {
  constructor(options?: HunitErrorOptions) {
    super('invalid_token', 'O Hunit recusou o token informado.', options);
  }
}

/** A tela de verificação em duas etapas do Hunit expirou antes de o token ser aceito. */
export class TwoFactorTimeoutError extends HunitError {
  constructor(options?: HunitErrorOptions) {
    super('two_factor_timeout', 'O tempo para informar o token terminou.', options);
  }
}

/** O Hunit não respondeu ou respondeu com erro (fora do ar, lento demais, falha de rede). */
export class HunitUnavailableError extends HunitError {
  constructor(detail?: string, options?: HunitErrorOptions) {
    super(
      'hunit_unavailable',
      detail ? `O Hunit está indisponível: ${detail}` : 'O Hunit está indisponível.',
      options,
    );
  }
}

/**
 * O Hunit mostrou uma tela ou devolveu uma resposta diferente do esperado — o sinal de que o
 * Hunit mudou (SC-006). `detail` descreve o que era esperado, sem dados da tela.
 */
export class ScreenNotRecognizedError extends HunitError {
  constructor(detail: string, options?: HunitErrorOptions) {
    super('screen_not_recognized', `Tela ou resposta do Hunit não reconhecida: ${detail}`, options);
  }
}

/** A sessão do Hunit expirou no meio da execução; é preciso um novo acesso com token. */
export class SessionExpiredError extends HunitError {
  constructor(options?: HunitErrorOptions) {
    super('session_expired', 'A sessão do Hunit expirou.', options);
  }
}
