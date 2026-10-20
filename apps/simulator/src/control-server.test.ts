import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { ManualClock } from './clock.ts';
import { ControlServer, type ControlServerOptions } from './control-server.ts';
import { IngestPoller } from './ingest-poller.ts';
import { ObservationStore } from './observation-store.ts';
import { DEVICES, FakeIngest, setupEngine, T0 } from './test-support.ts';

/** The tests here talk to a real server on a loopback port the system picks (port 0). */

type Json = Record<string, unknown>;

const SCENARIOS = { overheat: ['dc-env-01:temperature_c:29.2:20:60'] };
const JSON_TYPE = { 'Content-Type': 'application/json' };

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json(): Json;
}

function request(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/',
        headers: options.headers,
        // A new connection each time: a pooled one, closed by the server, would fail with
        // ECONNRESET instead of the ECONNREFUSED a closed listener gives.
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json: () => JSON.parse(text) as Json,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

const get = (port: number, path: string, headers?: Record<string, string>) =>
  request(port, { path, ...(headers ? { headers } : {}) });
const send = (port: number, method: string, path: string, body: unknown = {}) =>
  request(port, { method, path, headers: JSON_TYPE, body: JSON.stringify(body) });

interface SseEvent {
  event: string;
  data: Json;
}

/** A reader of the event stream that keeps what it has seen and can wait for an event. */
class StreamClient {
  readonly events: SseEvent[] = [];
  readonly closed: Promise<void>;
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  private readonly request: http.ClientRequest;
  private readonly waiters: {
    matches: (e: SseEvent) => boolean;
    resolve: (e: SseEvent) => void;
  }[] = [];
  private buffer = '';

  constructor(request: http.ClientRequest, response: http.IncomingMessage) {
    this.request = request;
    this.status = response.statusCode ?? 0;
    this.headers = response.headers;
    response.setEncoding('utf8');
    response.on('error', () => {}); // a stream cut off by the server or by destroy() is expected here
    response.on('data', (chunk: string) => this.onData(chunk));
    this.closed = new Promise((resolve) => response.on('close', () => resolve()));
  }

  static open(port: number): Promise<StreamClient> {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/stream' }, (res) =>
        resolve(new StreamClient(req, res)),
      );
      req.on('error', reject);
    });
  }

  waitFor(matches: (e: SseEvent) => boolean, timeoutMs = 3000): Promise<SseEvent> {
    const seen = this.events.find(matches);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `No such event within ${timeoutMs} ms; saw: ${this.events.map((e) => e.event).join(', ')}`,
            ),
          ),
        timeoutMs,
      );
      this.waiters.push({
        matches,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      });
    });
  }

  destroy(): void {
    this.request.destroy();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      if (block.startsWith(':')) continue; // a heartbeat comment
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event === undefined || data === undefined) continue;
      const parsed: SseEvent = { event, data: JSON.parse(data) as Json };
      this.events.push(parsed);
      for (const waiter of [...this.waiters]) {
        if (!waiter.matches(parsed)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(parsed);
      }
    }
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startServer(overrides: Partial<ControlServerOptions> = {}) {
  const { engine, publisher } = setupEngine();
  const ingest = new FakeIngest();
  const pollerClock = new ManualClock(T0);
  const poller = new IngestPoller({
    baseUrl: 'http://ingest:3100',
    clock: pollerClock,
    fetch: ingest.fetch,
    log: () => {},
  });
  const server = new ControlServer({
    engine,
    devices: DEVICES,
    scenarios: SCENARIOS,
    poller,
    config: { host: '127.0.0.1', port: 0, ingestUrl: 'http://ingest:3100', consoleUrl: null },
    now: () => T0,
    log: () => {},
    stream: { heartbeatMs: 0 },
    ...overrides,
  });
  cleanups.push(async () => {
    engine.stop();
    await server.close();
  });
  const { port } = await server.listen();
  await engine.start(); // as main.ts does: after the port is bound
  const tickErrors: Error[] = [];
  engine.on('tick-error', (error) => tickErrors.push(error));
  return { server, engine, publisher, ingest, pollerClock, port, tickErrors };
}

/** True for the snapshot or the `ingest` event that says ingest answered `/api/ready`. */
const ingestReady = (e: SseEvent) =>
  (e.event === 'snapshot' && (e.data.ingest as Json).status === 'ready') ||
  (e.event === 'ingest' && e.data.status === 'ready');

async function openStream(port: number): Promise<StreamClient> {
  const client = await StreamClient.open(port);
  cleanups.push(() => client.destroy());
  return client;
}

const nothingCrossOrigin = (reply: Reply) =>
  assert.deepEqual(
    Object.keys(reply.headers).filter((name) => name.startsWith('access-control-')),
    [],
  );

describe('ControlServer guards', () => {
  it('refuses a Host header that does not name this machine, and accepts the ones that do', async () => {
    const { port } = await startServer();

    for (const host of [
      'evil.example',
      'evil.example:3200',
      'localhost.evil.example',
      '127.0.0.1.evil.test',
    ]) {
      const reply = await get(port, '/api/state', { Host: host });
      assert.equal(reply.status, 403, host);
      assert.equal(reply.json().statusCode, 403);
    }
    for (const host of ['localhost:3200', 'LOCALHOST', '127.0.0.1:8080', '[::1]:3200']) {
      assert.equal((await get(port, '/api/state', { Host: host })).status, 200, host);
    }
  });

  it('refuses a command that is not application/json, and does nothing for it', async () => {
    const { port, engine } = await startServer();

    const noType = await request(port, { method: 'POST', path: '/api/devices/dc-env-01/pause' });
    const plain = await request(port, {
      method: 'POST',
      path: '/api/devices/dc-env-01/pause',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    const form = await request(port, {
      method: 'POST',
      path: '/api/devices/dc-env-01/pause',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
    });

    for (const reply of [noType, plain, form]) {
      assert.equal(reply.status, 415);
      assert.equal(reply.json().statusCode, 415);
    }
    assert.equal(engine.snapshot().devices[0]?.state, 'running');
  });

  it('accepts application/json with a charset, and an empty body', async () => {
    const { port } = await startServer();
    const withCharset = await request(port, {
      method: 'POST',
      path: '/api/reset',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: '{}',
    });
    const empty = await request(port, { method: 'POST', path: '/api/reset', headers: JSON_TYPE });
    assert.equal(withCharset.status, 200);
    assert.equal(empty.status, 200);
  });

  it('never sends a CORS header, and gives a preflight no way through', async () => {
    const { port } = await startServer();
    const replies = [
      await get(port, '/api/state', { Origin: 'https://evil.example' }),
      await get(port, '/api/nothing', { Origin: 'https://evil.example' }),
      await request(port, { method: 'POST', path: '/api/reset' }), // 415
      await get(port, '/api/state', { Host: 'evil.example' }), // 403
      await request(port, {
        method: 'OPTIONS',
        path: '/api/devices/dc-env-01/pause',
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      }),
    ];
    for (const reply of replies) nothingCrossOrigin(reply);
    const preflight = replies.at(-1) as Reply;
    assert.ok(preflight.status >= 400, `a preflight must not succeed, got ${preflight.status}`);
  });

  it('refuses a body over 16 KiB with 413, and a body that is not JSON with 400', async () => {
    const { port } = await startServer();
    const huge = await send(port, 'POST', '/api/anomalies', { pad: 'x'.repeat(17 * 1024) });
    assert.equal(huge.status, 413);
    assert.equal(huge.json().statusCode, 413);

    const broken = await request(port, {
      method: 'POST',
      path: '/api/reset',
      headers: JSON_TYPE,
      body: '{not json',
    });
    assert.equal(broken.status, 400);
    assert.match(String(broken.json().message), /not valid JSON/);
  });

  it('answers an unknown route in the error envelope, as JSON that is not cached', async () => {
    const { port } = await startServer();
    const reply = await get(port, '/api/nothing');
    assert.equal(reply.status, 404);
    assert.deepEqual(Object.keys(reply.json()).sort(), ['error', 'message', 'statusCode']);
    assert.match(String(reply.headers['content-type']), /^application\/json/);
    assert.equal(reply.headers['cache-control'], 'no-store');
  });
});

describe('ControlServer commands', () => {
  it('serves the state and runs a command against the engine', async () => {
    const { port, engine } = await startServer();
    const state = await get(port, '/api/state');
    assert.equal(state.status, 200);
    assert.equal((state.json().devices as unknown[]).length, 3);

    const paused = await send(port, 'POST', '/api/devices/dc-env-01/pause');
    assert.equal(paused.status, 200);
    assert.equal(engine.snapshot().devices[0]?.state, 'paused');
  });

  it('records what happened in the observation store, which a client pages', async () => {
    const { port } = await startServer();
    await send(port, 'POST', '/api/devices/dc-env-01/pause');
    await send(port, 'POST', '/api/scenarios/overheat/run');

    const reply = await get(port, '/api/observations?limit=100');
    const events = JSON.parse(reply.text) as { kind: string; data: Json }[];
    assert.ok(events.some((e) => e.kind === 'engine-state' && e.data.type === 'device-state'));
    assert.ok(events.some((e) => e.kind === 'scenario-run' && e.data.name === 'overheat'));
    assert.equal(reply.headers['x-next-cursor'], undefined);

    const firstPage = await get(port, '/api/observations?limit=1');
    assert.equal((JSON.parse(firstPage.text) as unknown[]).length, 1);
    assert.ok(firstPage.headers['x-next-cursor']);
  });
});

describe('ControlServer event stream', () => {
  it('opens with a snapshot of the state and the publish log', async () => {
    const { port } = await startServer();
    const client = await openStream(port);

    assert.equal(client.status, 200);
    assert.match(String(client.headers['content-type']), /^text\/event-stream/);
    const snapshot = await client.waitFor((e) => e.event === 'snapshot');
    assert.equal((snapshot.data.engine as Json).running, true);
    assert.equal((snapshot.data.devices as unknown[]).length, 3);
    assert.equal((snapshot.data.publishLog as unknown[]).length, 3); // the first tick
  });

  it('streams a state change, the observation of it, and the messages of a step', async () => {
    const { port } = await startServer();
    const client = await openStream(port);
    await client.waitFor((e) => e.event === 'snapshot');

    await send(port, 'POST', '/api/devices/dc-env-01/pause');
    const state = await client.waitFor((e) => e.event === 'state');
    assert.deepEqual(state.data, { type: 'device-state', deviceId: 'dc-env-01', state: 'paused' });
    const observation = await client.waitFor(
      (e) => e.event === 'observation' && e.data.kind === 'engine-state',
    );
    assert.equal(typeof observation.data.id, 'number');

    await send(port, 'POST', '/api/step');
    const published = await client.waitFor(
      (e) => e.event === 'published' && e.data.deviceId === 'lib-air-01' && e.data.seq === 2,
    );
    assert.equal(published.data.topic, 'campus/BLD-LIB/lib-air-01/telemetry');
    // dc-env-01 is paused: it has no second message.
    assert.equal(
      client.events.some(
        (e) => e.event === 'published' && e.data.deviceId === 'dc-env-01' && e.data.seq === 2,
      ),
      false,
    );
  });

  it('keeps the newest 200 published messages for a page that opens late', async () => {
    const { port, engine } = await startServer();
    for (let i = 0; i < 70; i++) await engine.step(); // 3 + 210 messages

    const client = await openStream(port);
    const snapshot = await client.waitFor((e) => e.event === 'snapshot');
    const log = snapshot.data.publishLog as { seq: number; deviceId: string }[];
    assert.equal(log.length, 200);
    assert.equal(log.at(-1)?.seq, 71);
    assert.equal(log.at(-1)?.deviceId, 'lib-air-01');
  });

  it('refuses a client over the limit with 503', async () => {
    const { port } = await startServer({ stream: { heartbeatMs: 0, maxClients: 1 } });
    await openStream(port);
    const second = await get(port, '/api/stream');
    assert.equal(second.status, 503);
    assert.equal(second.json().statusCode, 503);
  });

  it('ends every stream and the listener on close()', async () => {
    const { port, server } = await startServer();
    const client = await openStream(port);
    await client.waitFor((e) => e.event === 'snapshot');

    await server.close();
    await client.closed;

    await assert.rejects(get(port, '/api/state'), /ECONNREFUSED/);
  });
});

describe('ControlServer keeps publishing', () => {
  it('goes on when a stream client disappears', async () => {
    const { port, engine, publisher, tickErrors } = await startServer();
    const gone = await openStream(port);
    const stays = await openStream(port);
    await gone.waitFor((e) => e.event === 'snapshot');
    await stays.waitFor((e) => e.event === 'snapshot');

    gone.destroy();
    const before = publisher.sent.length;
    for (let i = 0; i < 3; i++) await engine.step();

    assert.equal(publisher.sent.length - before, 9);
    assert.deepEqual(tickErrors, []);
    await stays.waitFor((e) => e.event === 'published' && e.data.seq === 4);
  });

  it('goes on, and still answers the command, when the observation store is broken', async () => {
    class BrokenStore extends ObservationStore {
      override append(): never {
        throw new Error('store is broken');
      }
    }
    const logs: string[] = [];
    const { port, engine, publisher, tickErrors } = await startServer({
      store: new BrokenStore(),
      log: (line) => logs.push(line),
    });

    const paused = await send(port, 'POST', '/api/devices/dc-env-01/pause');
    const scenario = await send(port, 'POST', '/api/scenarios/overheat/run');
    const before = publisher.sent.length;
    await engine.step();

    assert.equal(paused.status, 200);
    assert.equal(scenario.status, 200);
    assert.equal(engine.snapshot().devices[0]?.state, 'paused');
    assert.equal(publisher.sent.length - before, 2);
    assert.deepEqual(tickErrors, []);
    assert.ok(logs.some((line) => line.includes('"state" listener threw')));
    assert.ok(logs.some((line) => line.includes('"record" listener threw')));
  });
});

describe('ControlServer and ingest', () => {
  it('reports ingest as unreachable on the first poll after it stops, and keeps publishing', async () => {
    const { port, engine, publisher, ingest, pollerClock } = await startServer();
    const client = await openStream(port);

    // Ingest is up: the snapshot or the first `ingest` event says so.
    await client.waitFor(ingestReady);

    ingest.up = false;
    const before = publisher.sent.length;
    await pollerClock.advance(1000); // the next poll

    const down = await client.waitFor(
      (e) => e.event === 'ingest' && e.data.status === 'unreachable',
    );
    assert.equal(down.data.detail, 'ECONNREFUSED');
    const dependency = await client.waitFor(
      (e) =>
        e.event === 'observation' &&
        e.data.kind === 'dependency' &&
        (e.data.data as Json).to === 'unreachable',
    );
    assert.equal((dependency.data.data as Json).from, 'ready');

    await engine.step();
    await client.waitFor(
      (e) => e.event === 'published' && e.data.seq === 2 && e.data.deviceId === 'lib-air-01',
    );
    assert.equal(publisher.sent.length - before, 3);
  });

  it('reports alerts it sees, with the time it saw them, on the stream', async () => {
    const { port, ingest, pollerClock } = await startServer();
    const client = await openStream(port);
    // The first poll (nothing there) is the baseline: it must be done before an alert appears.
    await client.waitFor(ingestReady);

    ingest.alerts = [
      {
        id: '1',
        deviceId: 'dc-env-01',
        ruleId: 'server-room-hot',
        metric: 'temperature_c',
        severity: 'high',
        title: 'Server room temperature high',
        status: 'open',
        openedAt: '2026-10-01T05:00:00.000Z',
        openedValue: 29.3,
        clearedAt: null,
        clearedValue: null,
        externalRef: null,
        deliveryStatus: 'pending',
        deliveryAttempts: 0,
        deliveryError: null,
      },
    ];
    await pollerClock.advance(1000);

    const opened = await client.waitFor(
      (e) => e.event === 'observation' && e.data.kind === 'alert-opened',
    );
    assert.equal((opened.data.data as Json).alertId, '1');
    // The time is the poller's clock at the second poll, not the engine's.
    assert.equal(opened.data.at, new Date(T0 + 1000).toISOString());
  });
});

describe('ControlServer listen', () => {
  it('says which settings to change when the port is taken, and leaves the engine alone', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
    const taken = (blocker.address() as net.AddressInfo).port;

    const { engine } = setupEngine();
    const poller = new IngestPoller({
      baseUrl: 'http://ingest:3100',
      clock: new ManualClock(T0),
      fetch: new FakeIngest().fetch,
      log: () => {},
    });
    const server = new ControlServer({
      engine,
      devices: DEVICES,
      scenarios: SCENARIOS,
      poller,
      config: { host: '127.0.0.1', port: taken, ingestUrl: 'http://ingest:3100', consoleUrl: null },
      log: () => {},
    });

    await assert.rejects(server.listen(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /EADDRINUSE/);
      assert.match(error.message, /CONTROL_PORT/);
      assert.match(error.message, new RegExp(`127\\.0\\.0\\.1:${taken}`));
      return true;
    });
    assert.equal(engine.listenerCount('state'), 0);
    assert.equal(engine.listenerCount('published'), 0);
    assert.equal(engine.snapshot().running, false);
  });
});
