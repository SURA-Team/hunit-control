import {
  pino,
  stdSerializers,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from 'pino';
import type { LogLevel } from './config.js';
import { REDACTED, type SecretRegistry } from './secrets.js';

export type { Logger } from 'pino';

/**
 * Campos que nunca podem aparecer em log (research R-12; constitution, princípio VI).
 * Valem na raiz do objeto registrado e um nível abaixo (ex.: `{ dados: { password } }`).
 */
const SENSITIVE_KEYS = [
  'password',
  'senha',
  'token',
  'otp',
  'authorization',
  'cookie',
  'credentials',
  'username',
  'apiKey',
  'accountKeySecret',
  'databaseUrl',
];

export const REDACT_PATHS: readonly string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  // Requisições HTTP: cabeçalhos de autenticação e o corpo inteiro (pode ter senha ou token).
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body',
  'request.headers.authorization',
  'request.headers.cookie',
  'request.body',
  'headers.authorization',
  'headers.cookie',
  'body',
  'res.headers["set-cookie"]',
];

/**
 * Campos de erros de banco que repetem valores das linhas (ex.: "Failing row contains (...)"
 * do PostgreSQL, ou os parâmetros da consulta no erro do Drizzle). Podem conter dados de
 * hóspedes, então não vão para o log.
 */
const ROW_DATA_ERROR_FIELDS = new Set(['params', 'detail', 'where', 'internalQuery']);

const MAX_CAUSE_DEPTH = 5;

function typeNameOf(error: Error): string {
  return typeof error.constructor === 'function' ? error.constructor.name : error.name;
}

/** Copia o erro (e suas causas) sem os campos e trechos que repetem valores das linhas. */
function withoutRowData(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error) || depth > MAX_CAUSE_DEPTH) return error;

  const { query, params } = error as { query?: unknown; params?: unknown };
  // O erro de consulta do Drizzle junta os parâmetros à mensagem; fica só o SQL.
  const isQueryError = typeof query === 'string' && Array.isArray(params);
  const message = isQueryError ? `Failed query: ${query}` : error.message;

  const safe = new Error(message);
  safe.name = error.name;
  if (error.stack !== undefined) {
    safe.stack =
      message === error.message ? error.stack : error.stack.replace(error.message, message);
  }

  for (const [key, value] of Object.entries(error)) {
    if (key === 'cause' || ROW_DATA_ERROR_FIELDS.has(key)) continue;
    (safe as unknown as Record<string, unknown>)[key] = value;
  }
  if (error.cause !== undefined) safe.cause = withoutRowData(error.cause, depth + 1);

  return safe;
}

/** Serializa erros para o log sem os valores das linhas do banco. */
export function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  const serialized = stdSerializers.err(withoutRowData(error) as Error);
  serialized.type = typeNameOf(error);
  return serialized;
}

/**
 * Serializa uma requisição HTTP para o log: só o método e o **caminho, sem a query**. A query
 * pode ter dados pessoais — o nome do hóspede na busca de reservas (`?q=`) e o nome do arquivo no
 * envio de documentos (`?name=`) — e cabeçalhos, endereço e corpo não vão para o log
 * (specs/003, research R-13).
 */
export function serializeRequest(request: unknown): unknown {
  if (typeof request !== 'object' || request === null) return request;

  const { method, url } = request as { method?: unknown; url?: unknown };
  return {
    method: typeof method === 'string' ? method : undefined,
    url: typeof url === 'string' ? (url.split('?', 1)[0] ?? '') : undefined,
  };
}

/** Serializadores do log, inclusive os que o Fastify usa ao registrar cada requisição. */
const SERIALIZERS = { err: serializeError, req: serializeRequest };

export interface LoggerSetup {
  level: LogLevel;
  /** Segredos em uso: toda linha de log passa por `scrub` antes de ser escrita. */
  secrets?: SecretRegistry;
  /** Destino das linhas de log; o padrão é a saída padrão. Os testes informam um destino em memória. */
  destination?: DestinationStream;
}

/**
 * Cria o logger do servidor: JSON estruturado, uma linha por registro, sem dados sensíveis.
 *
 * As requisições HTTP são registradas só pelo método e pelo caminho, sem a query (`serializeRequest`).
 *
 * Três proteções se somam:
 * 1. `redact`: campos com nome sensível (senha, token, autorização...) são trocados por
 *    "[REDACTED]" antes da serialização;
 * 2. `serializeError`: erros de banco são registrados sem os valores das linhas;
 * 3. `secrets.scrub`: o texto final de cada linha tem os segredos em uso apagados, onde quer
 *    que apareçam (mensagens de erro, campos com outro nome).
 */
export function createLogger(setup: LoggerSetup): Logger {
  const { secrets } = setup;
  const options: LoggerOptions = {
    level: setup.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    serializers: SERIALIZERS,
    ...(secrets && { hooks: { streamWrite: (line: string) => secrets.scrub(line) } }),
  };

  const logger = setup.destination ? pino(options, setup.destination) : pino(options);
  // O Fastify troca o serializador de `req` pelo padrão dele (que registra a URL com a query),
  // a menos que o logger recebido exponha os seus em `serializers` (research R-13).
  return Object.assign(logger, { serializers: SERIALIZERS });
}
