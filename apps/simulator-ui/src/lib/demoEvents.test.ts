import { describe, expect, it } from 'vitest';
import type { ObservationEvent, RuleInfo } from '../api/types';
import type { Sample } from '../state/history';
import {
  type Baseline,
  beginStep,
  type MatchInputs,
  matchAwait,
  milestones,
  rebase,
  takeBaseline,
} from './demoEvents';
import type { DemoAwait, DemoStep } from './demoScript';

const rule: RuleInfo = {
  id: 'server-room-hot',
  kind: 'server_room',
  metric: 'temperature_c',
  direction: 'above',
  raise: 27,
  clear: 25.5,
  for: 3,
  severity: 'high',
  title: 'Server room temperature high',
};

const awaiting = (type: DemoAwait['type']): DemoAwait => ({
  type,
  ruleId: 'server-room-hot',
  deviceId: 'dc-env-01',
});

const event = (
  id: number,
  kind: ObservationEvent['kind'],
  data: Record<string, unknown>,
): ObservationEvent => ({
  id,
  at: `2026-10-23T08:00:${String(id).padStart(2, '0')}.000Z`,
  kind,
  data,
});

const opened = (id: number, alertId = '7', extra: Record<string, unknown> = {}) =>
  event(id, 'alert-opened', {
    alertId,
    deviceId: 'dc-env-01',
    ruleId: 'server-room-hot',
    ...extra,
  });
const cleared = (id: number, alertId = '7') =>
  event(id, 'alert-cleared', { alertId, deviceId: 'dc-env-01', ruleId: 'server-room-hot' });
const incident = (id: number, alertId = '7') =>
  event(id, 'incident', { alertId, externalRef: 'c3a1f0d2' });

const samples = (...values: number[]): Sample[] =>
  values.map((v, index) => ({ t: 1_000 + index * 2_000, v }));

/** Events newest first, as the observation log hands them over. */
const inputs = (
  events: ObservationEvent[] = [],
  overrides: Partial<MatchInputs> = {},
): MatchInputs => ({
  events: [...events].sort((a, b) => b.id - a.id),
  newestId: events.reduce((max, e) => Math.max(max, e.id), 0),
  series: [],
  rule,
  alerts: [],
  ...overrides,
});

const baselineAt = (observationId: number, extra: Partial<Baseline> = {}): Baseline => ({
  observationId,
  seriesT: null,
  openAlertIds: [],
  at: 0,
  ...extra,
});

describe('takeBaseline', () => {
  it('records the newest observation, the newest reading and the open alerts of the awaited rule', () => {
    const baseline = takeBaseline(
      inputs([opened(4)], {
        series: samples(22, 22.4),
        alerts: [
          { id: '7', status: 'open', ruleId: 'server-room-hot', deviceId: 'dc-env-01' },
          { id: '8', status: 'cleared', ruleId: 'server-room-hot', deviceId: 'dc-env-01' },
          { id: '9', status: 'open', ruleId: 'indoor-co2', deviceId: 'lha-air-01' },
        ],
      }),
      awaiting('alert-opened'),
      5_000,
    );
    expect(baseline).toEqual({ observationId: 4, seriesT: 3_000, openAlertIds: ['7'], at: 5_000 });
  });

  it('is empty for an empty log and a series without readings', () => {
    expect(takeBaseline(inputs(), awaiting('alert-opened'), 1)).toEqual({
      observationId: 0,
      seriesT: null,
      openAlertIds: [],
      at: 1,
    });
  });

  it('records no open alerts for a step that awaits nothing', () => {
    const open = [
      { id: '7', status: 'open' as const, ruleId: 'server-room-hot', deviceId: 'dc-env-01' },
    ];
    expect(takeBaseline(inputs([], { alerts: open }), undefined, 1).openAlertIds).toEqual([]);
  });
});

describe('beginStep', () => {
  const plain: DemoStep = {
    id: 'a',
    title: 'A',
    summary: 'A',
    say: 'A',
    await: awaiting('alert-opened'),
  };
  const acting: DemoStep = {
    ...plain,
    action: { type: 'run-scenario', scenario: 'server-room-overheat' },
  };
  const previous = baselineAt(3, { at: 100 });

  it('takes a fresh baseline for a step that does something', () => {
    expect(beginStep(acting, previous, inputs([opened(9)]), 500).observationId).toBe(9);
  });

  it('takes a fresh baseline for the first step', () => {
    expect(beginStep(plain, null, inputs([opened(9)]), 500).observationId).toBe(9);
  });

  it('keeps the baseline of the step before for a step that only waits, so an event that came while the presenter was reading still counts', () => {
    const kept = beginStep(plain, previous, inputs([opened(9)]), 500);
    expect(kept).toBe(previous);
    expect(matchAwait(awaiting('alert-opened'), kept, inputs([opened(9)])).status).toBe(
      'satisfied',
    );
  });
});

describe('rebase', () => {
  it('resets the observation baseline when the log is newer than the simulator (a restart numbers events from 1)', () => {
    expect(rebase(baselineAt(40), inputs([opened(2)])).observationId).toBe(0);
    expect(rebase(baselineAt(40), inputs()).observationId).toBe(0);
  });

  it('leaves it alone otherwise', () => {
    const baseline = baselineAt(4);
    expect(rebase(baseline, inputs([opened(5)]))).toBe(baseline);
    expect(rebase(baseline, inputs([opened(4)]))).toBe(baseline);
  });
});

describe('matchAwait: alert-opened', () => {
  const awaited = awaiting('alert-opened');

  it('is satisfied by an alert-opened of the rule on the device after the baseline, with its time and alert', () => {
    const result = matchAwait(awaited, baselineAt(2), inputs([opened(3)]));
    expect(result).toEqual({
      status: 'satisfied',
      at: Date.parse('2026-10-23T08:00:03.000Z'),
      alertId: '7',
    });
  });

  it('is not satisfied by an event at or before the baseline', () => {
    expect(matchAwait(awaited, baselineAt(3), inputs([opened(3)])).status).toBe('waiting');
    // the log reaches the baseline (id 5), so it is the same simulator and event 3 is older than the baseline
    const filler = event(5, 'engine-state', {});
    expect(matchAwait(awaited, baselineAt(5), inputs([opened(3), filler])).status).toBe('waiting');
  });

  it('ignores another rule, another device and another kind of event', () => {
    const others = [
      opened(3, '8', { ruleId: 'indoor-co2' }),
      opened(4, '9', { deviceId: 'lha-air-01' }),
      cleared(5),
      incident(6),
    ];
    expect(matchAwait(awaited, baselineAt(0), inputs(others)).status).toBe('waiting');
  });

  it('says an alert was already open when the baseline was taken, and goes on waiting', () => {
    const result = matchAwait(awaited, baselineAt(2, { openAlertIds: ['7'] }), inputs());
    expect(result).toMatchObject({ status: 'waiting', progress: { alreadyOpen: true } });
  });

  it('is satisfied, not "already open", once an alert does open', () => {
    const result = matchAwait(awaited, baselineAt(2, { openAlertIds: ['6'] }), inputs([opened(3)]));
    expect(result.status).toBe('satisfied');
  });

  it('counts every event after a simulator restart (a log whose newest id is below the baseline)', () => {
    expect(matchAwait(awaited, baselineAt(40), inputs([opened(1)])).status).toBe('satisfied');
  });

  it('survives an event whose data lacks a key or has an unreadable time', () => {
    const odd = [{ id: 3, at: 'not a time', kind: 'alert-opened' as const, data: {} }];
    expect(matchAwait(awaited, baselineAt(0), inputs(odd)).status).toBe('waiting');
    const noTime = [{ ...opened(3), at: 'not a time' }];
    expect(matchAwait(awaited, baselineAt(0), inputs(noTime))).toMatchObject({
      status: 'satisfied',
      at: null,
    });
  });
});

describe('matchAwait: alert-cleared', () => {
  it('is satisfied by an alert-cleared of the rule on the device after the baseline', () => {
    const awaited = awaiting('alert-cleared');
    expect(matchAwait(awaited, baselineAt(5), inputs([opened(3), cleared(6)])).status).toBe(
      'satisfied',
    );
    const filler = event(5, 'engine-state', {});
    expect(matchAwait(awaited, baselineAt(5), inputs([cleared(4), filler])).status).toBe('waiting');
  });
});

describe('matchAwait: incident-delivered', () => {
  const awaited = awaiting('incident-delivered');

  it('is satisfied by the incident of an alert the rule opened after the baseline', () => {
    const result = matchAwait(awaited, baselineAt(2), inputs([opened(3), incident(5)]));
    expect(result).toMatchObject({ status: 'satisfied', alertId: '7' });
  });

  it('is not satisfied by the incident of some other rule’s alert', () => {
    const events = [opened(3, '7'), opened(4, '8', { ruleId: 'indoor-co2' }), incident(5, '8')];
    expect(matchAwait(awaited, baselineAt(2), inputs(events)).status).toBe('waiting');
  });

  it('is not satisfied by an incident of an alert the rule opened before the baseline (an earlier run)', () => {
    expect(matchAwait(awaited, baselineAt(4), inputs([opened(3), incident(5)])).status).toBe(
      'waiting',
    );
  });

  it('waits when the alert has opened and no incident has come', () => {
    expect(matchAwait(awaited, baselineAt(2), inputs([opened(3)])).status).toBe('waiting');
  });

  it('is not satisfied by a delivery that is not an incident', () => {
    const delivery = event(4, 'delivery', { alertId: '7', phase: 'opened', status: 'delivered' });
    expect(matchAwait(awaited, baselineAt(2), inputs([opened(3), delivery])).status).toBe(
      'waiting',
    );
  });
});

describe('matchAwait: rule-raised', () => {
  const awaited = awaiting('rule-raised');

  it('counts the readings in a row beyond the raise line and is satisfied at `for`', () => {
    const two = matchAwait(awaited, baselineAt(0), inputs([], { series: samples(22, 27.5, 28) }));
    expect(two).toMatchObject({ status: 'waiting', progress: { counted: 2, of: 3, latest: 28 } });

    const three = matchAwait(
      awaited,
      baselineAt(0),
      inputs([], { series: samples(22, 27.5, 28, 29.3) }),
    );
    // the third reading in a row is the one at t = 7000
    expect(three).toEqual({ status: 'satisfied', at: 7_000, alertId: null });
  });

  it('counts only readings newer than the baseline (by `t`)', () => {
    const series = samples(29, 29, 29, 29);
    const result = matchAwait(awaited, baselineAt(0, { seriesT: 3_000 }), inputs([], { series }));
    // t = 1000, 3000, 5000, 7000: the last two are newer than 3000
    expect(result).toMatchObject({ status: 'waiting', progress: { counted: 2 } });
  });

  it('starts the count again when a reading falls back under the line', () => {
    const result = matchAwait(
      awaited,
      baselineAt(0),
      inputs([], { series: samples(28, 28, 26.9, 28) }),
    );
    expect(result).toMatchObject({ status: 'waiting', progress: { counted: 1 } });
  });

  it('does not count a reading exactly on the line (strictly beyond)', () => {
    const result = matchAwait(awaited, baselineAt(0), inputs([], { series: samples(27, 27, 27) }));
    expect(result).toMatchObject({ status: 'waiting', progress: { counted: 0 } });
  });

  it('waits, without a count, when the simulator has no rule', () => {
    const result = matchAwait(
      awaited,
      baselineAt(0),
      inputs([], { rule: null, series: samples(30) }),
    );
    expect(result).toMatchObject({
      status: 'waiting',
      progress: { counted: null, of: null, latest: 30 },
    });
  });

  it('waits with no latest reading for an empty series', () => {
    expect(matchAwait(awaited, baselineAt(0), inputs())).toMatchObject({
      status: 'waiting',
      progress: { counted: 0, latest: null },
    });
  });
});

describe('the scan', () => {
  it('stops at the baseline: a log of 5,000 events costs what happened since, not what is kept', () => {
    const events: ObservationEvent[] = [];
    for (let id = 5_000; id >= 1; id--) events.push(event(id, 'engine-state', {}));
    let reads = 0;
    const counted = new Proxy(events, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const result = matchAwait(awaiting('alert-opened'), baselineAt(4_990), {
      events: counted,
      newestId: 5_000,
      series: [],
      rule,
      alerts: [],
    });
    expect(result.status).toBe('waiting');
    expect(reads).toBeLessThanOrEqual(12);
  });
});

describe('milestones', () => {
  const subject = { ruleId: 'server-room-hot', deviceId: 'dc-env-01' };

  it('has reached nothing without a baseline, and still knows the rule’s length', () => {
    expect(milestones(subject, null, inputs())).toEqual({
      counted: null,
      of: 3,
      ruleRaised: false,
      alert: 'none',
      incident: false,
    });
    expect(milestones(subject, null, inputs([], { rule: null })).of).toBeNull();
  });

  it('counts the readings while the rule has not raised', () => {
    const result = milestones(subject, baselineAt(0), inputs([], { series: samples(22, 28, 28) }));
    expect(result).toEqual({
      counted: 2,
      of: 3,
      ruleRaised: false,
      alert: 'none',
      incident: false,
    });
  });

  it('has the rule raised when its count is reached, before any alert', () => {
    const result = milestones(subject, baselineAt(0), inputs([], { series: samples(28, 28, 28) }));
    expect(result).toMatchObject({ counted: 3, ruleRaised: true, alert: 'none' });
  });

  it('has the rule raised and the alert open when an alert opened, even if the readings have fallen back', () => {
    const result = milestones(
      subject,
      baselineAt(0),
      inputs([opened(2)], { series: samples(22, 22) }),
    );
    expect(result).toMatchObject({ ruleRaised: true, alert: 'open', incident: false });
  });

  it('adds the incident of that alert, then the clear', () => {
    const withIncident = milestones(subject, baselineAt(0), inputs([opened(2), incident(3)]));
    expect(withIncident).toMatchObject({ alert: 'open', incident: true });
    const all = milestones(subject, baselineAt(0), inputs([opened(2), incident(3), cleared(4)]));
    expect(all).toMatchObject({ ruleRaised: true, alert: 'cleared', incident: true });
  });

  it('does not count a clear of an alert that opened before the baseline', () => {
    const result = milestones(subject, baselineAt(3), inputs([opened(2), cleared(4)]));
    expect(result.alert).toBe('none');
  });
});
