import { describe, expect, it } from 'vitest';
import { readRailPinned, readTimeZone, writeRailPinned, writeTimeZone } from './preferences';

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

describe('the time zone of the timeline', () => {
  it('is the local one when nothing was stored', () => {
    expect(readTimeZone(memory())).toBe('local');
  });

  it('is remembered, either way', () => {
    const storage = memory();
    writeTimeZone('utc', storage);
    expect(storage.data.get('studio.timeZone')).toBe('utc');
    expect(readTimeZone(storage)).toBe('utc');

    writeTimeZone('local', storage);
    expect(readTimeZone(storage)).toBe('local');
  });

  it('reads anything but "utc" as local', () => {
    for (const value of ['UTC', 'Europe/Paris', 'true', '']) {
      expect(readTimeZone(memory({ 'studio.timeZone': value }))).toBe('local');
    }
  });

  it('is kept apart from the pinned rail', () => {
    const storage = memory();
    writeTimeZone('utc', storage);
    writeRailPinned(true, storage);
    expect(readTimeZone(storage)).toBe('utc');
    expect(readRailPinned(storage)).toBe(true);
  });

  it('copes with storage that throws, and with no storage at all', () => {
    expect(readTimeZone(broken)).toBe('local');
    expect(() => writeTimeZone('utc', broken)).not.toThrow();
    expect(readTimeZone(null)).toBe('local');
    expect(() => writeTimeZone('utc', null)).not.toThrow();
  });
});
