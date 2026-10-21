/**
 * The address of the Scenarios page, as pure functions: what is searched, which tab, how the cards are sorted, the
 * page and its size, and the scenario a link points at (the command palette's `?scenario=<name>`). Like the Fleet's
 * (`fleetQuery.ts`), the address is the state, so a reload or a shared link opens the same page, and a value that is
 * not one of the allowed ones falls back to the default instead of failing.
 */

export type ScenarioTab = 'all' | 'built-in' | 'custom';
export type ScenarioSortKey = 'recent' | 'name' | 'duration';

export const SCENARIO_TABS: readonly ScenarioTab[] = ['all', 'built-in', 'custom'];
export const SCENARIO_TAB_LABELS: Record<ScenarioTab, string> = {
  all: 'All',
  'built-in': 'Built-in',
  custom: 'Custom',
};

export const SCENARIO_SORTS: readonly ScenarioSortKey[] = ['recent', 'name', 'duration'];
/** The order each sort gives is in its label: the field has no direction to flip. */
export const SCENARIO_SORT_LABELS: Record<ScenarioSortKey, string> = {
  recent: 'Recently run',
  name: 'Name',
  duration: 'Duration, longest first',
};

/** Cards per page. */
export const SCENARIO_SIZES = [6, 12, 24] as const;
export const DEFAULT_SCENARIO_SIZE = 6;
const MAX_SEARCH_LENGTH = 100;

export interface ScenarioQuery {
  /** Search text: every word must appear in the name, a device of the scenario, or a rule it should raise. */
  q: string;
  tab: ScenarioTab;
  sort: ScenarioSortKey;
  /** 1-based. */
  page: number;
  /** Cards per page. */
  size: number;
  /** The scenario a link points at, marked and shown on its page; `null` for none. */
  scenario: string | null;
}

export const DEFAULT_SCENARIO_QUERY: ScenarioQuery = {
  q: '',
  tab: 'all',
  sort: 'recent',
  page: 1,
  size: DEFAULT_SCENARIO_SIZE,
  scenario: null,
};

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null;

export function parseScenarioQuery(params: URLSearchParams): ScenarioQuery {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  return {
    q: (params.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH),
    tab: oneOf(params.get('tab'), SCENARIO_TABS) ?? DEFAULT_SCENARIO_QUERY.tab,
    sort: oneOf(params.get('sort'), SCENARIO_SORTS) ?? DEFAULT_SCENARIO_QUERY.sort,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    size: (SCENARIO_SIZES as readonly number[]).includes(size) ? size : DEFAULT_SCENARIO_SIZE,
    scenario: params.get('scenario') || null,
  };
}

/** Writes the address with only what differs from the default, so the plain page has a plain address. */
export function serializeScenarioQuery(query: ScenarioQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.tab !== DEFAULT_SCENARIO_QUERY.tab) params.set('tab', query.tab);
  if (query.sort !== DEFAULT_SCENARIO_QUERY.sort) params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.size !== DEFAULT_SCENARIO_SIZE) params.set('size', String(query.size));
  if (query.scenario) params.set('scenario', query.scenario);
  return params;
}
