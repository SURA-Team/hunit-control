import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { REDACTED, SecretRegistry } from '../../src/secrets.js';
import { captureLogs } from '../helpers/log-capture.js';

describe('logger (T014, research R-12)', () => {
  it('escreve uma linha JSON por registro, com horário ISO', () => {
    const logs = captureLogs();

    logs.logger.info({ executionId: 'e-1', hotelCode: 'H1' }, 'hotel iniciado');

    expect(logs.lines).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({
      level: 30,
      executionId: 'e-1',
      hotelCode: 'H1',
      msg: 'hotel iniciado',
    });
    expect(logs.records()[0]?.['time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('respeita o nível configurado', () => {
    const logs = captureLogs({ level: 'warn' });

    logs.logger.info('ignorado');
    logs.logger.warn('registrado');

    expect(logs.records().map((record) => record['msg'])).toEqual(['registrado']);
  });

  it('troca campos sensíveis por [REDACTED]', () => {
    const logs = captureLogs();

    logs.logger.info(
      {
        password: 'senha-raiz',
        token: '111111',
        authorization: 'Bearer chave-raiz',
        credentials: { username: 'usuario-cred', password: 'senha-cred' },
        req: {
          method: 'POST',
          headers: { authorization: 'Bearer chave-req', cookie: 'sessao=cookie-req' },
          body: { credentials: { password: 'senha-no-corpo' } },
        },
        dados: { password: 'senha-aninhada', token: '222222', username: 'usuario-aninhado' },
        hotelCode: 'H1',
      },
      'tentativa de acesso',
    );

    const text = logs.text();
    for (const secret of [
      'senha-raiz',
      '111111',
      'chave-raiz',
      'usuario-cred',
      'senha-cred',
      'chave-req',
      'cookie-req',
      'senha-no-corpo',
      'senha-aninhada',
      '222222',
      'usuario-aninhado',
    ]) {
      expect(text).not.toContain(secret);
    }

    expect(logs.records()[0]).toMatchObject({
      password: REDACTED,
      credentials: REDACTED,
      req: { method: 'POST', headers: { authorization: REDACTED }, body: REDACTED },
      hotelCode: 'H1',
      msg: 'tentativa de acesso',
    });
  });

  it('apaga segredos registrados onde quer que apareçam, mantendo o JSON válido', () => {
    const secrets = new SecretRegistry();
    const password = 'S3nh@"Forte\\2026';
    secrets.register('operador@hotel.test', password);
    const logs = captureLogs({ secrets });

    logs.logger.error(
      {
        // O Playwright pode citar o valor digitado na mensagem de erro.
        err: new Error(`locator.fill: Timeout. Call log: fill("${password}")`),
        profundo: { a: { b: { c: `valor ${password}` } } },
        outroNome: 'operador@hotel.test',
      },
      `falha no login de operador@hotel.test com ${password}`,
    );

    const text = logs.text();
    expect(text).not.toContain(password);
    expect(text).not.toContain(JSON.stringify(password).slice(1, -1));
    expect(text).not.toContain('operador@hotel.test');
    expect(text).toContain(REDACTED);

    const [record] = logs.records(); // continua sendo JSON válido
    expect(record?.['msg']).toBe(`falha no login de ${REDACTED} com ${REDACTED}`);
  });

  it('registra erros de banco sem os valores das linhas (podem ter dados de hóspedes)', () => {
    const logs = captureLogs();
    const query = 'insert into "reservations" ("guest_name") values ($1)';
    const databaseError = Object.assign(
      new Error('new row for relation "reservations" violates check constraint "x_check"'),
      {
        code: '23514',
        constraint: 'x_check',
        table: 'reservations',
        detail: 'Failing row contains (H1, 1001, Hóspede Secreto, Booking.com).',
        where: 'COPY reservations, line 1: "Hóspede Secreto"',
      },
    );

    logs.logger.error(
      { err: new DrizzleQueryError(query, ['Hóspede Secreto'], databaseError) },
      'falha ao gravar o hotel',
    );

    expect(logs.text()).not.toContain('Hóspede Secreto');

    const record = logs.records()[0]?.['err'] as Record<string, unknown>;
    expect(record['type']).toBe('DrizzleQueryError');
    expect(record['query']).toBe(query);
    expect(record['params']).toBeUndefined();
    // A causa (o erro do PostgreSQL) continua visível, sem o detalhe da linha.
    expect(record['message']).toContain('violates check constraint "x_check"');
    expect(record['stack']).toContain('violates check constraint "x_check"');
  });

  it('mantém os campos úteis de um erro do PostgreSQL registrado diretamente', () => {
    const logs = captureLogs();
    const databaseError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'reservations_pk',
      detail: 'Key (guest_name)=(Hóspede Secreto) already exists.',
    });

    logs.logger.error({ err: databaseError }, 'falha');

    expect(logs.text()).not.toContain('Hóspede Secreto');
    expect(logs.records()[0]?.['err']).toMatchObject({
      type: 'Error',
      message: 'duplicate key value',
      code: '23505',
      constraint: 'reservations_pk',
    });
  });

  it('volta a registrar o texto normalmente depois que o segredo é removido', () => {
    const secrets = new SecretRegistry();
    const unregister = secrets.register('valor-temporario');
    const logs = captureLogs({ secrets });

    logs.logger.info('antes: valor-temporario');
    unregister();
    logs.logger.info('depois: valor-temporario');

    expect(logs.records().map((record) => record['msg'])).toEqual([
      `antes: ${REDACTED}`,
      'depois: valor-temporario',
    ]);
  });
});
