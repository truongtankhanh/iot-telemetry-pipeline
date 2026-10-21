import { describe, expect, it } from 'vitest';
import type { ScenarioItem } from '../api/types';
import { pageCount } from './paging';
import { DEFAULT_SCENARIO_QUERY, type ScenarioQuery } from './scenarioQuery';
import { applyScenarioQuery, matchesScenarioSearch, pageOfScenario } from './scenarioRows';

/** A scenario with plain defaults: built-in, one anomaly on dc-env-01 that raises the server room alert. */
function scenario(name: string, overrides: Partial<ScenarioItem> = {}): ScenarioItem {
  return {
    name,
    description: `The scenario ${name}.`,
    source: 'built-in',
    imported: false,
    anomalies: [
      { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
    ],
    lengthS: 80,
    needsStart: [],
    lastRunAt: null,
    running: false,
    expected: {
      available: true,
      intervalS: 2,
      horizonS: 80,
      alerts: [
        {
          ruleId: 'server-room-hot',
          title: 'Server room temperature high',
          severity: 'high',
          deviceId: 'dc-env-01',
          metric: 'temperature_c',
          opensAtS: 24,
          opensMargin: false,
          clearsAtS: 80,
          clearsUncertain: false,
        },
      ],
      quiet: [],
      series: [],
    },
    ...overrides,
  };
}

const query = (change: Partial<ScenarioQuery> = {}): ScenarioQuery => ({
  ...DEFAULT_SCENARIO_QUERY,
  ...change,
});
const names = (rows: readonly ScenarioItem[]) => rows.map((row) => row.name);

/** 2 built-in and 36 custom, as in the ticket: 38 in all. */
function library38(): ScenarioItem[] {
  return [
    scenario('server-room-overheat'),
    scenario('crowded-lecture'),
    ...Array.from({ length: 36 }, (_, i) =>
      scenario(`custom-${String(i + 1).padStart(2, '0')}`, { source: 'custom' }),
    ),
  ];
}

describe('applyScenarioQuery: the ticket', () => {
  it('counts 38 scenarios as All 38, Built-in 2, Custom 36, over 7 pages of 6', () => {
    const { rows, counts } = applyScenarioQuery(library38(), query());
    expect(counts).toEqual({ all: 38, 'built-in': 2, custom: 36 });
    expect(rows).toHaveLength(38);
    expect(pageCount(rows.length, 6)).toBe(7);
  });

  it('shows only the tab that is open, and still counts the others', () => {
    const custom = applyScenarioQuery(library38(), query({ tab: 'custom' }));
    expect(custom.rows).toHaveLength(36);
    expect(custom.counts).toEqual({ all: 38, 'built-in': 2, custom: 36 });
    const builtIn = applyScenarioQuery(library38(), query({ tab: 'built-in' }));
    expect(names(builtIn.rows)).toEqual(['server-room-overheat', 'crowded-lecture']);
  });
});

describe('search', () => {
  const items = [
    scenario('server-room-overheat'),
    scenario('crowded-lecture', {
      anomalies: [
        { deviceId: 'lha-air-01', metric: 'co2_ppm', value: 1450, startAt: 20, duration: 90 },
      ],
      expected: {
        available: true,
        intervalS: 2,
        horizonS: 110,
        alerts: [
          {
            ruleId: 'indoor-co2',
            title: 'Poor air quality (CO₂)',
            severity: 'medium',
            deviceId: 'lha-air-01',
            metric: 'co2_ppm',
            opensAtS: 24,
            opensMargin: false,
            clearsAtS: 110,
            clearsUncertain: true,
          },
        ],
        quiet: [],
        series: [],
      },
    }),
  ];

  it('finds a scenario by name, by a device of its anomalies and by a rule it should raise', () => {
    expect(names(applyScenarioQuery(items, query({ q: 'overheat' })).rows)).toEqual([
      'server-room-overheat',
    ]);
    expect(names(applyScenarioQuery(items, query({ q: 'lha-air' })).rows)).toEqual([
      'crowded-lecture',
    ]);
    expect(names(applyScenarioQuery(items, query({ q: 'indoor-co2' })).rows)).toEqual([
      'crowded-lecture',
    ]);
    expect(names(applyScenarioQuery(items, query({ q: 'temperature high' })).rows)).toEqual([
      'server-room-overheat',
    ]);
  });

  it('wants every word, ignores case, and finds everything for an empty search', () => {
    expect(applyScenarioQuery(items, query({ q: 'LECTURE lha' })).rows).toHaveLength(1);
    expect(applyScenarioQuery(items, query({ q: 'lecture dc-env-01' })).rows).toHaveLength(0);
    expect(applyScenarioQuery(items, query({ q: '   ' })).rows).toHaveLength(2);
  });

  it('does not search the description', () => {
    const described = [scenario('plain', { description: 'Row A runs hot for a minute.' })];
    expect(matchesScenarioSearch(described[0]!, 'minute')).toBe(false);
  });

  it('finds no rule when the rules are not available, but still finds the name and the device', () => {
    const unavailable = scenario('no-rules', {
      expected: { available: false, reason: 'cannot read rules.json' },
    });
    expect(matchesScenarioSearch(unavailable, 'server-room-hot')).toBe(false);
    expect(matchesScenarioSearch(unavailable, 'dc-env-01')).toBe(true);
    expect(matchesScenarioSearch(unavailable, 'no-rules')).toBe(true);
  });

  it('makes the tab counts follow the search, not the tab', () => {
    const library = [...library38(), scenario('custom-hub', { source: 'custom' })];
    const result = applyScenarioQuery(library, query({ q: 'custom-0', tab: 'built-in' }));
    expect(result.counts).toEqual({ all: 9, 'built-in': 0, custom: 9 });
    expect(result.rows).toEqual([]);
  });
});

describe('sort', () => {
  const run = (name: string, at: string | null, extra: Partial<ScenarioItem> = {}) =>
    scenario(name, { lastRunAt: at, ...extra });

  it('puts the newest run first and the scenarios never run after, in library order', () => {
    const items = [
      run('never-a', null),
      run('old', '2026-10-21T08:00:00.000Z'),
      run('never-b', null),
      run('new', '2026-10-21T09:30:00.000Z'),
    ];
    expect(names(applyScenarioQuery(items, query({ sort: 'recent' })).rows)).toEqual([
      'new',
      'old',
      'never-a',
      'never-b',
    ]);
  });

  it('keeps the library order when nothing has been run, as after a restart', () => {
    const items = library38();
    expect(names(applyScenarioQuery(items, query()).rows)).toEqual(names(items));
  });

  it('sorts by name, A to Z, comparing numbers as numbers', () => {
    const items = [scenario('custom-10'), scenario('custom-2'), scenario('alpha')];
    expect(names(applyScenarioQuery(items, query({ sort: 'name' })).rows)).toEqual([
      'alpha',
      'custom-2',
      'custom-10',
    ]);
  });

  it('sorts by duration, longest first, and breaks a tie by name', () => {
    const items = [
      scenario('b-short', { lengthS: 55 }),
      scenario('a-long', { lengthS: 120 }),
      scenario('a-short', { lengthS: 55 }),
    ];
    expect(names(applyScenarioQuery(items, query({ sort: 'duration' })).rows)).toEqual([
      'a-long',
      'a-short',
      'b-short',
    ]);
  });

  it('does not change the list it was given', () => {
    const items = [scenario('b'), scenario('a')];
    applyScenarioQuery(items, query({ sort: 'name' }));
    expect(names(items)).toEqual(['b', 'a']);
  });
});

describe('pageOfScenario', () => {
  const rows = applyScenarioQuery(library38(), query()).rows;

  it('gives the page that holds the scenario', () => {
    expect(pageOfScenario(rows, 'server-room-overheat', 6)).toBe(1);
    expect(pageOfScenario(rows, 'custom-04', 6)).toBe(1); // the sixth row
    expect(pageOfScenario(rows, 'custom-05', 6)).toBe(2); // the seventh
    expect(pageOfScenario(rows, 'custom-36', 6)).toBe(7);
    expect(pageOfScenario(rows, 'custom-36', 12)).toBe(4);
  });

  it('gives nothing for a scenario these rows do not hold, such as one a tab or the search hides', () => {
    expect(pageOfScenario(rows, 'nope', 6)).toBeNull();
    const customOnly = applyScenarioQuery(library38(), query({ tab: 'custom' })).rows;
    expect(pageOfScenario(customOnly, 'server-room-overheat', 6)).toBeNull();
  });
});
