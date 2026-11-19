/**
 * Envios ao Comercial (specs/005, FR-001 a FR-007, FR-020; contracts/api-changes.md): conferência,
 * início, acompanhamento (estado e SSE), token, cancelamento e retomada. As escritas são só do
 * perfil operador (`OPERATOR_ONLY_OPERATIONS`).
 */
import type { operations } from '@hunit/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CommercialSheetSync } from '../../commercial-sheet/sync.js';
import { checkDispatchEligibility, uniqueReservationKeys } from '../../dispatches/eligibility.js';
import type { DispatchEvent, DispatchEventBus } from '../../dispatches/events.js';
import {
  DispatchNotFoundError,
  DispatchStillActiveError,
  NothingToResumeDispatchError,
  resumeDispatch,
} from '../../dispatches/resume.js';
import { NoEligibleReservationsError, type DispatchRunner } from '../../dispatches/runner.js';
import type { Database } from '../../persistence/db.js';
import {
  AccountBusyError,
  countDispatchItems,
  DispatchAlreadyResumedError,
  findDispatch,
  findResumeOfDispatch,
  listDispatches,
  listDispatchItems,
  type DispatchWithClient,
} from '../../persistence/dispatches-repo.js';
import { InvalidCursorError } from '../../persistence/executions-repo.js';
import { isActiveExecutionStatus, type ExecutionStatus } from '../../persistence/schema.js';
import {
  toDispatchEventView,
  toDispatchSummaryView,
  toDispatchView,
  type CommercialDispatchView,
} from '../commercial-views.js';
import { ProblemError } from '../problem.js';

type CheckBody =
  operations['checkCommercialDispatch']['requestBody']['content']['application/json'];
type CreateBody =
  operations['createCommercialDispatch']['requestBody']['content']['application/json'];
type DispatchParams = operations['getCommercialDispatch']['parameters']['path'];
type ListQuery = NonNullable<operations['listCommercialDispatches']['parameters']['query']>;
type TokenBody =
  operations['sendCommercialDispatchTwoFactor']['requestBody']['content']['application/json'];
type ResumeBody =
  operations['resumeCommercialDispatch']['requestBody']['content']['application/json'];

export interface DispatchHandlerDependencies {
  db: Database;
  dispatches?: DispatchRunner | undefined;
  dispatchEvents?: DispatchEventBus | undefined;
  commercialSheet?: CommercialSheetSync | null | undefined;
  heartbeatMs?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const FINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(['completed', 'failed', 'cancelled']);
const HEARTBEAT_MS = 15_000;
const RETRY_MS = 3_000;

function clientOf(request: FastifyRequest) {
  if (!request.client) throw new ProblemError('unauthorized');
  return request.client;
}

/** Soma valores "1234.56" em centavos, sem erro de ponto flutuante. */
function sumAmounts(amounts: readonly (string | null)[]): string {
  let cents = 0n;
  for (const amount of amounts) {
    if (amount === null) continue;
    const [whole = '0', fraction = ''] = amount.split('.');
    cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  }
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

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

const isFinal = (event: DispatchEvent) =>
  event.type === 'status_changed' && event.status !== null && FINAL_STATUSES.has(event.status);

export function createDispatchHandlers(dependencies: DispatchHandlerDependencies) {
  const { db } = dependencies;
  const heartbeatMs = dependencies.heartbeatMs ?? HEARTBEAT_MS;
  const openStreams = new Set<() => void>();

  function runner(): DispatchRunner {
    if (!dependencies.dispatches) throw new ProblemError('commercial_sheet_not_configured');
    return dependencies.dispatches;
  }

  function events(): DispatchEventBus {
    if (!dependencies.dispatchEvents) throw new ProblemError('not_found', 'Envio não encontrado.');
    return dependencies.dispatchEvents;
  }

  /** O envio só existe com a planilha configurada (FR-013; research R-04). */
  function requireSheet(): void {
    if (!dependencies.commercialSheet) {
      throw new ProblemError(
        'commercial_sheet_not_configured',
        'O servidor não tem a planilha do Comercial configurada; o envio ao Comercial está desligado.',
      );
    }
  }

  async function load(dispatchId: string): Promise<DispatchWithClient> {
    const found = await findDispatch(db, dispatchId);
    if (!found) throw new ProblemError('not_found', 'Envio não encontrado.');
    return found;
  }

  async function viewOf(found: DispatchWithClient): Promise<CommercialDispatchView> {
    const { dispatch, clientName } = found;
    const [items, counts, resumedBy, lastStatusEvent, lastEventId] = await Promise.all([
      listDispatchItems(db, dispatch.id),
      countDispatchItems(db, [dispatch.id]),
      findResumeOfDispatch(db, dispatch.id),
      dependencies.dispatchEvents?.lastStatusChange(dispatch.id) ?? null,
      dependencies.dispatchEvents?.lastEventId(dispatch.id) ?? null,
    ]);
    return toDispatchView({
      dispatch,
      clientName,
      items,
      counts: counts.get(dispatch.id) ?? {
        total: 0,
        pending: 0,
        sent: 0,
        withdrawn: 0,
        notVerified: 0,
        ignored: 0,
      },
      resumedByDispatchId: resumedBy?.id ?? null,
      lastStatusEvent,
      lastEventId,
    });
  }

  return {
    handlers: {
      /** POST /v1/commercial-dispatches/check — quem aceita o envio, sem gravar (FR-001). */
      async checkCommercialDispatch(request: FastifyRequest) {
        const { reservations } = request.body as CheckBody;
        const items = await checkDispatchEligibility(db, uniqueReservationKeys(reservations));
        const eligible = items.filter((item) => item.eligibility.eligible);
        return {
          eligible: eligible.map((item) => ({
            hotelCode: item.hotelCode,
            reservationNumber: item.reservationNumber,
            totalAmount: item.totalAmount,
            resend: item.eligibility.eligible && item.eligibility.resend,
          })),
          ignored: items.flatMap((item) =>
            item.eligibility.eligible
              ? []
              : [
                  {
                    hotelCode: item.hotelCode,
                    reservationNumber: item.reservationNumber,
                    reason: item.eligibility.reason,
                  },
                ],
          ),
          totalAmount: sumAmounts(eligible.map((item) => item.totalAmount)),
        };
      },

      /** POST /v1/commercial-dispatches — inicia o envio (FR-001, FR-002). */
      async createCommercialDispatch(request: FastifyRequest, reply: FastifyReply) {
        requireSheet();
        const client = clientOf(request);
        const body = request.body as CreateBody;
        let dispatchId: string;
        try {
          const dispatch = await runner().start({
            clientId: client.id,
            credentials: body.credentials,
            reservations: body.reservations,
          });
          dispatchId = dispatch.id;
        } catch (error) {
          if (error instanceof AccountBusyError) {
            throw new ProblemError(
              'account_busy',
              'Aguarde a execução ou o envio em andamento desta conta do Hunit terminar, ou cancele-o.',
            );
          }
          if (error instanceof NoEligibleReservationsError) {
            throw new ProblemError('no_eligible_reservations');
          }
          throw error;
        }
        request.log.info({ dispatchId }, 'envio ao Comercial iniciado');
        void reply.code(202);
        return viewOf(await load(dispatchId));
      },

      /** GET /v1/commercial-dispatches — envios, dos mais recentes para os mais antigos. */
      async listCommercialDispatches(request: FastifyRequest) {
        const query = request.query as ListQuery;
        try {
          const page = await listDispatches(db, {
            active: query.active,
            limit: query.limit ?? DEFAULT_PAGE_SIZE,
            cursor: query.cursor,
          });
          const counts = await countDispatchItems(
            db,
            page.items.map((item) => item.id),
          );
          return {
            items: page.items.map((item) =>
              toDispatchSummaryView(
                item,
                item.clientName,
                counts.get(item.id) ?? {
                  total: 0,
                  pending: 0,
                  sent: 0,
                  withdrawn: 0,
                  notVerified: 0,
                  ignored: 0,
                },
              ),
            ),
            nextCursor: page.nextCursor,
          };
        } catch (error) {
          if (error instanceof InvalidCursorError) {
            throw new ProblemError('validation_error', 'O parâmetro "cursor" é inválido.');
          }
          throw error;
        }
      },

      /** GET /v1/commercial-dispatches/{dispatchId} — estado e resultado de cada reserva. */
      async getCommercialDispatch(request: FastifyRequest) {
        const { dispatchId } = request.params as DispatchParams;
        return viewOf(await load(dispatchId));
      },

      /** POST /v1/commercial-dispatches/{dispatchId}/two-factor — entrega o token (FR-002). */
      async sendCommercialDispatchTwoFactor(request: FastifyRequest, reply: FastifyReply) {
        const { dispatchId } = request.params as DispatchParams;
        const { token } = request.body as TokenBody;
        const { dispatch } = await load(dispatchId);
        if (!dependencies.dispatches?.submitToken(dispatchId, token)) {
          throw new ProblemError(
            'not_awaiting_two_factor',
            dispatch.status === 'awaiting_2fa'
              ? 'O prazo para enviar o token terminou ou o token já foi enviado.'
              : `O envio está no estado "${dispatch.status}" e não espera um token.`,
          );
        }
        request.log.info({ dispatchId }, 'token entregue ao envio');
        return reply.code(202).send();
      },

      /** POST /v1/commercial-dispatches/{dispatchId}/cancel — cancela o envio (FR-007). */
      async cancelCommercialDispatch(request: FastifyRequest, reply: FastifyReply) {
        const client = clientOf(request);
        const { dispatchId } = request.params as DispatchParams;
        const { dispatch } = await load(dispatchId);
        const outcome = isActiveExecutionStatus(dispatch.status)
          ? await runner().cancel(dispatchId, client.id)
          : 'already_finished';
        if (outcome === 'already_finished') {
          const { dispatch: current } = await load(dispatchId);
          throw new ProblemError(
            'dispatch_already_finished',
            `O envio já terminou no estado "${current.status}".`,
          );
        }
        void reply.code(202);
        return viewOf(await load(dispatchId));
      },

      /** POST /v1/commercial-dispatches/{dispatchId}/resume — retoma as não verificadas (FR-007). */
      async resumeCommercialDispatch(request: FastifyRequest, reply: FastifyReply) {
        requireSheet();
        const client = clientOf(request);
        const { dispatchId } = request.params as DispatchParams;
        const { credentials } = request.body as ResumeBody;
        let resumedId: string;
        try {
          resumedId = (
            await resumeDispatch(
              { db, runner: runner() },
              { dispatchId, clientId: client.id, credentials },
            )
          ).id;
        } catch (error) {
          if (error instanceof DispatchNotFoundError) {
            throw new ProblemError('not_found', error.message);
          }
          if (error instanceof DispatchStillActiveError || error instanceof AccountBusyError) {
            throw new ProblemError('account_busy', error.message);
          }
          if (error instanceof NothingToResumeDispatchError) {
            throw new ProblemError('nothing_to_resume', error.message);
          }
          if (error instanceof DispatchAlreadyResumedError) {
            throw new ProblemError('dispatch_already_resumed', error.message);
          }
          if (error instanceof NoEligibleReservationsError) {
            throw new ProblemError('no_eligible_reservations');
          }
          throw error;
        }
        void reply.code(202);
        return viewOf(await load(resumedId));
      },

      /** GET /v1/commercial-dispatches/{dispatchId}/events — acompanhamento em tempo real (SSE). */
      async streamCommercialDispatchEvents(request: FastifyRequest, reply: FastifyReply) {
        const { dispatchId } = request.params as DispatchParams;
        const afterId = parseLastEventId(request.headers['last-event-id']);
        await load(dispatchId);
        const bus = events();

        reply.hijack();
        const response = reply.raw;
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        response.write(`retry: ${RETRY_MS}\n\n`);

        let closed = false;
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
          unsubscribe = await bus.subscribe(dispatchId, afterId, (event) => {
            if (closed) return;
            delivered = event.id;
            response.write(
              `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(toDispatchEventView(event))}\n\n`,
            );
            if (isFinal(event)) close();
          });
          if (closed) {
            unsubscribe();
            return;
          }
          const last = await bus.lastStatusChange(dispatchId);
          if (last && isFinal(last) && last.id <= delivered) close();
        } catch (error) {
          request.log.error({ err: error, dispatchId }, 'falha no stream de eventos do envio');
          close();
        }
      },
    },

    /** Encerra os streams abertos (o servidor está desligando). */
    closeAll() {
      for (const close of [...openStreams]) close();
    },
  };
}
