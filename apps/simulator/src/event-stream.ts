/** What the stream needs of a response; `http.ServerResponse` is one, a test passes a fake. */
export interface StreamResponse {
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  /** Bytes accepted by `write` that the socket has not taken yet. */
  readonly writableLength: number;
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(): unknown;
  destroy(error?: Error): unknown;
  on(event: 'close', listener: () => void): unknown;
}

export interface EventStreamOptions {
  /** At most this many clients; the next one is refused. */
  maxClients?: number;
  /** A client with more than this many bytes queued is slow or gone, and is dropped. */
  maxBufferedBytes?: number;
  /** A comment line every so often keeps idle connections open. 0 turns it off. */
  heartbeatMs?: number;
}

export const MAX_CLIENTS = 20;
export const MAX_BUFFERED_BYTES = 1024 * 1024;
export const HEARTBEAT_MS = 15_000;

/**
 * The server-sent-events fan-out: every client gets every event, each as
 * `event: <name>` and `data: <json>`.
 *
 * It is written to be called from inside the engine's event handlers, so nothing here may throw: a
 * socket that is destroyed, errors or falls behind is dropped, and `send` goes on to the others.
 * (An exception in a listener of the engine's `published` event would otherwise turn a message that
 * was sent into a failed tick.)
 */
export class EventStream {
  private readonly clients = new Set<StreamResponse>();
  private readonly maxClients: number;
  private readonly maxBufferedBytes: number;
  private readonly heartbeatMs: number;
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(options: EventStreamOptions = {}) {
    this.maxClients = options.maxClients ?? MAX_CLIENTS;
    this.maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Opens the stream on a response and sends `initial` as its first message. Returns false, having
   * written nothing, when there are already too many clients: the caller answers 503.
   */
  add(response: StreamResponse, initial: { event: string; data: unknown }): boolean {
    if (this.clients.size >= this.maxClients) return false;
    try {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    } catch {
      this.drop(response);
      return true;
    }
    this.clients.add(response);
    response.on('close', () => this.remove(response));
    try {
      this.write(response, frame(initial.event, initial.data));
    } catch {
      this.drop(response); // the first message is not JSON: a bug of the caller
      return true;
    }
    this.startHeartbeat();
    return true;
  }

  /** Sends one event to every client. Never throws. */
  send(event: string, data: unknown): void {
    let text: string;
    try {
      text = frame(event, data);
    } catch {
      return; // not JSON (a cycle, a bigint): a bug of the caller, not worth stopping the engine for
    }
    for (const client of [...this.clients]) this.write(client, text);
  }

  /** Ends every stream and stops the heartbeat. */
  close(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const client of [...this.clients]) {
      this.remove(client);
      try {
        client.end();
      } catch {
        this.drop(client);
      }
    }
  }

  private write(client: StreamResponse, text: string): void {
    try {
      if (client.destroyed || client.writableEnded) {
        this.remove(client);
        return;
      }
      client.write(text);
      if (client.writableLength > this.maxBufferedBytes) this.drop(client);
    } catch {
      this.drop(client);
    }
  }

  private remove(client: StreamResponse): void {
    this.clients.delete(client);
    if (this.clients.size === 0) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  private drop(client: StreamResponse): void {
    this.remove(client);
    try {
      client.destroy();
    } catch {
      // Already gone; nothing left to release.
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat || this.heartbeatMs <= 0) return;
    this.heartbeat = setInterval(() => {
      for (const client of [...this.clients]) this.write(client, ': keep-alive\n\n');
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
