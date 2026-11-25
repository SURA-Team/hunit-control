import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const DATABASE_URL = 'postgres://hunit:senha-do-banco@db:5432/hunit';
const ACCOUNT_KEY_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';

const minimal = { DATABASE_URL, ACCOUNT_KEY_SECRET };

function configError(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('loadConfig deveria ter falhado');
}

describe('loadConfig (T010)', () => {
  it('aplica os valores padrão quando só as variáveis obrigatórias são informadas', () => {
    expect(loadConfig(minimal)).toEqual({
      port: 3000,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      accountKeySecret: ACCOUNT_KEY_SECRET,
      hunit: {
        webUrl: 'https://hunit.hsystem.com.br',
        apiUrl: 'https://hunit-api.hsystem.com.br',
        twoFactorTimeoutSeconds: 300,
        hotelConcurrency: 1,
        maxPeriodDays: null,
      },
      evidence: { dir: '/data/evidence', retentionDays: 30 },
      reservationRetentionYears: 5,
      // Sem as variáveis da planilha, a integração com o Comercial fica desligada (specs/005).
      commercialSheet: { access: null, doneRetentionDays: 90 },
    });
  });

  it('lê os valores informados, convertendo os numéricos', () => {
    const config = loadConfig({
      ...minimal,
      PORT: '8080',
      LOG_LEVEL: 'debug',
      HUNIT_WEB_URL: 'https://hunit.exemplo.test',
      HUNIT_API_URL: 'https://hunit-api.exemplo.test',
      TWO_FACTOR_TIMEOUT_SECONDS: '90',
      HOTEL_CONCURRENCY: '3',
      MAX_PERIOD_DAYS: '31',
      EVIDENCE_DIR: '/tmp/evidencias',
      EVIDENCE_RETENTION_DAYS: '10',
      RESERVATION_RETENTION_YEARS: '7',
    });

    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('debug');
    expect(config.hunit).toEqual({
      webUrl: 'https://hunit.exemplo.test',
      apiUrl: 'https://hunit-api.exemplo.test',
      twoFactorTimeoutSeconds: 90,
      hotelConcurrency: 3,
      maxPeriodDays: 31,
    });
    expect(config.evidence).toEqual({ dir: '/tmp/evidencias', retentionDays: 10 });
    expect(config.reservationRetentionYears).toBe(7);
  });

  it('trata variável vazia como não definida (ex.: MAX_PERIOD_DAYS= no .env)', () => {
    const config = loadConfig({ ...minimal, MAX_PERIOD_DAYS: '', PORT: '  ', LOG_LEVEL: '' });

    expect(config.hunit.maxPeriodDays).toBeNull();
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('falha quando DATABASE_URL e ACCOUNT_KEY_SECRET faltam, citando as duas', () => {
    const error = configError({});

    expect(error.problems).toHaveLength(2);
    expect(error.message).toContain('DATABASE_URL: é obrigatória');
    expect(error.message).toContain('ACCOUNT_KEY_SECRET: é obrigatória');
  });

  it('trata variável obrigatória vazia como ausente', () => {
    const error = configError({ DATABASE_URL: '', ACCOUNT_KEY_SECRET: '   ' });

    expect(error.message).toContain('DATABASE_URL: é obrigatória');
    expect(error.message).toContain('ACCOUNT_KEY_SECRET: é obrigatória');
  });

  it('exige HOTEL_CONCURRENCY maior ou igual a 1', () => {
    expect(configError({ ...minimal, HOTEL_CONCURRENCY: '0' }).message).toContain(
      'HOTEL_CONCURRENCY: deve ser no mínimo 1',
    );
  });

  it.each([
    ['PORT', 'abc', 'PORT: deve ser um número inteiro'],
    ['PORT', '70000', 'PORT: deve ser no máximo 65535'],
    ['MAX_PERIOD_DAYS', '0', 'MAX_PERIOD_DAYS: deve ser no mínimo 1'],
    ['MAX_PERIOD_DAYS', '1.5', 'MAX_PERIOD_DAYS: deve ser um número inteiro'],
    ['TWO_FACTOR_TIMEOUT_SECONDS', '5', 'TWO_FACTOR_TIMEOUT_SECONDS: deve ser no mínimo 10'],
    ['LOG_LEVEL', 'verbose', 'LOG_LEVEL: deve ser um de:'],
    ['HUNIT_API_URL', 'http://hunit-api.exemplo.test', 'HUNIT_API_URL: deve começar com https://'],
    ['HUNIT_WEB_URL', 'não é url', 'HUNIT_WEB_URL: deve ser uma URL válida'],
  ])('recusa %s=%s', (name, value, expected) => {
    expect(configError({ ...minimal, [name]: value }).message).toContain(expected);
  });

  it('recusa DATABASE_URL que não é do PostgreSQL', () => {
    expect(configError({ ...minimal, DATABASE_URL: 'mysql://u:p@h/db' }).message).toContain(
      'DATABASE_URL: deve começar com postgres:// ou postgresql://',
    );
  });

  it('recusa ACCOUNT_KEY_SECRET curto', () => {
    expect(configError({ ...minimal, ACCOUNT_KEY_SECRET: 'curto' }).message).toContain(
      'ACCOUNT_KEY_SECRET: deve ter no mínimo 32 caracteres',
    );
  });

  it('lista todos os problemas de uma vez', () => {
    const error = configError({ ...minimal, PORT: 'abc', HOTEL_CONCURRENCY: '0' });

    expect(error.problems).toHaveLength(2);
  });

  it('nunca inclui valores na mensagem de erro (podem ser segredos)', () => {
    const error = configError({
      DATABASE_URL: 'mysql://usuario:SENHA-SUPER-SECRETA@host/banco',
      ACCOUNT_KEY_SECRET: 'CURTO-E-SECRETO',
      PORT: 'VALOR-DA-PORTA',
      LOG_LEVEL: 'NIVEL-INVALIDO',
      HUNIT_API_URL: 'http://URL-INSEGURA.test',
    });

    for (const value of [
      'SENHA-SUPER-SECRETA',
      'CURTO-E-SECRETO',
      'VALOR-DA-PORTA',
      'NIVEL-INVALIDO',
      'URL-INSEGURA',
    ]) {
      expect(error.message).not.toContain(value);
    }
    expect(error.problems).toHaveLength(5);
  });
});

describe('loadConfig: planilha do Comercial (specs/005, T002, research R-04)', () => {
  const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab';
  const KEY_FILE = '/run/secrets/commercial-sheet/commercial-sheet-key.json';

  it('liga a integração quando as duas variáveis são informadas', () => {
    const config = loadConfig({
      ...minimal,
      COMMERCIAL_SHEET_ID: SHEET_ID,
      COMMERCIAL_SHEET_KEY_FILE: KEY_FILE,
      COMMERCIAL_SHEET_DONE_RETENTION_DAYS: '30',
    });

    expect(config.commercialSheet).toEqual({
      access: { spreadsheetId: SHEET_ID, keyFile: KEY_FILE },
      doneRetentionDays: 30,
    });
  });

  it('variáveis vazias deixam a integração desligada', () => {
    const config = loadConfig({
      ...minimal,
      COMMERCIAL_SHEET_ID: '',
      COMMERCIAL_SHEET_KEY_FILE: ' ',
    });

    expect(config.commercialSheet.access).toBeNull();
  });

  it.each([
    ['só o identificador', { COMMERCIAL_SHEET_ID: SHEET_ID }],
    ['só a chave', { COMMERCIAL_SHEET_KEY_FILE: KEY_FILE }],
  ])('recusa %s, sem mostrar o valor', (_case, env) => {
    const error = configError({ ...minimal, ...env });

    expect(error.message).toContain('defina as duas variáveis da planilha do Comercial ou nenhuma');
    expect(error.message).not.toContain(SHEET_ID);
    expect(error.message).not.toContain(KEY_FILE);
  });

  it.each([
    ['COMMERCIAL_SHEET_ID', 'curto', 'COMMERCIAL_SHEET_ID: deve ser o identificador da planilha'],
    [
      'COMMERCIAL_SHEET_KEY_FILE',
      'chave.json',
      'COMMERCIAL_SHEET_KEY_FILE: deve ser o caminho absoluto',
    ],
    [
      'COMMERCIAL_SHEET_DONE_RETENTION_DAYS',
      '0',
      'COMMERCIAL_SHEET_DONE_RETENTION_DAYS: deve ser no mínimo 1',
    ],
  ])('recusa %s=%s', (name, value, expected) => {
    expect(configError({ ...minimal, [name]: value }).message).toContain(expected);
  });
});
