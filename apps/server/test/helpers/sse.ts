/** Leitura de streams Server-Sent Events nos testes. */

export interface SseMessage {
  id: string | null;
  event: string | null;
  data: string;
}

/** Interpreta um bloco SSE completo (sem a linha em branco final). Comentários e `retry` são ignorados. */
function parseBlock(block: string): SseMessage | null {
  let id: string | null = null;
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('id: ')) id = line.slice(4);
    else if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }
  return data.length > 0 ? { id, event, data: data.join('\n') } : null;
}

/**
 * Lê as mensagens de uma resposta SSE até o servidor encerrar o stream, ou até `stopWhen`
 * devolver `true` (aí a conexão é fechada pelo cliente). Falha se passar de `timeoutMs`.
 */
export async function readSse(
  response: Response,
  options: { stopWhen?: (message: SseMessage) => boolean; timeoutMs?: number } = {},
): Promise<{ messages: SseMessage[]; endedByServer: boolean }> {
  if (!response.body) throw new Error('A resposta não tem corpo.');
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  const messages: SseMessage[] = [];
  let buffer = '';

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, options.timeoutMs ?? 5_000);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (timedOut) throw new Error('Tempo esgotado lendo o stream de eventos.');
        return { messages, endedByServer: true };
      }
      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const message = parseBlock(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf('\n\n');
        if (!message) continue;
        messages.push(message);
        if (options.stopWhen?.(message)) {
          await reader.cancel();
          return { messages, endedByServer: false };
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}
