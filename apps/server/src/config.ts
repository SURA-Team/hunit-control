import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Tamanho mínimo do segredo usado no HMAC que identifica a conta do Hunit (research R-11). */
const MIN_ACCOUNT_KEY_SECRET_LENGTH = 32;

const integer = (minimum: number, maximum?: number) => {
  const schema = z.coerce
    .number('deve ser um número inteiro')
    .int('deve ser um número inteiro')
    .min(minimum, `deve ser no mínimo ${minimum}`);
  return maximum === undefined ? schema : schema.max(maximum, `deve ser no máximo ${maximum}`);
};

const httpsUrl = z
  .url('deve ser uma URL válida')
  .refine((value) => value.startsWith('https://'), 'deve começar com https://');

const environmentSchema = z.object({
  PORT: integer(1, 65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS, `deve ser um de: ${LOG_LEVELS.join(', ')}`).default('info'),

  DATABASE_URL: z
    .string('é obrigatória (ex.: postgres://usuario:senha@host:5432/banco)')
    .regex(/^postgres(ql)?:\/\/\S+$/, 'deve começar com postgres:// ou postgresql://'),

  ACCOUNT_KEY_SECRET: z
    .string('é obrigatória (um valor aleatório e secreto)')
    .min(
      MIN_ACCOUNT_KEY_SECRET_LENGTH,
      `deve ter no mínimo ${MIN_ACCOUNT_KEY_SECRET_LENGTH} caracteres`,
    ),

  HUNIT_WEB_URL: httpsUrl.default('https://hunit.hsystem.com.br'),
  HUNIT_API_URL: httpsUrl.default('https://hunit-api.hsystem.com.br'),
  // Padrão de 5 min: o Hunit aceitou o token 491 s depois de a tela abrir (research R-13).
  TWO_FACTOR_TIMEOUT_SECONDS: integer(10, 600).default(300),
  HOTEL_CONCURRENCY: integer(1).default(1),
  MAX_PERIOD_DAYS: integer(1).optional(),

  EVIDENCE_DIR: z.string().default('/data/evidence'),
  EVIDENCE_RETENTION_DAYS: integer(1).default(30),
  RESERVATION_RETENTION_YEARS: integer(1).default(5),

  // Planilha do Comercial (specs/005, research R-04). As duas ou nenhuma: sem elas, a integração
  // fica desligada. O conteúdo da chave nunca vem por variável, só o caminho do arquivo.
  COMMERCIAL_SHEET_ID: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{20,100}$/,
      'deve ser o identificador da planilha (letras, números, - e _)',
    )
    .optional(),
  COMMERCIAL_SHEET_KEY_FILE: z
    .string()
    .regex(/^\/\S+$/, 'deve ser o caminho absoluto do arquivo da chave dentro do container')
    .optional(),
  COMMERCIAL_SHEET_DONE_RETENTION_DAYS: integer(1).default(90),
});

export interface AppConfig {
  port: number;
  logLevel: LogLevel;
  databaseUrl: string;
  /** Segredo do HMAC que identifica a conta do Hunit sem guardar o usuário (research R-11). */
  accountKeySecret: string;
  hunit: {
    webUrl: string;
    apiUrl: string;
    /** Tempo máximo de espera pelo token 2FA (FR-004). */
    twoFactorTimeoutSeconds: number;
    /** Hotéis processados ao mesmo tempo (research R-08). */
    hotelConcurrency: number;
    /** Tamanho máximo de cada consulta, em dias; `null` = não dividir o período (research R-09). */
    maxPeriodDays: number | null;
  };
  evidence: {
    dir: string;
    retentionDays: number;
  };
  reservationRetentionYears: number;
  /** Planilha do Comercial (specs/005, research R-04 e R-15). */
  commercialSheet: {
    /** `null` = integração desligada (nenhuma das duas variáveis definida). */
    access: CommercialSheetAccess | null;
    /** Dias que uma linha concluída fica na aba "Concluídas" (spec FR-026). */
    doneRetentionDays: number;
  };
}

/** Onde está a planilha e a chave da conta de serviço. Os valores nunca vão para log ou resposta. */
export interface CommercialSheetAccess {
  spreadsheetId: string;
  /** Caminho do arquivo da chave dentro do container (pasta só de leitura, research R-04). */
  keyFile: string;
}

/**
 * Erro de configuração. A mensagem cita apenas o nome das variáveis e o problema — nunca os
 * valores, que podem ser segredos (senha do banco, segredo do HMAC).
 */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      ['Configuração inválida (variáveis de ambiente):', ...problems.map((p) => `- ${p}`)].join(
        '\n',
      ),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Environment = Record<string, string | undefined>;

/** Variável vazia (`NOME=`) conta como não definida, para que o valor padrão se aplique. */
function withoutBlankValues(env: Environment): Environment {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/**
 * Lê só a URL do banco. Usada pelos comandos administrativos (CLI), que não precisam das
 * demais variáveis.
 */
export function loadDatabaseUrl(env: Environment = process.env): string {
  const result = environmentSchema.pick({ DATABASE_URL: true }).safeParse(withoutBlankValues(env));
  if (!result.success) throw new ConfigError(describeIssues(result.error));
  return result.data.DATABASE_URL;
}

/**
 * Lê e valida as variáveis de ambiente (constitution, princípio V: configuração somente por
 * variáveis de ambiente). Lança `ConfigError` listando todos os problemas de uma vez.
 */
export function loadConfig(env: Environment = process.env): AppConfig {
  const result = environmentSchema.safeParse(withoutBlankValues(env));
  if (!result.success) throw new ConfigError(describeIssues(result.error));

  const values = result.data;
  const sheetAccess = commercialSheetAccessOf(
    values.COMMERCIAL_SHEET_ID,
    values.COMMERCIAL_SHEET_KEY_FILE,
  );

  return {
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    databaseUrl: values.DATABASE_URL,
    accountKeySecret: values.ACCOUNT_KEY_SECRET,
    hunit: {
      webUrl: values.HUNIT_WEB_URL,
      apiUrl: values.HUNIT_API_URL,
      twoFactorTimeoutSeconds: values.TWO_FACTOR_TIMEOUT_SECONDS,
      hotelConcurrency: values.HOTEL_CONCURRENCY,
      maxPeriodDays: values.MAX_PERIOD_DAYS ?? null,
    },
    evidence: {
      dir: values.EVIDENCE_DIR,
      retentionDays: values.EVIDENCE_RETENTION_DAYS,
    },
    reservationRetentionYears: values.RESERVATION_RETENTION_YEARS,
    commercialSheet: {
      access: sheetAccess,
      doneRetentionDays: values.COMMERCIAL_SHEET_DONE_RETENTION_DAYS,
    },
  };
}

/** As duas variáveis da planilha ou nenhuma (specs/005, research R-04). */
function commercialSheetAccessOf(
  spreadsheetId: string | undefined,
  keyFile: string | undefined,
): CommercialSheetAccess | null {
  if ((spreadsheetId === undefined) !== (keyFile === undefined)) {
    throw new ConfigError([
      'COMMERCIAL_SHEET_ID e COMMERCIAL_SHEET_KEY_FILE: defina as duas variáveis da planilha do Comercial ou nenhuma',
    ]);
  }
  return spreadsheetId !== undefined && keyFile !== undefined ? { spreadsheetId, keyFile } : null;
}

/**
 * Lê só o acesso à planilha do Comercial. Usada pelo comando `commercial-sheet`, que não precisa
 * das demais variáveis (nem do banco). `null` = integração desligada.
 */
export function loadCommercialSheetAccess(
  env: Environment = process.env,
): CommercialSheetAccess | null {
  const result = environmentSchema
    .pick({ COMMERCIAL_SHEET_ID: true, COMMERCIAL_SHEET_KEY_FILE: true })
    .safeParse(withoutBlankValues(env));
  if (!result.success) throw new ConfigError(describeIssues(result.error));
  return commercialSheetAccessOf(
    result.data.COMMERCIAL_SHEET_ID,
    result.data.COMMERCIAL_SHEET_KEY_FILE,
  );
}
