import pg from 'pg';

/** Códigos de erro do PostgreSQL usados para reconhecer violações de restrição. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

/**
 * Procura o erro original do PostgreSQL. O Drizzle embrulha os erros de consulta, deixando o
 * original em `cause`.
 */
export function findDatabaseError(error: unknown): pg.DatabaseError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof pg.DatabaseError) return current;
    current = current.cause;
  }
  return null;
}

/** Indica se o erro é a violação de uma restrição, opcionalmente de uma restrição específica. */
export function isConstraintViolation(error: unknown, code: string, constraint?: string): boolean {
  const databaseError = findDatabaseError(error);
  if (databaseError?.code !== code) return false;
  return constraint === undefined || databaseError.constraint === constraint;
}
