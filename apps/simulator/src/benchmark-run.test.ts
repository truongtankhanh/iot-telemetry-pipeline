import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DatabaseCheck } from './bench-run.ts';
import {
  BenchmarkBusyError,
  BenchmarkRun,
  BenchmarkUnavailableError,
  EXIT_GRACE_MS,
  KEPT_RUNS,
  MAX_SERIES_POINTS,
  parseBenchmarkStart,
  PreflightFailedError,
  SILENCE_MS,
  STOP_GRACE_MS,
  TERMINATE_GRACE_MS,
  type BenchmarkPoint,
  type BenchmarkRunSummary,
  type FleetView,
} from './benchmark-run.ts';
import { ManualClock } from './clock.ts';
import type { IngestState, MetricsFeed } from './ingest-poller.ts';
import type { Sample } from './prometheus-text.ts';
import {
  BENCH_RESULT as RESULT,
  DEVICES,
  FakeBenchChild as FakeChild,
  T0,
} from './test-support.ts';

const DATABASE_URL = 'postgres://user:s3cret@db.example:5433/telemetry';
const BROKER_URL = 'mqtt://u:brokerpass@localhost:1883';

const READY: IngestState = {
  status: 'ready',
  database: 'up',
  broker: 'up',
  alertSink: 'none',
  detail: null,
  since: null,
  lastCheckedAt: null,
};

/** A clock that knows how many of its timers are still waiting. */
class TrackedClock extends ManualClock {
  live = 0;

  override setTimer(delayMs: number, fn: () => void | Promise<void>): () => void {
    this.live++;
    let over = false;
    const settle = () => {
      if (!over) {
        over = true;
        this.live--;
      }
    };
    const cancel = super.setTimer(delayMs, async () => {
      settle();
      await fn();
    });
    return () => {
      settle();
      cancel();
    };
  }
}

function setup(
  options: {
    ingest?: Partial<IngestState>;
    fleet?: FleetView;
    database?: DatabaseCheck;
  } = {},
) {
  const clock = new TrackedClock(T0);
  const children: FakeChild[] = [];
  const spawnArguments: number[] = [];
  const state = {
    ingest: { ...READY, ...options.ingest },
    fleet: options.fleet ?? { running: [], scenarios: [] },
    database: options.database ?? ({ ok: true } as DatabaseCheck),
    databaseCalls: 0,
  };
  const benchmark = new BenchmarkRun({
    brokerUrl: BROKER_URL,
    databaseUrl: DATABASE_URL,
    devices: DEVICES,
    ingest: () => state.ingest,
    fleet: () => state.fleet,
    spawn: (...args: unknown[]) => {
      spawnArguments.push(args.length);
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    checkDatabase: async () => {
      state.databaseCalls++;
      return state.database;
    },
    clock,
  });
  const changes: BenchmarkRunSummary[] = [];
  benchmark.on('change', (run) => changes.push(run));
  const points: BenchmarkPoint[] = [];
  benchmark.on('point', (point) => points.push(point));
  return { benchmark, clock, children, state, changes, points, spawnArguments };
}

type Context = ReturnType<typeof setup>;

async function begin(context: Context, messages = 1000) {
  const summary = await context.benchmark.start({ messages });
  return { summary, child: context.children.at(-1)! };
}

const counter = (value: number): Sample => ({
  name: 'telemetry_readings_total',
  labels: { result: 'stored' },
  value,
});
const flush = (...counts: [le: string, count: number][]): Sample[] =>
  counts.map(([le, count]) => ({
    name: 'telemetry_flush_duration_seconds_bucket',
    labels: { le },
    value: count,
  }));

function feed(samples: Sample[], stale = false): MetricsFeed {
  return { samples, lastOkAt: stale ? null : '2026-10-01T05:00:00.000Z', stale };
}

describe('BenchmarkRun: the checks before a run', () => {
  it('passes when ingest is ready, the database answers and the fleet is paused', async () => {
    const { benchmark } = setup();
    const checks = await benchmark.preflight();
    assert.deepEqual(
      checks.map((c) => [c.id, c.ok, c.reason]),
      [
        ['ingest', true, null],
        ['database', true, null],
        ['fleet', true, null],
      ],
    );
  });

  it('fails the ingest check with ingest’s own reason', async () => {
    const down = setup({ ingest: { status: 'unreachable', detail: 'ECONNREFUSED' } });
    assert.equal((await down.benchmark.preflight())[0]?.reason, 'ECONNREFUSED');
    const notReady = setup({ ingest: { status: 'not-ready', database: 'down', broker: 'up' } });
    assert.match(
      (await notReady.benchmark.preflight())[0]?.reason ?? '',
      /not-ready.*database down/,
    );
    const unknown = setup({ ingest: { status: 'unknown' } });
    assert.match((await unknown.benchmark.preflight())[0]?.reason ?? '', /not been read/);
  });

  it('fails the database check with the reason, and the others stay as they are', async () => {
    const { benchmark } = setup({ database: { ok: false, reason: 'ECONNREFUSED: refused' } });
    const checks = await benchmark.preflight();
    assert.deepEqual(
      checks.map((c) => c.ok),
      [true, false, true],
    );
    assert.equal(checks[1]?.reason, 'ECONNREFUSED: refused');
  });

  it('fails the fleet check naming the devices that run and the scenarios that play', async () => {
    const { benchmark } = setup({
      fleet: { running: ['dc-env-01', 'lib-air-01'], scenarios: ['overheat'] },
    });
    const fleet = (await benchmark.preflight())[2];
    assert.equal(fleet?.ok, false);
    assert.match(fleet?.reason ?? '', /dc-env-01 is running.*lib-air-01 is running.*"overheat"/);
  });

  it('asks the database once for two answers under two seconds apart, and again after', async () => {
    const context = setup();
    await context.benchmark.preflight();
    await context.clock.advance(1000);
    await context.benchmark.preflight();
    assert.equal(context.state.databaseCalls, 1);
    await context.clock.advance(1500);
    await context.benchmark.preflight();
    assert.equal(context.state.databaseCalls, 2);
    await context.benchmark.preflight({ fresh: true });
    assert.equal(context.state.databaseCalls, 3);
  });

  it('is empty when the benchmark is not configured', async () => {
    const benchmark = new BenchmarkRun({
      devices: DEVICES,
      ingest: () => READY,
      fleet: () => ({ running: [], scenarios: [] }),
    });
    assert.deepEqual(await benchmark.preflight(), []);
  });
});

describe('BenchmarkRun: starting', () => {
  it('refuses without a pass, naming the checks, and starts nothing', async () => {
    const context = setup({ fleet: { running: ['dc-env-01'], scenarios: [] } });
    await assert.rejects(context.benchmark.start({ messages: 1000 }), (error: unknown) => {
      assert.ok(error instanceof PreflightFailedError);
      assert.deepEqual(
        error.checks.map((c) => c.ok),
        [true, true, false],
      );
      assert.match(error.message, /fleet paused failed/);
      return true;
    });
    assert.equal(context.children.length, 0);
    assert.equal(context.benchmark.running, false);
  });

  it('asks the database again instead of trusting an earlier answer', async () => {
    const context = setup();
    await context.benchmark.preflight();
    await begin(context);
    assert.equal(context.state.databaseCalls, 2);
  });

  it('sends one start message with the registry, the settings and the run number, and the database URL only over IPC', async () => {
    const context = setup();
    const { summary, child } = await begin(context, 600);
    assert.deepEqual(child.sent, [
      {
        type: 'start',
        broker: BROKER_URL,
        database: DATABASE_URL,
        devices: DEVICES,
        messages: 600,
        timeoutS: 120,
        run: 1,
      },
    ]);
    assert.deepEqual(context.spawnArguments, [0], 'nothing is passed to the process it starts');
    assert.equal(summary.id, 1);
    assert.equal(summary.phase, 'starting');
    assert.deepEqual(summary.settings, { messages: 600, devices: 3, timeoutS: 120 });
    assert.equal(summary.expectedReadings, 1400, '200 rounds of 2 + 2 + 3 readings');
    assert.equal(context.benchmark.running, true);
    assert.equal(context.changes.at(-1)?.id, 1);
  });

  it('refuses a second run while one is going, and a start that arrives together with another', async () => {
    const context = setup();
    const [first, second] = await Promise.allSettled([
      context.benchmark.start({ messages: 100 }),
      context.benchmark.start({ messages: 100 }),
    ]);
    assert.equal(first.status, 'fulfilled');
    assert.equal(second.status, 'rejected');
    assert.ok((second as PromiseRejectedResult).reason instanceof BenchmarkBusyError);
    assert.equal(context.children.length, 1);
    await assert.rejects(context.benchmark.start({ messages: 100 }), BenchmarkBusyError);
  });

  it('refuses another run until the process of the last one has gone', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.done('completed');
    assert.equal(context.benchmark.running, false, 'the run is over');
    await assert.rejects(context.benchmark.start({ messages: 100 }), /still ending/);
    child.exit('exited with code 0');
    await begin(context);
    assert.equal(context.children.length, 2);
  });

  it('says it is not available when it is not configured, and starts nothing', async () => {
    const benchmark = new BenchmarkRun({
      devices: DEVICES,
      ingest: () => READY,
      fleet: () => ({ running: [], scenarios: [] }),
    });
    assert.equal(benchmark.view().available, false);
    assert.equal(benchmark.view().reason, 'not configured');
    assert.equal(benchmark.view().database, null);
    await assert.rejects(benchmark.start({ messages: 10 }), BenchmarkUnavailableError);
    assert.equal(await benchmark.stop(), false);
  });
});

describe('BenchmarkRun: progress and the series', () => {
  it('follows the child: published, phase, and a change when the phase changes', async () => {
    const context = setup();
    const { child } = await begin(context);
    const before = context.changes.length;
    child.progress('publishing', 500, null);
    child.progress('publishing', 700, null);
    assert.equal(
      context.changes.length,
      before + 1,
      'one change for the new phase, none for a count',
    );
    const current = context.benchmark.view().current;
    assert.equal(current?.phase, 'publishing');
    assert.equal(current?.published, 700);
    child.progress('waiting', 1000, 400);
    assert.equal(context.benchmark.view().current?.phase, 'waiting');
    assert.equal(context.benchmark.view().current?.stored, 400);
    assert.equal(context.changes.length, before + 2);
    assert.notEqual(context.benchmark.view().current?.marks.publishEndedS, null);
  });

  it('ignores what does not fit the protocol', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.say({ type: 'progress', progress: { phase: 'bogus', published: 1 } });
    child.say({ type: 'done', outcome: 'completed', result: { messages: 'many' } });
    child.say('hello');
    child.say(null);
    assert.equal(context.benchmark.view().current?.phase, 'starting');
    assert.equal(context.benchmark.running, true);
  });

  it('adds a point per read of ingest: stored from its counter minus the start while publishing', async () => {
    const context = setup();
    context.benchmark.onMetrics(feed([counter(1000)]));
    const { child } = await begin(context);
    await context.clock.advance(1000);
    child.progress('publishing', 500, null);
    context.benchmark.onMetrics(
      feed([counter(1400), { name: 'telemetry_buffered_readings', labels: {}, value: 37 }]),
    );
    const [point] = context.points;
    assert.equal(point?.t, 1);
    assert.equal(point?.published, 500);
    assert.equal(point?.stored, 400);
    assert.equal(point?.buffered, 37);
    assert.equal(context.benchmark.detail().current?.series.length, 1);
  });

  it('takes stored from the child’s count while it waits', async () => {
    const context = setup();
    context.benchmark.onMetrics(feed([counter(0)]));
    const { child } = await begin(context);
    child.progress('waiting', 1000, 1500);
    await context.clock.advance(1000);
    context.benchmark.onMetrics(feed([counter(900)]));
    assert.equal(context.points[0]?.stored, 1500);
  });

  it('has null, not zero, for what a stale feed or a missing series cannot say', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.progress('publishing', 100, null);
    await context.clock.advance(1000);
    context.benchmark.onMetrics(feed([counter(500)])); // no baseline was read before the start
    context.benchmark.onMetrics(feed([counter(600)], true));
    for (const point of context.points) {
      assert.equal(point.stored, null);
      assert.equal(point.buffered, null);
      assert.equal(point.flushP95S, null);
      assert.equal(point.queueDelayS, null);
    }
    assert.equal(context.points.length, 2);
    assert.equal(context.points[0]?.published, 100);
  });

  it('takes the flush p95 from two reads, not from the life of ingest', async () => {
    const context = setup();
    context.benchmark.onMetrics(
      feed([counter(0), ...flush(['0.01', 5], ['0.1', 5], ['+Inf', 1000])]),
    );
    const { child } = await begin(context);
    child.progress('publishing', 100, null);
    await context.clock.advance(1000);
    // 100 flushes in the window, all under 10 ms: the slow past does not count.
    context.benchmark.onMetrics(
      feed([counter(10), ...flush(['0.01', 105], ['0.1', 105], ['+Inf', 1100])]),
    );
    const p95 = context.points[0]?.flushP95S;
    assert.ok(p95 !== null && p95 !== undefined && p95 <= 0.01, `p95 is ${p95}`);
  });

  it('estimates the queue delay from the readings in flight and the stored rate', async () => {
    const context = setup();
    context.benchmark.onMetrics(feed([counter(0)]));
    const { child } = await begin(context);
    child.progress('publishing', 900, null); // 300 rounds of 7 readings with three devices: 2,100
    await context.clock.advance(1000);
    context.benchmark.onMetrics(feed([counter(500)]));
    assert.equal(context.points[0]?.queueDelayS, null, 'one point is not a rate');
    await context.clock.advance(1000);
    context.benchmark.onMetrics(feed([counter(1000)]));
    // 1,100 readings in flight, 500 stored per second.
    assert.equal(context.points[1]?.queueDelayS, 1100 / 500);
  });

  it('keeps at most 1,000 points, replacing the last', async () => {
    const context = setup();
    const { child } = await begin(context);
    for (let i = 0; i < MAX_SERIES_POINTS + 25; i++) {
      await context.clock.advance(1000);
      child.progress('publishing', 1, null); // a child that is heard from is not silent
      context.benchmark.onMetrics(feed([counter(i)]));
    }
    const series = context.benchmark.detail().current?.series ?? [];
    assert.equal(series.length, MAX_SERIES_POINTS);
    assert.equal(series.at(-1)?.t, MAX_SERIES_POINTS + 25);
  });

  it('adds nothing when no run is going, but remembers the feed for the next start', async () => {
    const context = setup();
    context.benchmark.onMetrics(feed([counter(7)]));
    assert.equal(context.points.length, 0);
    await begin(context);
    await context.clock.advance(1000);
    context.benchmark.onMetrics(feed([counter(57)]));
    assert.equal(context.points[0]?.stored, 50);
  });
});

describe('BenchmarkRun: how a run ends', () => {
  it('keeps the child’s result unchanged, and a completed run is comparable', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.progress('publishing', 1000, null);
    child.done('completed');
    const run = context.benchmark.view().runs[0];
    assert.equal(run?.outcome, 'completed');
    assert.equal(run?.phase, 'ended');
    assert.equal(run?.comparable, true);
    assert.deepEqual(run?.result, RESULT);
    assert.equal(run?.published, 1000);
    assert.equal(run?.stored, 2000);
    assert.equal(run?.marks.publishEndedS, 0.1);
    assert.equal(context.benchmark.running, false);
    assert.equal(context.benchmark.view().current, null);
  });

  it('marks where the ramp-up ended, from the series, once the run is over', async () => {
    const context = setup();
    context.benchmark.onMetrics(feed([counter(0)]));
    const { child } = await begin(context);
    for (const published of [100, 300, 600, 1000]) {
      await context.clock.advance(1000);
      child.progress('publishing', published, null);
      context.benchmark.onMetrics(feed([counter(0)]));
    }
    child.done('completed');
    assert.equal(context.benchmark.view().runs[0]?.marks.rampUpEndS, 2);
  });

  it('calls a run that hit the timeout incomplete, and says it is not comparable', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.done('incomplete', { ...RESULT, readingsStored: 1500 });
    const run = context.benchmark.view().runs[0];
    assert.equal(run?.outcome, 'incomplete');
    assert.equal(run?.comparable, false);
    assert.equal(run?.stored, 1500);
  });

  it('fails with the child’s own error, and a run that failed is not comparable', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.say({ type: 'error', message: 'connect ECONNREFUSED 127.0.0.1:1883' });
    const run = context.benchmark.view().runs[0];
    assert.equal(run?.outcome, 'failed');
    assert.equal(run?.reason, 'connect ECONNREFUSED 127.0.0.1:1883');
    assert.equal(run?.comparable, false);
    assert.equal(run?.result, null);
  });

  it('fails when the process exits without a result, saying how', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.exit('exited with code 1');
    const run = context.benchmark.view().runs[0];
    assert.equal(run?.outcome, 'failed');
    assert.match(run?.reason ?? '', /exited with code 1/);
    assert.equal(context.benchmark.running, false);
  });

  it('kills a process that has been silent for two minutes, and fails the run', async () => {
    const context = setup();
    const { child } = await begin(context);
    await context.clock.advance(SILENCE_MS - 1);
    assert.equal(context.benchmark.running, true);
    await context.clock.advance(1);
    assert.deepEqual(child.kills, ['SIGKILL']);
    assert.equal(context.benchmark.view().runs[0]?.outcome, 'failed');
    assert.match(context.benchmark.view().runs[0]?.reason ?? '', /silent for 120 s/);
  });

  it('does not count a message as silence broken unless it fits the protocol', async () => {
    const context = setup();
    const { child } = await begin(context);
    await context.clock.advance(SILENCE_MS - 1000);
    child.progress('publishing', 10, null);
    await context.clock.advance(SILENCE_MS - 1000);
    assert.equal(context.benchmark.running, true, 'a progress message restarts the wait');
    child.say({ nonsense: true });
    await context.clock.advance(1000);
    assert.equal(context.benchmark.running, false, 'a message that does not fit does not');
  });

  it('keeps the last ten runs, newest first', async () => {
    const context = setup();
    for (let i = 1; i <= KEPT_RUNS + 1; i++) {
      const { child } = await begin(context);
      child.done('completed');
      child.exit('exited with code 0');
    }
    const runs = context.benchmark.view().runs;
    assert.equal(runs.length, KEPT_RUNS);
    assert.deepEqual(
      runs.map((run) => run.id),
      Array.from({ length: KEPT_RUNS }, (_, k) => KEPT_RUNS + 1 - k),
    );
    assert.equal(context.benchmark.detail().runs.length, KEPT_RUNS);
  });

  it('kills a process that reported its result and does not leave', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.done('completed');
    await context.clock.advance(EXIT_GRACE_MS);
    assert.deepEqual(child.kills, ['SIGKILL']);
    await begin(context);
    assert.equal(context.children.length, 2);
  });
});

describe('BenchmarkRun: stopping', () => {
  it('asks the child, which ends the run at its next window: stopped, not comparable', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.progress('publishing', 500, null);
    const stopped = context.benchmark.stop();
    assert.deepEqual(child.sent.at(-1), { type: 'stop' });
    child.done('stopped', { ...RESULT, readingsStored: 0 });
    child.exit('exited with code 0');
    assert.equal(await stopped, true);
    const run = context.benchmark.view().runs[0];
    assert.equal(run?.outcome, 'stopped');
    assert.equal(run?.comparable, false);
    assert.equal(run?.published, 500, 'the count at the stop, not the size that was asked for');
    assert.deepEqual(child.kills, []);
  });

  it('is idempotent and says false when nothing is running', async () => {
    const context = setup();
    assert.equal(await context.benchmark.stop(), false);
    const { child } = await begin(context);
    const first = context.benchmark.stop();
    const second = context.benchmark.stop();
    assert.equal(child.sent.filter((m) => m.type === 'stop').length, 1);
    child.done('stopped');
    child.exit('exited with code 0');
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
  });

  it('terminates a child that did not stop in five seconds, and the run is stopped', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.exitsOn = 'SIGTERM';
    const stopped = context.benchmark.stop();
    await context.clock.advance(STOP_GRACE_MS - 1);
    assert.deepEqual(child.kills, []);
    await context.clock.advance(1);
    assert.deepEqual(child.kills, ['SIGTERM']);
    await stopped;
    assert.equal(context.benchmark.view().runs[0]?.outcome, 'stopped');
  });

  it('kills a child that ignored SIGTERM three seconds later, and still ends the run', async () => {
    const context = setup();
    const { child } = await begin(context);
    const stopped = context.benchmark.stop();
    await context.clock.advance(STOP_GRACE_MS);
    assert.deepEqual(child.kills, ['SIGTERM']);
    await context.clock.advance(TERMINATE_GRACE_MS);
    assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
    await stopped;
    const run = context.benchmark.view().runs[0];
    assert.equal(run?.outcome, 'stopped');
    assert.match(run?.reason ?? '', /did not stop on request/);
    assert.equal(context.benchmark.running, false);
  });

  it('keeps a run that finished while the stop was on its way as it finished', async () => {
    const context = setup();
    const { child } = await begin(context);
    const stopped = context.benchmark.stop();
    child.done('completed');
    child.exit('exited with code 0');
    await stopped;
    assert.equal(context.benchmark.view().runs[0]?.outcome, 'completed');
  });

  it('ends a running run and leaves no timer when it is closed', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.exitsOn = 'SIGTERM';
    const closed = context.benchmark.close();
    await context.clock.advance(STOP_GRACE_MS);
    await closed;
    assert.equal(context.benchmark.running, false);
    assert.equal(context.clock.live, 0);
    await assert.rejects(context.benchmark.start({ messages: 10 }), BenchmarkUnavailableError);
  });

  it('kills a process that reported its result and is still there when it is closed', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.done('completed');
    await context.benchmark.close();
    assert.deepEqual(child.kills, ['SIGKILL']);
    assert.equal(context.clock.live, 0);
  });
});

describe('BenchmarkRun: what it shows', () => {
  it('never carries the database URL or the broker’s credentials, and shows the database by host, port and name', async () => {
    const context = setup();
    const { child } = await begin(context);
    child.progress('publishing', 10, null);
    context.benchmark.onMetrics(feed([counter(1)]));
    child.done('completed');
    const text = JSON.stringify([
      context.benchmark.view(),
      context.benchmark.detail(),
      context.changes,
    ]);
    assert.ok(!text.includes('s3cret'));
    assert.ok(!text.includes('brokerpass'));
    assert.equal(context.benchmark.view().database, 'db.example:5433/telemetry');
    assert.equal(context.benchmark.view().maxMessages, 250_000);
  });

  it('gives the summary without the series and the detail with it', async () => {
    const context = setup();
    await begin(context);
    await context.clock.advance(1000);
    context.benchmark.onMetrics(feed([counter(1)]));
    assert.equal('series' in (context.benchmark.view().current ?? {}), false);
    assert.equal(context.benchmark.detail().current?.series.length, 1);
  });
});

describe('parseBenchmarkStart', () => {
  it('takes a size and a confirmation', () => {
    assert.deepEqual(parseBenchmarkStart({ messages: 250_000, confirm: true }), {
      ok: true,
      value: { messages: 250_000 },
    });
    assert.deepEqual(parseBenchmarkStart({ messages: 1, confirm: true }), {
      ok: true,
      value: { messages: 1 },
    });
  });

  it('names the field that is wrong', () => {
    const reason = (body: unknown) => {
      const parsed = parseBenchmarkStart(body);
      assert.equal(parsed.ok, false);
      return parsed.ok ? '' : parsed.reason;
    };
    for (const messages of [0, -1, 1.5, '100', 250_001, null, undefined]) {
      assert.match(
        reason({ messages, confirm: true }),
        /"messages" must be a whole number from 1 to 250,000/,
      );
    }
    assert.match(reason(undefined), /"messages"/);
    assert.match(reason({ messages: 100 }), /"confirm" must be true/);
    assert.match(reason({ messages: 100, confirm: 'true' }), /"confirm" must be true/);
    assert.match(reason({ messages: 100, confirm: false }), /"confirm" must be true/);
    assert.match(
      reason({ messages: 100, confirm: true, timeout: 5 }),
      /"timeout" is not a known field/,
    );
    assert.match(reason([]), /JSON object/);
    assert.match(reason('x'), /JSON object/);
  });
});
