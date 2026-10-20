import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { EventStream, type StreamResponse } from './event-stream.ts';

class FakeResponse implements StreamResponse {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  status: number | undefined;
  headers: Record<string, string> = {};
  written: string[] = [];
  closeListeners: (() => void)[] = [];
  failWrites = false;

  writeHead(status: number, headers: Record<string, string>): void {
    this.status = status;
    this.headers = headers;
  }

  write(chunk: string): boolean {
    if (this.failWrites) throw new Error('write after destroy');
    this.written.push(chunk);
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  on(_event: 'close', listener: () => void): void {
    this.closeListeners.push(listener);
  }

  /** The client went away. */
  disconnect(): void {
    this.destroyed = true;
    for (const listener of this.closeListeners) listener();
  }
}

const streams: EventStream[] = [];
function newStream(options = {}): EventStream {
  const stream = new EventStream({ heartbeatMs: 0, ...options });
  streams.push(stream);
  return stream;
}
afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

const initial = { event: 'snapshot', data: { devices: 6 } };

describe('EventStream framing', () => {
  it('opens an event stream and sends the initial message first', () => {
    const stream = newStream();
    const client = new FakeResponse();
    assert.equal(stream.add(client, initial), true);

    assert.equal(client.status, 200);
    assert.equal(client.headers['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.equal(client.headers['Cache-Control'], 'no-cache, no-transform');
    assert.deepEqual(client.written, ['event: snapshot\ndata: {"devices":6}\n\n']);
    assert.equal(stream.size, 1);
  });

  it('sends every event to every client, in order, on one line of data', () => {
    const stream = newStream();
    const a = new FakeResponse();
    const b = new FakeResponse();
    stream.add(a, initial);
    stream.add(b, initial);

    stream.send('state', { type: 'reset' });
    stream.send('published', { text: 'line one\nline two' });

    for (const client of [a, b]) {
      assert.deepEqual(client.written.slice(1), [
        'event: state\ndata: {"type":"reset"}\n\n',
        'event: published\ndata: {"text":"line one\\nline two"}\n\n',
      ]);
    }
  });

  it('does not send a message that cannot be written as JSON, and does not throw', () => {
    const stream = newStream();
    const client = new FakeResponse();
    stream.add(client, initial);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    assert.doesNotThrow(() => stream.send('state', cycle));
    assert.doesNotThrow(() => stream.send('state', 1n));
    assert.equal(client.written.length, 1);
    assert.equal(stream.size, 1);
  });
});

describe('EventStream clients that fail', () => {
  it('forgets a client that disconnects', () => {
    const stream = newStream();
    const gone = new FakeResponse();
    const kept = new FakeResponse();
    stream.add(gone, initial);
    stream.add(kept, initial);

    gone.disconnect();
    stream.send('state', {});

    assert.equal(stream.size, 1);
    assert.equal(gone.written.length, 1);
    assert.equal(kept.written.length, 2);
  });

  it('drops a client whose write throws, without throwing, and still serves the others', () => {
    const stream = newStream();
    const broken = new FakeResponse();
    const healthy = new FakeResponse();
    stream.add(broken, initial);
    stream.add(healthy, initial);
    broken.failWrites = true;

    assert.doesNotThrow(() => stream.send('state', {}));

    assert.equal(stream.size, 1);
    assert.equal(broken.destroyed, true);
    assert.equal(healthy.written.length, 2);
  });

  it('drops a destroyed or ended client that never sent close', () => {
    const stream = newStream();
    const destroyed = new FakeResponse();
    const ended = new FakeResponse();
    stream.add(destroyed, initial);
    stream.add(ended, initial);
    destroyed.destroyed = true;
    ended.writableEnded = true;

    stream.send('state', {});
    assert.equal(stream.size, 0);
  });

  it('drops a client that has fallen more than the limit behind', () => {
    const stream = newStream({ maxBufferedBytes: 100 });
    const slow = new FakeResponse();
    const quick = new FakeResponse();
    stream.add(slow, initial);
    stream.add(quick, initial);

    slow.writableLength = 101;
    stream.send('state', {});

    assert.equal(stream.size, 1);
    assert.equal(slow.destroyed, true);
    assert.equal(quick.destroyed, false);
  });

  it('keeps a client exactly at the limit', () => {
    const stream = newStream({ maxBufferedBytes: 100 });
    const client = new FakeResponse();
    stream.add(client, initial);
    client.writableLength = 100;
    stream.send('state', {});
    assert.equal(stream.size, 1);
  });

  it('does not keep a client whose response cannot even be opened', () => {
    const stream = newStream();
    const client = new FakeResponse();
    client.writeHead = () => {
      throw new Error('headers already sent');
    };
    assert.equal(stream.add(client, initial), true);
    assert.equal(stream.size, 0);
    assert.equal(client.destroyed, true);
  });
});

describe('EventStream limits', () => {
  it('refuses a client over the limit, writing nothing to it', () => {
    const stream = newStream({ maxClients: 2 });
    stream.add(new FakeResponse(), initial);
    stream.add(new FakeResponse(), initial);
    const third = new FakeResponse();

    assert.equal(stream.add(third, initial), false);
    assert.equal(third.status, undefined);
    assert.deepEqual(third.written, []);
    assert.equal(stream.size, 2);
  });

  it('accepts a client again once one has left', () => {
    const stream = newStream({ maxClients: 1 });
    const first = new FakeResponse();
    stream.add(first, initial);
    first.disconnect();
    assert.equal(stream.add(new FakeResponse(), initial), true);
  });

  it('allows 20 clients by default and refuses the 21st', () => {
    const stream = newStream();
    for (let i = 0; i < 20; i++) assert.equal(stream.add(new FakeResponse(), initial), true);
    assert.equal(stream.add(new FakeResponse(), initial), false);
  });
});

describe('EventStream heartbeat and close', () => {
  it('writes a comment line to idle clients', async () => {
    const stream = newStream({ heartbeatMs: 10 });
    const client = new FakeResponse();
    stream.add(client, initial);

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.ok(client.written.includes(': keep-alive\n\n'));
  });

  it('stops the heartbeat when the last client leaves', async () => {
    const stream = newStream({ heartbeatMs: 10 });
    const client = new FakeResponse();
    stream.add(client, initial);
    client.disconnect();
    const before = client.written.length;

    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(client.written.length, before);
  });

  it('ends every client on close() and sends nothing afterwards', () => {
    const stream = newStream();
    const a = new FakeResponse();
    const b = new FakeResponse();
    stream.add(a, initial);
    stream.add(b, initial);

    stream.close();
    stream.send('state', {});

    assert.equal(a.writableEnded, true);
    assert.equal(b.writableEnded, true);
    assert.equal(a.written.length, 1);
    assert.equal(stream.size, 0);
  });

  it('survives a client whose end() throws', () => {
    const stream = newStream();
    const client = new FakeResponse();
    client.end = () => {
      throw new Error('already closed');
    };
    stream.add(client, initial);

    assert.doesNotThrow(() => stream.close());
    assert.equal(client.destroyed, true);
  });
});
