import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/** The port the e2e environment points OCC_API_URL and OCC_TOKEN_URL at (e2e-env.js). */
export const FAKE_OCC_PORT = 3199;

export interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  headers: IncomingMessage['headers'];
}

/** How long to hold the response to `call`, in milliseconds. */
export type HoldFor = (call: Call) => number;

/**
 * Stands in for ops-command-center and its identity provider: issues a token for the pipeline's
 * client credentials and refuses API calls without it, as the real API does (its ADR-0010).
 */
export function fakeCommandCenter(options: { delayMs?: HoldFor } = {}): Promise<{
  server: Server;
  calls: Call[];
  /** Replaces the delay applied to API responses (not to token requests); `undefined` removes it. */
  setDelay(delayMs: HoldFor | undefined): void;
  close(): Promise<void>;
}> {
  const calls: Call[] = [];
  let delayMs = options.delayMs;
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/token') {
      const form = new URLSearchParams(raw);
      const valid =
        form.get('grant_type') === 'client_credentials' &&
        form.get('client_id') === 'telemetry-pipeline' &&
        form.get('client_secret') === 'e2e-secret';
      if (!valid) return res.writeHead(401).end(JSON.stringify({ error: 'invalid_client' }));
      return res.end(JSON.stringify({ access_token: 'e2e-token', expires_in: 300 }));
    }
    calls.push({
      method: req.method!,
      url: req.url!,
      body: raw ? JSON.parse(raw) : null,
      headers: req.headers,
    });
    if (req.headers.authorization !== 'Bearer e2e-token') {
      return res.writeHead(401).end(JSON.stringify({ statusCode: 401 }));
    }
    // Held after the call is recorded, so a test can see that it arrived and that it was slow.
    const hold = delayMs?.(calls.at(-1)!) ?? 0;
    if (hold > 0) await new Promise((resolve) => setTimeout(resolve, hold));
    if (req.url === '/api/zones')
      return res.end(
        JSON.stringify([
          { id: 'zone-dc', code: 'BLD-DC' },
          { id: 'zone-hub', code: 'BLD-HUB' },
          { id: 'zone-lib', code: 'BLD-LIB' },
        ]),
      );
    if (req.url === '/api/incidents')
      return res.writeHead(201).end(JSON.stringify({ id: 'incident-1' }));
    return res.end('{}');
  };
  // The listener is not async: createServer ignores what it returns, so a rejection would go
  // unhandled. A bug in this fake becomes a 500 that the test can see.
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  // Keep-alive connections from the application's fetch would hold `close` for seconds, and the
  // next spec file listens on the same port.
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  return new Promise((resolve) =>
    server.listen(FAKE_OCC_PORT, () =>
      resolve({
        server,
        calls,
        setDelay: (next) => {
          delayMs = next;
        },
        close,
      }),
    ),
  );
}
