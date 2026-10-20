import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { ObservedAlert, RuleInfo, StateView } from '../api/types';
import type { Sample } from '../state/history';
import { buildFleetRows } from './fleetRows';
import type { FleetRow } from './fleetQuery';
import {
  alertsFor,
  breachRun,
  consoleHref,
  evaluationTarget,
  primaryReading,
  ruleEvaluation,
  stageChecks,
  zoneSummary,
} from './topologyDetail';
import { formatClockTime } from './time';

const at = (clock: string) => Date.parse(`2026-10-20T${clock}.000Z`);
const sample = (clock: string, v: number): Sample => ({ t: at(clock), v });

const hot = fixture.rules.items.find((rule) => rule.id === 'server-room-hot') as RuleInfo;
const alert7 = fixture.alerts.alerts[0] as ObservedAlert;

describe('breachRun', () => {
  const series = [sample('09:14:20', 22.4), sample('09:14:22', 29.2), sample('09:14:24', 29.4)];

  it('is the readings at the end that are all beyond the raise line, oldest first', () => {
    expect(breachRun(series, hot).map((s) => s.v)).toEqual([29.2, 29.4]);
  });

  it('is empty when the newest reading is within the line', () => {
    expect(breachRun([...series, sample('09:14:26', 22.4)], hot)).toEqual([]);
  });

  it('is the whole series when every reading is beyond, and empty for none', () => {
    expect(breachRun(series.slice(1), hot)).toHaveLength(2);
    expect(breachRun([], hot)).toEqual([]);
  });

  it('does not count a reading exactly on the line (strictly beyond)', () => {
    expect(breachRun([sample('09:14:20', 27)], hot)).toEqual([]);
  });

  it('works for a rule that raises below a line', () => {
    const low: RuleInfo = { ...hot, direction: 'below', raise: 10, clear: 12 };
    expect(breachRun([sample('09:14:20', 15), sample('09:14:22', 9)], low).map((s) => s.v)).toEqual(
      [9],
    );
  });
});

describe('ruleEvaluation', () => {
  // The story of frame 04: 22.4, then 29.2, 29.4 and 29.3 in a row; ingest opens the alert at 09:14:35.
  const story = [
    sample('09:14:25', 22.4),
    sample('09:14:29', 29.2),
    sample('09:14:31', 29.4),
    sample('09:14:33', 29.3),
    sample('09:14:36', 29.5),
  ];
  const raised = ruleEvaluation({ rule: hot, alert: alert7, series: story });
  const row = (label: string) => raised.rows.find((r) => r.label === label);

  it('lists what the rule is, what it needs, and what it saw', () => {
    expect(raised.status).toBe('raised');
    expect(raised.rows.map((r) => r.label)).toEqual([
      'Rule',
      'Condition',
      'Readings',
      'Clears',
      'Raised',
      'Reaction time',
    ]);
    expect(row('Rule')).toMatchObject({ value: 'server-room-hot', mono: true });
    expect(row('Condition')?.value).toBe('above 27 °C, 3 readings in a row');
    expect(row('Clears')?.value).toBe('below 25.5 °C');
    expect(row('Raised')?.value).toBe(formatClockTime(Date.parse(alert7.openedAt)));
  });

  it('shows the readings that raised the alert, not the ones after it', () => {
    expect(row('Readings')).toMatchObject({ value: '29.2 · 29.4 · 29.3', mono: true, warn: true });
  });

  it("measures the reaction time from the first breaching reading to ingest's opening, and says so", () => {
    expect(row('Reaction time')?.value).toBe('6 s');
    expect(raised.note).toBe(
      `Reaction time: first breaching reading (${formatClockTime(at('09:14:29'))}) to alert opened (${formatClockTime(Date.parse(alert7.openedAt))}), as Studio observed them.`,
    );
  });

  it('has no Cause row: which scenario ran is not known to Studio', () => {
    expect(raised.rows.some((r) => /cause/i.test(r.label))).toBe(false);
  });

  it('says nothing is raised when there is no alert, and shows the newest readings', () => {
    const none = ruleEvaluation({ rule: hot, alert: null, series: story });
    expect(none.status).toBe('not-raised');
    expect(none.rows.at(-1)).toEqual({ label: 'Raised', value: 'not raised' });
    expect(none.rows.find((r) => r.label === 'Readings')?.value).toBe('29.4 · 29.3 · 29.5');
    expect(none.note).toBeNull();
  });

  it('says there are no readings yet when the history is empty', () => {
    const none = ruleEvaluation({ rule: hot, alert: null, series: [] });
    expect(none.rows.find((r) => r.label === 'Readings')).toMatchObject({
      value: 'none yet',
      warn: false,
    });
  });

  it('adds when it cleared', () => {
    const cleared: ObservedAlert = {
      ...alert7,
      status: 'cleared',
      clearedAt: '2026-10-20T09:15:40.000Z',
      clearedValue: 22.5,
    };
    const result = ruleEvaluation({ rule: hot, alert: cleared, series: story });
    expect(result.status).toBe('cleared');
    expect(result.rows.map((r) => r.label)).toContain('Cleared');
  });

  it('gives no reaction time when the run starts at the oldest reading it holds', () => {
    // The history begins inside the breach: the first breaching reading may be older than what Studio kept.
    const truncated = story.slice(1);
    const result = ruleEvaluation({ rule: hot, alert: alert7, series: truncated });
    expect(result.rows.map((r) => r.label)).not.toContain('Reaction time');
    expect(result.note).toMatch(/not shown/);
  });

  it('gives no reaction time when too few breaching readings were seen before the alert', () => {
    const few = [sample('09:14:25', 22.4), sample('09:14:33', 29.3)];
    const result = ruleEvaluation({ rule: hot, alert: alert7, series: few });
    expect(result.rows.map((r) => r.label)).not.toContain('Reaction time');
  });

  it('gives no reaction time for an alert that was already there when Studio started', () => {
    const result = ruleEvaluation({
      rule: hot,
      alert: { ...alert7, preexisting: true },
      series: story,
    });
    expect(result.rows.map((r) => r.label)).not.toContain('Reaction time');
    expect(result.note).toMatch(/did not see/);
  });

  it('words a rule that raises below a line', () => {
    const low: RuleInfo = { ...hot, direction: 'below', raise: 10, clear: 12, for: 1 };
    const result = ruleEvaluation({ rule: low, alert: null, series: [] });
    expect(result.rows.find((r) => r.label === 'Condition')?.value).toBe(
      'below 10 °C, 1 reading in a row',
    );
    expect(result.rows.find((r) => r.label === 'Clears')?.value).toBe('above 12 °C');
  });
});

describe('stageChecks', () => {
  const checks = (
    change: (view: StateView) => void = () => {},
    lastAlertSink: string | null = null,
  ) => {
    const view = structuredClone(fixture);
    change(view);
    const result = stageChecks(view, lastAlertSink);
    return {
      ...result,
      by: Object.fromEntries(result.checks.map((c) => [c.id, c])) as Record<
        'broker' | 'ingest' | 'alertSink',
        (typeof result.checks)[number]
      >,
    };
  };

  it('is ok three times when everything answers, and says when ingest was last asked', () => {
    const { by, lastRunAt } = checks();
    expect(by.broker).toMatchObject({
      tone: 'ok',
      chip: 'OK',
      text: 'Connected to mqtt://localhost:1883 over MQTT 5',
    });
    expect(by.ingest).toMatchObject({ tone: 'ok', text: 'GET /api/ready answered: ready' });
    expect(by.alertSink).toMatchObject({
      tone: 'ok',
      text: 'Ingest reports alertSink: ops-command-center',
    });
    expect(lastRunAt).toBe(Date.parse(fixture.ingest.lastCheckedAt as string));
  });

  it('has no run time before ingest was ever asked', () => {
    expect(checks((view) => (view.ingest.lastCheckedAt = null)).lastRunAt).toBeNull();
  });

  it('says what failed when ingest is unreachable, and that the sink is only last known', () => {
    const { by } = checks((view) => {
      view.ingest.status = 'unreachable';
      view.ingest.alertSink = null;
      view.ingest.detail = 'ECONNREFUSED';
    }, 'none');
    expect(by.ingest).toMatchObject({
      tone: 'bad',
      chip: 'Down',
      text: 'GET /api/ready failed: ECONNREFUSED',
    });
    expect(by.alertSink).toMatchObject({
      tone: 'warn',
      text: 'Unknown while ingest is down. Last known: none',
    });
    expect(by.broker.tone).toBe('ok');
  });

  it('names the dependency that is down when ingest is not ready', () => {
    const { by } = checks((view) => {
      view.ingest.status = 'not-ready';
      view.ingest.database = 'down';
    });
    expect(by.ingest).toMatchObject({ tone: 'warn', chip: 'Check' });
    expect(by.ingest.text).toMatch(/the database down for ingest/);
  });

  it('warns when ingest has no alert sink', () => {
    const { by } = checks((view) => (view.ingest.alertSink = 'none'));
    expect(by.alertSink).toMatchObject({ tone: 'warn', chip: 'Check' });
    expect(by.alertSink.text).toMatch(/alertSink: none/);
  });

  it('is red for a broker that is not connected, with its URL', () => {
    const { by } = checks((view) => (view.broker.connected = false));
    expect(by.broker).toMatchObject({ tone: 'bad', chip: 'Down' });
    expect(by.broker.text).toMatch(/mqtt:\/\/localhost:1883/);
  });

  it('is unknown, not ok, before ingest has answered and when no sink was ever reported', () => {
    const { by } = checks((view) => {
      view.ingest.status = 'unknown';
      view.ingest.alertSink = null;
    });
    expect(by.ingest).toMatchObject({ tone: 'unknown', chip: 'Checking' });
    expect(by.alertSink).toMatchObject({ tone: 'unknown', chip: 'Unknown' });
  });
});

describe('rows: primaryReading and zoneSummary', () => {
  const NOW = at('09:14:32');
  const series = (deviceId: string, metric: string): Sample[] =>
    deviceId === 'dc-env-01' && metric === 'temperature_c' ? [sample('09:14:30', 29.3)] : [];
  const rows: FleetRow[] = buildFleetRows({
    view: structuredClone(fixture),
    now: NOW,
    seriesOf: series,
    lastSeenOf: () => null,
  });
  const byId = (id: string) => rows.find((r) => r.device.id === id) as FleetRow;

  it('reads the first metric that has a value, with its unit', () => {
    expect(primaryReading(byId('dc-env-01'))).toEqual({ metric: 'temperature_c', text: '29.3 °C' });
  });

  it('has no reading for a device that was not heard from', () => {
    expect(primaryReading(byId('lib-air-01'))).toBeNull();
  });

  it('summarises a zone with its worst state and its devices, problems first', () => {
    const zone = zoneSummary(rows, 'BLD-DC');
    expect(zone).toMatchObject({ zone: 'BLD-DC', count: 2, worst: 'anomaly' });
    expect(zone?.members.map((m) => m.id)).toEqual(['dc-env-01', 'dc-env-02']);
    expect(zone?.members[0]).toMatchObject({
      word: 'Anomaly',
      state: 'anomaly',
      reading: '29.3 °C',
    });
    expect(zone?.members[1]).toMatchObject({ word: 'Running', state: 'healthy', reading: null });
  });

  it('counts a paused device as paused or silent, not healthy', () => {
    expect(zoneSummary(rows, 'BLD-HUB')).toMatchObject({ count: 1, worst: 'stale' });
  });

  it('has no summary for a zone with no device', () => {
    expect(zoneSummary(rows, 'BLD-NOPE')).toBeNull();
  });
});

describe('consoleHref', () => {
  it('is the console as a link when it is an http or https URL', () => {
    expect(consoleHref('https://occ.example.test/')).toBe('https://occ.example.test/');
    expect(consoleHref('http://localhost:5173')).toBe('http://localhost:5173/');
  });

  it('is nothing when none is set', () => {
    expect(consoleHref(null)).toBeNull();
  });

  it('never lets another scheme reach an href', () => {
    expect(consoleHref('javascript:alert(1)')).toBeNull();
    expect(consoleHref('data:text/html,<b>x</b>')).toBeNull();
    expect(consoleHref('ftp://occ.example.test')).toBeNull();
  });

  it('is nothing for text that is not a URL', () => {
    expect(consoleHref('not a url')).toBeNull();
    expect(consoleHref('')).toBeNull();
  });
});

describe('alertsFor and evaluationTarget', () => {
  // #7 is dc-env-01's (open), #6 is lha-air-01's (cleared, the older one); the list is newest first
  const view = (): StateView => {
    const copy = structuredClone(fixture);
    copy.alerts.alerts = [
      alert7,
      {
        ...alert7,
        id: '6',
        deviceId: 'lha-air-01',
        ruleId: 'indoor-co2',
        metric: 'co2_ppm',
        status: 'cleared',
        clearedAt: '2026-10-20T09:08:36.000Z',
        title: 'Poor air quality (CO₂)',
      },
    ];
    return copy;
  };

  it('are the alerts of a device, of the devices of a zone, or all of them', () => {
    const v = view();
    expect(alertsFor(v, { type: 'device', id: 'lha-air-01' }).map((a) => a.id)).toEqual(['6']);
    expect(alertsFor(v, { type: 'zone', id: 'BLD-DC' }).map((a) => a.id)).toEqual(['7']);
    expect(alertsFor(v, { type: 'zone', id: 'BLD-LHA' }).map((a) => a.id)).toEqual(['6']);
    expect(alertsFor(v, { type: 'stage', id: 'alert' }).map((a) => a.id)).toEqual(['7', '6']);
    expect(alertsFor(v, null).map((a) => a.id)).toEqual(['7', '6']);
  });

  it('are nothing for a zone or a device with no alert', () => {
    expect(alertsFor(view(), { type: 'zone', id: 'BLD-HUB' })).toEqual([]);
    expect(alertsFor(view(), { type: 'device', id: 'nobody' })).toEqual([]);
  });

  it('target, for a device, the rule that raised its alert', () => {
    const target = evaluationTarget(view(), { type: 'device', id: 'dc-env-01' });
    expect(target).toMatchObject({ deviceId: 'dc-env-01', rule: { id: 'server-room-hot' } });
    expect(target?.alert?.id).toBe('7');
  });

  it('target, for a device with no alert, its first rule and no alert', () => {
    const target = evaluationTarget(view(), { type: 'device', id: 'dc-env-02' });
    expect(target).toMatchObject({
      deviceId: 'dc-env-02',
      rule: { id: 'server-room-hot' },
      alert: null,
    });
  });

  it('target nothing for a device no rule watches', () => {
    const v = view();
    v.rules = { available: true, reason: null, items: [] };
    expect(evaluationTarget(v, { type: 'device', id: 'dc-env-01' })).toBeNull();
  });

  it('target nothing when the rules are not available', () => {
    const v = view();
    v.rules = { available: false, reason: 'no rules file was given', items: [] };
    expect(evaluationTarget(v, { type: 'device', id: 'dc-env-01' })).toBeNull();
    expect(evaluationTarget(v, { type: 'stage', id: 'rules' })).toBeNull();
  });

  it('target, for a stage, a zone or nothing, the newest alert of what is selected and its rule', () => {
    const v = view();
    expect(evaluationTarget(v, { type: 'stage', id: 'alert' })).toMatchObject({
      deviceId: 'dc-env-01',
      rule: { id: 'server-room-hot' },
    });
    expect(evaluationTarget(v, { type: 'zone', id: 'BLD-LHA' })).toMatchObject({
      deviceId: 'lha-air-01',
      rule: { id: 'indoor-co2' },
    });
    expect(evaluationTarget(v, null)?.alert?.id).toBe('7');
  });

  it('target nothing, for a stage or a zone, when no alert was raised', () => {
    const v = view();
    v.alerts.alerts = [];
    expect(evaluationTarget(v, { type: 'stage', id: 'rules' })).toBeNull();
    expect(evaluationTarget(v, { type: 'zone', id: 'BLD-DC' })).toBeNull();
  });

  it('target nothing for a device that is not registered', () => {
    expect(evaluationTarget(view(), { type: 'device', id: 'nobody' })).toBeNull();
  });
});
