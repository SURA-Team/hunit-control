import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'] as const;

interface OpenApiOperation {
  operationId?: string;
  security?: unknown[];
  requestBody?: { content?: Record<string, unknown> };
  responses?: Record<string, { content?: Record<string, unknown> }>;
}

type OpenApiPathItem = Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOperation>>;

export interface OpenApiDocument {
  openapi: string;
  security?: unknown[];
  paths?: Record<string, OpenApiPathItem>;
  components?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ContractOperation {
  operationId: string;
  /** Método HTTP em maiúsculas. */
  method: string;
  /** Caminho como escrito no contrato, ex.: `/executions/{executionId}`. */
  path: string;
  /** `false` somente quando o contrato declara `security: []` para a operação. */
  requiresAuth: boolean;
  /** Tipos de conteúdo aceitos no corpo; `null` quando a operação não tem corpo. */
  requestBodyTypes: readonly string[] | null;
}

export interface Contract {
  document: OpenApiDocument;
  /** Operações do contrato, por `operationId`. */
  operations: ReadonlyMap<string, ContractOperation>;
  /** Todos os tipos de conteúdo citados no contrato (corpos e respostas). */
  contentTypes: ReadonlySet<string>;
}

/** Caminho do contrato da API, a fonte da verdade (constitution, princípio III). */
export function contractPath(): string {
  return require.resolve('@hunit/contracts/openapi.yaml');
}

/** Lê o contrato OpenAPI e indexa as operações. */
export function loadContract(): Contract {
  const document = parse(readFileSync(contractPath(), 'utf8')) as OpenApiDocument;
  const operations = new Map<string, ContractOperation>();
  const contentTypes = new Set<string>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const { operationId } = operation;
      if (!operationId) {
        throw new Error(`Contrato inválido: ${method.toUpperCase()} ${path} não tem operationId.`);
      }
      if (operations.has(operationId)) {
        throw new Error(`Contrato inválido: operationId "${operationId}" repetido.`);
      }

      const requestBodyTypes = operation.requestBody
        ? Object.keys(operation.requestBody.content ?? {})
        : null;
      for (const type of requestBodyTypes ?? []) contentTypes.add(type);
      for (const response of Object.values(operation.responses ?? {})) {
        for (const type of Object.keys(response.content ?? {})) contentTypes.add(type);
      }

      // Por segurança, só fica sem autenticação a operação que declara `security: []`.
      const security = operation.security ?? document.security;
      const isPublic = Array.isArray(security) && security.length === 0;

      operations.set(operationId, {
        operationId,
        method: method.toUpperCase(),
        path,
        requiresAuth: !isPublic,
        requestBodyTypes,
      });
    }
  }

  // As respostas de erro reutilizáveis (components.responses) também citam tipos de conteúdo.
  const sharedResponses = (document.components?.['responses'] ?? {}) as Record<
    string,
    { content?: Record<string, unknown> }
  >;
  for (const response of Object.values(sharedResponses)) {
    for (const type of Object.keys(response.content ?? {})) contentTypes.add(type);
  }

  return { document, operations, contentTypes };
}
