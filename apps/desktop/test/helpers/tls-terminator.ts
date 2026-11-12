/**
 * Terminador TLS dos testes de ponta a ponta (specs/002, T039): faz o papel do Caddy do servidor
 * de produção — recebe HTTPS com o certificado emitido pela autoridade de teste e repassa para a
 * porta HTTP do servidor de teste. Pode ser parado e religado na mesma porta (servidor caindo e
 * voltando, SC-006) e trocar de certificado (servidor não confirmado, SC-007).
 */
import { connect, type Socket } from 'node:net';
import { createServer, type Server, type TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';
import type { TestServerCertificate } from './certificates.js';

export interface TlsTerminator {
  /** Ex.: "https://127.0.0.1:54321". */
  url: string;
  port: number;
  /** Para de aceitar conexões e derruba as abertas: "servidor indisponível". */
  stop(): Promise<void>;
  /** Volta a escutar na mesma porta. */
  start(): Promise<void>;
  useCertificate(certificate: TestServerCertificate): void;
  close(): Promise<void>;
}

export async function startTlsTerminator(options: {
  certificate: TestServerCertificate;
  targetPort: number;
}): Promise<TlsTerminator> {
  let certificate = options.certificate;
  const sockets = new Set<Socket>();
  let server: Server | null = null;
  let port = 0;

  const listen = async () => {
    const next = createServer(
      { key: certificate.privateKeyPem, cert: certificate.certificatePem },
      (client: TLSSocket) => {
        const upstream = connect(options.targetPort, '127.0.0.1');
        for (const socket of [client, upstream]) {
          sockets.add(socket);
          socket.on('close', () => sockets.delete(socket));
          socket.on('error', () => {
            client.destroy();
            upstream.destroy();
          });
        }
        client.pipe(upstream);
        upstream.pipe(client);
      },
    );
    next.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve, reject) => {
      next.once('error', reject);
      next.listen(port, '127.0.0.1', () => resolve());
    });
    port = (next.address() as AddressInfo).port;
    server = next;
  };

  const stop = async () => {
    const current = server;
    server = null;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
  };

  await listen();

  return {
    get url() {
      return `https://127.0.0.1:${port}`;
    },
    get port() {
      return port;
    },
    stop,
    start: listen,
    useCertificate(next) {
      certificate = next;
      server?.setSecureContext({ key: next.privateKeyPem, cert: next.certificatePem });
    },
    close: stop,
  };
}
