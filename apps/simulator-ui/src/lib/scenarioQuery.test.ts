import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIO_QUERY,
  parseScenarioQuery,
  SCENARIO_SIZES,
  SCENARIO_SORT_LABELS,
  SCENARIO_SORTS,
  SCENARIO_TAB_LABELS,
  SCENARIO_TABS,
  serializeScenarioQuery,
} from './scenarioQuery';

const parse = (search: string) => parseScenarioQuery(new URLSearchParams(search));

describe('parseScenarioQuery', () => {
  it('gives the defaults for a plain address: all, recently run, page 1, six cards', () => {
    expect(parse('')).toEqual(DEFAULT_SCENARIO_QUERY);
    expect(DEFAULT_SCENARIO_QUERY).toEqual({
      q: '',
      tab: 'all',
      sort: 'recent',
      page: 1,
      size: 6,
      scenario: null,
    });
  });

  it('reads every part of the address', () => {
    expect(parse('q=row+a&tab=custom&sort=duration&page=3&size=12&scenario=bad-afternoon')).toEqual(
      {
        q: 'row a',
        tab: 'custom',
        sort: 'duration',
        page: 3,
        size: 12,
        scenario: 'bad-afternoon',
      },
    );
  });

  it('falls back to the default for a value that is not allowed, so an old link still opens', () => {
    expect(parse('tab=mine&sort=newest&size=7&page=0').tab).toBe('all');
    expect(parse('tab=mine&sort=newest&size=7&page=0').sort).toBe('recent');
    expect(parse('tab=mine&sort=newest&size=7&page=0').size).toBe(6);
    expect(parse('tab=mine&sort=newest&size=7&page=0').page).toBe(1);
    expect(parse('page=-2').page).toBe(1);
    expect(parse('page=2.5').page).toBe(1);
    expect(parse('page=abc').page).toBe(1);
    expect(parse('size=100').size).toBe(6);
  });

  it('allows the three sizes of the ticket and no other', () => {
    expect([...SCENARIO_SIZES]).toEqual([6, 12, 24]);
    for (const size of SCENARIO_SIZES) expect(parse(`size=${size}`).size).toBe(size);
  });

  it('keeps at most 100 characters of the search and reads an empty scenario as none', () => {
    expect(parse(`q=${'x'.repeat(150)}`).q).toHaveLength(100);
    expect(parse('scenario=').scenario).toBeNull();
  });

  it('names every tab and every sort, in words', () => {
    expect(SCENARIO_TABS.map((tab) => SCENARIO_TAB_LABELS[tab])).toEqual([
      'All',
      'Built-in',
      'Custom',
    ]);
    expect(SCENARIO_SORTS.map((sort) => SCENARIO_SORT_LABELS[sort])).toEqual([
      'Recently run',
      'Name',
      'Duration, longest first',
    ]);
  });
});

describe('serializeScenarioQuery', () => {
  it('writes nothing for the defaults', () => {
    expect(serializeScenarioQuery(DEFAULT_SCENARIO_QUERY).toString()).toBe('');
  });

  it('writes only what differs from the default', () => {
    const params = serializeScenarioQuery({
      ...DEFAULT_SCENARIO_QUERY,
      tab: 'built-in',
      page: 2,
    });
    expect(params.toString()).toBe('tab=built-in&page=2');
  });

  it('round trips every combination it was given', () => {
    const query = {
      q: 'dc-env-01 hot',
      tab: 'custom' as const,
      sort: 'name' as const,
      page: 4,
      size: 24,
      scenario: 'exam-week-crowd',
    };
    expect(parseScenarioQuery(serializeScenarioQuery(query))).toEqual(query);
  });
});
