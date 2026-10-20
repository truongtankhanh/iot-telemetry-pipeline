import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { StateView } from '../api/types';
import type { Sample } from '../state/history';
import { buildFleetRows } from './fleetRows';

const NOW = Date.parse('2026-10-20T09:15:00.000Z');

const viewWith = (change: (view: StateView) => void = () => {}): StateView => {
  const view = structuredClone(fixture);
  change(view);
  return view;
};

/** Series for chosen devices and metrics; everything else is empty. */
const seriesFrom =
  (data: Record<string, number[]>) =>
  (deviceId: string, metric: string): readonly Sample[] =>
    (data[`${deviceId}/${metric}`] ?? []).map((v, i, all) => ({
      t: NOW - (all.length - 1 - i) * 2000,
      v,
    }));

const rowsOf = (
  view: StateView,
  data: Record<string, number[]> = {},
  lastSeen: Record<string, number | null> = {},
) =>
  buildFleetRows({
    view,
    now: NOW,
    seriesOf: seriesFrom(data),
    lastSeenOf: (id) => lastSeen[id] ?? null,
  });

describe('buildFleetRows', () => {
  it('has a row per device, in the registry order, with its name and short code', () => {
    const rows = rowsOf(viewWith());
    expect(rows.map((r) => r.device.id)).toEqual(fixture.devices.map((d) => d.id));
    expect(rows[0]).toMatchObject({ name: 'Data center — row A', code: 'DC·1' });
    expect(rows[5]).toMatchObject({ name: 'Innovation Hub main feed', code: 'HUB' });
  });

  it('falls back to the id when the registry gives no name', () => {
    const view = viewWith((v) => void delete v.devices[0]!.name);
    expect(rowsOf(view)[0]?.name).toBe('dc-env-01');
  });

  it('reads the newest value of each metric, null for one with no readings', () => {
    const rows = rowsOf(viewWith(), { 'dc-env-01/temperature_c': [22.1, 22.4, 29.3] });
    expect(rows[0]?.readings).toEqual([
      { metric: 'temperature_c', value: 29.3 },
      { metric: 'humidity_pct', value: null },
    ]);
  });

  it('judges the state from the newest values: a value beyond the raise line is an anomaly', () => {
    const rows = rowsOf(
      viewWith(),
      { 'dc-env-01/temperature_c': [22.4, 29.3] },
      { 'dc-env-01': NOW - 1000 },
    );
    expect(rows[0]?.status).toMatchObject({ kind: 'anomaly' });
    expect(rows[0]?.status.reason).toBe('temperature_c 29.3 °C, above 27');
  });

  it('takes paused and stopped from the engine, with the time the device was last heard from', () => {
    const view = viewWith((v) => {
      v.engine.devices[4]!.state = 'paused';
      v.engine.devices[5]!.state = 'stopped';
    });
    const rows = rowsOf(view, {}, { 'stu-air-01': NOW - 40_000, 'hub-power-01': NOW - 200_000 });
    expect(rows[4]?.status).toMatchObject({ kind: 'paused', since: NOW - 40_000 });
    expect(rows[5]?.status).toMatchObject({ kind: 'stopped', since: NOW - 200_000 });
  });

  it('calls a running device that has said nothing for a while silent', () => {
    const rows = rowsOf(viewWith(), {}, { 'dc-env-01': NOW - 30_000 });
    expect(rows[0]?.status.kind).toBe('silent');
    expect(rows[0]?.lastSeen).toBe(NOW - 30_000);
  });

  it('does not call a device silent that was never heard from since the page opened', () => {
    expect(rowsOf(viewWith())[0]?.status.kind).toBe('running');
  });

  it('is empty for a registry with no devices', () => {
    const view = viewWith((v) => {
      v.devices = [];
      v.engine.devices = [];
    });
    expect(rowsOf(view)).toEqual([]);
  });

  it('treats a device the engine does not know as stopped', () => {
    const view = viewWith((v) => void (v.engine.devices = []));
    expect(rowsOf(view)[0]?.status.kind).toBe('stopped');
  });
});
