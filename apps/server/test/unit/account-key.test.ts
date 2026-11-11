import { describe, expect, it } from 'vitest';
import { accountKeyFor } from '../../src/executions/account-key.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';

describe('accountKeyFor', () => {
  it('é estável e não contém o usuário', () => {
    const key = accountKeyFor('operador@hotel.test', SECRET);

    expect(key).toBe(accountKeyFor('operador@hotel.test', SECRET));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('operador');
  });

  it('ignora maiúsculas e espaços nas pontas (mesma conta)', () => {
    expect(accountKeyFor('  Operador@Hotel.TEST ', SECRET)).toBe(
      accountKeyFor('operador@hotel.test', SECRET),
    );
  });

  it('distingue contas diferentes', () => {
    expect(accountKeyFor('a@hotel.test', SECRET)).not.toBe(accountKeyFor('b@hotel.test', SECRET));
  });

  it('depende do segredo', () => {
    expect(accountKeyFor('operador@hotel.test', SECRET)).not.toBe(
      accountKeyFor('operador@hotel.test', `${SECRET}-outro`),
    );
  });
});
