import type { ObservedAlert, RuleInfo, StateView } from '../api/types';
import type { Sample } from '../state/history';
import { metricUnit } from './deviceIdentity';
import { STATUS_ORDER } from './deviceStatus';
import type { FleetRow } from './fleetQuery';
import { formatAmount, formatValue, isBeyond } from './rules';
import { formatClockTime } from './time';
import { deviceTopologyState, type TopologyState, worstOf } from './topologyState';

/** The newest reading of a row's first metric with a reading, as the text a node shows ("29.3 °C"). */
export function primaryReading(row: FleetRow): { metric: string; text: string } | null {
  for (const { metric, value } of row.readings) {
    if (value === null) continue;
    const unit = metricUnit(metric);
    return { metric, text: `${formatValue(metric, value)}${unit ? ` ${unit}` : ''}` };
  }
  return null;
}

/**
 * The readings at the end of a series that are all beyond the rule's raise line, oldest first. It is how Studio
 * counts toward the rule's `for`: ingest does not expose its own counter, so this is Studio's reading of what it saw.
 */
export function breachRun(series: readonly Sample[], rule: RuleInfo): Sample[] {
  let start = series.length;
  for (let i = series.length - 1; i >= 0; i--) {
    const sample = series[i];
    if (sample === undefined || !isBeyond(rule, sample.v)) break;
    start = i;
  }
  return series.slice(start);
}

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;

export type EvaluationStatus = 'raised' | 'not-raised' | 'cleared';

export interface EvaluationRow {
  label: string;
  value: string;
  /** Machine text (an id, a list of readings) is set in the monospace face. */
  mono?: boolean;
  /** The readings that are beyond the line are amber. */
  warn?: boolean;
}

export interface RuleEvaluation {
  status: EvaluationStatus;
  rows: EvaluationRow[];
  /** What the reaction time is measured between, or why it is not given; `null` when there is nothing to say. */
  note: string | null;
}

export interface RuleEvaluationInput {
  rule: RuleInfo;
  /** The newest alert of ingest for this device and rule, or `null`. */
  alert: ObservedAlert | null;
  /** The history of the rule's metric for the device. */
  series: readonly Sample[];
}

const conditionOf = (rule: RuleInfo) => {
  const unit = metricUnit(rule.metric);
  const line = `${rule.direction} ${formatAmount(rule.raise)}${unit ? ` ${unit}` : ''}`;
  return `${line}, ${rule.for} ${rule.for === 1 ? 'reading' : 'readings'} in a row`;
};

const clearsOf = (rule: RuleInfo) => {
  const unit = metricUnit(rule.metric);
  const side = rule.direction === 'above' ? 'below' : 'above';
  return `${side} ${formatAmount(rule.clear)}${unit ? ` ${unit}` : ''}`;
};

/**
 * What the rule did for this device (frame 04's "Rule evaluation"). The reaction time is from the first breaching
 * reading Studio saw to the moment ingest opened the alert: the first is a reading Studio observed, the second is
 * ingest's own `openedAt`, and the note says so. There is no "Cause" row: which Studio scenario produced the alert is
 * not known before SIM-08 (analysis, Q4).
 */
export function ruleEvaluation({ rule, alert, series }: RuleEvaluationInput): RuleEvaluation {
  const status: EvaluationStatus =
    alert === null ? 'not-raised' : alert.status === 'open' ? 'raised' : 'cleared';
  const openedAt = alert === null ? null : Date.parse(alert.openedAt);
  // The readings that matter are those up to the moment ingest opened the alert; without an alert, the newest ones.
  const before = openedAt === null ? series : series.filter((sample) => sample.t <= openedAt);
  const shown = before.slice(-rule.for);
  const rows: EvaluationRow[] = [
    { label: 'Rule', value: rule.id, mono: true },
    { label: 'Condition', value: conditionOf(rule) },
    {
      label: 'Readings',
      value:
        shown.length === 0
          ? 'none yet'
          : shown.map((sample) => formatValue(rule.metric, sample.v)).join(' · '),
      mono: shown.length > 0,
      warn: shown.length > 0 && shown.every((sample) => isBeyond(rule, sample.v)),
    },
    { label: 'Clears', value: clearsOf(rule) },
  ];

  if (alert === null) {
    rows.push({ label: 'Raised', value: 'not raised' });
    return { status, rows, note: null };
  }

  const opened = Date.parse(alert.openedAt);
  rows.push({ label: 'Raised', value: formatClockTime(opened) });
  if (alert.clearedAt !== null) {
    rows.push({ label: 'Cleared', value: formatClockTime(Date.parse(alert.clearedAt)) });
  }

  // The run of breaching readings that led to the alert: those up to its opening. If the run starts at the oldest
  // reading the history holds, the true start may be older, and no reaction time is given.
  const run = breachRun(before, rule);
  const first = run[0];
  const startsAtTheEdge = first !== undefined && first === before[0];
  if (alert.preexisting || first === undefined || run.length < rule.for || startsAtTheEdge) {
    return {
      status,
      rows,
      note: 'Reaction time is not shown: Studio did not see the readings that led to this alert.',
    };
  }
  rows.push({ label: 'Reaction time', value: seconds(opened - first.t) });
  return {
    status,
    rows,
    note: `Reaction time: first breaching reading (${formatClockTime(first.t)}) to alert opened (${formatClockTime(opened)}), as Studio observed them.`,
  };
}

export type CheckTone = 'ok' | 'warn' | 'bad' | 'unknown';

export interface StageCheck {
  id: 'broker' | 'ingest' | 'alertSink';
  label: string;
  tone: CheckTone;
  /** The chip beside the check. */
  chip: string;
  text: string;
}

export interface StageChecks {
  checks: StageCheck[];
  /** When Studio last asked ingest (ms), or `null` before the first answer. */
  lastRunAt: number | null;
}

/**
 * The Checks of frame 10: what Studio asked each dependency and what came back, in a sentence each. Nothing here is
 * a guess: where ingest does not answer, the alert sink is the last one it reported and the check says so.
 */
export function stageChecks(view: StateView, lastAlertSink: string | null): StageChecks {
  const { broker, ingest } = view;
  const answering = ingest.status === 'ready' || ingest.status === 'not-ready';

  const brokerCheck: StageCheck = broker.connected
    ? {
        id: 'broker',
        label: 'Broker',
        tone: 'ok',
        chip: 'OK',
        text: `Connected to ${broker.url} over MQTT 5`,
      }
    : {
        id: 'broker',
        label: 'Broker',
        tone: 'bad',
        chip: 'Down',
        text: `Not connected to ${broker.url}. The simulator keeps retrying, and publishing resumes by itself.`,
      };

  const ingestCheck: StageCheck = (() => {
    switch (ingest.status) {
      case 'ready':
        return {
          id: 'ingest' as const,
          label: 'Ingest',
          tone: 'ok' as const,
          chip: 'OK',
          text: 'GET /api/ready answered: ready',
        };
      case 'not-ready': {
        const down = [
          ingest.database === 'down' ? 'the database' : null,
          ingest.broker === 'down' ? 'the broker' : null,
        ].filter((name): name is string => name !== null);
        return {
          id: 'ingest' as const,
          label: 'Ingest',
          tone: 'warn' as const,
          chip: 'Check',
          text: `GET /api/ready answered: not ready${down.length > 0 ? ` (${down.join(' and ')} down for ingest)` : ''}`,
        };
      }
      case 'unreachable':
        return {
          id: 'ingest' as const,
          label: 'Ingest',
          tone: 'bad' as const,
          chip: 'Down',
          text: `GET /api/ready failed: ${ingest.detail ?? 'no reason given'}`,
        };
      default:
        return {
          id: 'ingest' as const,
          label: 'Ingest',
          tone: 'unknown' as const,
          chip: 'Checking',
          text: 'Studio has not had an answer from ingest yet.',
        };
    }
  })();

  const sink = answering ? ingest.alertSink : lastAlertSink;
  const sinkCheck: StageCheck = (() => {
    if (sink === null) {
      return {
        id: 'alertSink' as const,
        label: 'Alert sink',
        tone: 'unknown' as const,
        chip: 'Unknown',
        text: 'Ingest has not said whether it has an alert sink.',
      };
    }
    if (!answering) {
      return {
        id: 'alertSink' as const,
        label: 'Alert sink',
        tone: 'warn' as const,
        chip: 'Check',
        text: `Unknown while ingest is down. Last known: ${sink === 'none' ? 'none' : sink}`,
      };
    }
    return sink === 'none'
      ? {
          id: 'alertSink' as const,
          label: 'Alert sink',
          tone: 'warn' as const,
          chip: 'Check',
          text: 'Ingest reports alertSink: none. Alerts are recorded and marked skipped; no incident is created.',
        }
      : {
          id: 'alertSink' as const,
          label: 'Alert sink',
          tone: 'ok' as const,
          chip: 'OK',
          text: `Ingest reports alertSink: ${sink}`,
        };
  })();

  return {
    checks: [brokerCheck, ingestCheck, sinkCheck],
    lastRunAt: ingest.lastCheckedAt === null ? null : Date.parse(ingest.lastCheckedAt),
  };
}

export interface ZoneMember {
  id: string;
  name: string;
  code: string;
  /** The device's own word: "Running", "Anomaly", "Silent", "Paused"… */
  word: string;
  state: TopologyState;
  reading: string | null;
}

export interface ZoneSummary {
  zone: string;
  count: number;
  worst: TopologyState;
  /** Problems first, then by id, so the list a person reads starts with what needs them. */
  members: ZoneMember[];
}

/** A zone as the detail row lists it; `null` for a zone with no device. */
export function zoneSummary(rows: readonly FleetRow[], zone: string): ZoneSummary | null {
  const inZone = rows.filter((row) => row.device.zoneCode === zone);
  const worst = worstOf(inZone.map((row) => deviceTopologyState(row.status.kind)));
  if (worst === null) return null;
  const members = [...inZone]
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status.kind) - STATUS_ORDER.indexOf(b.status.kind) ||
        a.device.id.localeCompare(b.device.id, 'en', { numeric: true }),
    )
    .map((row) => ({
      id: row.device.id,
      name: row.name,
      code: row.code,
      word: row.status.word,
      state: deviceTopologyState(row.status.kind),
      reading: primaryReading(row)?.text ?? null,
    }));
  return { zone, count: inZone.length, worst, members };
}
