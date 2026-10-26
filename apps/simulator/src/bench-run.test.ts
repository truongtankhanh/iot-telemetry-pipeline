import { telemetryTopic } from '@itp/telemetry-contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BenchIo,
  type BenchProgress,
  checkDatabase,
  DEFAULT_DATABASE_URL,
  describeDatabase,
  expectedReadings,
  resolveDatabaseUrl,
  runBenchmark,
  sessionTsBase,
} from './bench-run.ts';
import type { DeviceSpec } from './signals.ts';

const WALL = Date.parse('2026-10-23T08:00:00Z');
const HOUR = 60 * 60_000;

/** The registry of `apps/ingest/config/devices.json`: six devices, 12 readings per round of messages. */
const REGISTRY: DeviceSpec[] = [
  {
    id: 'dc-env-01',
    kind: 'server_room',
    zoneCode: 'BLD-DC',
    metrics: ['temperature_c', 'humidity_pct'],
  },
  {
    id: 'dc-env-02',
    kind: 'server_room',
    zoneCode: 'BLD-DC',
    metrics: ['temperature_c', 'humidity_pct'],
  },
  {
    id: 'lib-air-01',
    kind: 'indoor_air',
    zoneCode: 'BLD-LIB',
    metrics: ['co2_ppm', 'temperature_c', 'humidity_pct'],
  },
  {
    id: 'lha-air-01',
    kind: 'indoor_air',
    zoneCode: 'BLD-LHA',
    metrics: ['co2_ppm', 'temperature_c'],
  },
  {
    id: 'stu-air-01',
    kind: 'indoor_air',
    zoneCode: 'BLD-STU',
    metrics: ['co2_ppm', 'temperature_c'],
  },
  { id: 'hub-power-01', kind: 'power_meter', zoneCode: 'BLD-HUB', metrics: ['power_kw'] },
];

/**
 * A publisher and a database that follow what was sent: `publishCostMs` of monotonic time per message, and
 * `storedPerPoll` readings appearing per count (never more than were published and never more than
 * `storedLimit`). The count includes `baseline` rows that were there before the run.
 */
class FakeIo implements BenchIo {
  readonly published: { topic: string; payload: string }[] = [];
  mono = 0;
  wallMs = WALL;
  publishCostMs = 0.1;
  storedPerPoll = 1000;
  storedLimit = Infinity;
  baseline = 1234;
  countCalls = 0;
  inFlight = 0;
  maxInFlight = 0;
  onSleep: (() => void) | undefined;
  onPublish: ((sent: number) => void) | undefined;
  private arrived = 0;

  publish(topic: string, payload: string): Promise<unknown> {
    this.published.push({ topic, payload });
    this.mono += this.publishCostMs;
    this.wallMs += this.publishCostMs;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.onPublish?.(this.published.length);
    return new Promise((resolve) =>
      queueMicrotask(() => {
        this.inFlight--;
        resolve(undefined);
      }),
    );
  }

  async countStored(): Promise<number> {
    this.countCalls++;
    if (this.countCalls > 1) {
      const sent = this.published.reduce(
        (sum, { payload }) =>
          sum + Object.keys((JSON.parse(payload) as { metrics: object }).metrics).length,
        0,
      );
      this.arrived = Math.min(this.arrived + this.storedPerPoll, sent, this.storedLimit);
    }
    return this.baseline + this.arrived;
  }

  now = () => this.mono;
  wall = () => this.wallMs;

  async sleep(ms: number): Promise<void> {
    this.mono += ms;
    this.wallMs += ms;
    this.onSleep?.();
  }
}

const quiet = () => undefined;

describe('runBenchmark: what it measures', () => {
  it('returns exactly the fields of the CLI --json line, in its order', async () => {
    const io = new FakeIo();
    const { result } = await runBenchmark({
      devices: REGISTRY,
      messages: 600,
      timeoutS: 120,
      io,
      log: quiet,
    });
    assert.deepEqual(Object.keys(result), [
      'messages',
      'readingsExpected',
      'readingsStored',
      'publishSeconds',
      'endToEndSeconds',
      'messagesPerSecond',
      'readingsPerSecond',
      'vcpu',
      'node',
    ]);
    assert.equal(typeof result.vcpu, 'number');
    assert.equal(result.node, process.versions.node);
  });

  it("uses the CLI's formulas and rounding", async () => {
    const io = new FakeIo();
    const { outcome, result } = await runBenchmark({
      devices: REGISTRY,
      messages: 2000,
      timeoutS: 120,
      io,
      log: quiet,
    });
    // 2000 messages cost 200 ms to publish; 4000 readings arrive 1000 per 100 ms poll: 400 ms more.
    assert.equal(outcome, 'completed');
    assert.equal(result.messages, 2000);
    assert.equal(result.readingsExpected, 4000);
    assert.equal(
      result.readingsStored,
      4000,
      'rows that were there before the run are not counted',
    );
    assert.equal(result.publishSeconds, 0.2);
    assert.equal(result.endToEndSeconds, 0.6);
    assert.equal(result.messagesPerSecond, Math.round(2000 / 0.6));
    assert.equal(result.readingsPerSecond, Math.round(4000 / 0.6));
  });

  it('expects 200,001 readings for 100,000 messages of the six-device registry, the figure of docs/benchmarks.md', () => {
    assert.equal(expectedReadings(REGISTRY, 100_000), 200_001);
  });

  it('counts readings the way a loop over the messages would, for any number of messages', () => {
    for (let messages = 1; messages <= 50; messages++) {
      let loop = 0;
      for (let i = 0; i < messages; i++) loop += REGISTRY[i % REGISTRY.length]!.metrics.length;
      assert.equal(expectedReadings(REGISTRY, messages), loop, `${messages} messages`);
    }
  });

  it('expects the readings of a 100-device registry', () => {
    const hundred: DeviceSpec[] = Array.from({ length: 100 }, (_, k) => ({
      id: `dev-${k}`,
      kind: 'indoor_air',
      zoneCode: 'BLD-LIB',
      metrics: ['co2_ppm', 'temperature_c'],
    }));
    assert.equal(expectedReadings(hundred, 250), 500);
  });
});

describe('runBenchmark: what it sends', () => {
  it('sends what the CLI sends when it is given no option: topic, seq from 1,000,001, ts every 10 ms from an hour ago, 20 + i % 10', async () => {
    const io = new FakeIo();
    await runBenchmark({ devices: REGISTRY, messages: 8, timeoutS: 1, io, log: quiet });
    const base = WALL - HOUR;
    const expected = REGISTRY.concat(REGISTRY.slice(0, 2)).map((device, i) => ({
      topic: telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id }),
      payload: JSON.stringify({
        seq: 1_000_001 + (i >= 6 ? 1 : 0),
        ts: new Date(base + i * 10).toISOString(),
        metrics: Object.fromEntries(device.metrics.map((m) => [m, 20 + (i % 10)])),
      }),
    }));
    assert.deepEqual(io.published, expected);
  });

  it('changes only the sequence numbers and the timestamps when it is given them', async () => {
    const io = new FakeIo();
    const tsBase = Date.parse('2026-10-23T06:30:00.007Z');
    await runBenchmark({
      devices: REGISTRY,
      messages: 7,
      timeoutS: 1,
      io,
      firstSeq: { 'dc-env-01': 41, 'hub-power-01': 7 },
      tsBase,
      log: quiet,
    });
    const bodies = io.published.map((m) => JSON.parse(m.payload) as { seq: number; ts: string });
    assert.deepEqual(
      bodies.map((b) => b.seq),
      [41, 1_000_001, 1_000_001, 1_000_001, 1_000_001, 7, 42],
    );
    assert.deepEqual(
      bodies.map((b) => b.ts),
      Array.from({ length: 7 }, (_, i) => new Date(tsBase + i * 10).toISOString()),
    );
  });

  it('never has more than 500 messages in flight', async () => {
    const io = new FakeIo();
    await runBenchmark({ devices: REGISTRY, messages: 1200, timeoutS: 1, io, log: quiet });
    assert.equal(io.maxInFlight, 500);
    assert.equal(io.published.length, 1200);
  });

  it('refuses a number of messages that is not a whole number of 1 or more, and an empty registry', async () => {
    const io = new FakeIo();
    for (const messages of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(
        runBenchmark({ devices: REGISTRY, messages, timeoutS: 1, io, log: quiet }),
        RangeError,
      );
    }
    await assert.rejects(
      runBenchmark({ devices: [], messages: 10, timeoutS: 1, io, log: quiet }),
      RangeError,
    );
    assert.equal(io.published.length, 0);
  });
});

describe('runBenchmark: how it ends', () => {
  it('is incomplete when the wait ends at the timeout before every reading is stored', async () => {
    const io = new FakeIo();
    io.storedLimit = 100;
    const { outcome, result } = await runBenchmark({
      devices: REGISTRY,
      messages: 600,
      timeoutS: 1,
      io,
      log: quiet,
    });
    assert.equal(outcome, 'incomplete');
    assert.equal(result.readingsStored, 100);
    assert.ok(result.readingsStored < result.readingsExpected);
  });

  it('stops at the next window when the signal fires while publishing: nothing more is sent and there is no wait', async () => {
    const io = new FakeIo();
    const controller = new AbortController();
    io.onPublish = (sent) => {
      if (sent === 700) controller.abort();
    };
    const { outcome, result } = await runBenchmark({
      devices: REGISTRY,
      messages: 5000,
      timeoutS: 120,
      io,
      signal: controller.signal,
      log: quiet,
    });
    assert.equal(outcome, 'stopped');
    // The window of 500 that was going when it fired is finished, the next one is not started.
    assert.equal(io.published.length, 1000);
    assert.equal(io.countCalls, 1, 'only the count before the run: no wait');
    assert.equal(result.readingsStored, 0);
    assert.equal(result.messages, 5000);
  });

  it('does not start when the signal fired before it', async () => {
    const io = new FakeIo();
    const { outcome } = await runBenchmark({
      devices: REGISTRY,
      messages: 5000,
      timeoutS: 120,
      io,
      signal: AbortSignal.abort(),
      log: quiet,
    });
    assert.equal(outcome, 'stopped');
    assert.equal(io.published.length, 0);
  });

  it('stops waiting when the signal fires while it waits, with the count it last saw', async () => {
    const io = new FakeIo();
    io.storedPerPoll = 10;
    const controller = new AbortController();
    let sleeps = 0;
    io.onSleep = () => {
      if (++sleeps === 3) controller.abort();
    };
    const { outcome, result } = await runBenchmark({
      devices: REGISTRY,
      messages: 600,
      timeoutS: 120,
      io,
      signal: controller.signal,
      log: quiet,
    });
    assert.equal(outcome, 'stopped');
    assert.equal(result.readingsStored, 30);
    assert.equal(sleeps, 3);
  });
});

describe('runBenchmark: progress', () => {
  it('does not ask the database while publishing, and counts readings while waiting', async () => {
    const io = new FakeIo();
    io.publishCostMs = 1;
    io.storedPerPoll = 500;
    const seen: (BenchProgress & { counts: number })[] = [];
    await runBenchmark({
      devices: REGISTRY,
      messages: 1500,
      timeoutS: 120,
      io,
      onProgress: (progress) => seen.push({ ...progress, counts: io.countCalls }),
      log: quiet,
    });

    const publishing = seen.filter((p) => p.phase === 'publishing');
    assert.ok(
      publishing.length >= 2,
      'a window of 500 messages takes longer than the progress interval',
    );
    for (const progress of publishing) {
      assert.equal(progress.stored, null);
      assert.equal(progress.counts, 1, 'the count before the run is the only one while publishing');
    }
    assert.equal(publishing.at(-1)?.published, 1500);

    const waiting = seen.filter((p) => p.phase === 'waiting');
    assert.ok(waiting.length > 0);
    assert.equal(waiting.at(-1)?.stored, 3000);
    assert.deepEqual(
      waiting.map((p) => p.stored),
      [...waiting.map((p) => p.stored)].sort((a, b) => a! - b!),
    );
    assert.ok(waiting.every((p) => p.published === 1500));
  });
});

describe('sessionTsBase', () => {
  const base = (run: number, devices = 6) => sessionTsBase({ wallMs: WALL, devices, run });

  it('stays within a tenth of a second of an hour ago', () => {
    for (const run of [1, 2, 30, 59]) assert.ok(Math.abs(base(run) - (WALL - HOUR)) < 120);
  });

  it('gives runs bases that never differ by a multiple of 10 ms × devices, so no two runs collide on a reading', () => {
    const step = 60;
    for (let a = 1; a <= 59; a++) {
      for (let b = a + 1; b <= 59; b++) {
        // The wall clock moves between runs: whole steps, as far as the alignment goes.
        const later = sessionTsBase({ wallMs: WALL + 97 * step * (b - a), devices: 6, run: b });
        assert.notEqual((later - base(a)) % step, 0, `runs ${a} and ${b}`);
      }
    }
  });

  it('starts over after 10 × devices − 1 runs, which is the limit of the guarantee', () => {
    assert.equal(base(60) % 60, base(1) % 60);
  });

  it('works for the 100-device registry and for a registry of one', () => {
    assert.notEqual(base(1, 100) % 1000, base(2, 100) % 1000);
    assert.notEqual(base(1, 1) % 10, base(2, 1) % 10);
  });
});

describe('the database URL', () => {
  it('is the flag, then DATABASE_URL, then the Compose database; a blank value is not set', () => {
    const env = { DATABASE_URL: 'postgres://env/db' };
    assert.equal(resolveDatabaseUrl({ flag: 'postgres://flag/db', env }), 'postgres://flag/db');
    assert.equal(resolveDatabaseUrl({ env }), 'postgres://env/db');
    assert.equal(resolveDatabaseUrl({ flag: '  ', env }), 'postgres://env/db');
    assert.equal(resolveDatabaseUrl({ env: { DATABASE_URL: '' } }), DEFAULT_DATABASE_URL);
    assert.equal(resolveDatabaseUrl({ env: {} }), DEFAULT_DATABASE_URL);
  });

  it('is described by host, port and name, never by the user or the password', () => {
    assert.equal(
      describeDatabase('postgres://user:s3cret@db.example:6543/telemetry'),
      'db.example:6543/telemetry',
    );
    assert.equal(describeDatabase('postgres://user:p%40ss@host/db'), 'host:5432/db');
    assert.equal(describeDatabase('postgres://user:p@ss@host/db'), 'host:5432/db');
    for (const url of [
      'postgres://user:s3cret@db.example:6543/telemetry',
      'postgres://u:p@ss@h/d',
    ]) {
      assert.ok(!describeDatabase(url).includes('s3cret'));
      assert.ok(!describeDatabase(url).includes('ss@'));
    }
    assert.equal(describeDatabase(DEFAULT_DATABASE_URL), 'localhost:5433/telemetry');
  });

  it('is not echoed when it cannot be read', () => {
    assert.equal(describeDatabase('not a url with s3cret in it'), 'an invalid DATABASE_URL');
  });
});

describe('checkDatabase', () => {
  it('says why a connection is refused, without the password, and does not throw', async () => {
    const check = await checkDatabase('postgres://user:s3cret@127.0.0.1:1/telemetry', 1000);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.ok(check.reason.length > 0);
      assert.ok(!check.reason.includes('s3cret'));
    }
  });

  it('answers a URL that cannot be parsed with a reason, not an exception', async () => {
    const check = await checkDatabase('postgres://user:s3cret@[bad/telemetry', 1000);
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(!check.reason.includes('s3cret'));
  });
});
