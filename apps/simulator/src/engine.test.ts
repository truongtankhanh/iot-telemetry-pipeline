import type { TelemetryPayload } from '@itp/telemetry-contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Clock, ManualClock } from './clock.ts';
import { Engine, type EngineOptions, type Publisher, type StateChange } from './engine.ts';
import type { Anomaly, DeviceSpec } from './signals.ts';

const dc1: DeviceSpec = {
  id: 'dc-env-01',
  kind: 'server_room',
  zoneCode: 'BLD-DC',
  metrics: ['temperature_c', 'humidity_pct'],
};
const dc2: DeviceSpec = { ...dc1, id: 'dc-env-02' };
const T0 = Date.parse('2026-10-01T05:00:00Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

class FakePublisher implements Publisher {
  readonly sent: { topic: string; payload: string; options: { qos: 1 } }[] = [];
  attempts = 0;
  failOn: ((topic: string) => boolean) | undefined;

  async publish(topic: string, payload: string, options: { qos: 1 }): Promise<void> {
    this.attempts++;
    if (this.failOn?.(topic)) throw new Error(`publish failed: ${topic}`);
    this.sent.push({ topic, payload, options });
  }
}

interface StubTimer {
  delayMs: number;
  fn: () => void | Promise<void>;
  cancelled: boolean;
}

/**
 * A clock that never moves by itself and, unlike `ManualClock`, never fires a timer for you: a test
 * sets `nowMs` and runs the pending timer with `fire`, so it can make a timer late or early.
 */
class StubClock implements Clock {
  nowMs = T0;
  readonly timers: StubTimer[] = [];

  now(): number {
    return this.nowMs;
  }

  setTimer(delayMs: number, fn: () => void | Promise<void>): () => void {
    const timer: StubTimer = { delayMs, fn, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /** The timer the engine waits on: it cancels the old one before it arms a new one. */
  get live(): StubTimer | undefined {
    return this.timers.findLast((t) => !t.cancelled);
  }
}

async function fire(clock: StubClock): Promise<void> {
  const timer = clock.live;
  assert.ok(timer, 'the engine has no timer armed');
  timer.cancelled = true; // a timer that has fired is no longer pending
  await timer.fn();
}

/** An engine on a manual clock whose noise is zero (`random()` is 0.5) unless told otherwise. */
function setup(options: Partial<EngineOptions> = {}) {
  const clock = new ManualClock(T0);
  const publisher = new FakePublisher();
  const engine = new Engine({
    devices: [dc1, dc2],
    publisher,
    clock,
    intervalMs: 2000,
    random: () => 0.5,
    ...options,
  });
  return { engine, clock, publisher };
}

const readings = (publisher: FakePublisher, deviceId: string) =>
  publisher.sent
    .filter((m) => m.topic === `campus/BLD-DC/${deviceId}/telemetry`)
    .map((m) => JSON.parse(m.payload) as TelemetryPayload);
const seqs = (publisher: FakePublisher, deviceId: string) =>
  readings(publisher, deviceId).map((r) => r.seq);
const temperatures = (publisher: FakePublisher, deviceId: string) =>
  readings(publisher, deviceId).map((r) => r.metrics.temperature_c);

async function steps(engine: Engine, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await engine.step();
}

const overheat: Anomaly = {
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 2,
  duration: 4,
};

describe('Engine construction', () => {
  it('rejects an interval that is not a positive number', () => {
    for (const intervalMs of [0, -5, Number.NaN, Infinity]) {
      assert.throws(() => setup({ intervalMs }), RangeError);
    }
  });

  it('rejects two devices with the same id', () => {
    assert.throws(() => setup({ devices: [dc1, dc1] }), /Duplicate device id/);
  });
});

describe('Engine start and cadence', () => {
  it('publishes the first tick at once, with seq 1 and the contract topic and payload', async () => {
    const { engine, publisher } = setup();

    await engine.start();

    assert.deepEqual(
      publisher.sent.map((m) => m.topic),
      ['campus/BLD-DC/dc-env-01/telemetry', 'campus/BLD-DC/dc-env-02/telemetry'],
    );
    const [first] = publisher.sent;
    assert.deepEqual(first?.options, { qos: 1 });
    assert.deepEqual(Object.keys(JSON.parse(first!.payload) as object), ['seq', 'ts', 'metrics']);
    assert.deepEqual(readings(publisher, 'dc-env-01')[0], {
      seq: 1,
      ts: iso(0),
      metrics: { temperature_c: 22.5, humidity_pct: 45 },
    });
  });

  it('publishes every interval, all devices of a tick with the same timestamp', async () => {
    const { engine, publisher } = setup();
    await engine.start();

    await steps(engine, 2);

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2, 3]);
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1, 2, 3]);
    assert.deepEqual(
      readings(publisher, 'dc-env-01').map((r) => r.ts),
      [iso(0), iso(2000), iso(4000)],
    );
    assert.deepEqual(
      readings(publisher, 'dc-env-02').map((r) => r.ts),
      readings(publisher, 'dc-env-01').map((r) => r.ts),
    );
  });

  it('follows the clock when it is advanced directly, as the real timer would', async () => {
    const { engine, clock, publisher } = setup();
    await engine.start();

    await clock.advance(5000);

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2, 3]);
    assert.equal(clock.now(), T0 + 5000);
  });

  it('refuses a second start', async () => {
    const { engine } = setup();
    await engine.start();
    assert.throws(() => engine.start(), /already started/);
  });

  it('stops publishing after stop()', async () => {
    const { engine, clock, publisher } = setup();
    await engine.start();

    engine.stop();
    await clock.advance(10_000);

    assert.equal(publisher.sent.length, 2);
    assert.equal(engine.snapshot().running, false);
  });
});

describe('Engine step', () => {
  it('needs the simulated clock', async () => {
    const { engine } = setup({ clock: undefined });
    await assert.rejects(engine.step(), /ManualClock/);
  });

  it('needs a started engine', async () => {
    const { engine } = setup();
    await assert.rejects(engine.step(), /not started/);
  });

  it('moves the clock by one interval and sends exactly that tick', async () => {
    const { engine, clock, publisher } = setup({ intervalMs: 500 });
    await engine.start();

    await engine.step();

    assert.equal(clock.now(), T0 + 500);
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2]);
    assert.equal(readings(publisher, 'dc-env-01')[1]?.ts, iso(500));
  });
});

describe('Engine scheduling on a real clock', () => {
  // The device is due at T0 + 2000 after the first tick; the tests run that timer at other times.
  async function started() {
    const stub = new StubClock();
    const { engine, publisher } = setup({ devices: [dc1], clock: stub });
    await engine.start();
    return { stub, engine, publisher };
  }

  it('skips the missed ticks of a stall that is a whole number of intervals', async () => {
    const { stub, publisher } = await started();

    stub.nowMs = T0 + 3_604_000;
    await fire(stub);

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2]);
    assert.equal(readings(publisher, 'dc-env-01')[1]?.ts, iso(3_604_000));
    assert.equal(stub.live?.delayMs, 2000); // the next slot is after now, not now
  });

  it('keeps the phase of the device after a stall that is not a whole number of intervals', async () => {
    const { stub, publisher } = await started();

    stub.nowMs = T0 + 3_603_500;
    await fire(stub);

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2]);
    assert.equal(stub.live?.delayMs, 500); // the next slot is T0 + 3_604_000
  });

  it('keeps the cadence when a timer is on time or a few milliseconds late', async () => {
    const { stub, publisher } = await started();

    stub.nowMs = T0 + 2000;
    await fire(stub);
    assert.equal(stub.live?.delayMs, 2000);

    stub.nowMs = T0 + 4003;
    await fire(stub);
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2, 3]);
    assert.equal(stub.live?.delayMs, 1997); // still aimed at T0 + 6000: no drift
  });

  it('publishes nothing when a timer fires early, and waits for the remainder', async () => {
    const { stub, publisher } = await started();

    stub.nowMs = T0 + 1999;
    await fire(stub);

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1]);
    assert.equal(stub.live?.delayMs, 1);
  });

  it('can be started again after stop(), counting on from the same seq', async () => {
    const { stub, engine, publisher } = await started();
    engine.stop();
    assert.equal(stub.timers.filter((t) => !t.cancelled).length, 0, 'stop() leaves no timer armed');

    stub.nowMs = T0 + 10_000;
    await engine.start();

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2]);
    assert.equal(readings(publisher, 'dc-env-01')[1]?.ts, iso(10_000));
    assert.equal(engine.snapshot().elapsedS, 0);
    assert.equal(stub.live?.delayMs, 2000);
  });
});

describe('Engine devices', () => {
  it('does not publish a paused or stopped device, and keeps its seq', async () => {
    const { engine, publisher } = setup();
    await engine.start();

    engine.pauseDevice('dc-env-02');
    engine.stopDevice('dc-env-01');
    await steps(engine, 2);

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1]);
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1]);
    assert.deepEqual(
      engine.snapshot().devices.map((d) => [d.id, d.state, d.seq]),
      [
        ['dc-env-01', 'stopped', 1],
        ['dc-env-02', 'paused', 1],
      ],
    );
  });

  it('publishes a started device again after one interval, with the next seq', async () => {
    const { engine, publisher } = setup();
    await engine.start();
    engine.pauseDevice('dc-env-02');
    await engine.step(); // t = 2 s: only dc-env-01

    engine.startDevice('dc-env-02');
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1]);
    await engine.step(); // t = 4 s

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2, 3]);
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1, 2]);
    assert.equal(readings(publisher, 'dc-env-02')[1]?.ts, iso(4000));
  });

  it('gives a device its own interval, and takes it back with undefined', async () => {
    const { engine, clock, publisher } = setup();
    await engine.start();

    engine.setDeviceInterval('dc-env-02', 1000);
    await clock.advance(2000);

    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2]);
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1, 2, 3]);
    assert.equal(engine.snapshot().devices[1]?.intervalMs, 1000);

    engine.setDeviceInterval('dc-env-02', undefined);
    assert.equal(engine.snapshot().devices[1]?.intervalMs, 2000);
  });

  it('rejects an unknown device and a bad interval', () => {
    const { engine } = setup();
    assert.throws(() => engine.pauseDevice('nope'), /Unknown device/);
    assert.throws(() => engine.setDeviceInterval('nope', 1000), /Unknown device/);
    assert.throws(() => engine.setDeviceInterval('dc-env-01', 0), RangeError);
  });
});

describe('Engine anomalies', () => {
  it('applies an anomaly added while running from its start to its end', async () => {
    const { engine, publisher } = setup();
    await engine.start();

    engine.addAnomaly(overheat); // 2 s to 6 s on the anomaly clock
    await steps(engine, 3);

    assert.deepEqual(temperatures(publisher, 'dc-env-01'), [22.5, 29.2, 29.2, 22.5]);
    assert.deepEqual(temperatures(publisher, 'dc-env-02'), [22.5, 22.5, 22.5, 22.5]);
  });

  it('stops applying an anomaly once it is removed', async () => {
    const { engine, publisher } = setup();
    await engine.start();
    const id = engine.addAnomaly({ ...overheat, startAt: 0, duration: 100 });

    await engine.step();
    assert.equal(engine.removeAnomaly(id), true);
    await engine.step();

    assert.deepEqual(temperatures(publisher, 'dc-env-01'), [22.5, 29.2, 22.5]);
    assert.equal(engine.removeAnomaly(id), false);
  });

  it('applies the shape of an anomaly', async () => {
    const ramp: Anomaly = { ...overheat, value: 30.5, startAt: 0, duration: 8, shape: 'ramp' };
    const { engine, publisher } = setup({ anomalies: [ramp] });
    await engine.start();

    await steps(engine, 3);

    assert.deepEqual(temperatures(publisher, 'dc-env-01'), [22.5, 24.5, 26.5, 28.5]);
  });

  it('lists anomalies with ids, the initial ones first', () => {
    const { engine } = setup({ anomalies: [overheat] });

    const id = engine.addAnomaly({ ...overheat, startAt: 10 });

    assert.deepEqual(
      engine.snapshot().anomalies.map((a) => a.id),
      ['a1', id],
    );
    assert.equal(id, 'a2');
  });

  it('checks a new anomaly against the device, but not the initial ones', async () => {
    const { engine, publisher } = setup({ anomalies: [{ ...overheat, deviceId: 'ghost' }] });
    await engine.start();

    assert.deepEqual(temperatures(publisher, 'dc-env-01'), [22.5]);
    assert.throws(() => engine.addAnomaly({ ...overheat, deviceId: 'ghost' }), /Unknown device/);
    assert.throws(() => engine.addAnomaly({ ...overheat, metric: 'co2_ppm' }), /no metric/);
  });

  it('rejects numbers it cannot play', () => {
    const { engine } = setup();
    const unplayable = [
      { value: Number.NaN },
      { value: Infinity },
      { startAt: Number.NaN },
      { startAt: -Infinity },
      { duration: 0 },
      { duration: -1 },
      { duration: Number.NaN },
      { duration: Infinity },
    ];

    for (const change of unplayable) {
      assert.throws(
        () => engine.addAnomaly({ ...overheat, ...change }),
        RangeError,
        Object.entries(change).join('='),
      );
    }
  });

  it('rejects an unknown shape', () => {
    const { engine } = setup();
    assert.throws(
      () => engine.addAnomaly({ ...overheat, shape: 'sine' as never }),
      /Unknown anomaly shape/,
    );
  });

  it('accepts each shape, and none', () => {
    const { engine } = setup();
    for (const shape of [undefined, 'step', 'ramp', 'spike'] as const) {
      assert.match(engine.addAnomaly({ ...overheat, shape }), /^a\d+$/);
    }
  });

  it('neither stores nor announces an anomaly it rejects', () => {
    const { engine } = setup();
    const changes: StateChange[] = [];
    engine.on('state', (change) => changes.push(change));

    assert.throws(() => engine.addAnomaly({ ...overheat, duration: 0 }), RangeError);

    assert.deepEqual(engine.snapshot().anomalies, []);
    assert.deepEqual(changes, []);
  });

  it('checks the device and the metric before the numbers', () => {
    const { engine } = setup();
    assert.throws(
      () => engine.addAnomaly({ ...overheat, deviceId: 'ghost', value: Number.NaN }),
      /Unknown device/,
    );
    assert.throws(
      () => engine.addAnomaly({ ...overheat, metric: 'co2_ppm', duration: 0 }),
      /no metric/,
    );
  });

  it('does not check the anomalies it is built with, as the command line never did', () => {
    assert.doesNotThrow(() => setup({ anomalies: [{ ...overheat, duration: 0 }] }));
  });
});

describe('Engine held values', () => {
  it('publishes the held value exactly, over an anomaly, until it is released', async () => {
    const { engine, publisher } = setup({ random: () => 1 }); // noise at its maximum
    await engine.start();

    engine.addAnomaly({ ...overheat, startAt: 0, duration: 100 });
    engine.holdValue('dc-env-01', 'temperature_c', 25);
    await engine.step();
    engine.releaseValue('dc-env-01', 'temperature_c');
    await engine.step();

    const [first, held, released] = readings(publisher, 'dc-env-01');
    assert.deepEqual(first?.metrics, { temperature_c: 22.8, humidity_pct: 46.5 });
    assert.deepEqual(held?.metrics, { temperature_c: 25, humidity_pct: 46.5 });
    assert.equal(released?.metrics.temperature_c, 29.3); // the anomaly applies again, with its jitter
  });

  it('rejects an unknown metric and a value that is not a number', () => {
    const { engine } = setup();
    assert.throws(() => engine.holdValue('dc-env-01', 'co2_ppm', 400), /no metric/);
    assert.throws(() => engine.holdValue('dc-env-01', 'temperature_c', Number.NaN), RangeError);
    assert.throws(() => engine.holdValue('nope', 'temperature_c', 20), /Unknown device/);
  });
});

describe('Engine reset', () => {
  it('clears anomalies and held values and restarts the anomaly clock, but not seq or ts', async () => {
    const forever: Anomaly = { ...overheat, startAt: 0, duration: 1000 };
    const { engine, publisher } = setup({ anomalies: [forever] });
    await engine.start();
    engine.holdValue('dc-env-01', 'humidity_pct', 50);
    await steps(engine, 2); // t = 4 s
    assert.equal(engine.snapshot().elapsedS, 4);

    engine.reset();
    assert.equal(engine.snapshot().elapsedS, 0);
    assert.deepEqual(engine.snapshot().anomalies, []);
    await engine.step(); // t = 6 s

    const all = readings(publisher, 'dc-env-01');
    assert.deepEqual(
      all.map((r) => r.seq),
      [1, 2, 3, 4],
    );
    assert.deepEqual(all.at(-1), {
      seq: 4,
      ts: iso(6000),
      metrics: { temperature_c: 22.5, humidity_pct: 45 },
    });
    assert.equal(all[1]?.metrics.humidity_pct, 50);
  });

  it('counts an anomaly added after a reset from the reset', async () => {
    const { engine, publisher } = setup();
    await engine.start();
    await steps(engine, 2); // t = 4 s
    engine.reset();

    engine.addAnomaly(overheat); // 2 s to 6 s after the reset, that is 6 s to 10 s of clock time
    await steps(engine, 3); // t = 6, 8, 10 s

    assert.deepEqual(temperatures(publisher, 'dc-env-01'), [22.5, 22.5, 22.5, 29.2, 29.2, 22.5]);
  });
});

describe('Engine events', () => {
  it('emits published after the publisher accepts a message, with what it was given', async () => {
    const { engine, publisher } = setup();
    const events: unknown[] = [];
    engine.on('published', (message) => events.push(message));

    await engine.start();

    assert.equal(events.length, 2);
    assert.deepEqual(events[0], {
      deviceId: 'dc-env-01',
      topic: 'campus/BLD-DC/dc-env-01/telemetry',
      payload: publisher.sent[0]?.payload,
      seq: 1,
      ts: iso(0),
    });
  });

  it('emits one state event per change, in order, and none for a change that changes nothing', () => {
    const { engine } = setup();
    const types: StateChange['type'][] = [];
    engine.on('state', (change) => types.push(change.type));

    engine.pauseDevice('dc-env-02');
    engine.pauseDevice('dc-env-02');
    engine.setDeviceInterval('dc-env-01', 1000);
    const id = engine.addAnomaly(overheat);
    engine.holdValue('dc-env-01', 'temperature_c', 20);
    engine.releaseValue('dc-env-01', 'temperature_c');
    engine.releaseValue('dc-env-01', 'temperature_c');
    engine.removeAnomaly(id);
    engine.removeAnomaly(id);
    engine.reset();

    assert.deepEqual(types, [
      'device-state',
      'device-interval',
      'anomaly-added',
      'hold-set',
      'hold-released',
      'anomaly-removed',
      'reset',
    ]);
  });

  it('rejects start() when the first tick fails, after sending the other devices', async () => {
    const { engine, publisher } = setup();
    publisher.failOn = (topic) => topic.includes('dc-env-01');

    await assert.rejects(engine.start(), /publish failed/);

    assert.equal(publisher.sent.length, 1);
    assert.equal(engine.published, 2); // counted before the publish, failures included
    engine.stop();
  });

  it('reports a later failing tick once, with the first failure, and keeps going', async () => {
    const { engine, publisher } = setup();
    const errors: Error[] = [];
    engine.on('tick-error', (error) => errors.push(error));
    await engine.start();
    publisher.failOn = () => true;

    await engine.step();

    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /publish failed/);
    publisher.failOn = undefined;
    await engine.step();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 3]);
  });
});

describe('Engine snapshot', () => {
  it('describes the state the control server needs', async () => {
    const { engine } = setup();
    await engine.start();
    engine.holdValue('dc-env-02', 'humidity_pct', 50);
    await engine.step();

    assert.deepEqual(engine.snapshot(), {
      running: true,
      simulated: true,
      nowMs: T0 + 2000,
      elapsedS: 2,
      intervalMs: 2000,
      published: 4,
      devices: [
        { id: 'dc-env-01', state: 'running', intervalMs: 2000, seq: 2, holds: {} },
        {
          id: 'dc-env-02',
          state: 'running',
          intervalMs: 2000,
          seq: 2,
          holds: { humidity_pct: 50 },
        },
      ],
      anomalies: [],
    });
  });

  it('says it is not simulated on the wall clock, and not running before start', () => {
    const { engine } = setup({ clock: undefined });
    const snapshot = engine.snapshot();
    assert.equal(snapshot.simulated, false);
    assert.equal(snapshot.running, false);
    assert.equal(snapshot.elapsedS, 0);
  });
});
