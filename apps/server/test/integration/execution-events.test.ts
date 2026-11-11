import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ExecutionEventBus,
  type ExecutionEvent,
  type NewExecutionEvent,
} from '../../src/executions/events.js';
import { executionEvents } from '../../src/persistence/schema.js';
import { REDACTED, SecretRegistry } from '../../src/secrets.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { insertExecution } from '../helpers/factories.js';
import { captureLogs, type CapturedLogs } from '../helpers/log-capture.js';

let database: TestDatabase;
let secrets: SecretRegistry;
let logs: CapturedLogs;
let bus: ExecutionEventBus;

beforeAll(async () => {
  database = await createTestDatabase();
  secrets = new SecretRegistry();
  logs = captureLogs({ secrets });
  bus = new ExecutionEventBus({ db: database.db, secrets, logger: logs.logger });
});

afterAll(async () => {
  await database.close();
});

async function newExecutionId(): Promise<string> {
  return (await insertExecution(database.db)).id;
}

function pageDone(executionId: string, page: number): NewExecutionEvent {
  return { executionId, type: 'page_done', hotelCode: 'H1', message: `página ${page} concluída` };
}

const messagesOf = (events: ExecutionEvent[]) => events.map((event) => event.message);

describe('ExecutionEventBus — publicação (T024, FR-021)', () => {
  it('grava o evento e devolve o identificador e o horário', async () => {
    const executionId = await newExecutionId();

    const event = await bus.publish({
      executionId,
      type: 'status_changed',
      status: 'awaiting_2fa',
      message: 'aguardando o token de verificação',
    });

    expect(event).toMatchObject({
      executionId,
      type: 'status_changed',
      status: 'awaiting_2fa',
      hotelCode: null,
      reservationNumber: null,
      message: 'aguardando o token de verificação',
    });
    expect(event.id).toBeGreaterThan(0);
    expect(event.at).toBeInstanceOf(Date);

    const rows = await database.db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.executionId, executionId));
    expect(rows).toEqual([event]);
  });

  it('mantém a ordem de publicação mesmo com publicações simultâneas', async () => {
    const executionId = await newExecutionId();
    const received: ExecutionEvent[] = [];
    const unsubscribe = await bus.subscribe(executionId, 0, (event) => received.push(event));

    const published = await Promise.all(
      Array.from({ length: 40 }, (_unused, index) => bus.publish(pageDone(executionId, index + 1))),
    );
    unsubscribe();

    const ids = published.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(messagesOf(received)).toEqual(
      Array.from({ length: 40 }, (_unused, index) => `página ${index + 1} concluída`),
    );
    expect(received.map((event) => event.id)).toEqual(ids);
  });

  it('apaga segredos em uso da mensagem antes de gravar (FR-005)', async () => {
    const executionId = await newExecutionId();
    const unregister = secrets.register('operador@hotel.test', 'S3nh@Forte!');

    const event = await bus.publish({
      executionId,
      type: 'hotel_failed',
      hotelCode: 'H1',
      message: 'falha no acesso de operador@hotel.test com S3nh@Forte!',
    });
    unregister();

    expect(event.message).toBe(`falha no acesso de ${REDACTED} com ${REDACTED}`);
    const [row] = await database.db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.id, event.id));
    expect(row?.message).toBe(event.message);
    expect(logs.text()).not.toContain('S3nh@Forte!');
  });

  it('rejeita a publicação quando a gravação falha, sem travar as seguintes', async () => {
    const executionId = await newExecutionId();
    const unknownExecutionId = '00000000-0000-4000-8000-000000000000';

    await expect(bus.publish(pageDone(unknownExecutionId, 1))).rejects.toThrow();
    await expect(bus.publish(pageDone(unknownExecutionId, 2))).rejects.toThrow();
    await expect(bus.publish(pageDone(executionId, 1))).resolves.toMatchObject({
      message: 'página 1 concluída',
    });
  });

  it('registra no log os eventos, com os mais frequentes só no nível de depuração', async () => {
    const executionId = await newExecutionId();
    logs.lines.length = 0;

    await bus.publish({
      executionId,
      type: 'hotel_started',
      hotelCode: 'H1',
      message: 'hotel iniciado',
    });
    await bus.publish(pageDone(executionId, 1));

    const records = logs.records();
    expect(records.find((record) => record['msg'] === 'hotel iniciado')).toMatchObject({
      level: 30,
      executionId,
      hotelCode: 'H1',
      eventType: 'hotel_started',
    });
    expect(records.find((record) => record['msg'] === 'página 1 concluída')).toMatchObject({
      level: 20,
    });
  });
});

describe('ExecutionEventBus — acompanhamento em tempo real (T024, research R-04)', () => {
  it('entrega o histórico posterior ao último evento visto e depois os eventos novos', async () => {
    const executionId = await newExecutionId();
    const first = await bus.publish(pageDone(executionId, 1));
    await bus.publish(pageDone(executionId, 2));
    await bus.publish(pageDone(executionId, 3));

    const received: ExecutionEvent[] = [];
    const unsubscribe = await bus.subscribe(executionId, first.id, (event) => received.push(event));
    await bus.publish(pageDone(executionId, 4));
    unsubscribe();

    expect(messagesOf(received)).toEqual([
      'página 2 concluída',
      'página 3 concluída',
      'página 4 concluída',
    ]);
  });

  it('não repete nem pula eventos publicados enquanto o histórico é lido', async () => {
    const executionId = await newExecutionId();
    for (let page = 1; page <= 5; page += 1) await bus.publish(pageDone(executionId, page));

    const received: ExecutionEvent[] = [];
    // A assinatura e as novas publicações começam ao mesmo tempo.
    const [unsubscribe] = await Promise.all([
      bus.subscribe(executionId, 0, (event) => received.push(event)),
      ...Array.from({ length: 10 }, (_unused, index) =>
        bus.publish(pageDone(executionId, index + 6)),
      ),
    ]);
    await bus.publish(pageDone(executionId, 16));
    unsubscribe();

    expect(messagesOf(received)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => `página ${index + 1} concluída`),
    );
    const ids = received.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('entrega só os eventos da execução acompanhada', async () => {
    const watched = await newExecutionId();
    const other = await newExecutionId();
    const received: ExecutionEvent[] = [];
    const unsubscribe = await bus.subscribe(watched, 0, (event) => received.push(event));

    await bus.publish(pageDone(other, 1));
    await bus.publish(pageDone(watched, 1));
    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]?.executionId).toBe(watched);
  });

  it('para de entregar depois que o acompanhamento é encerrado', async () => {
    const executionId = await newExecutionId();
    const received: ExecutionEvent[] = [];
    const unsubscribe = await bus.subscribe(executionId, 0, (event) => received.push(event));
    expect(bus.subscriberCount(executionId)).toBe(1);

    await bus.publish(pageDone(executionId, 1));
    unsubscribe();
    unsubscribe(); // encerrar duas vezes não causa erro
    await bus.publish(pageDone(executionId, 2));

    expect(messagesOf(received)).toEqual(['página 1 concluída']);
    expect(bus.subscriberCount(executionId)).toBe(0);
  });

  it('um assinante com defeito não derruba a publicação nem os outros assinantes', async () => {
    const executionId = await newExecutionId();
    const received: ExecutionEvent[] = [];
    const stopBroken = await bus.subscribe(executionId, 0, () => {
      throw new Error('assinante com defeito');
    });
    const stopHealthy = await bus.subscribe(executionId, 0, (event) => received.push(event));

    await expect(bus.publish(pageDone(executionId, 1))).resolves.toBeDefined();
    stopBroken();
    stopHealthy();

    expect(messagesOf(received)).toEqual(['página 1 concluída']);
  });
});

describe('ExecutionEventBus — eventos recentes (FR-021)', () => {
  it('devolve os últimos eventos da execução, do mais antigo para o mais novo', async () => {
    const executionId = await newExecutionId();
    for (let page = 1; page <= 7; page += 1) await bus.publish(pageDone(executionId, page));

    expect(messagesOf(await bus.listRecent(executionId, 3))).toEqual([
      'página 5 concluída',
      'página 6 concluída',
      'página 7 concluída',
    ]);
    expect(await bus.listRecent(executionId)).toHaveLength(7);
    expect(await bus.listRecent(await newExecutionId())).toEqual([]);
  });
});
