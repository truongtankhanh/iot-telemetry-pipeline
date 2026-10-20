import type { PagedAlert, RuleInfo } from '../api/types';
import type { Sample } from '../state/history';
import { metricUnit } from './deviceIdentity';
import { formatValue } from './rules';
import { breachRun } from './topologyDetail';

/** Whose clock a time on the trail is, so two clocks in one list are never mistaken for one. */
export type Provenance = 'recorded reading' | 'ingest' | 'observed';

/** The mark a step carries; `ui/icons.ts` gives each its glyph. */
export type TrailGlyph = 'reading' | 'rule' | 'alert' | 'outbox' | 'incident' | 'clear';

export type TrailTone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface TrailStep {
  id: 'first-breach' | 'raised' | 'opened' | 'outbox' | 'incident' | 'cleared' | 'clear-outbox';
  title: string;
  detail: string;
  /** The detail is machine text (an id), set in the monospace face. */
  mono?: boolean;
  tone: TrailTone;
  glyph: TrailGlyph;
  /** When it happened (ms), or `null` when Studio does not know. */
  time: number | null;
  /** Whose clock `time` is on; `null` with no time. */
  provenance: Provenance | null;
}

export interface AlertTrail {
  steps: TrailStep[];
  /** Said under the trail: what the times mean, and why a step is missing or means less than it seems. */
  notes: string[];
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const timeOf = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

const withUnit = (metric: string, text: string) => {
  const unit = metricUnit(metric);
  return unit === '' ? text : `${text} ${unit}`;
};

const OBSERVED_NOTE =
  'Times marked observed are when Studio first saw the state change, to within its 1 s polling interval: GET /api/alerts has no delivery timestamp.';

type Phase = 'opened' | 'cleared';

/**
 * The step for one outbox event, from what is known of it. Ingest reports only the status of an alert's **latest**
 * event, so that status is the opening's for an open alert and the clearing's for a cleared one; the opening's
 * delivery of a cleared alert is known only if Studio saw it, or from the incident id that exists once it happened.
 */
function deliveryStep(alert: PagedAlert, phase: Phase): TrailStep {
  const id = phase === 'opened' ? 'outbox' : 'clear-outbox';
  const word = phase === 'opened' ? 'Outbox' : 'Clear';
  const observedAt = timeOf(alert.observed.delivered[phase]);
  const latest = phase === 'opened' ? alert.status === 'open' : alert.status === 'cleared';
  const attempts =
    alert.deliveryAttempts === null ? '' : `${plural(alert.deliveryAttempts, 'attempt')} · `;
  const seen = (time: number | null) => ({
    time,
    provenance: time === null ? null : ('observed' as const),
  });

  if (!latest) {
    // The opening of an alert that has cleared: ingest now reports the clearing's status.
    if (observedAt !== null) {
      return {
        id,
        title: 'Outbox delivered',
        detail: 'first seen delivered by Studio',
        tone: 'ok',
        glyph: 'outbox',
        ...seen(observedAt),
      };
    }
    if (alert.externalRef !== null) {
      return {
        id,
        title: 'Outbox delivered',
        detail: 'the incident exists; Studio did not see when it was delivered',
        tone: 'ok',
        glyph: 'outbox',
        ...seen(null),
      };
    }
    return {
      id,
      title: 'Opening delivery not known',
      detail: 'Ingest reports only the latest event, and Studio did not see this one',
      tone: 'neutral',
      glyph: 'outbox',
      ...seen(null),
    };
  }

  switch (alert.deliveryStatus) {
    case 'delivered':
      return {
        id,
        title: phase === 'opened' ? 'Outbox delivered' : 'Clear delivered',
        detail: `${attempts}${observedAt === null ? 'delivered before Studio saw it' : 'first seen delivered by Studio'}`,
        tone: 'ok',
        glyph: 'outbox',
        ...seen(observedAt),
      };
    case 'pending':
      return {
        id,
        title: `${word} ${phase === 'opened' ? 'pending' : 'delivery pending'}`,
        detail: attempts === '' ? 'waiting for the outbox worker' : `${attempts}not delivered yet`,
        tone: 'warn',
        glyph: 'outbox',
        ...seen(null),
      };
    case 'failed':
      return {
        id,
        title: phase === 'opened' ? 'Outbox delivery failed' : 'Clear delivery failed',
        detail: `${attempts}${alert.deliveryError ?? 'no reason given'}`,
        tone: 'bad',
        glyph: 'outbox',
        ...seen(null),
      };
    case 'skipped':
      return {
        id,
        title: phase === 'opened' ? 'Delivery skipped' : 'Clear delivery skipped',
        detail: 'no alert sink was configured when this was raised (OCC_API_URL unset on ingest)',
        tone: 'neutral',
        glyph: 'outbox',
        ...seen(null),
      };
    default:
      // A status ingest adds later, or none: said as unknown, never as delivered.
      return {
        id,
        title: 'Delivery unknown',
        detail: 'ingest reports no delivery state for this alert',
        tone: 'neutral',
        glyph: 'outbox',
        ...seen(null),
      };
  }
}

/** The first breaching reading, or why there is none: it needs the whole run that led to the alert to be on record. */
function firstBreach(
  alert: PagedAlert,
  rule: RuleInfo | null,
  series: readonly Sample[],
): TrailStep | null {
  if (rule === null || alert.preexisting) return null;
  const openedMs = timeOf(alert.openedAt);
  if (openedMs === null) return null;
  const before = series.filter((sample) => sample.t <= openedMs);
  const run = breachRun(before, rule);
  const first = run[0];
  // A run that starts at the oldest reading held may have started earlier: its start is not known.
  if (first === undefined || run.length < rule.for || first === before[0]) return null;
  return {
    id: 'first-breach',
    title: 'First breaching reading',
    detail: `${withUnit(rule.metric, formatValue(rule.metric, first.v))}, ${rule.direction} the raise threshold`,
    tone: 'warn',
    glyph: 'reading',
    time: first.t,
    provenance: 'recorded reading',
  };
}

/**
 * The trail of an alert from the first breaching reading to the incident (frame 13), and, for a cleared alert, its
 * clearing and the delivery of that. Each step says whose clock its time is on; a step Studio cannot honestly
 * give is left out, and a note says why. A delivery that did not happen (`pending`, `failed`, `skipped`, unknown)
 * has no incident step after it.
 */
export function alertTrail({
  alert,
  rule,
  series,
}: {
  alert: PagedAlert;
  rule: RuleInfo | null;
  series: readonly Sample[];
}): AlertTrail {
  const steps: TrailStep[] = [];
  const notes: string[] = [];

  const first = firstBreach(alert, rule, series);
  if (first) steps.push(first);
  else {
    notes.push(
      'The first breaching reading is not shown: Studio did not record the readings that led to this alert.',
    );
  }

  steps.push({
    id: 'raised',
    title: 'Rule raised',
    detail: rule === null ? alert.ruleId : `${rule.id} · ${rule.for} of ${rule.for}`,
    mono: true,
    tone: 'warn',
    glyph: 'rule',
    time: timeOf(alert.openedAt),
    provenance: 'ingest',
  });
  steps.push({
    id: 'opened',
    title: 'Alert opened',
    detail: `${alert.severity} · recorded in PostgreSQL`,
    tone: 'warn',
    glyph: 'alert',
    time: timeOf(alert.openedAt),
    provenance: 'ingest',
  });

  steps.push(deliveryStep(alert, 'opened'));
  if (alert.externalRef !== null) {
    const incident = timeOf(alert.observed.incident);
    steps.push({
      id: 'incident',
      title: 'Incident in Command Center',
      detail: alert.externalRef,
      mono: true,
      tone: 'ok',
      glyph: 'incident',
      time: incident,
      provenance: incident === null ? null : 'observed',
    });
  }

  if (alert.status === 'cleared') {
    const clearedMs = timeOf(alert.clearedAt);
    steps.push({
      id: 'cleared',
      title: 'Alert cleared',
      detail:
        alert.clearedValue === null
          ? 'the reading came back past the clear line'
          : `back to ${withUnit(alert.metric, formatValue(alert.metric, alert.clearedValue))}`,
      tone: 'ok',
      glyph: 'clear',
      time: clearedMs,
      provenance: clearedMs === null ? null : 'ingest',
    });
    steps.push(deliveryStep(alert, 'cleared'));
    notes.push(
      'The delivery in the list is that of the latest outbox event, which for a cleared alert is the clearing.',
    );
  }

  notes.push(OBSERVED_NOTE);
  return { steps, notes };
}
