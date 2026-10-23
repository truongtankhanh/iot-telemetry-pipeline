import { parsePayload, parseTopic, type TelemetryPayload } from '@itp/telemetry-contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Clock, ManualClock } from './clock.ts';
import {
  type DroppedMessage,
  Engine,
  type EngineOptions,
  type Publisher,
  type PublishedMessage,
  type RealTime,
  type StateChange,
} from './engine.ts';
import {
  FaultConflictError,
  type LinkControl,
  type MalformedConfig,
  MALFORMED_KINDS,
} from './faults.ts';
import { seededRandom } from './random.ts';
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
      faults: { ...NO_FAULTS, deviceCount: 2 },
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

// ---------------------------------------------------------------------------------------------
// Faults
// ---------------------------------------------------------------------------------------------

const NO_FAULTS = {
  scope: { mode: 'running' },
  drop: null,
  duplicate: null,
  delay: null,
  reorder: null,
  malformed: null,
  linkLoss: null,
  activeCount: 0,
  deviceCount: 0,
  held: 0,
  dropped: 0,
  bursting: false,
};

/** Records the order of its calls in `log`, which a test can share with the publisher. */
class FakeLink implements LinkControl {
  readonly calls: string[] = [];
  failCut = false;
  failRestore = false;

  private readonly log: string[];

  // No parameter property: Node strips types and does not transform them.
  constructor(log: string[] = []) {
    this.log = log;
  }

  async cut(): Promise<void> {
    if (this.failCut) throw new Error('cannot cut the link');
    this.calls.push('cut');
    this.log.push('cut');
  }

  async restore(): Promise<void> {
    if (this.failRestore) throw new Error('cannot restore the link');
    this.calls.push('restore');
    this.log.push('restore');
  }
}

/** Everything the engine says, in one place. */
function listen(engine: Engine) {
  const heard = {
    published: [] as PublishedMessage[],
    dropped: [] as DroppedMessage[],
    states: [] as StateChange[],
    errors: [] as Error[],
  };
  engine.on('published', (m) => heard.published.push(m));
  engine.on('dropped', (m) => heard.dropped.push(m));
  engine.on('state', (c) => heard.states.push(c));
  engine.on('tick-error', (e) => heard.errors.push(e));
  return heard;
}

/** Lets promises that nobody awaits (a window released by a paused device) finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Engine faults: with none on', () => {
  it('sends exactly what an engine without the fault layer sends, and does not read the random source for them', async () => {
    const plain = setup({ random: seededRandom(7) });
    await plain.engine.start();
    await steps(plain.engine, 5);

    // A fault that was switched on and off again before the engine started leaves nothing behind.
    const touched = setup({ random: seededRandom(7) });
    touched.engine.setFault('drop', { percent: 50 });
    touched.engine.setFault('malformed', { percent: 50, kinds: ['json'] });
    touched.engine.clearFault('drop');
    touched.engine.clearFault('malformed');
    await touched.engine.start();
    await steps(touched.engine, 5);

    assert.deepEqual(touched.publisher.sent, plain.publisher.sent);
    assert.equal(touched.engine.published, plain.engine.published);
  });

  it('emits published without a fault tag, and never dropped', async () => {
    const { engine } = setup();
    const heard = listen(engine);
    await engine.start();
    assert.equal(heard.published.length, 2);
    assert.ok(heard.published.every((m) => !('fault' in m)));
    assert.deepEqual(heard.dropped, []);
  });
});

describe('Engine faults: drop', () => {
  it('builds the message and uses its seq but never hands it to the publisher', async () => {
    const { engine, publisher } = setup();
    const heard = listen(engine);
    engine.setFault('drop', { percent: 100 });
    await engine.start();
    await steps(engine, 2);

    assert.deepEqual(publisher.sent, []);
    assert.equal(engine.published, 0);
    assert.equal(heard.published.length, 0);
    assert.equal(heard.dropped.length, 6);
    assert.deepEqual(heard.dropped[0], {
      deviceId: 'dc-env-01',
      seq: 1,
      ts: iso(0),
      reason: 'fault',
    });
    const snapshot = engine.snapshot();
    assert.deepEqual(
      snapshot.devices.map((d) => d.seq),
      [3, 3],
    );
    assert.equal(snapshot.faults.dropped, 6);
    assert.equal(snapshot.published, 0);
  });

  it('after it is switched off the next message carries the next seq, which leaves a gap', async () => {
    const { engine, publisher } = setup();
    engine.setFault('drop', { percent: 100 });
    await engine.start();
    engine.clearFault('drop');
    await engine.step();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [2]);
  });

  it('at 5 % loses about 5 % of the messages and leaves holes in the seq of each device', async () => {
    const { engine, publisher } = setup({ random: seededRandom(1) });
    const heard = listen(engine);
    engine.setFault('drop', { percent: 5 });
    await engine.start();
    await steps(engine, 999);

    const total = 2 * 1000;
    const dropped = heard.dropped.length;
    assert.ok(dropped > total * 0.03 && dropped < total * 0.07, `dropped ${dropped} of ${total}`);
    assert.equal(engine.published + dropped, total);
    const first = seqs(publisher, 'dc-env-01');
    assert.ok(first.length < 1000);
    assert.equal(Math.max(...first) <= 1000, true);
    // A hole: some seq below the highest was never sent.
    assert.ok(first.some((seq, i) => i > 0 && seq - (first[i - 1] as number) > 1));
  });

  it('a device out of scope is not touched', async () => {
    const { engine, publisher } = setup();
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.setFault('drop', { percent: 100 });
    await engine.start();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), []);
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1]);
  });
});

describe('Engine faults: scope', () => {
  it('"running" is read at every tick: a device that is started later is in scope', async () => {
    const { engine, publisher } = setup();
    engine.stopDevice('dc-env-02');
    engine.setFault('drop', { percent: 100 });
    await engine.start();
    engine.startDevice('dc-env-02');
    await engine.step();
    await engine.step();
    assert.deepEqual(seqs(publisher, 'dc-env-02'), []);
    assert.equal(engine.snapshot().faults.dropped >= 3, true);
  });

  it('a selection keeps the others publishing and is reported with its devices', async () => {
    const { engine, publisher } = setup();
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-02'] });
    engine.setFault('drop', { percent: 100 });
    await engine.start();
    await engine.step();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2]);
    assert.deepEqual(seqs(publisher, 'dc-env-02'), []);
    const { faults } = engine.snapshot();
    assert.deepEqual(faults.scope, { mode: 'selected', deviceIds: ['dc-env-02'] });
    assert.equal(faults.deviceCount, 1);
  });

  it('refuses an unknown device or an empty selection and changes nothing', () => {
    const { engine } = setup();
    const heard = listen(engine);
    assert.throws(
      () => engine.setFaultScope({ mode: 'selected', deviceIds: ['ghost'] }),
      /Unknown device "ghost"/,
    );
    assert.throws(() => engine.setFaultScope({ mode: 'selected', deviceIds: [] }), RangeError);
    assert.deepEqual(engine.snapshot().faults.scope, { mode: 'running' });
    assert.deepEqual(heard.states, []);
  });

  it('copies the selection it is given', () => {
    const { engine } = setup();
    const ids = ['dc-env-01'];
    engine.setFaultScope({ mode: 'selected', deviceIds: ids });
    ids.push('dc-env-02');
    assert.deepEqual(engine.snapshot().faults.scope, {
      mode: 'selected',
      deviceIds: ['dc-env-01'],
    });
  });
});

describe('Engine faults: duplicate', () => {
  it('sends the same payload twice, and tags the second copy', async () => {
    const { engine, publisher } = setup();
    const heard = listen(engine);
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.setFault('duplicate', { percent: 100 });
    await engine.start();

    const sent = publisher.sent.filter((m) => m.topic.includes('dc-env-01'));
    assert.equal(sent.length, 2);
    assert.equal(sent[0]?.payload, sent[1]?.payload);
    assert.equal(engine.published, 3);
    const mine = heard.published.filter((m) => m.deviceId === 'dc-env-01');
    assert.equal('fault' in (mine[0] as PublishedMessage), false);
    assert.equal(mine[1]?.fault, 'duplicate');
    // Both copies are of the same message: one seq.
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 1]);
  });
});

describe('Engine faults: malformed', () => {
  for (const kind of MALFORMED_KINDS) {
    it(`"${kind}" goes out as a message ingest rejects for exactly that reason`, async () => {
      const { engine, publisher } = setup();
      const heard = listen(engine);
      engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
      engine.setFault('malformed', { percent: 100, kinds: [kind] });
      await engine.start();

      const sent = publisher.sent.find((m) => m.topic.includes('dc-env-01'));
      assert.ok(sent);
      if (kind === 'topic') {
        assert.deepEqual(parseTopic(sent.topic), { ok: false, reason: 'topic' });
        assert.equal(parsePayload(sent.payload).ok, true);
      } else {
        assert.deepEqual(parsePayload(sent.payload), { ok: false, reason: kind });
      }
      const event = heard.published.find((m) => m.deviceId === 'dc-env-01');
      assert.equal(event?.fault, `malformed:${kind}`);
      assert.equal(event?.seq, 1);
    });
  }

  it('replaces the good message: nothing else is sent for that tick, and its seq is used', async () => {
    const { engine, publisher } = setup();
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.setFault('malformed', { percent: 100, kinds: ['json'] });
    await engine.start();
    assert.equal(publisher.sent.filter((m) => m.topic.includes('dc-env-01')).length, 1);
    engine.clearFault('malformed');
    await engine.step();
    const valid = publisher.sent
      .filter((m) => m.topic.includes('dc-env-01'))
      .flatMap((m) => {
        const parsed = parsePayload(m.payload);
        return parsed.ok ? [parsed.value.seq] : [];
      });
    assert.deepEqual(valid, [2]);
  });

  it('chooses among several kinds with the random source', async () => {
    const { engine, publisher } = setup({ random: seededRandom(3) });
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.setFault('malformed', { percent: 100, kinds: ['json', 'empty', 'range'] });
    await engine.start();
    await steps(engine, 60);
    const reasons = new Set(
      publisher.sent
        .filter((m) => m.topic.includes('dc-env-01'))
        .map((m) => {
          const parsed = parsePayload(m.payload);
          return parsed.ok ? 'ok' : parsed.reason;
        }),
    );
    assert.deepEqual([...reasons].sort(), ['empty', 'json', 'range']);
  });
});

describe('Engine faults: delay', () => {
  it('holds each message back on the clock, keeps its measurement time, and does not hold up the tick', async () => {
    const { engine, clock, publisher } = setup();
    engine.setFault('delay', { delayMs: 500, jitterMs: 0 });
    await engine.start();
    assert.equal(publisher.sent.length, 0);
    assert.equal(engine.snapshot().faults.held, 2);

    await clock.advance(499);
    assert.equal(publisher.sent.length, 0);
    await clock.advance(1);
    assert.equal(publisher.sent.length, 2);
    assert.equal(readings(publisher, 'dc-env-01')[0]?.ts, iso(0));
    assert.equal(engine.snapshot().faults.held, 0);
  });

  it('waits the delay plus or minus the jitter', async () => {
    const early = setup({ random: () => 0 });
    early.engine.setFault('delay', { delayMs: 500, jitterMs: 200 });
    await early.engine.start();
    await early.clock.advance(299);
    assert.equal(early.publisher.sent.length, 0);
    await early.clock.advance(1);
    assert.equal(early.publisher.sent.length, 2);

    const late = setup({ random: () => 0.999999 });
    late.engine.setFault('delay', { delayMs: 500, jitterMs: 200 });
    await late.engine.start();
    await late.clock.advance(699);
    assert.equal(late.publisher.sent.length, 0);
    await late.clock.advance(2);
    assert.equal(late.publisher.sent.length, 2);
  });

  it('a delayed message that fails to send is reported once as a tick-error', async () => {
    const { engine, clock, publisher } = setup();
    const heard = listen(engine);
    publisher.failOn = (topic) => topic.includes('dc-env-01');
    engine.setFault('delay', { delayMs: 100, jitterMs: 0 });
    await engine.start();
    await clock.advance(100);
    assert.equal(heard.errors.length, 1);
    assert.match(heard.errors[0]?.message ?? '', /publish failed/);
  });

  it('switching it off lets the messages already waiting go on their schedule', async () => {
    const { engine, clock, publisher } = setup();
    engine.setFault('delay', { delayMs: 500, jitterMs: 0 });
    await engine.start();
    engine.clearFault('delay');
    assert.equal(publisher.sent.length, 0);
    await clock.advance(500);
    assert.equal(publisher.sent.length, 2);
  });
});

describe('Engine faults: reorder', () => {
  it('releases a full window in a different order, and holds the messages until then', async () => {
    const { engine, publisher } = setup({ random: seededRandom(5) });
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.setFault('reorder', { window: 3 });
    await engine.start();
    await engine.step();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), []);
    assert.equal(engine.snapshot().faults.held, 2);

    await engine.step();
    const out = seqs(publisher, 'dc-env-01');
    assert.deepEqual([...out].sort(), [1, 2, 3]);
    assert.notDeepEqual(out, [1, 2, 3]);
    assert.equal(engine.snapshot().faults.held, 0);
    // The device out of scope was never held.
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1, 2, 3]);
  });

  it('every message is eventually sent: nothing is lost, only moved', async () => {
    const { engine, publisher } = setup({ random: seededRandom(9) });
    engine.setFault('reorder', { window: 4 });
    await engine.start();
    await steps(engine, 7);
    assert.deepEqual([...seqs(publisher, 'dc-env-01')].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a device that is paused sends what its window holds', async () => {
    const { engine, publisher } = setup();
    engine.setFault('reorder', { window: 5 });
    await engine.start();
    engine.pauseDevice('dc-env-01');
    await settle();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1]);
    assert.deepEqual(seqs(publisher, 'dc-env-02'), []);
  });

  it('switching it off, or taking the device out of scope, sends what is held', async () => {
    const { engine, publisher } = setup();
    engine.setFault('reorder', { window: 5 });
    await engine.start();
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    await settle();
    assert.deepEqual(seqs(publisher, 'dc-env-02'), [1]);
    engine.clearFault('reorder');
    await settle();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1]);
  });

  it('with a delay on as well, a released message is then delayed', async () => {
    const { engine, clock, publisher } = setup({ random: seededRandom(2) });
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.setFault('reorder', { window: 2 });
    engine.setFault('delay', { delayMs: 300, jitterMs: 0 });
    await engine.start();
    await engine.step();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), []);
    await clock.advance(300);
    assert.deepEqual([...seqs(publisher, 'dc-env-01')].sort(), [1, 2]);
  });
});

describe('Engine faults: burst', () => {
  it('sends the count asked for, tagged, with contiguous seq and increasing ts between two ticks', async () => {
    const { engine, publisher } = setup();
    const heard = listen(engine);
    await engine.start();
    await engine.step();
    const before = publisher.sent.length;

    const result = await engine.burst(10);
    assert.deepEqual(result, { sent: 10, failed: 0 });
    assert.equal(publisher.sent.length - before, 10);
    const burst = heard.published.filter((m) => m.fault === 'burst');
    assert.equal(burst.length, 10);

    for (const id of ['dc-env-01', 'dc-env-02']) {
      const mine = readings(publisher, id);
      assert.deepEqual(
        mine.map((r) => r.seq),
        [1, 2, 3, 4, 5, 6, 7],
      );
      const times = mine.slice(2).map((r) => Date.parse(r.ts));
      assert.deepEqual(
        [...times].sort((a, b) => a - b),
        times,
      );
      assert.equal(new Set(times).size, times.length);
      for (const time of times) assert.ok(time > T0 + 2000 && time < T0 + 4000, String(time - T0));
    }
    assert.deepEqual(heard.states.at(-1), {
      type: 'burst',
      count: 10,
      sent: 10,
      failed: 0,
      deviceIds: ['dc-env-01', 'dc-env-02'],
    });
  });

  it('gives the first devices one message more when the count does not divide', async () => {
    const { engine, publisher } = setup();
    await engine.start();
    await engine.burst(5);
    assert.equal(readings(publisher, 'dc-env-01').length, 1 + 3);
    assert.equal(readings(publisher, 'dc-env-02').length, 1 + 2);
  });

  it('every message is valid for the contract, and its values come from the same sampler', async () => {
    const { engine, publisher } = setup();
    await engine.start();
    await engine.burst(20);
    for (const message of publisher.sent) assert.equal(parsePayload(message.payload).ok, true);
  });

  it('acts on the devices in scope only, and ignores the switches', async () => {
    const { engine, publisher } = setup();
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-02'] });
    await engine.start();
    engine.setFault('drop', { percent: 100 });
    engine.setFault('malformed', { percent: 100, kinds: ['json'] });
    await engine.burst(4);
    const burst = readings(publisher, 'dc-env-02');
    assert.equal(burst.length, 1 + 4);
    assert.equal(readings(publisher, 'dc-env-01').length, 1);
  });

  it('is refused with too many messages for the device interval to space', async () => {
    const { engine, publisher } = setup();
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    await engine.start();
    const before = publisher.sent.length;
    await assert.rejects(() => engine.burst(2000), /choose more devices or a smaller count/);
    assert.equal(publisher.sent.length, before);
    assert.deepEqual(
      engine.snapshot().devices.map((d) => d.seq),
      [1, 1],
    );
    const ok = await engine.burst(1999);
    assert.equal(ok.sent, 1999);
  });

  it('is refused for a count that is not 1 to 5,000, when not started, with no device in scope, or while the link is down', async () => {
    const link = new FakeLink();
    const { engine } = setup({ link });
    await assert.rejects(() => engine.burst(10), FaultConflictError);
    await engine.start();
    for (const count of [0, -1, 1.5, 5001, Number.NaN]) {
      await assert.rejects(() => engine.burst(count), RangeError, String(count));
    }
    engine.stopDevice('dc-env-01');
    engine.stopDevice('dc-env-02');
    await assert.rejects(() => engine.burst(10), /No running device is in scope/);
    engine.startDevice('dc-env-01');
    await engine.cutLink();
    await assert.rejects(() => engine.burst(10), /link to the broker is down/);
  });

  it('allows one at a time, and says so in the snapshot', async () => {
    const gate: { release: () => void } = { release: () => {} };
    const blocked = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const publisher: Publisher = { publish: () => blocked };
    const { engine } = setup({ publisher });
    // The first tick is handed to a publisher that never answers: start it without waiting.
    void engine.start();
    const first = engine.burst(4);
    assert.equal(engine.snapshot().faults.bursting, true);
    await assert.rejects(() => engine.burst(4), FaultConflictError);
    gate.release();
    assert.deepEqual(await first, { sent: 4, failed: 0 });
    assert.equal(engine.snapshot().faults.bursting, false);
  });

  it('hands the messages over in chunks, never all at once', async () => {
    let inFlight = 0;
    let most = 0;
    const publisher: Publisher = {
      publish: async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await settle();
        inFlight--;
      },
    };
    const { engine } = setup({ publisher });
    await engine.start();
    most = 0;
    const result = await engine.burst(1000);
    assert.equal(result.sent, 1000);
    assert.ok(most <= 250, `at most 250 at once, saw ${most}`);
    assert.ok(most > 1);
  });

  it('counts a failed publish, reports one tick-error, and goes on', async () => {
    const { engine, publisher } = setup();
    const heard = listen(engine);
    await engine.start();
    publisher.failOn = (topic) => topic.includes('dc-env-02');
    const result = await engine.burst(10);
    assert.deepEqual(result, { sent: 5, failed: 5 });
    assert.equal(heard.errors.length, 1);
  });

  it('stopping the engine ends the burst; what was not sent counts as failed', async () => {
    const { engine, publisher } = setup();
    await engine.start();
    publisher.failOn = undefined;
    const original = publisher.publish.bind(publisher);
    let calls = 0;
    publisher.publish = async (topic, payload, options) => {
      calls++;
      if (calls === 250) engine.stop();
      await original(topic, payload, options);
    };
    const result = await engine.burst(600);
    assert.equal(result.sent + result.failed, 600);
    assert.ok(result.failed > 0);
  });
});

describe('Engine faults: link loss', () => {
  it('cuts the link and drops what is built while it is down; the seq goes on', async () => {
    const link = new FakeLink();
    const { engine, publisher } = setup({ link });
    const heard = listen(engine);
    await engine.start();
    await engine.cutLink();
    await engine.step();
    await engine.step();

    assert.deepEqual(link.calls, ['cut']);
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1]);
    assert.deepEqual(
      heard.dropped.filter((d) => d.deviceId === 'dc-env-01').map((d) => [d.seq, d.reason]),
      [
        [2, 'link'],
        [3, 'link'],
      ],
    );
    const { faults } = engine.snapshot();
    assert.deepEqual(faults.linkLoss, { since: iso(0), forS: null });
    assert.equal(faults.activeCount, 1);
    assert.deepEqual(heard.states.at(-1), { type: 'link-lost', forS: null });
  });

  it('restoring it lets the next message through, and leaves the gap behind', async () => {
    const link = new FakeLink();
    const { engine, publisher } = setup({ link });
    const heard = listen(engine);
    await engine.start();
    await engine.cutLink();
    await engine.step();
    await engine.restoreLink();
    await engine.step();

    assert.deepEqual(link.calls, ['cut', 'restore']);
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 3]);
    assert.equal(engine.snapshot().faults.linkLoss, null);
    assert.deepEqual(heard.states.at(-1), { type: 'link-restored', reason: 'command' });
  });

  it('with forS it restores itself on the clock', async () => {
    const link = new FakeLink();
    const { engine, clock } = setup({ link });
    const heard = listen(engine);
    await engine.start();
    await engine.cutLink({ forS: 5 });
    await clock.advance(4999);
    assert.notEqual(engine.snapshot().faults.linkLoss, null);
    await clock.advance(1);
    assert.equal(engine.snapshot().faults.linkLoss, null);
    assert.deepEqual(link.calls, ['cut', 'restore']);
    assert.deepEqual(heard.states.at(-1), { type: 'link-restored', reason: 'timer' });
  });

  it('a restore by hand cancels the timer', async () => {
    const link = new FakeLink();
    const { engine, clock } = setup({ link });
    await engine.start();
    await engine.cutLink({ forS: 5 });
    await engine.restoreLink();
    await clock.advance(10_000);
    assert.deepEqual(link.calls, ['cut', 'restore']);
  });

  it('a link that cannot be cut leaves the state as it was and says nothing', async () => {
    const link = new FakeLink();
    link.failCut = true;
    const { engine } = setup({ link });
    const heard = listen(engine);
    await engine.start();
    await assert.rejects(() => engine.cutLink(), /cannot cut the link/);
    assert.equal(engine.snapshot().faults.linkLoss, null);
    assert.deepEqual(heard.states, []);
    await engine.step();
    assert.equal(heard.dropped.length, 0);
  });

  it('a link that cannot be restored stays marked as down, and reports it', async () => {
    const link = new FakeLink();
    const { engine } = setup({ link });
    await engine.start();
    await engine.cutLink();
    link.failRestore = true;
    await assert.rejects(() => engine.restoreLink(), /cannot restore the link/);
    assert.notEqual(engine.snapshot().faults.linkLoss, null);
  });

  it('a timer that cannot restore the link reports a tick-error', async () => {
    const link = new FakeLink();
    const { engine, clock } = setup({ link });
    const heard = listen(engine);
    await engine.start();
    await engine.cutLink({ forS: 1 });
    link.failRestore = true;
    await clock.advance(1000);
    assert.equal(heard.errors.length, 1);
    assert.match(heard.errors[0]?.message ?? '', /cannot restore/);
  });

  it('is refused without a link and when already down; restoring a link that is up does nothing', async () => {
    const { engine: bare } = setup();
    await assert.rejects(() => bare.cutLink(), FaultConflictError);
    await bare.restoreLink();

    const link = new FakeLink();
    const { engine } = setup({ link });
    await engine.start();
    await engine.restoreLink();
    assert.deepEqual(link.calls, []);
    await engine.cutLink();
    await assert.rejects(() => engine.cutLink(), /already down/);
  });
});

describe('Engine faults: clear all', () => {
  it('restores the link first, then sends what was held, once, and says so once', async () => {
    const log: string[] = [];
    const link = new FakeLink(log);
    const publisher = new FakePublisher();
    const original = publisher.publish.bind(publisher);
    publisher.publish = async (topic, payload, options) => {
      log.push(`send:${topic.split('/')[2]}`);
      await original(topic, payload, options);
    };
    const { engine, clock } = setup({ link, publisher });
    const heard = listen(engine);
    engine.setFault('delay', { delayMs: 5000, jitterMs: 0 });
    await engine.start();
    await engine.cutLink();
    log.length = 0;
    // The first message is held, the later ones are dropped by the link.
    await engine.clearFaults();

    assert.deepEqual(log, ['restore', 'send:dc-env-01', 'send:dc-env-02']);
    const snapshot = engine.snapshot();
    assert.equal(snapshot.faults.activeCount, 0);
    assert.equal(snapshot.faults.held, 0);
    assert.equal(heard.states.filter((s) => s.type === 'faults-cleared').length, 1);

    // Nothing is left on the clock: the held messages are not sent a second time.
    await clock.advance(5000);
    assert.deepEqual(
      seqs(publisher, 'dc-env-01').filter((s) => s === 1),
      [1],
    );
  });

  it('sends what a reorder window holds, in the order it was held', async () => {
    const { engine, publisher } = setup();
    engine.setFault('reorder', { window: 5 });
    await engine.start();
    await engine.step();
    await engine.step();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), []);
    await engine.clearFaults();
    assert.deepEqual(seqs(publisher, 'dc-env-01'), [1, 2, 3]);
  });

  it('keeps the scope, and says nothing when no fault was on', async () => {
    const { engine } = setup();
    const heard = listen(engine);
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    heard.states.length = 0;
    await engine.clearFaults();
    assert.deepEqual(heard.states, []);
    assert.deepEqual(engine.snapshot().faults.scope, {
      mode: 'selected',
      deviceIds: ['dc-env-01'],
    });
  });

  it('does everything else when the link cannot be restored, and then throws', async () => {
    const link = new FakeLink();
    const { engine } = setup({ link });
    engine.setFault('drop', { percent: 100 });
    await engine.start();
    await engine.cutLink();
    link.failRestore = true;
    await assert.rejects(() => engine.clearFaults(), /cannot restore the link/);
    assert.equal(engine.snapshot().faults.drop, null);
  });
});

describe('Engine faults: settings, events and lifecycle', () => {
  it('reports each fault with its settings, and counts the ones that are on', () => {
    const { engine } = setup({ link: new FakeLink() });
    engine.setFault('drop', { percent: 5 });
    engine.setFault('duplicate', { percent: 2 });
    engine.setFault('malformed', { percent: 3, kinds: ['range'] });
    const { faults } = engine.snapshot();
    assert.deepEqual(faults.drop, { percent: 5 });
    assert.deepEqual(faults.duplicate, { percent: 2 });
    assert.deepEqual(faults.malformed, { percent: 3, kinds: ['range'] });
    assert.equal(faults.delay, null);
    assert.equal(faults.activeCount, 3);
    assert.equal(faults.deviceCount, 2);
  });

  it('changing a setting replaces it; each change is one state event', () => {
    const { engine } = setup();
    const heard = listen(engine);
    engine.setFault('drop', { percent: 5 });
    engine.setFault('drop', { percent: 10 });
    engine.clearFault('drop');
    engine.clearFault('drop');
    assert.deepEqual(heard.states, [
      { type: 'fault-set', kind: 'drop', config: { percent: 5 } },
      { type: 'fault-set', kind: 'drop', config: { percent: 10 } },
      { type: 'fault-cleared', kind: 'drop' },
    ]);
  });

  it('refuses a setting that cannot be played, and changes nothing', () => {
    const { engine } = setup();
    const heard = listen(engine);
    assert.throws(() => engine.setFault('drop', { percent: 0 }), /"percent"/);
    assert.throws(() => engine.setFault('delay', { delayMs: 100, jitterMs: 500 }), /"jitterMs"/);
    assert.throws(() => engine.setFault('reorder', { window: 1 }), /"window"/);
    assert.throws(() => engine.setFault('malformed', { percent: 5, kinds: [] }), /"kinds"/);
    assert.equal(engine.snapshot().faults.activeCount, 0);
    assert.deepEqual(heard.states, []);
  });

  it('does not copy what it was given into its state', () => {
    const { engine } = setup();
    const config: MalformedConfig = { percent: 5, kinds: ['range'] };
    engine.setFault('malformed', config);
    config.kinds.push('json');
    assert.deepEqual(engine.snapshot().faults.malformed?.kinds, ['range']);
  });

  it('a reset leaves the faults alone', () => {
    const { engine } = setup();
    engine.setFault('drop', { percent: 5 });
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.reset();
    const { faults } = engine.snapshot();
    assert.deepEqual(faults.drop, { percent: 5 });
    assert.equal(faults.scope.mode, 'selected');
  });

  it('stopping the engine discards what is held and leaves nothing on the clock', async () => {
    const { engine, clock, publisher } = setup();
    engine.setFault('delay', { delayMs: 500, jitterMs: 0 });
    engine.setFault('reorder', { window: 5 });
    await engine.start();
    engine.stop();
    await clock.advance(10_000);
    assert.equal(publisher.sent.length, 0);
    assert.equal(engine.snapshot().faults.held, 0);
  });
});

/** The real clocks of the engine, fixed by the test; the manual clock stays at 2026-10-01. */
class FakeRealTime implements RealTime {
  wallMs = Date.parse('2026-10-23T08:00:00.000Z');
  monoMs = 1000;

  wall(): number {
    return this.wallMs;
  }

  mono(): number {
    return this.monoMs;
  }
}

/** A publisher whose PUBACK takes `ackMs` on the fake monotonic clock. */
class TimedPublisher extends FakePublisher {
  ackMs = 3;
  private readonly realTime: FakeRealTime;

  // No parameter property: Node strips types and does not transform them.
  constructor(realTime: FakeRealTime) {
    super();
    this.realTime = realTime;
  }

  override async publish(topic: string, payload: string, options: { qos: 1 }): Promise<void> {
    await super.publish(topic, payload, options);
    this.realTime.monoMs += this.ackMs;
  }
}

function setupTimed(options: Partial<EngineOptions> = {}) {
  const realTime = new FakeRealTime();
  const publisher = new TimedPublisher(realTime);
  const clock = new ManualClock(T0);
  const engine = new Engine({
    devices: [dc1, dc2],
    publisher,
    clock,
    realTime,
    intervalMs: 2000,
    random: () => 0.5,
    ...options,
  });
  return { engine, clock, publisher, realTime };
}

describe('Engine published messages: id, time and PUBACK', () => {
  it('gives every message an id from 1, in the order they are emitted, copies included', async () => {
    const { engine } = setupTimed();
    const heard = listen(engine);
    engine.setFaultScope({ mode: 'selected', deviceIds: ['dc-env-01'] });
    engine.setFault('duplicate', { percent: 100 });
    await engine.start();
    assert.deepEqual(
      heard.published.map((m) => m.id),
      [1, 2, 3],
    );
  });

  it('stamps the real wall time of the acknowledgement, not the engine clock', async () => {
    const { engine, clock, realTime } = setupTimed();
    const heard = listen(engine);
    await engine.start();
    await clock.advance(2000);
    assert.equal(heard.published[0]?.at, '2026-10-23T08:00:00.000Z');
    realTime.wallMs += 1500;
    await clock.advance(2000);
    assert.equal(heard.published.at(-1)?.at, '2026-10-23T08:00:01.500Z');
    // The payload's own time is the engine's.
    assert.equal(heard.published.at(-1)?.ts, iso(4000));
  });

  it('measures the PUBACK time on the monotonic clock, to a tenth of a millisecond', async () => {
    const { engine, publisher } = setupTimed();
    const heard = listen(engine);
    publisher.ackMs = 3.14159;
    await engine.start();
    assert.equal(heard.published[0]?.ackMs, 3.1);
    publisher.ackMs = 2;
    await engine.step();
    assert.equal(heard.published.at(-1)?.ackMs, 2);
  });

  it('uses the system clocks when none are given', async () => {
    const { engine } = setup();
    const heard = listen(engine);
    const before = Date.now();
    await engine.start();
    const message = heard.published[0] as PublishedMessage;
    const at = Date.parse(message.at);
    assert.ok(at >= before && at <= Date.now() + 1000, message.at);
    assert.ok(Number.isFinite(message.ackMs) && message.ackMs >= 0, String(message.ackMs));
  });

  it('does not read the random source for the new fields', async () => {
    let reads = 0;
    const counting = () => {
      reads++;
      return 0.5;
    };
    const plain = setup({ random: counting });
    await plain.engine.start();
    const withNew = reads;
    reads = 0;
    const timed = setupTimed({ random: counting });
    await timed.engine.start();
    assert.equal(reads, withNew);
  });
});

describe('Engine republish', () => {
  async function started(options: Partial<EngineOptions> = {}) {
    const rig = setupTimed(options);
    const heard = listen(rig.engine);
    await rig.engine.start();
    const original = heard.published[0] as PublishedMessage;
    return { ...rig, heard, original };
  }

  it('sends the same topic, payload, seq and ts again, as a new message tagged republish', async () => {
    const { engine, publisher, heard, original } = await started();
    const sentBefore = publisher.sent.length;
    const again = await engine.republish(original);

    assert.equal(publisher.sent.length, sentBefore + 1);
    assert.deepEqual(publisher.sent.at(-1), {
      topic: original.topic,
      payload: original.payload,
      options: { qos: 1 },
    });
    assert.equal(again.seq, original.seq);
    assert.equal(again.ts, original.ts);
    assert.equal(again.payload, original.payload);
    assert.equal(again.fault, 'republish');
    assert.ok(again.id > original.id);
    assert.equal(heard.published.at(-1), again);
  });

  it('is counted like any message handed to the publisher', async () => {
    const { engine, original } = await started();
    const before = engine.published;
    await engine.republish(original);
    assert.equal(engine.published, before + 1);
  });

  it('emits published first and then the state change', async () => {
    const { engine, original } = await started();
    const order: string[] = [];
    engine.on('published', () => order.push('published'));
    engine.on('state', (change) => order.push(change.type));
    await engine.republish(original);
    assert.deepEqual(order, ['published', 'republish']);
  });

  it('says which device and seq in the state change', async () => {
    const { engine, heard, original } = await started();
    await engine.republish(original);
    assert.deepEqual(heard.states.at(-1), {
      type: 'republish',
      deviceId: original.deviceId,
      seq: original.seq,
    });
  });

  it('replaces the tag of the original, even a malformed or duplicate one', async () => {
    const { engine, original } = await started();
    for (const fault of ['duplicate', 'burst', 'malformed:json'] as const) {
      const again = await engine.republish({ ...original, fault } as PublishedMessage);
      assert.equal(again.fault, 'republish');
    }
  });

  it('applies no fault, reads no random value, and ignores the scope', async () => {
    let reads = 0;
    const { engine, publisher, heard, original } = await started({
      random: () => {
        reads++;
        return 0;
      },
    });
    engine.setFault('drop', { percent: 100 });
    engine.setFault('malformed', { percent: 100, kinds: ['json'] });
    engine.setFault('duplicate', { percent: 100 });
    engine.setFault('delay', { delayMs: 500, jitterMs: 0 });
    engine.setFault('reorder', { window: 5 });
    engine.setFaultScope({ mode: 'selected', deviceIds: [original.deviceId] });
    const readsBefore = reads;
    const sentBefore = publisher.sent.length;

    await engine.republish(original);

    assert.equal(publisher.sent.length, sentBefore + 1);
    assert.equal(publisher.sent.at(-1)?.payload, original.payload);
    assert.equal(reads, readsBefore);
    assert.deepEqual(heard.dropped, []);
    assert.equal(engine.snapshot().faults.held, 0);
  });

  it('is refused while the link is down, and publishes nothing', async () => {
    const { engine, publisher, heard, original } = await started({ link: new FakeLink() });
    await engine.cutLink();
    const sentBefore = publisher.sent.length;
    const publishedBefore = engine.published;
    const statesBefore = heard.states.length;

    await assert.rejects(() => engine.republish(original), FaultConflictError);

    assert.equal(publisher.sent.length, sentBefore);
    assert.equal(engine.published, publishedBefore);
    assert.equal(heard.states.length, statesBefore);
  });

  it('rejects when the broker refuses the publish, without a published event, a state change or a tick-error', async () => {
    const { engine, publisher, heard, original } = await started();
    const publishedBefore = heard.published.length;
    const statesBefore = heard.states.length;
    publisher.failOn = () => true;

    await assert.rejects(() => engine.republish(original), /publish failed/);

    assert.equal(heard.published.length, publishedBefore);
    assert.equal(heard.states.length, statesBefore);
    assert.deepEqual(heard.errors, []);
  });

  it('works on a stopped engine and on a simulated clock, with the same bytes', async () => {
    const { engine, clock, publisher, original } = await started();
    await clock.advance(2000);
    engine.stop();
    const again = await engine.republish(original);
    assert.equal(again.ts, original.ts);
    assert.equal(publisher.sent.at(-1)?.payload, original.payload);
  });
});
