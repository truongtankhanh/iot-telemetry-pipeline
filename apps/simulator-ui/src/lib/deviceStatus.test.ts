import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { EngineSnapshot, RulesView } from '../api/types';
import { deviceStatus, type DeviceStatusInput, STATUS_ORDER, STATUS_WORDS } from './deviceStatus';

const NOW = Date.parse('2026-10-20T09:14:32.000Z');
const dc = fixture.devices[0]!; // dc-env-01, server_room
const air = fixture.devices[2]!; // lib-air-01, indoor_air

const engineDevice = (
  state: 'running' | 'paused' | 'stopped',
  intervalMs = 2000,
): EngineSnapshot['devices'][number] => ({ id: 'x', state, intervalMs, seq: 1, holds: {} });

const input = (change: Partial<DeviceStatusInput> = {}): DeviceStatusInput => ({
  device: dc,
  engineDevice: engineDevice('running'),
  engine: { anomalies: [], elapsedS: 100 },
  rules: fixture.rules,
  latest: { temperature_c: 22.4, humidity_pct: 45 },
  lastSeen: NOW - 1000,
  now: NOW,
  ...change,
});

describe('deviceStatus', () => {
  it('is running and healthy when it publishes and is under every raise line', () => {
    expect(deviceStatus(input())).toEqual({
      kind: 'running',
      node: 'healthy',
      word: 'Running',
      since: null,
      reason: null,
    });
  });

  it('is an anomaly when the latest value is beyond a raise line, and says which', () => {
    const status = deviceStatus(input({ latest: { temperature_c: 29.3, humidity_pct: 45 } }));
    expect(status).toMatchObject({ kind: 'anomaly', node: 'anomaly', word: 'Anomaly' });
    expect(status.reason).toBe('temperature_c 29.3 °C, above 27');
  });

  it('is not an anomaly on the raise line itself', () => {
    expect(deviceStatus(input({ latest: { temperature_c: 27 } })).kind).toBe('running');
  });

  it('judges each metric by its own rules', () => {
    const status = deviceStatus(
      input({ device: air, latest: { co2_ppm: 1450, temperature_c: 99, humidity_pct: 10 } }),
    );
    expect(status.reason).toBe('co2_ppm 1450 ppm, above 1200');
  });

  it('is paused or stopped as the engine says, with the time it was last heard from', () => {
    expect(deviceStatus(input({ engineDevice: engineDevice('paused') }))).toEqual({
      kind: 'paused',
      node: 'paused',
      word: 'Paused',
      since: NOW - 1000,
      reason: null,
    });
    expect(
      deviceStatus(input({ engineDevice: engineDevice('stopped'), lastSeen: null })),
    ).toMatchObject({
      kind: 'stopped',
      node: 'paused',
      word: 'Stopped',
      since: null,
    });
  });

  it('keeps paused above an anomaly: a paused device is not publishing the breach', () => {
    const status = deviceStatus(
      input({ engineDevice: engineDevice('paused'), latest: { temperature_c: 40 } }),
    );
    expect(status.kind).toBe('paused');
  });

  it('counts a device the engine does not know as stopped', () => {
    expect(deviceStatus(input({ engineDevice: undefined })).kind).toBe('stopped');
  });

  describe('silent', () => {
    it('is a running device that has said nothing for three intervals', () => {
      const status = deviceStatus(input({ lastSeen: NOW - 6001 }));
      expect(status).toMatchObject({
        kind: 'silent',
        node: 'down',
        word: 'Silent',
        since: NOW - 6001,
      });
    });

    it('is not silent up to three intervals (6 s at 2 s)', () => {
      expect(deviceStatus(input({ lastSeen: NOW - 6000 })).kind).toBe('running');
    });

    it('allows at least five seconds, however short the interval', () => {
      const fast = engineDevice('running', 100);
      expect(deviceStatus(input({ engineDevice: fast, lastSeen: NOW - 4999 })).kind).toBe(
        'running',
      );
      expect(deviceStatus(input({ engineDevice: fast, lastSeen: NOW - 5001 })).kind).toBe('silent');
    });

    it('waits longer for a slow device', () => {
      const slow = engineDevice('running', 10_000);
      expect(deviceStatus(input({ engineDevice: slow, lastSeen: NOW - 29_000 })).kind).toBe(
        'running',
      );
      expect(deviceStatus(input({ engineDevice: slow, lastSeen: NOW - 31_000 })).kind).toBe(
        'silent',
      );
    });

    it('is not called for a device never heard from since the page opened', () => {
      expect(deviceStatus(input({ lastSeen: null, latest: {} })).kind).toBe('running');
    });

    it('wins over an anomaly: the last value is old, not current', () => {
      const status = deviceStatus(input({ lastSeen: NOW - 60_000, latest: { temperature_c: 40 } }));
      expect(status.kind).toBe('silent');
    });
  });

  describe('without rules', () => {
    const none: RulesView = { available: false, reason: 'cannot read', items: [] };
    const anomaly = (startAt: number, duration: number) => ({
      id: '1',
      anomaly: {
        deviceId: 'dc-env-01',
        metric: 'temperature_c' as const,
        value: 29.2,
        startAt,
        duration,
      },
    });

    it('is an anomaly while the engine plays one on the device', () => {
      const status = deviceStatus(
        input({
          rules: none,
          latest: { temperature_c: 29 },
          engine: { anomalies: [anomaly(20, 60)], elapsedS: 30 },
        }),
      );
      expect(status).toMatchObject({ kind: 'anomaly' });
      expect(status.reason).toBe('temperature_c is being driven to 29.2');
    });

    it('is healthy before it starts and after it ends, and for another device', () => {
      const at = (elapsedS: number) =>
        deviceStatus(input({ rules: none, engine: { anomalies: [anomaly(20, 60)], elapsedS } }))
          .kind;
      expect(at(10)).toBe('running');
      expect(at(80)).toBe('running');
      const other = deviceStatus(
        input({ rules: none, device: air, engine: { anomalies: [anomaly(20, 60)], elapsedS: 30 } }),
      );
      expect(other.kind).toBe('running');
    });

    it('does not use the engine anomalies when rules are available (the values decide)', () => {
      const status = deviceStatus(
        input({ engine: { anomalies: [anomaly(20, 60)], elapsedS: 30 } }),
      );
      expect(status.kind).toBe('running');
    });
  });
});

describe('the order and the words', () => {
  it('lists every state once, problems first, and has a word for each', () => {
    expect(STATUS_ORDER).toEqual(['anomaly', 'silent', 'paused', 'stopped', 'running']);
    expect(Object.keys(STATUS_WORDS).sort()).toEqual([...STATUS_ORDER].sort());
  });
});
