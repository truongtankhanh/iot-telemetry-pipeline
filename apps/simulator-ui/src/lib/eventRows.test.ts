import { describe, expect, it } from 'vitest';
import observationsFixture from '../api/fixtures/observations.json';
import type { ObservationEvent } from '../api/types';
import {
  EVENT_SOURCES,
  eventRow,
  eventRows,
  type EventRow,
  matchesFilter,
  parseFilter,
  rangeWindow,
  selectEvents,
} from './eventRows';

const NOW = Date.parse('2026-10-20T09:00:00.000Z');
const fixture = observationsFixture as unknown as ObservationEvent[];
const byKind = (kind: string) => eventRow(fixture.find((e) => e.kind === kind) as ObservationEvent);
const event = (
  kind: string,
  data: Record<string, unknown>,
  id = 1,
  at = '2026-10-20T08:30:00.000Z',
): ObservationEvent => ({ id, at, kind: kind as ObservationEvent['kind'], data });
const field = (row: EventRow, label: string) => row.fields.find((f) => f.label === label)?.value;

describe('a row for each kind of observation', () => {
  it('names the device that paused, as the frame does (Fleet)', () => {
    const row = byKind('engine-state');
    expect(row).toMatchObject({ source: 'Fleet', glyph: 'fleet', message: 'stu-air-01 paused' });
    expect(row.parts[0]).toEqual({ text: 'stu-air-01', strong: true });
    expect(row.devices).toEqual(['stu-air-01']);
  });

  it('says a running device started, and what a hold and an interval did', () => {
    expect(
      eventRow(event('engine-state', { type: 'device-state', deviceId: 'a', state: 'running' }))
        .message,
    ).toBe('a started');
    expect(
      eventRow(event('engine-state', { type: 'device-state', deviceId: 'a', state: 'stopped' }))
        .message,
    ).toBe('a stopped');
    expect(
      eventRow(
        event('engine-state', {
          type: 'hold-set',
          deviceId: 'a',
          metric: 'temperature_c',
          value: 22,
        }),
      ).message,
    ).toBe('a holds temperature_c at 22');
    expect(
      eventRow(
        event('engine-state', { type: 'hold-released', deviceId: 'a', metric: 'temperature_c' }),
      ).message,
    ).toBe('a released temperature_c');
    expect(
      eventRow(event('engine-state', { type: 'device-interval', deviceId: 'a', intervalMs: 500 }))
        .message,
    ).toBe('a publishes every 500 ms');
    expect(
      eventRow(event('engine-state', { type: 'device-interval', deviceId: 'a' })).message,
    ).toBe('a publishes at the engine’s interval again');
  });

  it('puts what the engine did to its anomalies under the Engine', () => {
    const added = eventRow(
      event('engine-state', {
        type: 'anomaly-added',
        id: 'a1',
        anomaly: { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2 },
      }),
    );
    expect(added).toMatchObject({
      source: 'Engine',
      message: 'Anomaly a1 added: dc-env-01 → 29.2',
    });
    expect(added.devices).toEqual(['dc-env-01']);
    expect(eventRow(event('engine-state', { type: 'anomaly-removed', id: 'a1' })).message).toBe(
      'Anomaly a1 removed',
    );
    expect(eventRow(event('engine-state', { type: 'reset' })).source).toBe('Engine');
    expect(eventRow(event('engine-state', { type: 'something-new' })).message).toBe(
      'The engine changed (something-new)',
    );
  });

  it('says what the Faults page set, as the Engine: each fault with its settings, and off', () => {
    const row = (data: Record<string, unknown>) => eventRow(event('engine-state', data));
    expect(row({ type: 'fault-set', kind: 'drop', config: { percent: 5 } })).toMatchObject({
      source: 'Engine',
      glyph: 'engine',
      message: 'Drop messages set to 5 %',
    });
    expect(row({ type: 'fault-set', kind: 'duplicate', config: { percent: 0.5 } }).message).toBe(
      'Duplicate messages set to 0.5 %',
    );
    expect(
      row({
        type: 'fault-set',
        kind: 'malformed',
        config: { percent: 3, kinds: ['range', 'json'] },
      }).message,
    ).toBe('Malformed payloads set to 3 % (range, json)');
    expect(
      row({ type: 'fault-set', kind: 'delay', config: { delayMs: 500, jitterMs: 100 } }).message,
    ).toBe('Delay and jitter set to 500 ms, give or take 100 ms');
    expect(
      row({ type: 'fault-set', kind: 'delay', config: { delayMs: 500, jitterMs: 0 } }).message,
    ).toBe('Delay and jitter set to 500 ms');
    expect(row({ type: 'fault-set', kind: 'reorder', config: { window: 4 } }).message).toBe(
      'Out-of-order delivery set to windows of 4',
    );
    expect(row({ type: 'fault-cleared', kind: 'drop' }).message).toBe('Drop messages off');
    expect(field(row({ type: 'fault-set', kind: 'drop', config: { percent: 5 } }), 'Fault')).toBe(
      'drop',
    );
  });

  it('says what the scope is, and that every fault is cleared', () => {
    const selected = eventRow(
      event('engine-state', {
        type: 'fault-scope',
        scope: { mode: 'selected', deviceIds: ['dc-env-01', 'lib-air-01'] },
      }),
    );
    expect(selected.message).toBe('Faults now apply to 2 selected devices');
    expect(selected.devices).toEqual(['dc-env-01', 'lib-air-01']);
    expect(
      eventRow(event('engine-state', { type: 'fault-scope', scope: { mode: 'running' } })).message,
    ).toBe('Faults now apply to every running device');
    expect(eventRow(event('engine-state', { type: 'faults-cleared' })).message).toBe(
      'All faults cleared: held messages sent, the link restored',
    );
  });

  it('says a burst, with how many went and how many did not, and names its devices', () => {
    const ok = eventRow(
      event('engine-state', {
        type: 'burst',
        count: 1000,
        sent: 1000,
        failed: 0,
        deviceIds: ['dc-env-01', 'dc-env-02'],
      }),
    );
    expect(ok.message).toBe('Burst of 1,000 messages to 2 devices');
    expect(ok.devices).toEqual(['dc-env-01', 'dc-env-02']);
    const failed = eventRow(
      event('engine-state', { type: 'burst', count: 1000, sent: 997, failed: 3, deviceIds: ['a'] }),
    );
    expect(failed.message).toBe('Burst of 997 messages to 1 device, 3 failed');
    expect(field(failed, 'Failed')).toBe('3');
  });

  it('says the link was cut, and how it came back', () => {
    const row = (data: Record<string, unknown>) => eventRow(event('engine-state', data));
    expect(row({ type: 'link-lost', forS: null }).message).toBe(
      'Link loss: the simulator cut its connection to the broker',
    );
    expect(row({ type: 'link-lost', forS: 30 }).message).toBe(
      'Link loss: the simulator cut its connection to the broker, to restore itself after 30 s',
    );
    expect(row({ type: 'link-restored', reason: 'timer' }).message).toBe(
      'Link loss over: the connection to the broker was restored by its timer',
    );
    expect(row({ type: 'link-restored', reason: 'command' }).message).toMatch(/by hand$/);
    expect(row({ type: 'link-restored', reason: 'clear' }).message).toMatch(/by Clear all faults$/);
  });

  it('copes with a fault event that lacks its keys', () => {
    expect(eventRow(event('engine-state', { type: 'fault-set' })).message).toBe('A fault on');
    expect(eventRow(event('engine-state', { type: 'fault-scope' })).message).toBe(
      'Faults now apply to every running device',
    );
    expect(eventRow(event('engine-state', { type: 'burst' })).message).toMatch(
      /^Burst of 0 messages/,
    );
  });

  it('says a scenario started, with the devices it started and the runs it replaced', () => {
    const row = byKind('scenario-run');
    expect(row).toMatchObject({
      source: 'Scenario',
      message: 'server-room-overheat started',
      scenarios: ['server-room-overheat'],
      devices: ['dc-env-01'],
    });
    const more = eventRow(
      event('scenario-run', {
        name: 'bad-afternoon',
        startedDevices: ['hub-power-01'],
        replaced: [{ runId: 'r1' }, { runId: 'r2' }],
        anomalies: [],
      }),
    );
    expect(more.message).toBe('bad-afternoon started, and started hub-power-01, replacing 2 runs');
  });

  it('says a scenario stopped, or was replaced', () => {
    expect(byKind('scenario-stop').message).toBe('server-room-overheat stopped');
    expect(eventRow(event('scenario-stop', { name: 'x', reason: 'replaced' })).message).toBe(
      'x was replaced by another run',
    );
  });

  it('says an alert opened with its severity, and names its rule, device and number', () => {
    const row = byKind('alert-opened');
    expect(row).toMatchObject({
      source: 'Alert',
      message: '#7 opened · high',
      rules: ['server-room-hot'],
      devices: ['dc-env-01'],
      alerts: ['7'],
    });
    expect(field(row, 'Alert')).toBe('#7');
    expect(field(row, 'Title')).toBe('Server room temperature high');
    expect(byKind('alert-cleared').message).toBe('#7 cleared');
  });

  it('says a delivery as the frame does (Outbox) and an incident (Command Center)', () => {
    expect(byKind('delivery')).toMatchObject({
      source: 'Outbox',
      message: 'Event opened delivered',
    });
    expect(byKind('delivery').parts[1]).toEqual({ text: 'opened', strong: true });
    expect(byKind('incident')).toMatchObject({
      source: 'Command Center',
      message: 'Incident created for alert #7',
    });
    expect(field(byKind('incident'), 'Incident')).toBe('c3a1f0d2-5b7e-4c1a-9e0f-2d6a8b4c7e11');
  });

  it('says a dependency changed, and a tick failed', () => {
    expect(byKind('dependency')).toMatchObject({
      source: 'Ingest',
      message: 'ingest unreachable → ready',
    });
    expect(byKind('tick-error')).toMatchObject({
      source: 'Engine',
      message: 'A tick failed: Publish failed: connection closed',
    });
  });

  it('gives a kind it does not know a row of its own instead of failing', () => {
    const row = eventRow(event('something-new', { a: 1 }));
    expect(row).toMatchObject({
      source: 'Other',
      glyph: 'other',
      message: 'something-new happened',
    });
  });

  it('copes with a missing key and with a time that is not one', () => {
    const row = eventRow(event('alert-opened', {}, 3, 'not a time'));
    expect(row.message).toBe('#? opened');
    expect(row.at).toBe(0);
    expect(row.fields.map((f) => f.label)).toEqual(['Source']);
    expect(eventRow(event('delivery', {})).message).toBe('Event update changed');
  });

  it('lists the fields of the expanded row: the source first, the time Studio saw it last', () => {
    const row = byKind('alert-opened');
    expect(row.fields[0]).toEqual({ label: 'Source', value: 'Alert', mono: false });
    expect(row.fields.at(-1)).toMatchObject({ label: 'Seen by Studio', mono: true });
    expect(row.fields.map((f) => f.label)).toEqual([
      'Source',
      'Alert',
      'Title',
      'Rule',
      'Device',
      'Metric',
      'Seen by Studio',
    ]);
  });

  it('has a source and a glyph for every kind of the fixture, and the sources are the select’s', () => {
    for (const row of eventRows(fixture)) {
      expect(EVENT_SOURCES).toContain(row.source);
      expect(row.glyph).toBeTruthy();
      expect(row.message).not.toBe('');
    }
    expect(eventRows(fixture).map((r) => r.id)).toEqual(fixture.map((e) => e.id));
  });
});

describe('the filter field', () => {
  const rows = eventRows(fixture);
  const matching = (q: string) =>
    rows.filter((r) => matchesFilter(r, parseFilter(q))).map((r) => r.id);

  it('reads words and key:value terms, and ignores extra spaces', () => {
    expect(parseFilter('  source:Rule   device:dc-env-01  hot ')).toEqual({
      terms: [
        { key: 'source', value: 'rule' },
        { key: 'device', value: 'dc-env-01' },
        { key: null, value: 'hot' },
      ],
      unknownKeys: [],
    });
    expect(parseFilter('').terms).toEqual([]);
  });

  it('matches everything when empty', () => {
    expect(matching('')).toHaveLength(rows.length);
  });

  it('matches a source by prefix, whatever the case', () => {
    expect(matching('source:alert')).toEqual([8, 3]);
    expect(matching('source:Command')).toEqual([5]);
    expect(matching('source:center')).toEqual([5]);
    expect(matching('source:nothing')).toEqual([]);
  });

  it('matches the device, rule, alert and scenario an event names', () => {
    expect(matching('device:dc-env')).toEqual([8, 3, 2]);
    expect(matching('rule:server')).toEqual([8, 3]);
    expect(matching('alert:7')).toEqual([8, 5, 4, 3]);
    expect(matching('alert:#7')).toEqual([8, 5, 4, 3]);
    expect(matching('scenario:server-room')).toEqual([7, 2]);
  });

  it('matches a word in the message, and needs every term to match', () => {
    expect(matching('paused')).toEqual([1]);
    expect(matching('opened device:dc-env-01')).toEqual([3]);
    expect(matching('opened device:lib-air-01')).toEqual([]);
  });

  it('searches an unknown key as the text it is, and says which key it was', () => {
    const parsed = parseFilter('foo:bar source:alert http://x');
    expect(parsed.unknownKeys).toEqual(['foo', 'http']);
    expect(parsed.terms[0]).toEqual({ key: null, value: 'foo:bar' });
    expect(parseFilter('device:').terms).toEqual([{ key: null, value: 'device:' }]);
  });
});

describe('the range', () => {
  it('is the last 5 minutes, 30 minutes, hour, 3 hours or 12 hours up to now', () => {
    expect(rangeWindow('5m', { from: null, to: null }, NOW)).toEqual({
      from: NOW - 300_000,
      to: NOW,
    });
    expect(rangeWindow('12h', { from: null, to: null }, NOW).from).toBe(NOW - 12 * 3_600_000);
  });

  it('is the two bounds for a custom range, and the hour if one is missing', () => {
    expect(rangeWindow('custom', { from: NOW - 5000, to: NOW - 1000 }, NOW)).toEqual({
      from: NOW - 5000,
      to: NOW - 1000,
    });
    expect(rangeWindow('custom', { from: null, to: null }, NOW).from).toBe(NOW - 3_600_000);
  });
});

describe('selecting the events to show', () => {
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
  const all = eventRows([
    event('alert-opened', { alertId: '9', deviceId: 'a', ruleId: 'r' }, 5, at(1)),
    event('delivery', { alertId: '9', phase: 'opened', status: 'delivered' }, 4, at(10)),
    event('engine-state', { type: 'device-state', deviceId: 'a', state: 'paused' }, 3, at(40)),
    event('alert-cleared', { alertId: '8' }, 2, at(100)),
    event('alert-opened', { alertId: '8' }, 1, at(400)),
  ]);
  const ids = (selection: Partial<Parameters<typeof selectEvents>[1]>) =>
    selectEvents(
      all,
      { range: '1h', from: null, to: null, q: '', source: 'all', ...selection },
      NOW,
    ).rows.map((r) => r.id);

  it('keeps the events inside the range, newest first', () => {
    expect(ids({})).toEqual([5, 4, 3]);
    expect(ids({ range: '5m' })).toEqual([5]);
    expect(ids({ range: '3h' })).toEqual([5, 4, 3, 2]);
    expect(ids({ range: '12h' })).toEqual([5, 4, 3, 2, 1]);
  });

  it('keeps the events of a custom window, both ends included', () => {
    const window = { range: 'custom' as const, from: NOW - 40 * 60_000, to: NOW - 10 * 60_000 };
    expect(ids(window)).toEqual([4, 3]);
  });

  it('keeps the events of one source, and those that pass the filter', () => {
    expect(ids({ range: '12h', source: 'Alert' })).toEqual([5, 2, 1]);
    expect(ids({ range: '12h', q: 'alert:9' })).toEqual([5, 4]);
    expect(ids({ range: '12h', source: 'Alert', q: 'alert:9' })).toEqual([5]);
  });

  it('returns the window and the parsed filter it used', () => {
    const result = selectEvents(
      all,
      { range: '1h', from: null, to: null, q: 'device:a', source: 'all' },
      NOW,
    );
    expect(result.window).toEqual({ from: NOW - 3_600_000, to: NOW });
    expect(result.filter.terms).toEqual([{ key: 'device', value: 'a' }]);
  });
});
