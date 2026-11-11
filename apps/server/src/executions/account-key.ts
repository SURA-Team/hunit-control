import { createHmac } from 'node:crypto';

/**
 * Identifica a conta do Hunit sem guardar o usuário (research R-11; FR-006).
 *
 * `account_key = HMAC-SHA256(usuário normalizado, ACCOUNT_KEY_SECRET)`. O usuário é normalizado
 * (sem espaços nas pontas e em minúsculas) para que "Fulano@Hotel.com " e "fulano@hotel.com"
 * sejam a mesma conta. O segredo impede que alguém com acesso ao banco descubra o usuário
 * testando uma lista de e-mails.
 */
export function accountKeyFor(username: string, secret: string): string {
  const normalized = username.trim().toLowerCase();
  return createHmac('sha256', secret).update(normalized, 'utf8').digest('hex');
}
