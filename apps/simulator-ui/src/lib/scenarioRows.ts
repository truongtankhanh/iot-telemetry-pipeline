import type { ScenarioItem } from '../api/types';
import {
  SCENARIO_TABS,
  type ScenarioQuery,
  type ScenarioSortKey,
  type ScenarioTab,
} from './scenarioQuery';

/**
 * What the Scenarios page does with the library the simulator sent, as pure functions: search it, count the tabs,
 * sort it and cut a page. The simulator pages nothing (the whole library is a few dozen small items), so the browser
 * does, as the Fleet does with its devices.
 */

/**
 * The text a search looks in: the name, the device of each anomaly, and the id and title of each rule the scenario
 * should raise. The description is not searched. When the rules are not available there are no rules to match.
 */
function haystack(item: ScenarioItem): string {
  const devices = item.anomalies.map((anomaly) => anomaly.deviceId);
  const rules = item.expected.available
    ? item.expected.alerts.flatMap((alert) => [alert.ruleId, alert.title])
    : [];
  return [item.name, ...devices, ...rules].join(' ').toLowerCase();
}

/** True when every word of the search is in the name, a device or a rule. */
export function matchesScenarioSearch(item: ScenarioItem, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack(item);
  return words.every((word) => text.includes(word));
}

const compareText = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** Newest run first; a scenario never run in this session comes after every one that was, in library order. */
function byRecent(a: Ranked, b: Ranked): number {
  const ta = a.item.lastRunAt === null ? NaN : Date.parse(a.item.lastRunAt);
  const tb = b.item.lastRunAt === null ? NaN : Date.parse(b.item.lastRunAt);
  const ranA = Number.isNaN(ta);
  const ranB = Number.isNaN(tb);
  if (ranA && ranB) return a.index - b.index;
  if (ranA) return 1;
  if (ranB) return -1;
  return tb - ta || a.index - b.index;
}

interface Ranked {
  item: ScenarioItem;
  /** Its place in the library as the simulator sent it: what a tie falls back to, so the order never shuffles. */
  index: number;
}

function comparator(sort: ScenarioSortKey): (a: Ranked, b: Ranked) => number {
  switch (sort) {
    case 'recent':
      return byRecent;
    case 'name':
      return (a, b) => compareText(a.item.name, b.item.name) || a.index - b.index;
    case 'duration':
      return (a, b) =>
        b.item.lengthS - a.item.lengthS ||
        compareText(a.item.name, b.item.name) ||
        a.index - b.index;
  }
}

export interface ScenarioResult {
  /** Every scenario that passes the search and the tab, sorted. */
  rows: ScenarioItem[];
  /** The tab counts over what passes the search (so they follow what is typed), whatever tab is open. */
  counts: Record<ScenarioTab, number>;
}

/** Searches, counts the tabs, filters by the open tab and sorts. */
export function applyScenarioQuery(
  items: readonly ScenarioItem[],
  query: ScenarioQuery,
): ScenarioResult {
  const searched = items.filter((item) => matchesScenarioSearch(item, query.q));
  const counts = Object.fromEntries(SCENARIO_TABS.map((tab) => [tab, 0])) as Record<
    ScenarioTab,
    number
  >;
  counts.all = searched.length;
  for (const item of searched) counts[item.source] += 1;

  const order = new Map(items.map((item, index) => [item.name, index]));
  const rows = searched
    .filter((item) => query.tab === 'all' || item.source === query.tab)
    .map((item): Ranked => ({ item, index: order.get(item.name) ?? 0 }))
    .sort(comparator(query.sort))
    .map((ranked) => ranked.item);
  return { rows, counts };
}

/** The page (1-based) that holds the named scenario in these rows, or `null` when they do not hold it. */
export function pageOfScenario(
  rows: readonly ScenarioItem[],
  name: string,
  size: number,
): number | null {
  const index = rows.findIndex((item) => item.name === name);
  return index < 0 ? null : Math.floor(index / size) + 1;
}
