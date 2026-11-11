import type { components } from '@hunit/contracts';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type { Logger } from '../logging.js';
import type { Database } from '../persistence/db.js';
import { executionEvents, type ExecutionStatus } from '../persistence/schema.js';
import type { SecretRegistry } from '../secrets.js';

/** Tipos de evento, como definidos no contrato da API. */
export type ExecutionEventType = components['schemas']['ExecutionEvent']['type'];

export interface ExecutionEvent {
  /** Sequencial; define a ordem dos eventos e é o `id` das mensagens SSE. */
  id: number;
  executionId: string;
  at: Date;
  type: ExecutionEventType;
  /** Novo estado da execução, nos eventos `status_changed`. */
  status: ExecutionStatus | null;
  hotelCode: string | null;
  reservationNumber: string | null;
  message: string;
}

export interface NewExecutionEvent {
  executionId: string;
  type: ExecutionEventType;
  /** Texto para o operador. Não pode conter credenciais nem nome de hóspede. */
  message: string;
  status?: ExecutionStatus | null;
  hotelCode?: string | null;
  reservationNumber?: string | null;
}

export type ExecutionEventListener = (event: ExecutionEvent) => void;

export interface ExecutionEventBusOptions {
  db: Database;
  /** Segredos em uso: apagados da mensagem antes de gravar (FR-005). */
  secrets: SecretRegistry;
  logger?: Logger;
}

/** Eventos frequentes demais para o nível `info` do log (um por página ou por reserva). */
const VERBOSE_EVENT_TYPES: ReadonlySet<ExecutionEventType> = new Set([
  'page_done',
  'reservation_classified',
]);

type EventRow = typeof executionEvents.$inferSelect;

function toEvent(row: EventRow): ExecutionEvent {
  return { ...row, type: row.type as ExecutionEventType };
}

/**
 * Barramento de eventos das execuções (FR-021; research R-04).
 *
 * Cada evento é gravado em `execution_events` e entregue, na mesma ordem, a quem estiver
 * acompanhando a execução em tempo real (SSE). A gravação vem antes da entrega: um cliente
 * que reconecta sempre consegue recuperar pelo banco o que perdeu.
 */
export class ExecutionEventBus {
  private readonly listeners = new Map<string, Set<ExecutionEventListener>>();
  /** Última publicação pendente de cada execução, para manter a ordem. */
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(private readonly options: ExecutionEventBusOptions) {}

  /**
   * Grava o evento e o entrega aos assinantes.
   *
   * As publicações de uma mesma execução são feitas uma por vez, na ordem em que foram
   * pedidas; assim os identificadores crescem na ordem de entrega mesmo com publicações
   * simultâneas.
   */
  publish(event: NewExecutionEvent): Promise<ExecutionEvent> {
    const { executionId } = event;
    const previous = this.tails.get(executionId) ?? Promise.resolve();
    // Uma publicação que falhou não impede as seguintes.
    const current = previous.then(
      () => this.persistAndDeliver(event),
      () => this.persistAndDeliver(event),
    );

    this.tails.set(executionId, current);
    const forget = () => {
      if (this.tails.get(executionId) === current) this.tails.delete(executionId);
    };
    current.then(forget, forget);

    return current;
  }

  /**
   * Acompanha uma execução: entrega os eventos já gravados com `id` maior que `afterId` e,
   * em seguida, os novos — em ordem, sem repetir e sem pular nenhum, mesmo que eventos sejam
   * publicados durante a leitura do histórico.
   *
   * @returns função que encerra o acompanhamento.
   */
  async subscribe(
    executionId: string,
    afterId: number,
    listener: ExecutionEventListener,
  ): Promise<() => void> {
    let lastDelivered = afterId;
    let replaying = true;
    const arrivedDuringReplay: ExecutionEvent[] = [];

    const deliver = (event: ExecutionEvent) => {
      if (event.id <= lastDelivered) return;
      lastDelivered = event.id;
      this.notify(listener, event);
    };
    const live: ExecutionEventListener = (event) => {
      if (replaying) arrivedDuringReplay.push(event);
      else deliver(event);
    };

    // Assina antes de ler o histórico: o que for publicado durante a leitura fica guardado.
    this.addListener(executionId, live);
    try {
      const history = await this.listAfter(executionId, afterId);
      for (const event of history) deliver(event);
      for (const event of arrivedDuringReplay) deliver(event);
    } catch (error) {
      this.removeListener(executionId, live);
      throw error;
    }
    replaying = false;

    return () => this.removeListener(executionId, live);
  }

  /** Os eventos mais recentes de uma execução, do mais antigo para o mais novo. */
  async listRecent(executionId: string, limit = 50): Promise<ExecutionEvent[]> {
    const rows = await this.options.db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.executionId, executionId))
      .orderBy(desc(executionEvents.id))
      .limit(limit);
    return rows.reverse().map(toEvent);
  }

  /** Quantidade de assinantes de uma execução (para diagnóstico e testes). */
  subscriberCount(executionId: string): number {
    return this.listeners.get(executionId)?.size ?? 0;
  }

  private async listAfter(executionId: string, afterId: number): Promise<ExecutionEvent[]> {
    const rows = await this.options.db
      .select()
      .from(executionEvents)
      .where(and(eq(executionEvents.executionId, executionId), gt(executionEvents.id, afterId)))
      .orderBy(asc(executionEvents.id));
    return rows.map(toEvent);
  }

  private async persistAndDeliver(input: NewExecutionEvent): Promise<ExecutionEvent> {
    const [row] = await this.options.db
      .insert(executionEvents)
      .values({
        executionId: input.executionId,
        type: input.type,
        status: input.status ?? null,
        hotelCode: input.hotelCode ?? null,
        reservationNumber: input.reservationNumber ?? null,
        message: this.options.secrets.scrub(input.message),
      })
      .returning();
    if (!row) throw new Error('O banco não devolveu o evento gravado.');

    const event = toEvent(row);
    this.log(event);
    for (const listener of this.listeners.get(event.executionId) ?? []) {
      this.notify(listener, event);
    }
    return event;
  }

  /** Um assinante com defeito não pode derrubar a execução nem os outros assinantes. */
  private notify(listener: ExecutionEventListener, event: ExecutionEvent): void {
    try {
      listener(event);
    } catch (error) {
      this.options.logger?.warn(
        { err: error, executionId: event.executionId, eventId: event.id },
        'falha ao entregar um evento a um assinante',
      );
    }
  }

  private log(event: ExecutionEvent): void {
    const { logger } = this.options;
    if (!logger) return;

    const fields = {
      executionId: event.executionId,
      eventId: event.id,
      eventType: event.type,
      ...(event.status && { status: event.status }),
      ...(event.hotelCode && { hotelCode: event.hotelCode }),
      ...(event.reservationNumber && { reservationNumber: event.reservationNumber }),
    };
    if (VERBOSE_EVENT_TYPES.has(event.type)) logger.debug(fields, event.message);
    else logger.info(fields, event.message);
  }

  private addListener(executionId: string, listener: ExecutionEventListener): void {
    const listeners = this.listeners.get(executionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(executionId, listeners);
  }

  private removeListener(executionId: string, listener: ExecutionEventListener): void {
    const listeners = this.listeners.get(executionId);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) this.listeners.delete(executionId);
  }
}
