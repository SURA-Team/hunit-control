import type { components } from '@hunit/contracts';
import type { FastifyReply } from 'fastify';

/** Corpo de erro no formato RFC 9457 (problem details), como definido no contrato. */
export type Problem = components['schemas']['Problem'];

/** Código estável que os clientes usam para tratar cada tipo de erro. */
export type ProblemCode = Problem['code'];

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

interface ProblemDefinition {
  status: number;
  title: string;
}

/** Status HTTP e título padrão de cada código do contrato. */
export const PROBLEMS: Readonly<Record<ProblemCode, ProblemDefinition>> = {
  validation_error: { status: 400, title: 'Requisição inválida' },
  unauthorized: { status: 401, title: 'Chave de API ausente, inválida ou revogada' },
  forbidden_for_role: {
    status: 403,
    title: 'Ação não permitida para o nível de acesso do cliente',
  },
  not_found: { status: 404, title: 'Recurso não encontrado' },
  execution_already_active: {
    status: 409,
    title: 'Já existe uma execução ativa para esta conta do Hunit',
  },
  not_awaiting_two_factor: { status: 409, title: 'A execução não está aguardando o token' },
  execution_already_finished: { status: 409, title: 'A execução já foi encerrada' },
  nothing_to_resume: { status: 409, title: 'A execução não tem hotéis pendentes para retomar' },
  evidence_expired: { status: 410, title: 'Evidência expirada' },
  internal_error: { status: 500, title: 'Erro interno' },
};

export interface ProblemOptions {
  /** Status HTTP diferente do padrão do código (ex.: 415 para um `validation_error`). */
  status?: number;
  /** Título diferente do padrão do código. */
  title?: string;
  /** Erro original, mantido só para os logs; nunca é enviado ao cliente. */
  cause?: unknown;
}

/**
 * Erro que vira uma resposta `application/problem+json`. Qualquer parte do servidor pode
 * lançá-lo; o tratador de erros da aplicação o converte na resposta HTTP.
 *
 * `detail` é enviado ao cliente: não pode conter credenciais, token nem dados internos.
 */
export class ProblemError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;

  constructor(code: ProblemCode, detail?: string, options: ProblemOptions = {}) {
    const definition = PROBLEMS[code];
    const title = options.title ?? definition.title;
    super(detail ?? title, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProblemError';
    this.code = code;
    this.status = options.status ?? definition.status;
    this.title = title;
    this.detail = detail;
  }

  toProblem(): Problem {
    return {
      type: `urn:hunit-control:problem:${this.code}`,
      title: this.title,
      status: this.status,
      code: this.code,
      ...(this.detail !== undefined && { detail: this.detail }),
    };
  }
}

/** Envia o erro como `application/problem+json`. */
export function sendProblem(reply: FastifyReply, error: ProblemError): FastifyReply {
  if (error.status === 401) {
    void reply.header('www-authenticate', 'Bearer realm="hunit-control"');
  }
  return reply.code(error.status).type(PROBLEM_CONTENT_TYPE).send(error.toProblem());
}
