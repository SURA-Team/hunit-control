import { describe, expect, it } from 'vitest';
import { expectMatchesContract } from '../helpers/contract.js';

/**
 * O verificador de contrato é a base dos testes de contrato. Estes testes garantem que ele
 * realmente acusa respostas fora do contrato (um verificador que aceita tudo daria falsa
 * segurança).
 */
const problemResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/problem+json; charset=utf-8' },
  body: JSON.stringify(body),
});

const validProblem = {
  type: 'urn:hunit-control:problem:unauthorized',
  title: 'Chave de API ausente, inválida ou revogada',
  status: 401,
  code: 'unauthorized',
};

describe('expectMatchesContract', () => {
  it('aceita uma resposta que segue o contrato', () => {
    expect(() =>
      expectMatchesContract('listHotels', problemResponse(401, validProblem)),
    ).not.toThrow();
    expect(() =>
      expectMatchesContract('getHealth', {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: '{"status":"ok"}',
      }),
    ).not.toThrow();
  });

  it('acusa corpo sem um campo obrigatório', () => {
    const { code, ...withoutCode } = validProblem;
    expect(code).toBe('unauthorized');

    expect(() => expectMatchesContract('listHotels', problemResponse(401, withoutCode))).toThrow(
      /não segue o contrato[\s\S]*code/,
    );
  });

  it('acusa valor fora da lista permitida', () => {
    expect(() =>
      expectMatchesContract('listHotels', problemResponse(401, { ...validProblem, code: 'outro' })),
    ).toThrow(/não segue o contrato/);
    expect(() =>
      expectMatchesContract('getHealth', {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"status":"mais ou menos"}',
      }),
    ).toThrow(/não segue o contrato/);
  });

  it('acusa campo com o tipo errado', () => {
    expect(() =>
      expectMatchesContract('listHotels', problemResponse(401, { ...validProblem, status: '401' })),
    ).toThrow(/status/);
  });

  it('acusa status que o contrato não declara para a operação', () => {
    expect(() => expectMatchesContract('listHotels', problemResponse(418, validProblem))).toThrow(
      /não declara este status/,
    );
  });

  it('acusa tipo de conteúdo que o contrato não declara', () => {
    expect(() =>
      expectMatchesContract('listHotels', {
        statusCode: 401,
        headers: { 'content-type': 'text/html' },
        body: '<p>erro</p>',
      }),
    ).toThrow(/tipo de conteúdo "text\/html" não declarado/);
  });

  it('acusa corpo quando o contrato não prevê corpo', () => {
    expect(() =>
      expectMatchesContract('sendTwoFactor', {
        statusCode: 202,
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      }),
    ).toThrow(/não prevê corpo/);
    expect(() =>
      expectMatchesContract('sendTwoFactor', { statusCode: 202, headers: {}, body: '' }),
    ).not.toThrow();
  });

  it('acusa corpo que não é JSON', () => {
    expect(() =>
      expectMatchesContract('listHotels', {
        statusCode: 401,
        headers: { 'content-type': 'application/problem+json' },
        body: 'não é json',
      }),
    ).toThrow(/não é um JSON válido/);
  });

  it('acusa operação que não existe no contrato', () => {
    expect(() =>
      expectMatchesContract('operacaoInexistente', problemResponse(401, validProblem)),
    ).toThrow(/não tem a operação/);
  });

  it('valida formatos (data e hora, UUID) dentro de estruturas aninhadas', () => {
    const hotels = (lastSeenAt: string) => ({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ code: 'H1', name: 'Hotel Um', available: true, lastSeenAt }],
      }),
    });

    expect(() =>
      expectMatchesContract('listHotels', hotels('2026-11-11T12:00:00.000Z')),
    ).not.toThrow();
    expect(() => expectMatchesContract('listHotels', hotels('11/11/2026 12:00'))).toThrow(
      /lastSeenAt/,
    );
  });
});
