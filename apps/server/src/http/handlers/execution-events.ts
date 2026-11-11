import type { operations } from '@hunit/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ExecutionEvent, ExecutionEventBus } from '../../executions/events.js';
import type { Database } from '../../persistence/db.js';
import { findExecution } from '../../persistence/executions-repo.js';
import type { ExecutionStatus } from '../../persistence/schema.js';
import { ProblemError } from '../problem.js';
import { toEventView } from '../views.js';

type ExecutionParams = operations['streamExecutionEvents']['parameters']['path'];

/** Estados em que a execução não muda mais: o stream termina depois de entregá-los. */
const FINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(['completed', 'failed', 'cancelled']);

/** Intervalo dos comentários que mantêm a conexão aberta em proxies e detectam quem saiu. */
const HEARTBEAT_MS = 15_000;

/** Tempo que o cliente espera antes de reconectar, se a conexão cair. */
const RETRY_MS = 3_000;

export interface ExecutionEventsDependencies {
  db: Database;
  events: ExecutionEventBus;
  heartbeatMs?: number;
}

/** Lê o cabeçalho `Last-Event-ID`: vazio = desde o início. */
function parseLastEventId(header: string | string[] | undefined): number {
  const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
  if (value === '') return 0;
  if (!/^\d{1,15}$/.test(value)) {
    throw new ProblemError(
      'validation_error',
      'O cabeçalho Last-Event-ID deve ser o id numérico de um evento recebido.',
    );
  }
  return Number(value);
}

/** Uma mensagem SSE: `id`, `event` e `data` (JSON de ExecutionEvent, numa linha só). */
function formatMessage(event: ExecutionEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(toEventView(event))}\n\n`;
}

function isFinal(event: ExecutionEvent): boolean {
  return (
    event.type === 'status_changed' && event.status !== null && FINAL_STATUSES.has(event.status)
  );
}

/**
 * Acompanhamento em tempo real (research R-04): `GET /v1/executions/{id}/events`.
 *
 * Reenvia os eventos posteriores ao `Last-Event-ID` e depois os novos, na ordem. O stream termina
 * quando a execução chega a um estado final (`completed`, `failed`, `cancelled`); quem conectar
 * a uma execução já encerrada recebe o histórico e o fim do stream.
 */
export function createExecutionEventsHandlers(dependencies: ExecutionEventsDependencies) {
  const { db, events } = dependencies;
  const heartbeatMs = dependencies.heartbeatMs ?? HEARTBEAT_MS;
  /** Streams abertos, para encerrá-los quando o servidor desligar. */
  const openStreams = new Set<() => void>();

  return {
    handlers: {
      async streamExecutionEvents(request: FastifyRequest, reply: FastifyReply) {
        const { executionId } = request.params as ExecutionParams;
        const afterId = parseLastEventId(request.headers['last-event-id']);
        const found = await findExecution(db, executionId);
        if (!found) throw new ProblemError('not_found', 'Execução não encontrada.');

        // Daqui em diante a resposta é escrita diretamente, aos poucos.
        reply.hijack();
        const response = reply.raw;
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          // Pede a proxies (ex.: nginx) que não segurem as mensagens.
          'x-accel-buffering': 'no',
        });
        response.write(`retry: ${RETRY_MS}\n\n`);

        let closed = false;
        /** Id do último evento que o cliente já tem (recebido agora ou numa conexão anterior). */
        let delivered = afterId;
        let unsubscribe: (() => void) | null = null;
        const heartbeat = setInterval(() => response.write(': ping\n\n'), heartbeatMs);

        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe?.();
          openStreams.delete(close);
          response.end();
        };
        openStreams.add(close);
        request.raw.on('close', close);

        try {
          unsubscribe = await events.subscribe(executionId, afterId, (event) => {
            if (closed) return;
            delivered = event.id;
            response.write(formatMessage(event));
            if (isFinal(event)) close();
          });
          if (closed) {
            unsubscribe();
            return;
          }

          // Reconexão a uma execução encerrada, cujo evento final o cliente já recebeu: nada mais
          // virá. (Se o evento final ainda está a caminho, ele chega pela assinatura e encerra.)
          const last = await events.lastStatusChange(executionId);
          if (last && isFinal(last) && last.id <= delivered) close();
        } catch (error) {
          request.log.error({ err: error, executionId }, 'falha no stream de eventos');
          close();
        }
      },
    },

    /** Encerra todos os streams abertos (o servidor está desligando). */
    closeAll() {
      for (const close of [...openStreams]) close();
    },
  };
}
