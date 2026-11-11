import { defineConfig } from 'drizzle-kit';

// Usado só para GERAR migrations a partir do schema (não precisa de banco):
//   pnpm --filter @hunit/server db:generate --name=<descricao>
// As migrations são aplicadas pelo próprio servidor ao iniciar (src/persistence/db.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/persistence/schema.ts',
  out: './src/persistence/migrations',
});
