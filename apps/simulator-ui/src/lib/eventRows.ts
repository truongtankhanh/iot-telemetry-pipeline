import type { ObservationEvent } from '../api/types';

/**
 * The event timeline's rows (frame 11), as pure functions of the observations the simulator recorded. A row is what
 * Studio _saw_ happen (`at` is when Studio saw it, not when it happened). Nothing is invented: the frame draws a "Rule"
 * row and an "Anomaly started" row, but the rule fires inside ingest and an anomaly's start is a time inside a run, and
 * neither is an observation, so neither is a row. A rule is named by the alert it opened, and a run's row says what it
 * played.
 */

/** Where an event came from: the chip of its row and the choices of the source select. */
export const EVENT_SOURCES = [
  'Fleet',
  'Scenario',
  'Alert',
  'Outbox',
  'Command Center',
  'Ingest',
  'Engine',
  'Other',
] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];

/** The glyph of a row's chip; `ui/icons.ts` maps each name to an icon. */
export type EventGlyph =
  'fleet' | 'scenario' | 'alert' | 'outbox' | 'incident' | 'ingest' | 'engine' | 'other';

const GLYPHS: Record<EventSource, EventGlyph> = {
  Fleet: 'fleet',
  Scenario: 'scenario',
  Alert: 'alert',
  Outbox: 'outbox',
  'Command Center': 'incident',
  Ingest: 'ingest',
  Engine: 'engine',
  Other: 'other',
};

/** A piece of a row's one-line message; a `strong` one is drawn in monospace and bold (an id, a state). */
export interface MessagePart {
  text: string;
  strong?: boolean;
}

/** A labelled value in the expanded part of a row. */
export interface EventField {
  label: string;
  value: string;
  mono: boolean;
}

export interface EventRow {
  id: number;
  /** When Studio saw it, in ms; `0` if the simulator sent a time that is not one. */
  at: number;
  kind: string;
  source: EventSource;
  glyph: EventGlyph;
  parts: MessagePart[];
  /** The message as plain text: what the filter reads and the export writes. */
  message: string;
  fields: EventField[];
  /** What a filter key can match: the devices, rules, alerts and scenarios the event names. */
  devices: string[];
  rules: string[];
  alerts: string[];
  scenarios: string[];
}

type Data = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const textOrNumber = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const list = (items: readonly string[]): string => items.join(', ');

const plain = (...parts: (string | MessagePart)[]): MessagePart[] =>
  parts.map((part) => (typeof part === 'string' ? { text: part } : part));
const strong = (value: string): MessagePart => ({ text: value, strong: true });

interface Described {
  source: EventSource;
  parts: MessagePart[];
  fields: [label: string, value: string | null, mono?: boolean][];
  devices?: (string | null)[];
  rules?: (string | null)[];
  alerts?: (string | null)[];
  scenarios?: (string | null)[];
}

function describeEngineState(data: Data): Described {
  const type = text(data.type);
  const deviceId = text(data.deviceId);
  const metric = text(data.metric);
  switch (type) {
    case 'device-state': {
      const state = text(data.state);
      return {
        source: 'Fleet',
        parts: plain(
          strong(deviceId ?? 'A device'),
          ` ${state === 'running' ? 'started' : (state ?? 'changed')}`,
        ),
        fields: [
          ['Device', deviceId, true],
          ['State', state],
        ],
        devices: [deviceId],
      };
    }
    case 'device-interval': {
      const interval = textOrNumber(data.intervalMs);
      return {
        source: 'Fleet',
        parts: plain(
          strong(deviceId ?? 'A device'),
          interval === null
            ? ' publishes at the engine’s interval again'
            : ` publishes every ${interval} ms`,
        ),
        fields: [
          ['Device', deviceId, true],
          ['Interval', interval === null ? 'the engine’s' : `${interval} ms`],
        ],
        devices: [deviceId],
      };
    }
    case 'hold-set': {
      const value = textOrNumber(data.value);
      return {
        source: 'Fleet',
        parts: plain(
          strong(deviceId ?? 'A device'),
          ` holds ${metric ?? 'a metric'}${value === null ? '' : ` at ${value}`}`,
        ),
        fields: [
          ['Device', deviceId, true],
          ['Metric', metric, true],
          ['Value', value],
        ],
        devices: [deviceId],
      };
    }
    case 'hold-released':
      return {
        source: 'Fleet',
        parts: plain(strong(deviceId ?? 'A device'), ` released ${metric ?? 'a held value'}`),
        fields: [
          ['Device', deviceId, true],
          ['Metric', metric, true],
        ],
        devices: [deviceId],
      };
    case 'anomaly-added': {
      const anomaly = (data.anomaly ?? {}) as Data;
      const target = text(anomaly.deviceId);
      const value = textOrNumber(anomaly.value);
      return {
        source: 'Engine',
        parts: plain(
          `Anomaly ${text(data.id) ?? ''} added`.replace('  ', ' '),
          target === null ? '' : `: `,
          ...(target === null ? [] : [strong(target)]),
          value === null ? '' : ` → ${value}`,
        ),
        fields: [
          ['Anomaly', text(data.id), true],
          ['Device', target, true],
          ['Metric', text(anomaly.metric), true],
          ['Value', value],
        ],
        devices: [target],
      };
    }
    case 'anomaly-removed':
      return {
        source: 'Engine',
        parts: plain(`Anomaly ${text(data.id) ?? ''} removed`.replace('  ', ' ')),
        fields: [['Anomaly', text(data.id), true]],
      };
    case 'reset':
      return {
        source: 'Engine',
        parts: plain('Reset: anomalies and held values cleared, devices back at baseline'),
        fields: [],
      };
    default:
      return {
        source: 'Engine',
        parts: plain(`The engine changed${type === null ? '' : ` (${type})`}`),
        fields: [['Change', type, true]],
      };
  }
}

function describeEvent(kind: string, data: Data): Described {
  switch (kind) {
    case 'engine-state':
      return describeEngineState(data);
    case 'tick-error':
      return {
        source: 'Engine',
        parts: plain(`A tick failed: ${text(data.message) ?? 'no reason given'}`),
        fields: [['Error', text(data.message)]],
      };
    case 'scenario-run': {
      const name = text(data.name);
      const started = strings(data.startedDevices);
      const replaced = Array.isArray(data.replaced) ? data.replaced.length : 0;
      return {
        source: 'Scenario',
        parts: plain(
          strong(name ?? 'A scenario'),
          ' started',
          started.length > 0 ? `, and started ${list(started)}` : '',
          replaced > 0 ? `, replacing ${replaced === 1 ? 'a run' : `${replaced} runs`}` : '',
        ),
        fields: [
          ['Scenario', name, true],
          ['Run', text(data.runId), true],
          ['Anomalies', textOrNumber(Array.isArray(data.anomalies) ? data.anomalies.length : null)],
          ['Devices started', started.length === 0 ? null : list(started), true],
        ],
        devices: [
          ...strings(data.startedDevices),
          ...(Array.isArray(data.anomalies)
            ? data.anomalies.map((a) => text((a as Data | null)?.deviceId))
            : []),
        ],
        scenarios: [name],
      };
    }
    case 'scenario-stop': {
      const name = text(data.name);
      const reason = text(data.reason);
      return {
        source: 'Scenario',
        parts: plain(
          strong(name ?? 'A scenario'),
          reason === 'replaced' ? ' was replaced by another run' : ' stopped',
        ),
        fields: [
          ['Scenario', name, true],
          ['Run', text(data.runId), true],
          ['Why', reason],
        ],
        scenarios: [name],
      };
    }
    case 'alert-opened': {
      const id = textOrNumber(data.alertId);
      const severity = text(data.severity);
      return {
        source: 'Alert',
        parts: plain(`#${id ?? '?'} opened${severity === null ? '' : ` · ${severity}`}`),
        fields: [
          ['Alert', id === null ? null : `#${id}`, true],
          ['Title', text(data.title)],
          ['Rule', text(data.ruleId), true],
          ['Device', text(data.deviceId), true],
          ['Metric', text(data.metric), true],
        ],
        devices: [text(data.deviceId)],
        rules: [text(data.ruleId)],
        alerts: [id],
      };
    }
    case 'alert-cleared': {
      const id = textOrNumber(data.alertId);
      return {
        source: 'Alert',
        parts: plain(`#${id ?? '?'} cleared`),
        fields: [
          ['Alert', id === null ? null : `#${id}`, true],
          ['Title', text(data.title)],
          ['Rule', text(data.ruleId), true],
          ['Device', text(data.deviceId), true],
        ],
        devices: [text(data.deviceId)],
        rules: [text(data.ruleId)],
        alerts: [id],
      };
    }
    case 'delivery': {
      const id = textOrNumber(data.alertId);
      const phase = text(data.phase);
      const status = text(data.status);
      return {
        source: 'Outbox',
        parts: plain('Event ', strong(phase ?? 'update'), ` ${status ?? 'changed'}`),
        fields: [
          ['Alert', id === null ? null : `#${id}`, true],
          ['Event', phase],
          ['Status', status],
        ],
        alerts: [id],
      };
    }
    case 'incident': {
      const id = textOrNumber(data.alertId);
      return {
        source: 'Command Center',
        parts: plain(`Incident created for alert #${id ?? '?'}`),
        fields: [
          ['Alert', id === null ? null : `#${id}`, true],
          ['Incident', text(data.externalRef), true],
        ],
        alerts: [id],
      };
    }
    case 'dependency': {
      const name = text(data.name) ?? 'A dependency';
      const from = text(data.from);
      const to = text(data.to);
      return {
        source: 'Ingest',
        parts: plain(strong(name), from === null || to === null ? ' changed' : ` ${from} → ${to}`),
        fields: [
          ['Dependency', name, true],
          ['From', from],
          ['To', to],
          ['Database', text(data.database)],
          ['Broker', text(data.broker)],
          ['Alert sink', text(data.alertSink)],
          ['Detail', text(data.detail)],
        ],
      };
    }
    default:
      return {
        source: 'Other',
        parts: plain(strong(kind), ' happened'),
        fields: [['Kind', kind, true]],
      };
  }
}

const present = (values: readonly (string | null | undefined)[] = []): string[] => [
  ...new Set(values.filter((v): v is string => typeof v === 'string' && v !== '')),
];

/** The row of one observation. A key the event lacks is left out of its fields, never shown as `undefined`. */
export function eventRow(event: ObservationEvent): EventRow {
  const described = describeEvent(event.kind, event.data);
  const parts = described.parts.filter((part) => part.text !== '');
  const at = Date.parse(event.at);
  const fields: EventField[] = [];
  const add = (label: string, value: string | null, mono = false) => {
    if (value !== null) fields.push({ label, value, mono });
  };
  add('Source', described.source);
  for (const [label, value, mono] of described.fields) add(label, value, mono ?? false);
  add('Seen by Studio', Number.isFinite(at) ? event.at : null, true);
  return {
    id: event.id,
    at: Number.isFinite(at) ? at : 0,
    kind: event.kind,
    source: described.source,
    glyph: GLYPHS[described.source],
    parts,
    message: parts.map((part) => part.text).join(''),
    fields,
    devices: present(described.devices),
    rules: present(described.rules),
    alerts: present(described.alerts),
    scenarios: present(described.scenarios),
  };
}

/** The rows of the observations, in the order given (the log hands them over newest first). */
export const eventRows = (events: readonly ObservationEvent[]): EventRow[] => events.map(eventRow);

// ---- the filter field ----

/** The keys `key:value` understands. Any other word is searched in the message. */
export const FILTER_KEYS = ['source', 'device', 'rule', 'alert', 'scenario'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface FilterTerm {
  /** `null` for a word searched in the message. */
  key: FilterKey | null;
  value: string;
}

export interface ParsedFilter {
  terms: FilterTerm[];
  /** Words that looked like `key:value` for a key that does not exist; they are searched as text. */
  unknownKeys: string[];
}

const isFilterKey = (key: string): key is FilterKey =>
  (FILTER_KEYS as readonly string[]).includes(key);

/**
 * `source:Alert device:dc-env-01 hot`: space-separated terms, every one of which must match. A term with a known key
 * (`source`, `device`, `rule`, `alert`, `scenario`) and a value matches that part of the event; anything else is a
 * word searched in the message. A word with an unknown key, such as `foo:bar`, is searched as it is and reported, so
 * the field can say so.
 */
export function parseFilter(input: string): ParsedFilter {
  const terms: FilterTerm[] = [];
  const unknownKeys: string[] = [];
  for (const token of input.trim().split(/\s+/)) {
    if (token === '') continue;
    const colon = token.indexOf(':');
    const key = colon > 0 ? token.slice(0, colon).toLowerCase() : '';
    const value = colon > 0 ? token.slice(colon + 1) : '';
    if (isFilterKey(key) && value !== '') {
      terms.push({ key, value: value.toLowerCase() });
    } else {
      if (colon > 0 && /^[a-z]+$/.test(key) && value !== '') unknownKeys.push(key);
      terms.push({ key: null, value: token.toLowerCase() });
    }
  }
  return { terms, unknownKeys: [...new Set(unknownKeys)] };
}

/** True when a word of any of the candidates starts with the value (`#` before an alert number is ignored). */
function matchesWord(candidates: readonly string[], value: string): boolean {
  const wanted = value.replace(/^#/, '');
  return candidates.some((candidate) =>
    candidate
      .toLowerCase()
      .replace(/^#/, '')
      .split(/\s+/)
      .some((word) => word.startsWith(wanted)),
  );
}

export function matchesTerm(row: EventRow, term: FilterTerm): boolean {
  switch (term.key) {
    case 'source':
      return matchesWord([row.source], term.value);
    case 'device':
      return matchesWord(row.devices, term.value);
    case 'rule':
      return matchesWord(row.rules, term.value);
    case 'alert':
      return matchesWord(row.alerts, term.value);
    case 'scenario':
      return matchesWord(row.scenarios, term.value);
    case null:
      return row.message.toLowerCase().includes(term.value);
  }
}

export const matchesFilter = (row: EventRow, filter: ParsedFilter): boolean =>
  filter.terms.every((term) => matchesTerm(row, term));

// ---- the range ----

export const RANGE_IDS = ['5m', '30m', '1h', '3h', '12h', 'custom'] as const;
export type RangeId = (typeof RANGE_IDS)[number];

export const RANGE_LABELS: Record<RangeId, string> = {
  '5m': '5m',
  '30m': '30m',
  '1h': '1h',
  '3h': '3h',
  '12h': '12h',
  custom: 'Custom',
};

const RANGE_MS: Record<Exclude<RangeId, 'custom'>, number> = {
  '5m': 5 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '3h': 3 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
};

/** The sentence that names a range in the card ("last hour"). */
export const RANGE_NAMES: Record<Exclude<RangeId, 'custom'>, string> = {
  '5m': 'last 5 minutes',
  '30m': 'last 30 minutes',
  '1h': 'last hour',
  '3h': 'last 3 hours',
  '12h': 'last 12 hours',
};

export interface TimeWindow {
  from: number;
  to: number;
}

/** The window a range covers at `now`: the last 5 minutes, hour… up to now, or the custom bounds. */
export function rangeWindow(
  range: RangeId,
  custom: { from: number | null; to: number | null },
  now: number,
): TimeWindow {
  if (range === 'custom' && custom.from !== null && custom.to !== null) {
    return { from: custom.from, to: custom.to };
  }
  return { from: now - RANGE_MS[range === 'custom' ? '1h' : range], to: now };
}

export interface EventSelection {
  range: RangeId;
  from: number | null;
  to: number | null;
  q: string;
  /** `all` or one source. */
  source: 'all' | EventSource;
}

export interface EventResult {
  /** Rows in the window, of the source, that match the filter, newest first. */
  rows: EventRow[];
  window: TimeWindow;
  filter: ParsedFilter;
}

/** Narrows the rows (newest first) by the range, the source and the filter, keeping their order. */
export function selectEvents(
  all: readonly EventRow[],
  selection: EventSelection,
  now: number,
): EventResult {
  const window = rangeWindow(selection.range, selection, now);
  const filter = parseFilter(selection.q);
  const rows = all.filter(
    (row) =>
      row.at >= window.from &&
      row.at <= window.to &&
      (selection.source === 'all' || row.source === selection.source) &&
      matchesFilter(row, filter),
  );
  return { rows, window, filter };
}
