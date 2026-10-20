import { describe, expect, it } from 'vitest';
import { type DeviceStatusKind, STATUS_WORDS } from './deviceStatus';
import {
  deviceTopologyState,
  TOPOLOGY_TONES,
  TOPOLOGY_WORDS,
  type TopologyState,
  worstOf,
} from './topologyState';

describe('worstOf', () => {
  it('orders down, anomaly, paused or silent, healthy', () => {
    expect(worstOf(['healthy', 'stale', 'anomaly', 'down'])).toBe('down');
    expect(worstOf(['healthy', 'stale', 'anomaly'])).toBe('anomaly');
    expect(worstOf(['healthy', 'stale'])).toBe('stale');
    expect(worstOf(['healthy', 'healthy'])).toBe('healthy');
  });

  it('does not depend on the order it is given', () => {
    expect(worstOf(['down', 'healthy'])).toBe('down');
    expect(worstOf(['healthy', 'down'])).toBe('down');
  });

  it('has no worst state for nothing', () => {
    expect(worstOf([])).toBeNull();
  });

  it('takes any iterable', () => {
    expect(worstOf(new Set<TopologyState>(['stale', 'anomaly']))).toBe('anomaly');
  });
});

describe('deviceTopologyState', () => {
  it('draws a running device healthy and an anomaly as an anomaly', () => {
    expect(deviceTopologyState('running')).toBe('healthy');
    expect(deviceTopologyState('anomaly')).toBe('anomaly');
  });

  it('draws paused, stopped and silent the same, dark and dashed', () => {
    expect(deviceTopologyState('paused')).toBe('stale');
    expect(deviceTopologyState('stopped')).toBe('stale');
    expect(deviceTopologyState('silent')).toBe('stale');
  });

  it('covers every status kind of the Fleet', () => {
    const kinds = Object.keys(STATUS_WORDS) as DeviceStatusKind[];
    for (const kind of kinds) expect(deviceTopologyState(kind)).toBeDefined();
  });
});

describe('TOPOLOGY_WORDS', () => {
  it('has a word for every look, so a state is never colour alone', () => {
    expect(Object.values(TOPOLOGY_WORDS).every((word) => word.length > 0)).toBe(true);
    expect(TOPOLOGY_WORDS.stale).toBe('Paused or silent');
  });
});

describe('TOPOLOGY_TONES', () => {
  it('gives every look its own icon tone, so no two states share one', () => {
    const tones = Object.values(TOPOLOGY_TONES);
    expect(new Set(tones).size).toBe(tones.length);
    expect(TOPOLOGY_TONES.stale).toBe('unknown');
  });
});
