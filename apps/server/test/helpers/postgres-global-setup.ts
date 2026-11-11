/**
 * Preparação global dos testes que usam banco (projeto `server-db` do Vitest).
 *
 * Sobe UM container PostgreSQL para toda a rodada de testes e informa o endereço aos arquivos
 * de teste. Cada arquivo cria o seu próprio banco, isolado dos demais (ver `db.ts`).
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

/** Mesma versão do PostgreSQL usada no docker-compose.yml. */
const POSTGRES_IMAGE = 'postgres:17';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL de conexão administrativa do PostgreSQL de testes. */
    postgresAdminUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (error) {
    throw new Error(
      'Não foi possível subir o PostgreSQL de testes. Os testes do projeto "server-db" ' +
        'precisam do Docker em execução (abra o Docker Desktop e tente de novo). ' +
        'Para rodar só os testes que não usam banco: pnpm test --project domain --project server',
      { cause: error },
    );
  }

  project.provide('postgresAdminUrl', container.getConnectionUri());
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
