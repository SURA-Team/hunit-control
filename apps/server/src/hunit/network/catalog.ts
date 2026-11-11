import { z } from 'zod';
import { ScreenNotRecognizedError } from '../errors.js';
import type { HunitHotel } from '../gateway.js';
import { HUNIT_API_ROUTES, type HunitApiClient } from './api-client.js';

/**
 * Formato esperado de `GetCurrentUser` (research R-13a, lido do código da própria tela do
 * Hunit). Só os campos usados são conferidos; o resto da resposta (dados do usuário logado) é
 * ignorado e nunca guardado.
 */
const currentUserSchema = z.object({
  companies: z.array(
    z.object({
      id: z.union([z.number().int(), z.string().min(1)]),
      name: z.string().trim().min(1),
      isActive: z.boolean(),
    }),
  ),
});

/**
 * Catálogo de hotéis da conta (FR-008): os hotéis ativos de `GetCurrentUser.companies`. O `id`
 * de cada hotel é o código usado nas consultas (`X-Company-Id`).
 *
 * @throws ScreenNotRecognizedError se a resposta não tiver o formato esperado (evidência: a
 *   resposta recebida).
 */
export async function readCatalog(api: HunitApiClient): Promise<HunitHotel[]> {
  const body = await api.get(HUNIT_API_ROUTES.currentUser);
  const parsed = currentUserSchema.safeParse(body);
  if (!parsed.success) {
    throw new ScreenNotRecognizedError(
      'a resposta de GetCurrentUser não traz a lista de hotéis (companies) no formato esperado',
      { evidence: { response: JSON.stringify(body) } },
    );
  }

  return parsed.data.companies
    .filter((company) => company.isActive)
    .map((company) => ({ code: String(company.id), name: company.name }));
}
