import type { ObservationEvent } from '../api/types';
import { type EventRow, eventRow } from './eventRows';

/**
 * The execution log of the Lab (frames 12 and 19): what happened to the faults and to the alerts they raised, newest
 * first. It is the observations Studio saw (an alert opened, delivered, an incident created; a scenario run; an anomaly
 * added or removed) merged with the commands Studio itself sent from this page. It never shows a "Rule raised" or an
 * "Anomaly started" row: neither is an observation (the rule fires inside ingest, a fault's start is a time inside the
 * engine), and a row with a time Studio cannot know would be invented.
 */

export type LogFilter = 'all' | 'alerts' | 'faults';

export const LOG_FILTERS: readonly LogFilter[] = ['all', 'alerts', 'faults'];

export const LOG_FILTER_LABELS: Record<LogFilter, string> = {
  all: 'All',
  alerts: 'Alerts',
  faults: 'Faults',
};

/** A command the Lab sent, kept in the page for the log (the simulator does not record Studio's own clicks). */
export interface LabCommand {
  id: string;
  /** When it was sent (ms). */
  at: number;
  kind: 'inject' | 'timeline' | 'remove' | 'run' | 'stop';
  /** "Injected a breach on 12 devices". */
  text: string;
  devices: readonly string[];
}

export interface LogRow {
  /** Unique across observations and commands. */
  key: string;
  at: number;
  /** Which filter the row belongs to besides _All_. */
  group: Exclude<LogFilter, 'all'>;
  /** The observation's kind, or `command`. Rows of one kind are what a run collapses. */
  kind: string;
  /** The text of the row. */
  message: string;
  /** The row of the observation, for its parts and fields; `null` for a command. */
  event: EventRow | null;
  command: LabCommand | null;
  devices: string[];
  alertId: string | null;
}

/** The `engine-state` changes the Faults page makes (SIM-12): a fault switched on, off or changed, the scope, a burst, the link. */
const FAULT_STATE_TYPES: ReadonlySet<string> = new Set([
  'fault-set',
  'fault-cleared',
  'fault-scope',
  'faults-cleared',
  'burst',
  'link-lost',
  'link-restored',
]);

/** Observation kinds the log shows, and the filter each belongs to. Anything else is left to the Overview's timeline. */
function groupOf(event: ObservationEvent): LogRow['group'] | null {
  switch (event.kind) {
    case 'alert-opened':
    case 'alert-cleared':
    case 'delivery':
    case 'incident':
      return 'alerts';
    case 'scenario-run':
    case 'scenario-stop':
      return 'faults';
    case 'engine-state': {
      const type = event.data.type;
      return type === 'anomaly-added' ||
        type === 'anomaly-removed' ||
        FAULT_STATE_TYPES.has(String(type))
        ? 'faults'
        : null;
    }
    default:
      return null;
  }
}

/** The rows, newest first: the observations the log shows, and the commands, merged by time. */
export function logRows(
  events: readonly ObservationEvent[],
  commands: readonly LabCommand[],
): LogRow[] {
  const rows: LogRow[] = [];
  for (const event of events) {
    const group = groupOf(event);
    if (group === null) continue;
    const row = eventRow(event);
    rows.push({
      key: `event:${event.id}`,
      at: row.at,
      group,
      kind: event.kind,
      message: row.message,
      event: row,
      command: null,
      devices: row.devices,
      alertId: row.alerts[0] ?? null,
    });
  }
  for (const command of commands) {
    rows.push({
      key: `command:${command.id}`,
      at: command.at,
      group: 'faults',
      kind: 'command',
      message: command.text,
      event: null,
      command,
      devices: [...command.devices],
      alertId: null,
    });
  }
  return rows.sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

export function filterRows(rows: readonly LogRow[], filter: LogFilter): LogRow[] {
  return filter === 'all' ? [...rows] : rows.filter((row) => row.group === filter);
}

export function logCounts(rows: readonly LogRow[]): Record<LogFilter, number> {
  return {
    all: rows.length,
    alerts: rows.filter((row) => row.group === 'alerts').length,
    faults: rows.filter((row) => row.group === 'faults').length,
  };
}

/** A run of alike rows folded into one line: "6 more alerts, #8 to #13 · Show". */
export interface LogRun {
  type: 'run';
  /** The key of its first folded row. */
  key: string;
  kind: string;
  count: number;
  /** "6 more alerts, #8 to #13". */
  label: string;
  rows: LogRow[];
}

export type LogItem = { type: 'row'; row: LogRow } | LogRun;

/** A run shorter than this is shown row by row. */
export const RUN_MIN = 5;
/** How many rows of a run stay on show before the fold. */
export const RUN_KEEP = 2;

const NOUNS: Record<string, [string, string]> = {
  'alert-opened': ['alert', 'alerts'],
  'alert-cleared': ['cleared alert', 'cleared alerts'],
  delivery: ['delivery', 'deliveries'],
  incident: ['incident', 'incidents'],
  'engine-state': ['fault change', 'fault changes'],
  'scenario-run': ['run', 'runs'],
  'scenario-stop': ['stop', 'stops'],
  command: ['command', 'commands'],
};

function runLabel(kind: string, rows: readonly LogRow[]): string {
  const [one, many] = NOUNS[kind] ?? ['event', 'events'];
  const count = rows.length;
  const base = `${count} more ${count === 1 ? one : many}`;
  const ids = rows.map((row) => row.alertId).filter((id): id is string => id !== null);
  const numbers = ids.map(Number).filter(Number.isInteger);
  if (numbers.length === ids.length && numbers.length > 1) {
    return `${base}, #${Math.min(...numbers)} to #${Math.max(...numbers)}`;
  }
  return base;
}

/**
 * Folds each run of at least `RUN_MIN` consecutive rows of one kind, keeping the newest `RUN_KEEP` on show. A run in
 * `expanded` (by its key) is shown row by row, and stays a run item with no fold so the page can offer "Hide".
 */
export function collapseRuns(rows: readonly LogRow[], expanded: ReadonlySet<string>): LogItem[] {
  const items: LogItem[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && rows[j]!.kind === rows[i]!.kind) j += 1;
    const length = j - i;
    if (length < RUN_MIN) {
      for (const row of rows.slice(i, j)) items.push({ type: 'row', row });
    } else {
      const shown = rows.slice(i, i + RUN_KEEP);
      const folded = rows.slice(i + RUN_KEEP, j);
      for (const row of shown) items.push({ type: 'row', row });
      const key = folded[0]!.key;
      if (expanded.has(key)) {
        for (const row of folded) items.push({ type: 'row', row });
      } else {
        items.push({
          type: 'run',
          key,
          kind: folded[0]!.kind,
          count: folded.length,
          label: runLabel(folded[0]!.kind, folded),
          rows: folded,
        });
      }
    }
    i = j;
  }
  return items;
}

export interface TargetStep {
  id: string | null;
  /** 1-based, `0` for none. */
  position: number;
  total: number;
}

/**
 * The target the inspector is on and its place among the targets ("dc-env-01, 1 of 12"). A current target that is no
 * longer among them is dropped for the first; `delta` moves by one and wraps neither way: the arrows stop at the ends.
 */
export function stepTarget(
  targets: readonly string[],
  current: string | null,
  delta = 0,
): TargetStep {
  if (targets.length === 0) return { id: null, position: 0, total: 0 };
  const at = current === null ? -1 : targets.indexOf(current);
  const index = Math.min(targets.length - 1, Math.max(0, (at < 0 ? 0 : at) + delta));
  return { id: targets[index]!, position: index + 1, total: targets.length };
}
