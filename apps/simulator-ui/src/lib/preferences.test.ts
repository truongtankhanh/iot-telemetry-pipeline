import { describe, expect, it } from 'vitest';
import { readRailPinned, writeRailPinned } from './preferences';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const broken = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

describe('the pinned rail', () => {
  it('is unpinned when nothing was stored', () => {
    expect(readRailPinned(memory())).toBe(false);
  });

  it('is remembered', () => {
    const storage = memory();
    writeRailPinned(true, storage);
    expect(storage.data.get('studio.railPinned')).toBe('true');
    expect(readRailPinned(storage)).toBe(true);

    writeRailPinned(false, storage);
    expect(readRailPinned(storage)).toBe(false);
  });

  it('reads anything but "true" as unpinned', () => {
    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      expect(readRailPinned(memory({ 'studio.railPinned': value }))).toBe(false);
    }
  });

  it('copes with storage that throws on a read and on a write', () => {
    expect(readRailPinned(broken)).toBe(false);
    expect(() => writeRailPinned(true, broken)).not.toThrow();
  });

  it('copes with no storage at all', () => {
    expect(readRailPinned(null)).toBe(false);
    expect(() => writeRailPinned(true, null)).not.toThrow();
  });

  it('uses the browser storage by default', () => {
    window.localStorage.clear();
    writeRailPinned(true);
    expect(readRailPinned()).toBe(true);
    window.localStorage.clear();
  });
});
