import {
  MAX_PAYLOAD_BYTES,
  METRIC_NAMES,
  METRICS,
  type MetricName,
  parsePayload,
  parseTopic,
  type TelemetryPayload,
  telemetryTopic,
} from '@itp/telemetry-contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chance,
  delayFor,
  FAULT_LIMITS,
  MALFORMED_KINDS,
  malformedMessage,
  parseBurst,
  parseFaultConfig,
  parseScope,
  shuffleWindow,
} from './faults.ts';
import { seededRandom } from './random.ts';

const topic = telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'dc-env-01' });
const payloadWith = (metrics: TelemetryPayload['metrics']): TelemetryPayload => ({
  seq: 7,
  ts: '2026-10-01T05:00:00.000Z',
  metrics,
});

/** The metric sets of the registry's device kinds, and each metric on its own. */
const METRIC_SETS: TelemetryPayload['metrics'][] = [
  { temperature_c: 22.5, humidity_pct: 45 },
  { co2_ppm: 650, temperature_c: 24, humidity_pct: 55 },
  { power_kw: 120 },
  ...METRIC_NAMES.map((name) => ({ [name]: (METRICS[name].min + METRICS[name].max) / 2 })),
];

/** Every way the generators may branch on `random`, as fixed sources. */
const RANDOMS = [0, 0.25, 0.49, 0.5, 0.75, 0.999].map((value) => () => value);

describe('malformedMessage: one generator per rejection reason', () => {
  it('has a generator for the nine reasons of parsePayload and for the topic', () => {
    assert.deepEqual(
      [...MALFORMED_KINDS],
      ['size', 'json', 'shape', 'seq', 'ts', 'empty', 'metric', 'value', 'range', 'topic'],
    );
  });

  it('starts from a message the contract accepts', () => {
    for (const metrics of METRIC_SETS) {
      const parsed = parsePayload(JSON.stringify(payloadWith(metrics)));
      assert.equal(parsed.ok, true, JSON.stringify(metrics));
      assert.equal(parseTopic(topic).ok, true);
    }
  });

  for (const kind of MALFORMED_KINDS.filter((k) => k !== 'topic')) {
    it(`"${kind}" is rejected by parsePayload with exactly the reason "${kind}"`, () => {
      for (const metrics of METRIC_SETS) {
        for (const random of RANDOMS) {
          const message = malformedMessage(kind, { topic, payload: payloadWith(metrics) }, random);
          const parsed = parsePayload(message.body);
          assert.deepEqual(
            parsed,
            { ok: false, reason: kind },
            `${kind} for ${Object.keys(metrics).join(',')}: ${message.body.slice(0, 80)}`,
          );
          // The topic is the device's own: only the payload is damaged.
          assert.equal(message.topic, topic);
        }
      }
    });
  }

  it('"topic" is rejected by parseTopic with the reason "topic" and carries a payload that is fine', () => {
    for (const random of RANDOMS) {
      const message = malformedMessage(
        'topic',
        { topic, payload: payloadWith({ power_kw: 120 }) },
        random,
      );
      assert.deepEqual(parseTopic(message.topic), { ok: false, reason: 'topic' });
      assert.equal(parsePayload(message.body).ok, true);
    }
  });

  it('"size" is over the contract limit in characters and in bytes', () => {
    const message = malformedMessage(
      'size',
      { topic, payload: payloadWith({ power_kw: 120 }) },
      () => 0,
    );
    assert.ok(message.body.length > MAX_PAYLOAD_BYTES);
    assert.ok(Buffer.byteLength(message.body) > MAX_PAYLOAD_BYTES);
    assert.deepEqual(parsePayload(Buffer.from(message.body)), { ok: false, reason: 'size' });
  });

  it('"range" leaves the allowed interval of the metric it damages, whichever way, for every metric', () => {
    for (const name of METRIC_NAMES) {
      const payload = payloadWith({ [name]: (METRICS[name].min + METRICS[name].max) / 2 });
      for (const random of [() => 0, () => 0.99]) {
        const message = malformedMessage('range', { topic, payload }, random);
        const value = (JSON.parse(message.body) as TelemetryPayload).metrics[
          name as MetricName
        ] as number;
        assert.ok(value < METRICS[name].min || value > METRICS[name].max, `${name}: ${value}`);
      }
    }
  });

  it('"range" and "value" damage only one metric of a message with several', () => {
    const payload = payloadWith({ co2_ppm: 650, temperature_c: 24, humidity_pct: 55 });
    for (const kind of ['range', 'value'] as const) {
      const message = malformedMessage(kind, { topic, payload }, seededRandom(3));
      const metrics = (JSON.parse(message.body) as TelemetryPayload).metrics;
      const changed = Object.entries(payload.metrics).filter(
        ([name, value]) => metrics[name as MetricName] !== value,
      );
      assert.equal(changed.length, 1, kind);
    }
  });

  it('"shape" is a JSON primitive, not an array or an object (those are read as a payload with no seq)', () => {
    for (const random of RANDOMS) {
      const { body } = malformedMessage(
        'shape',
        { topic, payload: payloadWith({ power_kw: 120 }) },
        random,
      );
      assert.ok(body === '42' || body === 'null', body);
    }
  });

  it('does not change the message it is given', () => {
    const payload = payloadWith({ temperature_c: 22.5, humidity_pct: 45 });
    const before = structuredClone(payload);
    for (const kind of MALFORMED_KINDS) malformedMessage(kind, { topic, payload }, seededRandom(1));
    assert.deepEqual(payload, before);
  });

  it('is deterministic for a seeded source', () => {
    const payload = payloadWith({ co2_ppm: 650, temperature_c: 24, humidity_pct: 55 });
    for (const kind of MALFORMED_KINDS) {
      const a = malformedMessage(kind, { topic, payload }, seededRandom(42));
      const b = malformedMessage(kind, { topic, payload }, seededRandom(42));
      assert.deepEqual(a, b, kind);
    }
  });
});

describe('parseFaultConfig', () => {
  for (const kind of ['drop', 'duplicate'] as const) {
    it(`${kind}: a percent above 0 and at most 100`, () => {
      assert.deepEqual(parseFaultConfig(kind, { percent: 5 }), { ok: true, value: { percent: 5 } });
      assert.deepEqual(parseFaultConfig(kind, { percent: 100 }), {
        ok: true,
        value: { percent: 100 },
      });
      assert.deepEqual(parseFaultConfig(kind, { percent: 0.5 }), {
        ok: true,
        value: { percent: 0.5 },
      });
      for (const bad of [0, -1, 100.1, Number.NaN, '5', null, undefined]) {
        const result = parseFaultConfig(kind, { percent: bad });
        assert.equal(result.ok, false, String(bad));
        assert.match((result as { reason: string }).reason, /"percent"/);
      }
    });
  }

  it('refuses a body that is not an object and a field it does not know', () => {
    assert.deepEqual(parseFaultConfig('drop', []), {
      ok: false,
      reason: 'The request body must be a JSON object',
    });
    assert.deepEqual(parseFaultConfig('drop', 5), {
      ok: false,
      reason: 'The request body must be a JSON object',
    });
    assert.deepEqual(parseFaultConfig('drop', { percent: 5, extra: 1 }), {
      ok: false,
      reason: '"extra" is not a known field of the request',
    });
    assert.equal(parseFaultConfig('drop', undefined).ok, false);
  });

  it('malformed: kinds default to range, are de-duplicated and must be known', () => {
    assert.deepEqual(parseFaultConfig('malformed', { percent: 3 }), {
      ok: true,
      value: { percent: 3, kinds: ['range'] },
    });
    assert.deepEqual(
      parseFaultConfig('malformed', { percent: 3, kinds: ['json', 'seq', 'json'] }),
      {
        ok: true,
        value: { percent: 3, kinds: ['json', 'seq'] },
      },
    );
    for (const kinds of [[], 'range', ['nope'], [1], ['future']]) {
      const result = parseFaultConfig('malformed', { percent: 3, kinds });
      assert.equal(result.ok, false, JSON.stringify(kinds));
      assert.match((result as { reason: string }).reason, /"kinds"/);
    }
    assert.equal(parseFaultConfig('malformed', { kinds: ['range'] }).ok, false);
  });

  it('delay: delayMs from 1 to the limit, jitter from 0 to the delay, jitter defaults to 0', () => {
    assert.deepEqual(parseFaultConfig('delay', { delayMs: 500 }), {
      ok: true,
      value: { delayMs: 500, jitterMs: 0 },
    });
    assert.deepEqual(
      parseFaultConfig('delay', { delayMs: FAULT_LIMITS.maxDelayMs, jitterMs: 200 }),
      {
        ok: true,
        value: { delayMs: FAULT_LIMITS.maxDelayMs, jitterMs: 200 },
      },
    );
    assert.deepEqual(parseFaultConfig('delay', { delayMs: 100, jitterMs: 100 }).ok, true);
    for (const body of [
      {},
      { delayMs: 0 },
      { delayMs: FAULT_LIMITS.maxDelayMs + 1 },
      { delayMs: 100, jitterMs: 101 },
      { delayMs: 100, jitterMs: -1 },
      { delayMs: '100' },
    ]) {
      assert.equal(parseFaultConfig('delay', body).ok, false, JSON.stringify(body));
    }
  });

  it('reorder: an integer window from 2 to 10', () => {
    assert.deepEqual(parseFaultConfig('reorder', { window: 2 }), {
      ok: true,
      value: { window: 2 },
    });
    assert.deepEqual(parseFaultConfig('reorder', { window: 10 }), {
      ok: true,
      value: { window: 10 },
    });
    for (const window of [1, 11, 2.5, '3', null]) {
      const result = parseFaultConfig('reorder', { window });
      assert.equal(result.ok, false, String(window));
      assert.match((result as { reason: string }).reason, /"window"/);
    }
  });

  it('link-loss: forS is optional, from 1 to an hour', () => {
    assert.deepEqual(parseFaultConfig('link-loss', undefined), { ok: true, value: { forS: null } });
    assert.deepEqual(parseFaultConfig('link-loss', {}), { ok: true, value: { forS: null } });
    assert.deepEqual(parseFaultConfig('link-loss', { forS: null }), {
      ok: true,
      value: { forS: null },
    });
    assert.deepEqual(parseFaultConfig('link-loss', { forS: 30 }), {
      ok: true,
      value: { forS: 30 },
    });
    for (const forS of [0, -5, FAULT_LIMITS.maxLinkLossS + 1, 'x']) {
      assert.equal(parseFaultConfig('link-loss', { forS }).ok, false, String(forS));
    }
  });
});

describe('parseScope and parseBurst', () => {
  const known = ['dc-env-01', 'dc-env-02', 'lib-air-01'];

  it('accepts all running devices, or a selection of known ones, once each', () => {
    assert.deepEqual(parseScope({ mode: 'running' }, known), {
      ok: true,
      value: { mode: 'running' },
    });
    assert.deepEqual(
      parseScope({ mode: 'selected', deviceIds: ['dc-env-02', 'dc-env-01', 'dc-env-02'] }, known),
      {
        ok: true,
        value: { mode: 'selected', deviceIds: ['dc-env-02', 'dc-env-01'] },
      },
    );
  });

  it('refuses what cannot be a scope, and marks an unknown device so the route can say 404', () => {
    for (const body of [
      {},
      { mode: 'some' },
      { mode: 'selected' },
      { mode: 'selected', deviceIds: [] },
      { mode: 'selected', deviceIds: 'dc-env-01' },
      { mode: 'selected', deviceIds: [1] },
      { mode: 'selected', deviceIds: [''] },
      { mode: 'running', deviceIds: ['dc-env-01'] },
      { mode: 'running', extra: true },
    ]) {
      const result = parseScope(body, known);
      assert.equal(result.ok, false, JSON.stringify(body));
      assert.equal((result as { unknownDevice?: true }).unknownDevice, undefined);
    }
    assert.deepEqual(parseScope({ mode: 'selected', deviceIds: ['dc-env-01', 'ghost'] }, known), {
      ok: false,
      reason: 'Unknown device "ghost"',
      unknownDevice: true,
    });
  });

  it('a burst is an integer count from 1 to the limit', () => {
    assert.deepEqual(parseBurst({ count: 1 }), { ok: true, value: { count: 1 } });
    assert.deepEqual(parseBurst({ count: FAULT_LIMITS.maxBurst }), {
      ok: true,
      value: { count: FAULT_LIMITS.maxBurst },
    });
    for (const count of [0, FAULT_LIMITS.maxBurst + 1, 1.5, '10', null, undefined]) {
      const result = parseBurst({ count });
      assert.equal(result.ok, false, String(count));
      assert.match((result as { reason: string }).reason, /"count"/);
    }
    assert.equal(parseBurst({ count: 5, extra: 1 }).ok, false);
  });
});

describe('chance, delayFor and shuffleWindow', () => {
  it('chance hits with the given share, and 100 always hits', () => {
    const random = seededRandom(7);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (chance(5, random)) hits++;
    assert.ok(hits > 400 && hits < 600, `5 % of 10,000 gave ${hits}`);
    assert.equal(
      chance(100, () => 0.999999),
      true,
    );
    assert.equal(
      chance(5, () => 0.05),
      false,
    );
    assert.equal(
      chance(5, () => 0.0499),
      true,
    );
  });

  it('delayFor is the delay when there is no jitter, without touching the random source', () => {
    let calls = 0;
    const random = () => {
      calls++;
      return 0.5;
    };
    assert.equal(delayFor({ delayMs: 800, jitterMs: 0 }, random), 800);
    assert.equal(calls, 0);
  });

  it('delayFor stays within the jitter around the delay and never goes below 0', () => {
    const random = seededRandom(11);
    for (let i = 0; i < 1000; i++) {
      const ms = delayFor({ delayMs: 500, jitterMs: 200 }, random);
      assert.ok(ms >= 300 && ms <= 700, String(ms));
    }
    assert.equal(
      delayFor({ delayMs: 100, jitterMs: 100 }, () => 0),
      0,
    );
    assert.equal(
      delayFor({ delayMs: 500, jitterMs: 200 }, () => 0),
      300,
    );
  });

  it('shuffleWindow returns a permutation of its input and leaves the input alone', () => {
    const items = [1, 2, 3, 4, 5];
    const out = shuffleWindow(items, seededRandom(5));
    assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
    assert.deepEqual(items, [1, 2, 3, 4, 5]);
  });

  it('shuffleWindow never returns the order it was given, for any window of 2 or more', () => {
    for (let size = 2; size <= FAULT_LIMITS.maxWindow; size++) {
      const items = Array.from({ length: size }, (_, i) => i);
      for (let seed = 1; seed <= 200; seed++) {
        const out = shuffleWindow(items, seededRandom(seed));
        assert.notDeepEqual(out, items, `size ${size}, seed ${seed}`);
      }
    }
  });

  it('shuffleWindow is deterministic for a seed, and a window of one is itself', () => {
    const items = ['a', 'b', 'c', 'd'];
    assert.deepEqual(shuffleWindow(items, seededRandom(9)), shuffleWindow(items, seededRandom(9)));
    assert.deepEqual(shuffleWindow(['only'], seededRandom(9)), ['only']);
    assert.deepEqual(shuffleWindow([], seededRandom(9)), []);
  });
});
