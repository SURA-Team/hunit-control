import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvidenceStore } from '../../src/evidence/store.js';
import { evidence } from '../../src/persistence/schema.js';
import { REDACTED, SecretRegistry } from '../../src/secrets.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertExecution } from '../helpers/factories.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let database: TestDatabase;
let dir: string;
let secrets: SecretRegistry;
let store: EvidenceStore;

beforeAll(async () => {
  database = await createTestDatabase();
  dir = await mkdtemp(path.join(tmpdir(), 'hunit-evidence-'));
  secrets = new SecretRegistry();
  store = new EvidenceStore({ db: database.db, dir, retentionDays: 30, secrets, now: () => NOW });
});

afterAll(async () => {
  await database.close();
  await rm(dir, { recursive: true, force: true });
});

async function filesOf(executionId: string): Promise<string[]> {
  try {
    return (await readdir(path.join(dir, executionId))).sort();
  } catch {
    return [];
  }
}

describe('EvidenceStore (T023, FR-024/FR-025)', () => {
  it('grava a captura e o HTML na pasta da execução e registra no banco', async () => {
    const execution = await insertExecution(database.db);

    const stored = await store.save({
      executionId: execution.id,
      hotelCode: 'H1',
      reservationNumber: '1001',
      kind: 'screen_not_recognized',
      reason: 'campo "Senha" não encontrado na tela de login',
      material: { screenshot: PNG, html: '<h1>Entrar na sua conta</h1>' },
    });

    expect(stored).toMatchObject({
      screenshotPath: `${execution.id}/${stored?.id}.png`,
      htmlPath: `${execution.id}/${stored?.id}.html`,
      responsePath: null,
      createdAt: NOW,
    });
    expect(await filesOf(execution.id)).toEqual([`${stored?.id}.html`, `${stored?.id}.png`]);
    expect(await readFile(store.resolve(stored?.screenshotPath ?? ''))).toEqual(PNG);
    expect(await readFile(store.resolve(stored?.htmlPath ?? ''), 'utf8')).toBe(
      '<h1>Entrar na sua conta</h1>',
    );

    const [row] = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.id, stored?.id ?? ''));
    expect(row).toMatchObject({
      executionId: execution.id,
      hotelCode: 'H1',
      reservationNumber: '1001',
      kind: 'screen_not_recognized',
      reason: 'campo "Senha" não encontrado na tela de login',
      screenshotPath: stored?.screenshotPath,
      htmlPath: stored?.htmlPath,
      responsePath: null,
    });
  });

  it('marca a expiração para 30 dias depois da criação (FR-025)', async () => {
    const execution = await insertExecution(database.db);

    const stored = await store.save({
      executionId: execution.id,
      kind: 'navigation_failure',
      reason: 'resposta em formato inesperado',
      material: { response: '{"inesperado":true}' },
    });

    expect(stored?.expiresAt).toEqual(new Date('2026-12-11T12:00:00.000Z'));
    const [row] = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.id, stored?.id ?? ''));
    expect(row?.createdAt).toEqual(NOW);
    expect(row?.expiresAt).toEqual(new Date('2026-12-11T12:00:00.000Z'));
    expect(row).toMatchObject({ hotelCode: null, reservationNumber: null });
  });

  it('grava a resposta do Hunit que não foi reconhecida', async () => {
    const execution = await insertExecution(database.db);
    const response = JSON.stringify({ items: 'formato inesperado' });

    const stored = await store.save({
      executionId: execution.id,
      hotelCode: 'H2',
      kind: 'screen_not_recognized',
      reason: 'a listagem não trouxe o total de reservas',
      material: { response },
    });

    expect(stored).toMatchObject({
      screenshotPath: null,
      htmlPath: null,
      responsePath: `${execution.id}/${stored?.id}.json`,
    });
    expect(await readFile(store.resolve(stored?.responsePath ?? ''), 'utf8')).toBe(response);
  });

  it('nunca grava credenciais: apaga segredos em uso e valores de campos (FR-025)', async () => {
    const execution = await insertExecution(database.db);
    const unregister = secrets.register('operador@hotel.test', 'S3nh@Forte!', '482913');

    const stored = await store.save({
      executionId: execution.id,
      kind: 'screen_not_recognized',
      reason: 'login de operador@hotel.test não reconhecido',
      material: {
        html:
          '<label id="kc-attempted-username">operador@hotel.test</label>' +
          '<input id="otp" name="otp" value="482913">' +
          '<input type="hidden" name="outro" value="valor-oculto">',
        response: JSON.stringify({ email: 'operador@hotel.test', eco: 'S3nh@Forte!' }),
      },
    });
    unregister();

    const html = await readFile(store.resolve(stored?.htmlPath ?? ''), 'utf8');
    const response = await readFile(store.resolve(stored?.responsePath ?? ''), 'utf8');
    const [row] = await database.db
      .select()
      .from(evidence)
      .where(eq(evidence.id, stored?.id ?? ''));

    for (const text of [html, response, JSON.stringify(row)]) {
      expect(text).not.toContain('operador@hotel.test');
      expect(text).not.toContain('S3nh@Forte!');
      expect(text).not.toContain('482913');
    }
    expect(html).not.toContain('valor-oculto');
    expect(html).toBe(
      `<label id="kc-attempted-username">${REDACTED}</label>` +
        '<input id="otp" name="otp"><input type="hidden" name="outro">',
    );
    expect(row?.reason).toBe(`login de ${REDACTED} não reconhecido`);
  });

  it('não grava nada quando a captura não obteve material', async () => {
    const execution = await insertExecution(database.db);

    for (const material of [{}, { html: '' }, { screenshot: Buffer.alloc(0), response: '' }]) {
      expect(
        await store.save({
          executionId: execution.id,
          kind: 'navigation_failure',
          reason: 'página fechada antes da captura',
          material,
        }),
      ).toBeNull();
    }

    expect(await filesOf(execution.id)).toEqual([]);
    expect(
      await database.db.select().from(evidence).where(eq(evidence.executionId, execution.id)),
    ).toEqual([]);
  });

  it('remove os arquivos quando o registro no banco falha', async () => {
    const unknownExecutionId = '00000000-0000-4000-8000-000000000000';

    await expect(
      store.save({
        executionId: unknownExecutionId,
        kind: 'navigation_failure',
        reason: 'execução inexistente',
        material: { screenshot: PNG, html: '<p>tela</p>', response: '{}' },
      }),
    ).rejects.toThrow();

    expect(await filesOf(unknownExecutionId)).toEqual([]);
  });

  it('recusa caminhos que saem da pasta de evidências', () => {
    expect(() => store.resolve('../fora.png')).toThrow('fora da pasta de evidências');
    expect(() => store.resolve('a/../../fora.png')).toThrow('fora da pasta de evidências');
    expect(() => store.resolve(path.resolve(dir, '..', 'fora.png'))).toThrow(
      'fora da pasta de evidências',
    );
    expect(store.resolve('execucao/arquivo.png')).toBe(path.join(dir, 'execucao', 'arquivo.png'));
  });
});
