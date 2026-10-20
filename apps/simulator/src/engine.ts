import { type MetricName, type TelemetryPayload, telemetryTopic } from '@itp/telemetry-contract';
import { EventEmitter } from 'node:events';
import { type Clock, ManualClock, systemClock } from './clock.ts';
import { ANOMALY_SHAPES, type Anomaly, type DeviceSpec, sample } from './signals.ts';

/** Where messages go. `main.ts` adapts the MQTT client; tests pass a fake. */
export interface Publisher {
  publish(topic: string, payload: string, options: { qos: 1 }): Promise<unknown>;
}

export type DeviceState = 'running' | 'paused' | 'stopped';

export type StateChange =
  | { type: 'device-state'; deviceId: string; state: DeviceState }
  | { type: 'device-interval'; deviceId: string; intervalMs: number | undefined }
  | { type: 'anomaly-added'; id: string; anomaly: Anomaly }
  | { type: 'anomaly-removed'; id: string }
  | { type: 'hold-set'; deviceId: string; metric: MetricName; value: number }
  | { type: 'hold-released'; deviceId: string; metric: MetricName }
  | { type: 'reset' };

export interface PublishedMessage {
  deviceId: string;
  topic: string;
  payload: string;
  seq: number;
  ts: string;
}

/**
 * `state`: something an operator can change was changed. `published`: a message was accepted by the
 * publisher. `tick-error`: a tick failed (the first failure of that tick). There is no `error`
 * event on purpose: an emitter throws when `error` has no listener.
 */
export type EngineEvents = {
  state: [StateChange];
  published: [PublishedMessage];
  'tick-error': [Error];
};

export interface EngineOptions {
  devices: DeviceSpec[];
  publisher: Publisher;
  /** Default publish interval of every device, in milliseconds. */
  intervalMs: number;
  /** Defaults to the wall clock. A `ManualClock` is the simulated-clock mode: see `step()`. */
  clock?: Clock;
  /** Defaults to `Math.random`; pass `seededRandom(seed)` for reproducible readings. */
  random?: () => number;
  /**
   * Anomalies that exist from the start (the CLI's `--scenario` and `--anomaly`). Not checked,
   * unlike `addAnomaly`: one that names an unknown device or metric never matches, as before, and
   * `parseAnomaly` is the only guard of its numbers.
   */
  anomalies?: Anomaly[];
}

export interface EngineSnapshot {
  running: boolean;
  /** True when the engine runs on a `ManualClock`. */
  simulated: boolean;
  nowMs: number;
  /** Seconds on the anomaly clock: since `start()`, or since the last `reset()`. */
  elapsedS: number;
  intervalMs: number;
  /** Messages handed to the publisher, counted before the publish (so failures are included). */
  published: number;
  devices: {
    id: string;
    state: DeviceState;
    /** The interval in force: the device's own, else the engine's. */
    intervalMs: number;
    seq: number;
    holds: Partial<Record<MetricName, number>>;
  }[];
  anomalies: { id: string; anomaly: Anomaly }[];
}

interface DeviceRuntime {
  spec: DeviceSpec;
  state: DeviceState;
  /** The device's own interval, if it has one. */
  intervalMs: number | undefined;
  nextDueMs: number;
  seq: number;
  holds: Map<MetricName, number>;
}

function assertInterval(ms: number, what: string): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new RangeError(`${what} must be a positive number of milliseconds, got ${ms}`);
  }
}

function assertPlayable({ value, startAt, duration, shape }: Anomaly): void {
  if (!Number.isFinite(value) || !Number.isFinite(startAt)) {
    throw new RangeError(
      `An anomaly needs a finite value and startAt, got ${value} and ${startAt}`,
    );
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError(
      `An anomaly duration must be a positive number of seconds, got ${duration}`,
    );
  }
  if (shape !== undefined && !ANOMALY_SHAPES.includes(shape)) {
    throw new Error(`Unknown anomaly shape "${shape}"`);
  }
}

/**
 * The publish loop of the simulator, without any process or argument handling. Devices publish on
 * their interval; devices, anomalies and held values can be changed while it runs, and every change
 * and every message is an event.
 *
 * Time comes from the injected clock. On a `ManualClock` nothing happens until `step()` moves it,
 * which is what makes Step, Reset and deterministic tests possible. The clock is chosen when the
 * engine is built.
 *
 * Sequence numbers and timestamps only move forward: no operation here resets a device's `seq`, and
 * the clock is never set back, so ingest never reads a Reset as a device restart.
 */
export class Engine extends EventEmitter<EngineEvents> {
  private readonly publisher: Publisher;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly intervalMs: number;
  private readonly devices = new Map<string, DeviceRuntime>();
  private anomalies: { id: string; anomaly: Anomaly }[] = [];
  private nextAnomalyId = 1;
  private epochMs = 0;
  private started = false;
  private publishedCount = 0;
  private cancelTimer: (() => void) | undefined;

  constructor(options: EngineOptions) {
    super();
    assertInterval(options.intervalMs, 'The publish interval');
    this.publisher = options.publisher;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.intervalMs = options.intervalMs;
    for (const spec of options.devices) {
      if (this.devices.has(spec.id)) throw new Error(`Duplicate device id "${spec.id}"`);
      this.devices.set(spec.id, {
        spec,
        state: 'running',
        intervalMs: undefined,
        nextDueMs: 0,
        seq: 0,
        holds: new Map(),
      });
    }
    for (const anomaly of options.anomalies ?? []) {
      this.anomalies.push({ id: this.newAnomalyId(), anomaly });
    }
  }

  /** Messages handed to the publisher so far, counted before each publish. */
  get published(): number {
    return this.publishedCount;
  }

  /**
   * Starts the anomaly clock and publishes the first tick at once. The returned promise settles
   * with that tick, so a failure of the first publish is the caller's to handle; later ticks report
   * through `tick-error`.
   */
  start(): Promise<void> {
    if (this.started) throw new Error('The engine is already started');
    this.started = true;
    const now = this.clock.now();
    this.epochMs = now;
    for (const device of this.devices.values()) device.nextDueMs = now;
    return this.runDue();
  }

  /** Stops the timer. The publisher is not ended: it belongs to the caller. */
  stop(): void {
    this.started = false;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }

  /**
   * Simulated-clock mode: moves the clock forward by one publish interval, which publishes the tick
   * that falls due. Only an engine built on a `ManualClock` can be stepped.
   *
   * `ts` follows the simulated clock. Ingest rejects a `ts` more than 5 minutes ahead of its own
   * clock (`future`, docs/telemetry-contract.md), so stepping far ahead of real time makes it reject
   * the messages.
   */
  async step(): Promise<void> {
    if (!(this.clock instanceof ManualClock)) {
      throw new Error('step() needs the simulated clock: build the engine with a ManualClock');
    }
    if (!this.started) throw new Error('The engine is not started');
    await this.clock.advance(this.intervalMs);
  }

  startDevice(deviceId: string): void {
    this.setDeviceState(deviceId, 'running');
  }

  pauseDevice(deviceId: string): void {
    this.setDeviceState(deviceId, 'paused');
  }

  stopDevice(deviceId: string): void {
    this.setDeviceState(deviceId, 'stopped');
  }

  /** Gives a device its own publish interval, or `undefined` to follow the engine's again. */
  setDeviceInterval(deviceId: string, intervalMs: number | undefined): void {
    const device = this.device(deviceId);
    if (intervalMs !== undefined) assertInterval(intervalMs, 'A device interval');
    device.intervalMs = intervalMs;
    // A shorter interval takes effect within that interval; a longer one after the tick already due.
    device.nextDueMs = Math.min(device.nextDueMs, this.clock.now() + this.intervalOf(device));
    this.arm();
    this.emit('state', { type: 'device-interval', deviceId, intervalMs });
  }

  /**
   * Adds an anomaly while running. `startAt` is in seconds on the anomaly clock (see `elapsedS` in
   * `snapshot()`); to start "in 10 seconds", pass `elapsedS + 10`. Returns its id. Throws for an
   * unknown device or metric, for numbers that cannot be played (not finite, or a duration of 0 or
   * less) and for an unknown shape; nothing is stored or emitted then.
   */
  addAnomaly(anomaly: Anomaly): string {
    this.assertMetric(this.device(anomaly.deviceId), anomaly.metric);
    assertPlayable(anomaly);
    const id = this.newAnomalyId();
    this.anomalies.push({ id, anomaly });
    this.emit('state', { type: 'anomaly-added', id, anomaly });
    return id;
  }

  /** Returns false when there is no such anomaly. */
  removeAnomaly(id: string): boolean {
    const before = this.anomalies.length;
    this.anomalies = this.anomalies.filter((a) => a.id !== id);
    if (this.anomalies.length === before) return false;
    this.emit('state', { type: 'anomaly-removed', id });
    return true;
  }

  /**
   * Publishes an exact value for one metric of a device, with no noise, until it is released. It
   * wins over an anomaly on the same metric.
   */
  holdValue(deviceId: string, metric: MetricName, value: number): void {
    const device = this.device(deviceId);
    this.assertMetric(device, metric);
    if (!Number.isFinite(value)) throw new RangeError(`A held value must be finite, got ${value}`);
    device.holds.set(metric, value);
    this.emit('state', { type: 'hold-set', deviceId, metric, value });
  }

  releaseValue(deviceId: string, metric: MetricName): void {
    if (!this.device(deviceId).holds.delete(metric)) return;
    this.emit('state', { type: 'hold-released', deviceId, metric });
  }

  /**
   * Clears every anomaly and held value and restarts the anomaly clock at zero, so devices return
   * to their baseline. Device states, intervals, `seq` and the clock itself are left alone.
   */
  reset(): void {
    this.anomalies = [];
    for (const device of this.devices.values()) device.holds.clear();
    this.epochMs = this.clock.now();
    this.emit('state', { type: 'reset' });
  }

  snapshot(): EngineSnapshot {
    const now = this.clock.now();
    return {
      running: this.started,
      simulated: this.clock instanceof ManualClock,
      nowMs: now,
      elapsedS: this.started ? (now - this.epochMs) / 1000 : 0,
      intervalMs: this.intervalMs,
      published: this.publishedCount,
      devices: [...this.devices.values()].map((d) => ({
        id: d.spec.id,
        state: d.state,
        intervalMs: this.intervalOf(d),
        seq: d.seq,
        holds: Object.fromEntries(d.holds),
      })),
      anomalies: [...this.anomalies],
    };
  }

  private device(deviceId: string): DeviceRuntime {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Unknown device "${deviceId}"`);
    return device;
  }

  private assertMetric(device: DeviceRuntime, metric: MetricName): void {
    if (!device.spec.metrics.includes(metric)) {
      throw new Error(`Device "${device.spec.id}" has no metric "${metric}"`);
    }
  }

  private newAnomalyId(): string {
    return `a${this.nextAnomalyId++}`;
  }

  private intervalOf(device: DeviceRuntime): number {
    return device.intervalMs ?? this.intervalMs;
  }

  private setDeviceState(deviceId: string, state: DeviceState): void {
    const device = this.device(deviceId);
    if (device.state === state) return;
    device.state = state;
    // A device that starts again publishes after one interval, on both clocks.
    if (state === 'running') device.nextDueMs = this.clock.now() + this.intervalOf(device);
    this.arm();
    this.emit('state', { type: 'device-state', deviceId, state });
  }

  /** Arms one timer for the earliest running device, or none if nothing is running. */
  private arm(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    if (!this.started) return;
    let earliest = Infinity;
    for (const device of this.devices.values()) {
      if (device.state === 'running') earliest = Math.min(earliest, device.nextDueMs);
    }
    if (earliest === Infinity) return;
    const delay = Math.max(0, earliest - this.clock.now());
    this.cancelTimer = this.clock.setTimer(delay, () => this.onTimer());
  }

  private onTimer(): Promise<void> {
    this.cancelTimer = undefined;
    return this.runDue().catch((error: unknown) => {
      this.emit('tick-error', error instanceof Error ? error : new Error(String(error)));
    });
  }

  /**
   * Publishes every running device that is due, in registry order, all with the same timestamp. The
   * next timer is armed before the publishes are awaited, so a slow publish does not delay the
   * next tick (and ticks can overlap), as the `setInterval` of the old loop did.
   */
  private runDue(): Promise<void> {
    const now = this.clock.now();
    const due = [...this.devices.values()].filter(
      (d) => d.state === 'running' && d.nextDueMs <= now,
    );
    for (const device of due) {
      const interval = this.intervalOf(device);
      device.nextDueMs += interval;
      // After a long stall (a laptop that slept) skip the missed ticks instead of sending them all:
      // the next one is the first slot strictly after now, which keeps the device's phase.
      if (device.nextDueMs <= now) {
        device.nextDueMs += (Math.floor((now - device.nextDueMs) / interval) + 1) * interval;
      }
    }
    this.arm();

    const at = new Date(now);
    const elapsedS = (now - this.epochMs) / 1000;
    const anomalies = this.anomalies.map((a) => a.anomaly);
    return Promise.all(due.map((d) => this.publishOne(d, at, elapsedS, anomalies))).then(
      () => undefined,
    );
  }

  private publishOne(
    device: DeviceRuntime,
    at: Date,
    elapsedS: number,
    anomalies: Anomaly[],
  ): Promise<void> {
    const seq = ++device.seq;
    const ts = at.toISOString();
    const payload: TelemetryPayload = {
      seq,
      ts,
      metrics: Object.fromEntries(
        device.spec.metrics.map((m) => [
          m,
          device.holds.get(m) ?? sample(device.spec, m, at, elapsedS, anomalies, this.random),
        ]),
      ),
    };
    this.publishedCount++;
    const topic = telemetryTopic({ zoneCode: device.spec.zoneCode, deviceId: device.spec.id });
    const body = JSON.stringify(payload);
    return this.publisher.publish(topic, body, { qos: 1 }).then(() => {
      this.emit('published', { deviceId: device.spec.id, topic, payload: body, seq, ts });
    });
  }
}
