/**
 * @hunit/contracts — tipos da API do HUNIT Control.
 *
 * A fonte da verdade é `openapi.yaml` (constitution, princípio III). `generated.ts` é gerado
 * a partir dele e não deve ser editado à mão: rode `pnpm --filter @hunit/contracts generate`.
 */
export type { components, operations, paths } from './generated.js';
