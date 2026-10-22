import { describe, expect, it } from 'vitest';
import type { Expected, ExpectedAlert, ExpectationPreview } from '../api/types';
import { impactView } from './labImpact';

const alert = (change: Partial<ExpectedAlert> = {}): ExpectedAlert => ({
  ruleId: 'server-room-hot',
  title: 'Server room temperature high',
  severity: 'high',
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  opensAtS: 24,
  opensMargin: false,
  clearsAtS: 80,
  clearsUncertain: false,
  ...change,
});

const preview = (
  alerts: ExpectedAlert[],
  extra: Partial<Extract<Expected, { available: true }>> = {},
  needsStart: ExpectationPreview['needsStart'] = [],
): ExpectationPreview => ({
  expected: {
    available: true,
    intervalS: 2,
    horizonS: 80,
    alerts,
    quiet: [],
    series: [],
    ...extra,
  },
  needsStart,
  intervalMs: 2000,
});

const view = (p: ExpectationPreview | null, sink: string | null = 'ops-command-center') =>
  impactView({ status: 'ready', preview: p, error: null, sink });

describe('impactView: one alert', () => {
  const v = view(preview([alert()]));

  it('says the rule, the alert, the incident and the clear, as the frame does', () => {
    expect(v.kind).toBe('chips');
    expect(v.chips.map((c) => [c.id, c.text])).toEqual([
      ['rule', 'server-room-hot'],
      ['alert', 'Alert, high · about 24 s'],
      ['incident', 'Incident in OCC'],
      ['clear', 'Clears about 80 s'],
    ]);
  });

  it('says the times are designed from the rules, not observed', () => {
    expect(v.notes[0]).toBe(
      'Worked out from the rules and the publish interval, not observed. Times are seconds from now.',
    );
  });
});

describe('impactView: several alerts', () => {
  const alerts = Array.from({ length: 12 }, (_, i) =>
    alert({ deviceId: `d${i}`, opensAtS: 24 + 2 * i, clearsAtS: 80 + 2 * i }),
  );
  const v = view(preview(alerts));

  it('says up to n alerts and the range of their times, and when all is clear', () => {
    expect(v.chips.map((c) => c.text)).toEqual([
      'server-room-hot',
      'Up to 12 alerts · 24 to 46 s',
      'Incident in OCC',
      'All clear about 102 s',
    ]);
  });

  it('counts rules when more than one raises', () => {
    const two = view(preview([alert(), alert({ ruleId: 'server-room-humid', deviceId: 'd2' })]));
    expect(two.chips[0]!.text).toBe('2 rules');
  });

  it('says one time when every alert opens at once', () => {
    const same = view(preview([alert(), alert({ deviceId: 'd2' })]));
    expect(same.chips[1]!.text).toBe('Up to 2 alerts · 24 s');
  });
});

describe('impactView: what it cannot promise', () => {
  it('does not promise an incident without a command center, nor when it is not known', () => {
    expect(view(preview([alert()]), 'none').chips[2]).toMatchObject({
      tone: 'neutral',
      text: 'No command center: no incident',
    });
    expect(view(preview([alert()]), null).chips[2]!.text).toBe('Incident in OCC: not known');
  });

  it('says when the clear time is not known', () => {
    const v = view(preview([alert({ clearsAtS: null })]));
    expect(v.chips[3]!.text).toBe('Clear time not known');
  });

  it('says what a stopped device means: injecting does not start it', () => {
    const v = view(preview([alert()], {}, [{ deviceId: 'dc-env-01', state: 'stopped' }]));
    expect(v.notes).toContain(
      'dc-env-01 is not running. Injecting does not start it, so nothing is published until it is started.',
    );
    const many = view(
      preview([alert()], {}, [
        { deviceId: 'a', state: 'stopped' },
        { deviceId: 'b', state: 'paused' },
      ]),
    );
    expect(many.notes.join(' ')).toContain('a, b are not running. Injecting does not start them');
  });

  it('says a reading near the line may open late or never, and a clear may take longer', () => {
    const v = view(preview([alert({ opensMargin: true, clearsUncertain: true })]));
    expect(v.notes.join(' ')).toMatch(/within the jitter of the raise line/);
    expect(v.notes.join(' ')).toMatch(/A clear may take longer/);
  });

  it('says no alert is expected, and why, for a signal no rule watches', () => {
    const v = view(
      preview([], {
        quiet: [
          { deviceId: 'd1', metric: 'humidity_pct', why: 'no-rule' },
          { deviceId: 'd2', metric: 'temperature_c', why: 'never-crosses' },
          { deviceId: 'd3', metric: 'co2_ppm', why: 'no-rule' },
        ],
      }),
    );
    expect(v.chips).toEqual([{ id: 'alert', tone: 'neutral', text: 'No alert expected' }]);
    expect(v.notes).toContain('d1 humidity_pct: no rule watches it.');
    expect(v.notes).toContain("d2 temperature_c: it never crosses a rule's line.");
    expect(v.notes).toContain('and 1 more raise nothing.');
  });
});

describe('impactView: when there is nothing to show yet', () => {
  it('asks for a target while nothing is chosen', () => {
    expect(impactView({ status: 'idle', preview: null, error: null, sink: null })).toMatchObject({
      kind: 'message',
      message: 'Choose a target and a fault to see what the rules should do.',
    });
  });

  it('says it is working it out, until the first answer', () => {
    expect(impactView({ status: 'loading', preview: null, error: null, sink: null }).message).toBe(
      'Working out what the rules should do…',
    );
  });

  it('says what the simulator refused, as it said it', () => {
    const v = impactView({
      status: 'error',
      preview: null,
      error: 'anomalies[1] overlaps anomalies[0] on d1 temperature_c',
      sink: null,
    });
    expect(v.message).toBe('anomalies[1] overlaps anomalies[0] on d1 temperature_c');
  });

  it('says the rules are not available, with the reason', () => {
    const v = view({
      expected: { available: false, reason: 'cannot read rules.json (ENOENT)' },
      needsStart: [],
      intervalMs: 2000,
    });
    expect(v.message).toBe('Expected alerts are not available: cannot read rules.json (ENOENT)');
  });

  it('keeps showing the last answer while the next is asked for', () => {
    const v = impactView({
      status: 'loading',
      preview: preview([alert()]),
      error: null,
      sink: null,
    });
    expect(v.kind).toBe('chips');
  });
});
