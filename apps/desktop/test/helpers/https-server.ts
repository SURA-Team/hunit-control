/**
 * Servidor HTTPS local para os testes do processo principal (specs/002, T014): usa os
 * certificados gerados no teste, registra as requisições que chegaram aos manipuladores e responde
 * o que cada teste programar — inclusive fluxos de eventos (SSE).
 */
import { createServer, type Server } from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { TestServerCertificate } from './certificates.js';

export interface RecordedRequest {
  method: string;
  /** Caminho sem a consulta (ex.: "/v1/me"). */
  path: string;
  /** Consulta como veio (ex.: "active=true"). */
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: string;
}

export type Handler = (request: RecordedRequest, response: ServerResponse) => void | Promise<void>;

export interface TestHttpsServer {
  /** Ex.: "https://127.0.0.1:54321". */
  url: string;
  port: number;
  /** Requisições que chegaram a um manipulador (o aperto de mão TLS passou). */
  requests: RecordedRequest[];
  /** Programa a resposta de um método e caminho (substitui a anterior). */
  on(method: string, path: string, handler: Handler): void;
  /** Esquece as respostas programadas e as requisições registradas. */
  reset(): void;
  /** Troca o certificado apresentado (próximas conexões). */
  useCertificate(certificate: TestServerCertificate): void;
  close(): Promise<void>;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

export function sendProblem(
  response: ServerResponse,
  status: number,
  code: string,
  detail?: string,
): void {
  response.writeHead(status, { 'content-type': 'application/problem+json' });
  response.end(
    JSON.stringify({ type: 'about:blank', title: code, status, code, ...(detail && { detail }) }),
  );
}

export interface SseStream {
  send(event: { id: number | string; event: string; data: unknown }): void;
  close(): void;
}

/** Abre um fluxo de eventos na resposta. */
export function openSse(response: ServerResponse): SseStream {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  response.flushHeaders();
  return {
    send({ id, event, data }) {
      response.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      response.end();
    },
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startHttpsServer(
  certificate: TestServerCertificate,
): Promise<TestHttpsServer> {
  const handlers = new Map<string, Handler>();
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer(
    { key: certificate.privateKeyPem, cert: certificate.certificatePem },
    (request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'https://localhost');
        const recorded: RecordedRequest = {
          method: request.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          headers: request.headers,
          body: await readBody(request),
        };
        requests.push(recorded);
        const handler = handlers.get(`${recorded.method} ${recorded.path}`);
        if (!handler) {
          sendProblem(response, 404, 'not_found', `Sem resposta programada: ${recorded.path}`);
          return;
        }
        await handler(recorded, response);
      })().catch((error: unknown) => {
        if (!response.headersSent) sendProblem(response, 500, 'internal_error', String(error));
        else response.destroy();
      });
    },
  );
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  // Falhas de TLS do lado do cliente aparecem aqui; não interessam aos testes.
  server.on('tlsClientError', () => undefined);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `https://127.0.0.1:${port}`,
    port,
    requests,
    on(method, path, handler) {
      handlers.set(`${method} ${path}`, handler);
    },
    reset() {
      handlers.clear();
      requests.length = 0;
    },
    useCertificate(next) {
      server.setSecureContext({ key: next.privateKeyPem, cert: next.certificatePem });
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
