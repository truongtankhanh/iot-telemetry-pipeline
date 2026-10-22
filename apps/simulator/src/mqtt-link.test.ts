import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from './engine.ts';
import { ManualClock } from './clock.ts';
import { type LinkTransport, MqttLink, RESTORE_TIMEOUT_MS } from './mqtt-link.ts';

/** A transport that records what it is asked to do; `connect()` plays the client's `connect` event. */
class FakeTransport implements LinkTransport {
  connected = true;
  readonly calls: string[] = [];
  failEnd = false;
  /** Connects as soon as it is asked to, unless a test wants to hold it back. */
  connectOnReconnect = true;
  private readonly listeners = new Set<() => void>();

  isConnected(): boolean {
    return this.connected;
  }

  async end(): Promise<void> {
    this.calls.push('end');
    if (this.failEnd) throw new Error('end failed');
    this.connected = false;
  }

  reconnect(): void {
    this.calls.push('reconnect');
    if (this.connectOnReconnect) queueMicrotask(() => this.connect());
  }

  onceConnect(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): void {
    this.connected = true;
    for (const listener of [...this.listeners]) {
      this.listeners.delete(listener);
      listener();
    }
  }

  get waiting(): number {
    return this.listeners.size;
  }
}

describe('MqttLink', () => {
  it('cut ends the connection', async () => {
    const transport = new FakeTransport();
    await new MqttLink(transport).cut();
    assert.deepEqual(transport.calls, ['end']);
    assert.equal(transport.connected, false);
  });

  it('cut passes on a failure to end the connection', async () => {
    const transport = new FakeTransport();
    transport.failEnd = true;
    await assert.rejects(() => new MqttLink(transport).cut(), /end failed/);
  });

  it('cut twice is harmless: it asks again and the client answers', async () => {
    const transport = new FakeTransport();
    const link = new MqttLink(transport);
    await link.cut();
    await link.cut();
    assert.deepEqual(transport.calls, ['end', 'end']);
  });

  it('restore reconnects and settles when the client connects', async () => {
    const transport = new FakeTransport();
    const link = new MqttLink(transport);
    await link.cut();
    await link.restore();
    assert.deepEqual(transport.calls, ['end', 'reconnect']);
    assert.equal(transport.connected, true);
    assert.equal(transport.waiting, 0);
  });

  it('restore listens before it reconnects, so a connection that is quick is not missed', async () => {
    const transport = new FakeTransport();
    transport.connected = false;
    transport.connectOnReconnect = false;
    const reconnect = transport.reconnect.bind(transport);
    let waitingAtReconnect = -1;
    transport.reconnect = () => {
      waitingAtReconnect = transport.waiting;
      reconnect();
      transport.connect();
    };
    await new MqttLink(transport).restore();
    assert.equal(waitingAtReconnect, 1);
  });

  it('restore when the link is up does nothing', async () => {
    const transport = new FakeTransport();
    await new MqttLink(transport).restore();
    assert.deepEqual(transport.calls, []);
  });

  it('restore fails with a reason after the timeout, and stops listening', async () => {
    const transport = new FakeTransport();
    transport.connected = false;
    transport.connectOnReconnect = false;
    await assert.rejects(
      () => new MqttLink(transport, 15).restore(),
      /did not accept the connection again within 15 ms/,
    );
    assert.deepEqual(transport.calls, ['reconnect']);
    assert.equal(transport.waiting, 0);
  });

  it('a connection that comes after the timeout is not an error', async () => {
    const transport = new FakeTransport();
    transport.connected = false;
    transport.connectOnReconnect = false;
    const link = new MqttLink(transport, 10);
    await assert.rejects(() => link.restore());
    assert.doesNotThrow(() => transport.connect());
    await link.restore();
    assert.deepEqual(transport.calls, ['reconnect']);
  });

  it('the default timeout is ten seconds', () => {
    assert.equal(RESTORE_TIMEOUT_MS, 10_000);
  });

  it('works as the link of an engine: cut, forS, restore', async () => {
    const transport = new FakeTransport();
    const clock = new ManualClock(Date.parse('2026-10-01T05:00:00Z'));
    const engine = new Engine({
      devices: [
        { id: 'dc-env-01', kind: 'server_room', zoneCode: 'BLD-DC', metrics: ['temperature_c'] },
      ],
      publisher: { publish: async () => undefined },
      clock,
      intervalMs: 2000,
      link: new MqttLink(transport),
    });
    await engine.start();
    await engine.cutLink({ forS: 3 });
    assert.equal(transport.connected, false);
    await clock.advance(3000);
    assert.equal(transport.connected, true);
    assert.deepEqual(transport.calls, ['end', 'reconnect']);
    assert.equal(engine.snapshot().faults.linkLoss, null);
  });
});
