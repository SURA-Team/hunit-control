/**
 * Eventos dos envios ao Comercial (specs/005, FR-007; data-model §1.3), para o acompanhamento em
 * tempo real (SSE) — o mesmo modelo de `executions/events.ts`: cada evento é gravado antes de ser
 * entregue, na ordem, a quem acompanha o envio. Mensagens nunca citam credenciais nem hóspedes; o
 * `SecretRegistry` apaga qualquer ocorrência antes de gravar.
 */
import type { components } from '@hunit/contracts';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type { Logger } from '../logging.js';
import type { Database } from '../persistence/db.js';
import { commercialDispatchEvents, type ExecutionStatus } from '../persistence/schema.js';
import type { SecretRegistry } from '../secrets.js';

export type DispatchEventType = components['schemas']['CommercialDispatchEvent']['type'];

export interface DispatchEvent {
  id: number;
  dispatchId: string;
  at: Date;
  type: DispatchEventType;
  status: ExecutionStatus | null;
  hotelCode: string | null;
  reservationNumber: string | null;
  message: string;
}

export interface NewDispatchEvent {
  dispatchId: string;
  type: DispatchEventType;
  /** Texto para o operador. Não pode conter credenciais nem nome de hóspede. */
  message: string;
  status?: ExecutionStatus | null;
  hotelCode?: string | null;
  reservationNumber?: string | null;
}

export type DispatchEventListener = (event: DispatchEvent) => void;

type EventRow = typeof commercialDispatchEvents.$inferSelect;

function toEvent(row: EventRow): DispatchEvent {
  return { ...row, type: row.type as DispatchEventType };
}

export class DispatchEventBus {
  private readonly listeners = new Map<string, Set<DispatchEventListener>>();
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly options: { db: Database; secrets: SecretRegistry; logger?: Logger },
  ) {}

  /** Grava e entrega o evento; as publicações de um envio saem uma por vez, na ordem pedida. */
  publish(event: NewDispatchEvent): Promise<DispatchEvent> {
    const { dispatchId } = event;
    const previous = this.tails.get(dispatchId) ?? Promise.resolve();
    const current = previous.then(
      () => this.persistAndDeliver(event),
      () => this.persistAndDeliver(event),
    );
    this.tails.set(dispatchId, current);
    const forget = () => {
      if (this.tails.get(dispatchId) === current) this.tails.delete(dispatchId);
    };
    current.then(forget, forget);
    return current;
  }

  /**
   * Entrega os eventos gravados depois de `afterId` e, em seguida, os novos — sem repetir nem
   * pular, mesmo com publicações durante a leitura do histórico.
   */
  async subscribe(
    dispatchId: string,
    afterId: number,
    listener: DispatchEventListener,
  ): Promise<() => void> {
    let lastDelivered = afterId;
    let replaying = true;
    const arrived: DispatchEvent[] = [];
    const deliver = (event: DispatchEvent) => {
      if (event.id <= lastDelivered) return;
      lastDelivered = event.id;
      this.notify(listener, event);
    };
    const live: DispatchEventListener = (event) => {
      if (replaying) arrived.push(event);
      else deliver(event);
    };

    this.addListener(dispatchId, live);
    try {
      const history = await this.options.db
        .select()
        .from(commercialDispatchEvents)
        .where(
          and(
            eq(commercialDispatchEvents.dispatchId, dispatchId),
            gt(commercialDispatchEvents.id, afterId),
          ),
        )
        .orderBy(asc(commercialDispatchEvents.id));
      for (const row of history) deliver(toEvent(row));
      for (const event of arrived) deliver(event);
    } catch (error) {
      this.removeListener(dispatchId, live);
      throw error;
    }
    replaying = false;
    return () => this.removeListener(dispatchId, live);
  }

  /** Último `status_changed` do envio (para a mensagem de encerramento e o fim do stream). */
  async lastStatusChange(dispatchId: string): Promise<DispatchEvent | null> {
    const [row] = await this.options.db
      .select()
      .from(commercialDispatchEvents)
      .where(
        and(
          eq(commercialDispatchEvents.dispatchId, dispatchId),
          eq(commercialDispatchEvents.type, 'status_changed'),
        ),
      )
      .orderBy(desc(commercialDispatchEvents.id))
      .limit(1);
    return row ? toEvent(row) : null;
  }

  /** Id do evento mais recente do envio (o acompanhamento começa depois dele); null = nenhum. */
  async lastEventId(dispatchId: string): Promise<number | null> {
    const [row] = await this.options.db
      .select({ id: commercialDispatchEvents.id })
      .from(commercialDispatchEvents)
      .where(eq(commercialDispatchEvents.dispatchId, dispatchId))
      .orderBy(desc(commercialDispatchEvents.id))
      .limit(1);
    return row?.id ?? null;
  }

  private async persistAndDeliver(input: NewDispatchEvent): Promise<DispatchEvent> {
    const [row] = await this.options.db
      .insert(commercialDispatchEvents)
      .values({
        dispatchId: input.dispatchId,
        type: input.type,
        status: input.status ?? null,
        hotelCode: input.hotelCode ?? null,
        reservationNumber: input.reservationNumber ?? null,
        message: this.options.secrets.scrub(input.message),
      })
      .returning();
    if (!row) throw new Error('O banco não devolveu o evento gravado.');
    const event = toEvent(row);
    this.options.logger?.info(
      {
        dispatchId: event.dispatchId,
        eventId: event.id,
        eventType: event.type,
        ...(event.status && { status: event.status }),
        ...(event.hotelCode && { hotelCode: event.hotelCode }),
        ...(event.reservationNumber && { reservationNumber: event.reservationNumber }),
      },
      event.message,
    );
    for (const listener of this.listeners.get(event.dispatchId) ?? []) this.notify(listener, event);
    return event;
  }

  private notify(listener: DispatchEventListener, event: DispatchEvent): void {
    try {
      listener(event);
    } catch (error) {
      this.options.logger?.warn(
        { err: error, dispatchId: event.dispatchId, eventId: event.id },
        'falha ao entregar um evento de envio a um assinante',
      );
    }
  }

  private addListener(dispatchId: string, listener: DispatchEventListener): void {
    const listeners = this.listeners.get(dispatchId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(dispatchId, listeners);
  }

  private removeListener(dispatchId: string, listener: DispatchEventListener): void {
    const listeners = this.listeners.get(dispatchId);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) this.listeners.delete(dispatchId);
  }
}
