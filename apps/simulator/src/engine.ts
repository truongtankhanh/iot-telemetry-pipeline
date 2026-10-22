import { type MetricName, type TelemetryPayload, telemetryTopic } from '@itp/telemetry-contract';
import { EventEmitter } from 'node:events';
import { type Clock, ManualClock, systemClock } from './clock.ts';
import {
  chance,
  DEFAULT_SCOPE,
  delayFor,
  FAULT_LIMITS,
  type FaultConfigs,
  FaultConflictError,
  type FaultScope,
  type FaultsSnapshot,
  type FaultTag,
  type LinkControl,
  malformedMessage,
  parseFaultConfig,
  shuffleWindow,
  type SwitchKind,
} from './faults.ts';
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
  | { type: 'reset' }
  | { type: 'fault-set'; kind: SwitchKind; config: FaultConfigs[SwitchKind] }
  | { type: 'fault-cleared'; kind: SwitchKind }
  | { type: 'fault-scope'; scope: FaultScope }
  | { type: 'faults-cleared' }
  | { type: 'burst'; count: number; sent: number; failed: number; deviceIds: string[] }
  | { type: 'link-lost'; forS: number | null }
  | { type: 'link-restored'; reason: 'command' | 'timer' | 'clear' };

export interface PublishedMessage {
  deviceId: string;
  topic: string;
  payload: string;
  seq: number;
  ts: string;
  /** Present when the message is not a plain one: a copy, a burst message or a malformed payload. */
  fault?: FaultTag;
}

/** A message that was built, with its `seq` used, and never handed to the publisher. */
export interface DroppedMessage {
  deviceId: string;
  seq: number;
  ts: string;
  /** `fault`: the drop fault chose it. `link`: the link to the broker was down. */
  reason: 'fault' | 'link';
}

/**
 * `state`: something an operator can change was changed. `published`: a message was accepted by the
 * publisher (never emitted for one that was dropped). `dropped`: a message was built and not sent.
 * `tick-error`: a tick failed (the first failure of that tick), or a message that was held back
 * failed when it was finally sent. There is no `error` event on purpose: an emitter throws when
 * `error` has no listener.
 */
export type EngineEvents = {
  state: [StateChange];
  published: [PublishedMessage];
  dropped: [DroppedMessage];
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
  /** The simulator's own connection to the broker, for the link-loss fault. Without it that fault is refused. */
  link?: LinkControl;
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
  faults: FaultsSnapshot;
}

/** A message as it goes to the publisher. */
interface Outgoing {
  deviceId: string;
  topic: string;
  body: string;
  seq: number;
  ts: string;
  fault?: FaultTag;
}

/** The switches that are on, by kind; `null` is off. */
type Switches = { [K in SwitchKind]: FaultConfigs[K] | null };

const NO_SWITCHES: Switches = {
  drop: null,
  duplicate: null,
  delay: null,
  reorder: null,
  malformed: null,
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

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
 *
 * Faults (`faults.ts`) make the transport misbehave on purpose. A message is built first, so its `seq`
 * is used whatever happens to it; then, only for a device in scope and only when a fault is on, it may
 * be dropped, replaced by a malformed payload, sent twice, held in a window and released out of order,
 * or held back for a delay, in that order. The random source is read only for the faults that are on,
 * so with none on a seeded run is exactly what it was without this layer. A held message never holds
 * up a tick: the tick settles when its messages are queued or handed over.
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
  private readonly link: LinkControl | undefined;
  private switches: Switches = { ...NO_SWITCHES };
  private scope: FaultScope = DEFAULT_SCOPE;
  private linkDown: { since: string; forS: number | null } | undefined;
  private cancelLinkTimer: (() => void) | undefined;
  /** Messages waiting for their delay, with the way to send one now and to cancel its timer. */
  private readonly delayed = new Set<{ cancel: () => void; message: Outgoing }>();
  /** Messages held by the reorder fault, by device. */
  private readonly windows = new Map<string, Outgoing[]>();
  private droppedCount = 0;
  private bursting = false;

  constructor(options: EngineOptions) {
    super();
    assertInterval(options.intervalMs, 'The publish interval');
    this.publisher = options.publisher;
    this.link = options.link;
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

  /**
   * Stops the timer. The publisher is not ended: it belongs to the caller. Messages still held by a
   * delay or a window are discarded, and a link that was cut stays cut: call `clearFaults()` first to
   * have them sent and the link restored (`main.ts` does).
   */
  stop(): void {
    this.started = false;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.cancelLinkTimer?.();
    this.cancelLinkTimer = undefined;
    for (const entry of this.delayed) entry.cancel();
    this.delayed.clear();
    this.windows.clear();
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
      faults: this.faultsSnapshot(),
    };
  }

  /**
   * Switches a fault on, or changes its settings. The config is checked again here (the routes check
   * it first, to name the field): nothing changes and nothing is emitted when it is refused.
   */
  setFault<K extends SwitchKind>(kind: K, config: FaultConfigs[K]): void {
    const parsed = parseFaultConfig(kind, config);
    if (!parsed.ok) throw new RangeError(parsed.reason);
    this.switches[kind] = parsed.value;
    this.emit('state', { type: 'fault-set', kind, config: parsed.value });
  }

  /** Switches one fault off. Messages the reorder fault was holding are released now; delayed ones go out on their schedule. */
  clearFault(kind: SwitchKind): void {
    if (this.switches[kind] === null) return;
    this.switches[kind] = null;
    if (kind === 'reorder')
      for (const deviceId of [...this.windows.keys()]) this.releaseWindow(deviceId);
    this.emit('state', { type: 'fault-cleared', kind });
  }

  /** Which devices the switches and a burst act on. A selection must name devices of the registry. */
  setFaultScope(scope: FaultScope): void {
    if (scope.mode === 'selected') {
      if (scope.deviceIds.length === 0)
        throw new RangeError('A selection needs at least one device');
      for (const deviceId of scope.deviceIds) this.device(deviceId);
    }
    this.scope =
      scope.mode === 'running' ? scope : { mode: 'selected', deviceIds: [...scope.deviceIds] };
    // Messages held for a device that is no longer in scope are not kept back any longer.
    for (const deviceId of [...this.windows.keys()]) {
      if (!this.inScope(this.device(deviceId))) this.releaseWindow(deviceId);
    }
    this.emit('state', { type: 'fault-scope', scope: this.scope });
  }

  /**
   * Clear all faults: restores the link if it is down (first, or what is sent next would be dropped),
   * switches every fault off, sends what delay and reorder were holding and cancels their timers. The
   * scope stays. If the link cannot be restored the rest is still done, and the error is thrown last.
   */
  async clearFaults(): Promise<void> {
    const wasActive = this.faultsSnapshot().activeCount > 0 || this.heldCount() > 0;
    let failure: unknown;
    try {
      await this.restoreLink('clear');
    } catch (error) {
      failure = error;
    }
    this.switches = { ...NO_SWITCHES };
    await this.flushHeld();
    if (wasActive) this.emit('state', { type: 'faults-cleared' });
    if (failure !== undefined) throw failure;
  }

  /**
   * Cuts the connection to the broker. While it is down every message is dropped (its `seq` still
   * advances, so ingest counts a gap after its grace period). With `forS` it is restored by itself.
   */
  async cutLink({ forS = null }: { forS?: number | null } = {}): Promise<void> {
    if (!this.link) throw new FaultConflictError('This simulator has no broker link it can cut');
    if (this.linkDown) throw new FaultConflictError('The link is already down; restore it first');
    if (this.bursting) throw new FaultConflictError('A burst is being sent; wait for it');
    this.linkDown = { since: new Date(this.clock.now()).toISOString(), forS };
    try {
      await this.link.cut();
    } catch (error) {
      this.linkDown = undefined;
      throw error;
    }
    if (forS !== null) {
      this.cancelLinkTimer = this.clock.setTimer(forS * 1000, () => {
        this.cancelLinkTimer = undefined;
        return this.restoreLink('timer').catch((error: unknown) => {
          this.emit('tick-error', toError(error));
        });
      });
    }
    this.emit('state', { type: 'link-lost', forS });
  }

  /** Restores the connection. Harmless when it is not down. If the link cannot be restored it stays marked as down. */
  async restoreLink(reason: 'command' | 'timer' | 'clear' = 'command'): Promise<void> {
    if (!this.linkDown || !this.link) return;
    this.cancelLinkTimer?.();
    this.cancelLinkTimer = undefined;
    await this.link.restore();
    this.linkDown = undefined;
    this.emit('state', { type: 'link-restored', reason });
  }

  /**
   * Sends `count` valid messages as fast as the publisher takes them, round-robin over the running
   * devices in scope, bypassing the switches. Each device's messages get its next `seq` and a `ts` spread
   * over the next publish interval (`at + 1 + floor(k * (interval - 1) / m)` ms for the k-th of `m`), so
   * they are distinct under the readings' key `(device, metric, ts)`, increase, and fall strictly between
   * `at` and `at + interval` (never on the tick that has just gone out or the one that is next). They are handed over in chunks, each awaited, so memory stays bounded.
   */
  async burst(count: number): Promise<{ sent: number; failed: number }> {
    if (!Number.isInteger(count) || count < 1 || count > FAULT_LIMITS.maxBurst) {
      throw new RangeError(`A burst is from 1 to ${FAULT_LIMITS.maxBurst} messages, got ${count}`);
    }
    if (!this.started) throw new FaultConflictError('The engine is not started');
    if (this.linkDown)
      throw new FaultConflictError('The link to the broker is down; restore it first');
    if (this.bursting) throw new FaultConflictError('A burst is already being sent');
    const targets = [...this.devices.values()].filter(
      (d) => d.state === 'running' && this.inScope(d),
    );
    if (targets.length === 0) throw new FaultConflictError('No running device is in scope');
    const most = Math.ceil(count / targets.length);
    const tight = targets.find((d) => most > this.intervalOf(d) - 1);
    if (tight) {
      throw new RangeError(
        `${count} messages over ${targets.length} device(s) is ${most} for one, more than the ${this.intervalOf(tight) - 1} ms ` +
          `interval of ${tight.spec.id} can space; choose more devices or a smaller count`,
      );
    }

    this.bursting = true;
    try {
      const now = this.clock.now();
      const anomalies = this.anomalies.map((a) => a.anomaly);
      const messages: Outgoing[] = [];
      for (let i = 0; i < count; i++) {
        const index = i % targets.length;
        // The first `count % n` devices get one message more than the others.
        const share = Math.floor(count / targets.length) + (index < count % targets.length ? 1 : 0);
        const slot = Math.floor(i / targets.length);
        const spread = this.intervalOf(targets[index] as DeviceRuntime) - 1;
        const offsetMs = 1 + Math.floor((slot * spread) / share);
        messages.push(
          this.burstMessage(targets[index] as DeviceRuntime, now + offsetMs, anomalies),
        );
      }

      let sent = 0;
      let failed = 0;
      let firstError: unknown;
      for (let from = 0; from < messages.length; from += FAULT_LIMITS.burstChunk) {
        if (!this.started) {
          failed += messages.length - from;
          break;
        }
        const chunk = messages.slice(from, from + FAULT_LIMITS.burstChunk);
        const results = await Promise.allSettled(chunk.map((m) => this.send(m)));
        for (const result of results) {
          if (result.status === 'fulfilled') sent++;
          else {
            failed++;
            firstError ??= result.reason;
          }
        }
      }
      if (firstError !== undefined) this.emit('tick-error', toError(firstError));
      this.emit('state', {
        type: 'burst',
        count,
        sent,
        failed,
        deviceIds: targets.map((d) => d.spec.id),
      });
      return { sent, failed };
    } finally {
      this.bursting = false;
    }
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
    // A device that stops publishing does not keep messages back for a window that will not fill.
    else this.releaseWindow(deviceId);
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
    const topic = telemetryTopic({ zoneCode: device.spec.zoneCode, deviceId: device.spec.id });
    if (this.linkDown === undefined && !this.faultsApplyTo(device)) {
      return this.send({ deviceId: device.spec.id, topic, body: JSON.stringify(payload), seq, ts });
    }
    return this.dispatch(device, topic, payload);
  }

  /** The message as the publisher gets it. Counted when handed over, not when built, so a dropped one is not counted. */
  private send(message: Outgoing): Promise<void> {
    this.publishedCount++;
    return this.publisher.publish(message.topic, message.body, { qos: 1 }).then(() => {
      this.emit('published', {
        deviceId: message.deviceId,
        topic: message.topic,
        payload: message.body,
        seq: message.seq,
        ts: message.ts,
        ...(message.fault ? { fault: message.fault } : {}),
      });
    });
  }

  private inScope(device: DeviceRuntime): boolean {
    return this.scope.mode === 'running'
      ? device.state === 'running'
      : this.scope.deviceIds.includes(device.spec.id);
  }

  private anySwitchOn(): boolean {
    return Object.values(this.switches).some((config) => config !== null);
  }

  private faultsApplyTo(device: DeviceRuntime): boolean {
    return this.anySwitchOn() && this.inScope(device);
  }

  private heldCount(): number {
    let held = this.delayed.size;
    for (const window of this.windows.values()) held += window.length;
    return held;
  }

  private faultsSnapshot(): FaultsSnapshot {
    const { drop, duplicate, delay, reorder, malformed } = this.switches;
    return {
      scope:
        this.scope.mode === 'running'
          ? this.scope
          : { ...this.scope, deviceIds: [...this.scope.deviceIds] },
      drop,
      duplicate,
      delay,
      reorder,
      malformed,
      linkLoss: this.linkDown ? { ...this.linkDown } : null,
      activeCount:
        Object.values(this.switches).filter((c) => c !== null).length + (this.linkDown ? 1 : 0),
      deviceCount:
        this.scope.mode === 'selected'
          ? this.scope.deviceIds.length
          : [...this.devices.values()].filter((d) => d.state === 'running').length,
      held: this.heldCount(),
      dropped: this.droppedCount,
      bursting: this.bursting,
    };
  }

  /**
   * What the faults do to one message of a device in scope, in this order: the link being down or the
   * drop fault ends it; malformed replaces the payload; duplicate makes a second copy; reorder holds
   * the copies in the device's window; delay holds each one back. Each fault reads the random source
   * only if it is on. Settles when the messages are handed over or queued, not when a delayed one goes.
   */
  private async dispatch(
    device: DeviceRuntime,
    topic: string,
    payload: TelemetryPayload,
  ): Promise<void> {
    const { drop, malformed, duplicate } = this.switches;
    const { seq, ts } = payload;
    const deviceId = device.spec.id;
    if (this.linkDown) return this.discard(deviceId, seq, ts, 'link');
    if (drop && chance(drop.percent, this.random)) return this.discard(deviceId, seq, ts, 'fault');

    let message: Outgoing = { deviceId, topic, body: JSON.stringify(payload), seq, ts };
    if (malformed && chance(malformed.percent, this.random)) {
      const kinds = malformed.kinds;
      const kind =
        kinds[kinds.length === 1 ? 0 : Math.floor(this.random() * kinds.length)] ?? 'range';
      const wire = malformedMessage(kind, { topic, payload }, this.random);
      message = { ...message, topic: wire.topic, body: wire.body, fault: `malformed:${kind}` };
    }
    const copies = [message];
    if (duplicate && chance(duplicate.percent, this.random)) {
      copies.push({ ...message, fault: message.fault ?? 'duplicate' });
    }

    const sends: Promise<void>[] = [];
    for (const copy of copies) sends.push(...this.hold(deviceId, copy));
    await Promise.all(sends);
  }

  private async discard(
    deviceId: string,
    seq: number,
    ts: string,
    reason: DroppedMessage['reason'],
  ): Promise<void> {
    this.droppedCount++;
    this.emit('dropped', { deviceId, seq, ts, reason });
  }

  /** Puts a copy in the device's reorder window; a full window is released shuffled. Returns the sends that happen now. */
  private hold(deviceId: string, message: Outgoing): Promise<void>[] {
    const { reorder } = this.switches;
    if (!reorder) return [this.forward(message)];
    const window = this.windows.get(deviceId) ?? [];
    window.push(message);
    if (window.length < reorder.window) {
      this.windows.set(deviceId, window);
      return [];
    }
    this.windows.delete(deviceId);
    return shuffleWindow(window, this.random).map((m) => this.forward(m));
  }

  /** Sends now, or after the delay when that fault is on. A delayed message is sent on the clock, on its own. */
  private forward(message: Outgoing): Promise<void> {
    const { delay } = this.switches;
    if (!delay) return this.send(message);
    const entry = { cancel: () => {}, message };
    entry.cancel = this.clock.setTimer(delayFor(delay, this.random), () => {
      this.delayed.delete(entry);
      return this.send(message).catch((error: unknown) => {
        this.emit('tick-error', toError(error));
      });
    });
    this.delayed.add(entry);
    return Promise.resolve();
  }

  /** Lets go of what one device's window holds, in the order it was held. Failures are reported as `tick-error`. */
  private releaseWindow(deviceId: string): void {
    const window = this.windows.get(deviceId);
    if (!window?.length) return;
    this.windows.delete(deviceId);
    void Promise.allSettled(window.map((m) => this.forward(m))).then((results) =>
      this.reportFailed(results),
    );
  }

  /** Sends every held message now and cancels the timers. Settles when they have all been handed over. */
  private async flushHeld(): Promise<void> {
    const sends: Promise<void>[] = [];
    for (const entry of this.delayed) {
      entry.cancel();
      sends.push(this.send(entry.message));
    }
    this.delayed.clear();
    for (const [deviceId, window] of [...this.windows]) {
      this.windows.delete(deviceId);
      for (const message of window) sends.push(this.forward(message));
    }
    this.reportFailed(await Promise.allSettled(sends));
  }

  private reportFailed(results: PromiseSettledResult<void>[]): void {
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) this.emit('tick-error', toError(failed.reason));
  }

  /** A valid message for a burst: the device's next `seq`, values from the same sampler at `atMs`. */
  private burstMessage(device: DeviceRuntime, atMs: number, anomalies: Anomaly[]): Outgoing {
    const at = new Date(atMs);
    const seq = ++device.seq;
    const ts = at.toISOString();
    const elapsedS = (atMs - this.epochMs) / 1000;
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
    return {
      deviceId: device.spec.id,
      topic: telemetryTopic({ zoneCode: device.spec.zoneCode, deviceId: device.spec.id }),
      body: JSON.stringify(payload),
      seq,
      ts,
      fault: 'burst',
    };
  }
}
