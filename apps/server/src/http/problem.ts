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
  execution_already_resumed: { status: 409, title: 'A execução já foi retomada' },
  evidence_expired: { status: 410, title: 'Evidência expirada' },
  // Tratativas manuais (specs/003, contracts/api-changes.md §1).
  empty_file: { status: 400, title: 'O arquivo está vazio' },
  file_too_large: { status: 413, title: 'O arquivo tem mais de 25 MB' },
  unsupported_file_type: {
    status: 415,
    title: 'Tipo de arquivo não aceito ou conteúdo diferente da extensão',
  },
  file_not_found: { status: 422, title: 'O servidor não tem o arquivo informado' },
  not_eligible_for_treatment: {
    status: 409,
    title: 'A situação da reserva não aceita tratativa nem comprovante',
  },
  document_not_current: { status: 409, title: 'O documento não é mais o atual' },
  document_not_revertible: { status: 409, title: 'O documento não pode mais ser revertido' },
  proof_required: {
    status: 409,
    title: 'O valor só pode ser informado numa reserva com comprovante',
  },
  document_purged: {
    status: 410,
    title: 'O arquivo foi apagado pelo prazo de retenção',
  },
  // Envio ao Comercial (specs/005, contracts/api-changes.md).
  account_busy: {
    status: 409,
    title: 'Já existe uma execução ou um envio ativo para esta conta do Hunit',
  },
  commercial_sheet_not_configured: {
    status: 409,
    title: 'A planilha do Comercial não está configurada no servidor',
  },
  commercial_sheet_unavailable: { status: 503, title: 'A planilha do Comercial está indisponível' },
  no_eligible_reservations: {
    status: 422,
    title: 'Nenhuma das reservas aceita o envio ao Comercial',
  },
  dispatch_already_finished: { status: 409, title: 'O envio já foi encerrado' },
  dispatch_already_resumed: { status: 409, title: 'O envio já foi retomado' },
  return_awaiting_validation: {
    status: 409,
    title: 'Há um retorno do Comercial aguardando a validação do Financeiro',
  },
  return_not_awaiting_validation: {
    status: 409,
    title: 'O retorno não está aguardando validação',
  },
  return_not_confirmed: { status: 409, title: 'O retorno não está confirmado' },
  not_in_commercial_sheet: {
    status: 409,
    title: 'A reserva não está nesta situação na planilha do Comercial',
  },
  restore_expired: { status: 409, title: 'O prazo de 30 dias para reverter terminou' },
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
