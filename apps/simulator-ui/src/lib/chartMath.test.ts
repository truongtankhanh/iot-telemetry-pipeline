import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { RuleInfo } from '../api/types';
import type { Sample } from '../state/history';
import {
  buildLineChart,
  chartDomain,
  findGaps,
  gapThresholdMs,
  linearScale,
  niceTicks,
  rangeBarModel,
  sparkline,
  summarize,
  trailingReason,
  WINDOW_MS,
} from './chartMath';
import { formatClockTime } from './time';

const NOW = Date.parse('2026-10-20T09:15:00.000Z');
const hot = fixture.rules.items.find((r) => r.id === 'server-room-hot') as RuleInfo;
const co2 = fixture.rules.items.find((r) => r.id === 'indoor-co2') as RuleInfo;
/** Samples every 2 s ending `agoS` seconds before NOW, with these values. */
const series = (values: number[], agoS = 0): Sample[] =>
  values.map((v, i) => ({ t: NOW - (agoS + (values.length - 1 - i) * 2) * 1000, v }));
const running = { kind: 'running' as const, since: null };

describe('linearScale', () => {
  it('maps a domain onto a range, including a reversed one (pictures grow downwards)', () => {
    expect(linearScale(0, 10, 0, 100)(5)).toBe(50);
    expect(linearScale(0, 10, 100, 0)(2)).toBe(80);
  });

  it('maps a flat domain to the middle of the range', () => {
    expect(linearScale(5, 5, 0, 100)(5)).toBe(50);
  });
});

describe('niceTicks', () => {
  it('gives round numbers inside the span', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(22.1, 29.6, 4)).toEqual([24, 26, 28]);
  });

  it('keeps decimals exact', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('gives the single value of a flat span, and nothing for a span that is not a number', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });
});

describe('chartDomain', () => {
  it('covers the values and the lines with a margin', () => {
    const [lo, hi] = chartDomain([22, 23], [27, 25.5], null);
    expect(lo).toBeLessThan(22);
    expect(hi).toBeGreaterThan(27);
  });

  it('gives a flat series a visible span', () => {
    const [lo, hi] = chartDomain([22.5, 22.5], [], null);
    expect(hi - lo).toBeGreaterThan(1);
  });

  it('never goes outside the range the contract accepts', () => {
    const [lo, hi] = chartDomain([1, 99], [], { min: 0, max: 100 });
    expect(lo).toBe(0);
    expect(hi).toBe(100);
  });

  it('falls back to the contract range, or 0 to 1, with nothing to show', () => {
    expect(chartDomain([], [], { min: -40, max: 85 })).toEqual([-40, 85]);
    expect(chartDomain([], [], null)).toEqual([0, 1]);
  });
});

describe('summarize', () => {
  it('is min, average, max and last', () => {
    expect(summarize(series([1, 2, 6]))).toEqual({ min: 1, avg: 3, max: 6, last: 6 });
  });

  it('is null for no readings', () => {
    expect(summarize([])).toBeNull();
  });
});

describe('findGaps', () => {
  it('finds a stretch between two readings that is longer than the threshold', () => {
    const samples: Sample[] = [
      { t: NOW - 60_000, v: 1 },
      { t: NOW - 58_000, v: 1 },
      { t: NOW - 30_000, v: 1 },
      { t: NOW - 2000, v: 1 },
    ];
    expect(findGaps(samples, NOW, 6000)).toEqual([
      { from: NOW - 58_000, to: NOW - 30_000, kind: 'between' },
      { from: NOW - 30_000, to: NOW - 2000, kind: 'between' },
    ]);
  });

  it('finds the stretch from the last reading to now, only when it is longer than the threshold', () => {
    const quiet = [{ t: NOW - 20_000, v: 1 }];
    expect(findGaps(quiet, NOW, 6000)).toEqual([{ from: NOW - 20_000, to: NOW, kind: 'trailing' }]);
    expect(findGaps([{ t: NOW - 6000, v: 1 }], NOW, 6000)).toEqual([]);
  });

  it('finds nothing in an empty series: that is not a gap but no data', () => {
    expect(findGaps([], NOW, 6000)).toEqual([]);
  });
});

describe('gapThresholdMs', () => {
  it('is three intervals and at least five seconds', () => {
    expect(gapThresholdMs(2000)).toBe(6000);
    expect(gapThresholdMs(100)).toBe(5000);
    expect(gapThresholdMs(10_000)).toBe(30_000);
  });
});

describe('trailingReason', () => {
  it('says why the line stops', () => {
    const at = formatClockTime(NOW - 40_000);
    expect(trailingReason({ kind: 'paused', since: NOW - 40_000 }, NOW - 40_000, NOW)).toBe(
      `Paused at ${at}`,
    );
    expect(trailingReason({ kind: 'stopped', since: null }, NOW - 40_000, NOW)).toBe(
      `Stopped at ${at}`,
    );
    expect(trailingReason({ kind: 'silent', since: NOW - 40_000 }, NOW - 40_000, NOW)).toBe(
      `Silent since ${at}`,
    );
    expect(trailingReason(running, NOW - 15_000, NOW)).toBe('No readings for 15 s');
    expect(trailingReason(running, null, NOW)).toBe('No readings yet');
  });
});

describe('buildLineChart', () => {
  const chart = (values: number[], extra: Partial<Parameters<typeof buildLineChart>[0]> = {}) =>
    buildLineChart({
      deviceId: 'dc-env-01',
      metric: 'temperature_c',
      samples: series(values),
      now: NOW,
      rule: hot,
      status: running,
      intervalMs: 2000,
      ...extra,
    });

  it('draws the line inside the plot, newest on the right, higher values higher up', () => {
    const model = chart([22, 23, 24]);
    expect(model.line.startsWith('M')).toBe(true);
    expect(model.last?.x).toBeCloseTo(model.plot.right, 1);
    const ys = [...model.line.matchAll(/ (\d+(?:\.\d+)?)(?= L|$)/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeGreaterThan(ys[2] as number);
    expect(model.area.endsWith('Z')).toBe(true);
  });

  it('draws the raise and clear lines, with the headroom in words, and the amber region above the raise line', () => {
    const model = chart([22.2, 22.4, 22.4]);
    expect(model.raise).toMatchObject({
      label: 'raise 27',
      headroom: '4.6 °C to raise',
      beyond: false,
    });
    expect(model.clear?.label).toBe('clear 25.5');
    expect(model.raise!.y).toBeLessThan(model.clear!.y);
    expect(model.breach).toEqual({ y: model.plot.top, height: model.raise!.y - model.plot.top });
  });

  it('says how far beyond the raise line the last value is', () => {
    const model = chart([22.4, 29.3]);
    expect(model.raise).toMatchObject({ headroom: '2.3 °C above raise', beyond: true });
    expect(model.last?.label).toBe('29.3');
    expect(model.last!.y).toBeLessThan(model.raise!.y);
  });

  it('puts the amber region below the raise line for a rule that fires below a value', () => {
    const cold: RuleInfo = { ...hot, direction: 'below', raise: 18, clear: 20 };
    const model = chart([21, 19], { rule: cold });
    expect(model.breach).toEqual({ y: model.raise!.y, height: model.plot.bottom - model.raise!.y });
  });

  it('draws no lines and no region without a rule', () => {
    const model = chart([22, 23], { rule: null });
    expect(model.raise).toBeNull();
    expect(model.clear).toBeNull();
    expect(model.breach).toBeNull();
  });

  it('has the axes: round y labels, and time labels from -2 min to now', () => {
    const model = chart([22, 23, 24]);
    expect(model.xTicks.map((t) => t.label)).toEqual(['−2 min', '−1 min', 'now']);
    expect(model.yTicks.length).toBeGreaterThanOrEqual(2);
    for (const tick of model.yTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(model.plot.top - 0.01);
      expect(tick.y).toBeLessThanOrEqual(model.plot.bottom + 0.01);
    }
  });

  it('gives min, average and max beneath', () => {
    expect(chart([22, 23, 24]).stats).toEqual({ min: '22.0', avg: '23.0', max: '24.0' });
    expect(chart([]).stats).toBeNull();
  });

  it('shows ppm as whole numbers', () => {
    const model = buildLineChart({
      deviceId: 'lib-air-01',
      metric: 'co2_ppm',
      samples: series([650.4, 702.2]),
      now: NOW,
      rule: co2,
      status: running,
      intervalMs: 2000,
    });
    expect(model.last?.label).toBe('702');
    expect(model.raise?.headroom).toBe('498 ppm to raise');
  });

  it('hatches the stretch after the last reading of a paused device and says why', () => {
    const model = chart([22, 22.4], {
      samples: series([22, 22.4], 40),
      status: { kind: 'paused', since: NOW - 40_000 },
    });
    expect(model.gaps).toHaveLength(1);
    expect(model.gaps[0]?.reason).toBe(`Paused at ${formatClockTime(NOW - 40_000)}`);
    expect(model.gaps[0]!.x + model.gaps[0]!.width).toBeCloseTo(model.plot.right, 1);
    expect(model.description).toContain('Paused at');
  });

  it('hatches a stretch between readings', () => {
    const samples: Sample[] = [
      { t: NOW - 60_000, v: 22 },
      { t: NOW - 20_000, v: 22 },
      { t: NOW - 2000, v: 22 },
    ];
    const model = chart([], { samples });
    expect(model.gaps.map((g) => g.reason)).toContain('No readings');
  });

  it('is all gap, with the reason, when there are no readings in the window', () => {
    const model = chart([], { status: { kind: 'stopped', since: null } });
    expect(model.line).toBe('');
    expect(model.last).toBeNull();
    expect(model.gaps).toEqual([
      { x: model.plot.left, width: model.plot.right - model.plot.left, reason: 'Stopped' },
    ]);
    expect(model.description).toBe('temperature_c of dc-env-01, last 2 min: no readings (Stopped)');
  });

  it('ignores readings older than the window', () => {
    const old: Sample[] = [{ t: NOW - WINDOW_MS - 10_000, v: 99 }, ...series([22, 23])];
    expect(chart([], { samples: old }).stats).toEqual({ min: '22.0', avg: '22.5', max: '23.0' });
  });

  it('says it is collecting when the history is shorter than the window', () => {
    const short = chart([], {
      samples: [
        { t: NOW - 40_000, v: 22 },
        { t: NOW - 2000, v: 22.1 },
      ],
    });
    expect(short.collecting).toBe('collecting, 40 s of 2 min');
    expect(chart([22, 23]).collecting).toBe('collecting, 2 s of 2 min');
    const full: Sample[] = Array.from({ length: 60 }, (_, i) => ({
      t: NOW - (118 - i * 2) * 1000,
      v: 22,
    }));
    expect(chart([], { samples: full }).collecting).toBeNull();
  });

  it('describes itself in a sentence that includes the numbers', () => {
    const model = chart([22.2, 22.4, 29.3]);
    expect(model.description).toMatch(
      /^temperature_c of dc-env-01, last 2 min: from 22\.2 °C to 29\.3 °C; min 22\.2/,
    );
    expect(model.description).toContain('2.3 °C above raise line (27)');
    expect(model.description).toContain('an alert opens after 3 readings in a row');
  });
});

describe('sparkline', () => {
  it('draws the window in a small box, the newest at the right and the highest at the top', () => {
    const { d, last } = sparkline(series([10, 20]), NOW, { width: 72, height: 22 });
    expect(d).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
    expect(last?.x).toBeCloseTo(70, 0);
    expect(last?.y).toBe(2);
  });

  it('is empty without readings in the window', () => {
    expect(sparkline([], NOW)).toEqual({ d: '', last: null });
    expect(sparkline([{ t: NOW - WINDOW_MS - 1, v: 1 }], NOW)).toEqual({ d: '', last: null });
  });

  it('draws a flat series as a line in the middle', () => {
    const { last } = sparkline(series([5, 5, 5]), NOW, { height: 22 });
    expect(last?.y).toBe(11);
  });
});

describe('rangeBarModel', () => {
  const profile = { baseline: 22.5, noise: 0.3, dailySwing: 0 };

  it('splits the scale into safe, hysteresis and alarm, in order, covering the whole bar', () => {
    const model = rangeBarModel({ metric: 'temperature_c', rule: hot, profile, value: 29.3 });
    expect(model.zones.map((z) => z.kind)).toEqual(['safe', 'hysteresis', 'alarm']);
    expect(model.zones[0]?.from).toBe(0);
    expect(model.zones[2]?.to).toBe(1);
    expect(model.zones[0]!.to).toBe(model.zones[1]!.from);
    expect(model.zones[1]!.to).toBe(model.zones[2]!.from);
  });

  it('puts the pins where the numbers say: baseline in the safe zone, the value in the alarm zone', () => {
    const model = rangeBarModel({ metric: 'temperature_c', rule: hot, profile, value: 29.3 });
    expect(model.baseline).toBeLessThan(model.zones[0]!.to);
    expect(model.value).toBeGreaterThan(model.zones[2]!.from);
    expect(model.offScale).toBe(false);
  });

  it('turns the zones around for a rule that fires below a value', () => {
    const cold: RuleInfo = { ...hot, direction: 'below', raise: 18, clear: 20 };
    const model = rangeBarModel({ metric: 'temperature_c', rule: cold, profile, value: 17 });
    expect(model.zones.map((z) => z.kind)).toEqual(['alarm', 'hysteresis', 'safe']);
  });

  it('says it in words', () => {
    const model = rangeBarModel({ metric: 'temperature_c', rule: hot, profile, value: 29.3 });
    expect(model.text).toBe(
      'Safe up to 25.5 °C; hysteresis band 25.5 °C to 27 °C; alarm above 27 °C; baseline 22.5 °C; now 29.3 °C',
    );
  });

  it('copes with no profile and no value', () => {
    const model = rangeBarModel({ metric: 'temperature_c', rule: hot, profile: null, value: null });
    expect(model.baseline).toBeNull();
    expect(model.value).toBeNull();
    expect(model.text).toContain('no current value');
  });

  it('keeps the pin inside the bar for a value at the end of the contract range', () => {
    const model = rangeBarModel({
      metric: 'humidity_pct',
      rule: { ...hot, metric: 'humidity_pct', raise: 60, clear: 55 },
      profile: null,
      value: 100,
    });
    expect(model.value).toBeLessThanOrEqual(1);
    expect(model.value).toBeGreaterThanOrEqual(0);
  });
});
