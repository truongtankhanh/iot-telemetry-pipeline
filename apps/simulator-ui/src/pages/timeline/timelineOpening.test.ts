import { describe, expect, it } from 'vitest';
import type { ScenarioItem } from '../../api/types';
import { scenarioItem } from '../scenarios/scenariosTestSupport';
import { readTimelineQuery, resolveOpening, writeTimelineQuery } from './timelineOpening';

const saved = scenarioItem('bad-afternoon');
const builtIn = scenarioItem('server-room-overheat', { source: 'built-in' });
const scenarios: ScenarioItem[] = [builtIn, saved];

describe('readTimelineQuery', () => {
  it('reads the scenario to edit and the scenario to duplicate', () => {
    expect(readTimelineQuery(new URLSearchParams('scenario=a'))).toEqual({
      scenario: 'a',
      duplicate: null,
    });
    expect(readTimelineQuery(new URLSearchParams('duplicate=b'))).toEqual({
      scenario: null,
      duplicate: 'b',
    });
    expect(readTimelineQuery(new URLSearchParams(''))).toEqual({ scenario: null, duplicate: null });
  });

  it('lets ?scenario= win and takes an empty value for none', () => {
    expect(readTimelineQuery(new URLSearchParams('scenario=a&duplicate=b'))).toEqual({
      scenario: 'a',
      duplicate: null,
    });
    expect(readTimelineQuery(new URLSearchParams('scenario=&duplicate='))).toEqual({
      scenario: null,
      duplicate: null,
    });
  });
});

describe('writeTimelineQuery', () => {
  it('writes one of the two and keeps what else is in the address', () => {
    const params = new URLSearchParams('x=1&scenario=a');
    expect(writeTimelineQuery(params, { scenario: null, duplicate: 'b' }).toString()).toBe(
      'x=1&duplicate=b',
    );
    expect(writeTimelineQuery(params, { scenario: 'c', duplicate: 'b' }).toString()).toBe(
      'x=1&scenario=c',
    );
    expect(writeTimelineQuery(params, { scenario: null, duplicate: null }).toString()).toBe('x=1');
    expect(params.toString()).toBe('x=1&scenario=a');
  });
});

describe('resolveOpening', () => {
  const none = { scenario: null, duplicate: null };

  it('opens a new scenario at once, without the library', () => {
    expect(resolveOpening(none, null)).toEqual({ kind: 'new', key: 'new', notice: null });
  });

  it('waits for the library when the address names a scenario', () => {
    expect(resolveOpening({ scenario: 'a', duplicate: null }, null)).toEqual({ kind: 'loading' });
    expect(resolveOpening({ scenario: null, duplicate: 'a' }, null)).toEqual({ kind: 'loading' });
  });

  it('opens a custom scenario for editing', () => {
    expect(resolveOpening({ scenario: 'bad-afternoon', duplicate: null }, scenarios)).toEqual({
      kind: 'saved',
      key: 'scenario:bad-afternoon',
      item: saved,
    });
  });

  it('opens a new scenario, and says why, for a built-in or a name that does not exist', () => {
    const asked = resolveOpening({ scenario: 'server-room-overheat', duplicate: null }, scenarios);
    expect(asked).toMatchObject({ kind: 'new', key: 'new' });
    expect(asked.kind === 'new' && asked.notice).toMatch(
      /built-in scenario and cannot be changed; duplicate it/,
    );
    const missing = resolveOpening({ scenario: 'nope', duplicate: null }, scenarios);
    expect(missing.kind === 'new' && missing.notice).toBe(
      'There is no scenario named "nope", so this is a new one.',
    );
  });

  it('opens a copy of any scenario, built-ins included', () => {
    expect(
      resolveOpening({ scenario: null, duplicate: 'server-room-overheat' }, scenarios),
    ).toEqual({
      kind: 'copy',
      key: 'copy:server-room-overheat',
      item: builtIn,
    });
    const missing = resolveOpening({ scenario: null, duplicate: 'nope' }, scenarios);
    expect(missing.kind === 'new' && missing.notice).toMatch(
      /no scenario named "nope" to duplicate/,
    );
  });
});
