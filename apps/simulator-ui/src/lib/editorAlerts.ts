import type { Expected, ExpectedAlert, Severity } from '../api/types';
import { seconds } from './scenarioExpectation';

/**
 * The expected alerts of the timeline editor's table, from what the simulator worked out (`POST /api/expectations`): the
 * rows, the sentence that says what they rest on, and the notes for what raises nothing. No time is computed here; this only
 * words the simulator's numbers, in the way the scenario cards do, and says when an alert falls after the scenario ends.
 */

export interface AlertRow {
  key: string;
  ruleId: string;
  title: string;
  severity: Severity;
  deviceId: string;
  metric: string;
  /** "about 50 s", and that it comes after the scenario ends when it does. */
  raised: string;
  /** "about 106 s", "about 106 s or later", "clear time not known", and when it comes after the scenario ends. */
  clears: string;
  opensAtS: number;
  clearsAtS: number | null;
  /** The alert opens or clears after the last anomaly ends (an open bar in the picture). */
  afterEnd: boolean;
}

export interface AlertsView {
  rows: AlertRow[];
  /** Why there are no rows ("Expected alerts are not available: …", "No alert is expected."), or `null` when there are some. */
  empty: string | null;
  /** What the numbers rest on: the rules and the publish interval, and that they are a best case. */
  basis: string | null;
  /** What the rows cannot say by themselves: a margin, a clear that may not come, an anomaly no rule watches. */
  notes: string[];
}

const endSentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

function raisedText(alert: ExpectedAlert, lengthS: number): string {
  const text = `about ${seconds(alert.opensAtS)}`;
  return alert.opensAtS > lengthS ? `${text}, after the scenario ends` : text;
}

function clearsText(alert: ExpectedAlert, lengthS: number): string {
  if (alert.clearsAtS === null) return 'clear time not known';
  const text = `about ${seconds(alert.clearsAtS)}${alert.clearsUncertain ? ' or later' : ''}`;
  return alert.clearsAtS > lengthS ? `${text}, after the scenario ends` : text;
}

/** What raises nothing or may not behave, in the words of the scenario cards. */
export function quietNotes(expected: Extract<Expected, { available: true }>): string[] {
  const notes: string[] = [];
  for (const alert of expected.alerts) {
    if (alert.opensMargin) {
      notes.push(
        `${alert.title} is so close to its raise line that it may open later, or not at all.`,
      );
    }
    if (alert.clearsAtS === null) {
      notes.push(`${alert.title} may not clear while the baseline stays near its daily peak.`);
    }
  }
  for (const quiet of expected.quiet) {
    notes.push(
      quiet.why === 'no-rule'
        ? `No rule watches ${quiet.metric} on ${quiet.deviceId}.`
        : `${quiet.metric} on ${quiet.deviceId} never goes beyond a raise line.`,
    );
  }
  return notes;
}

/**
 * The table's content. `expected` is `null` while the simulator is being asked, and then there is nothing to say yet.
 * `lengthS` is the scenario's length, to tell an alert that falls after its end.
 */
export function alertsView(expected: Expected | null, lengthS: number): AlertsView {
  if (expected === null) return { rows: [], empty: null, basis: null, notes: [] };
  if (!expected.available) {
    return {
      rows: [],
      empty: `Expected alerts are not available: ${endSentence(expected.reason)}`,
      basis: null,
      notes: [],
    };
  }
  const rows = [...expected.alerts]
    .sort((a, b) => a.opensAtS - b.opensAtS || a.deviceId.localeCompare(b.deviceId))
    .map((alert): AlertRow => ({
      key: `${alert.ruleId}|${alert.deviceId}|${alert.metric}|${alert.opensAtS}`,
      ruleId: alert.ruleId,
      title: alert.title,
      severity: alert.severity,
      deviceId: alert.deviceId,
      metric: alert.metric,
      raised: raisedText(alert, lengthS),
      clears: clearsText(alert, lengthS),
      opensAtS: alert.opensAtS,
      clearsAtS: alert.clearsAtS,
      afterEnd: alert.opensAtS > lengthS || (alert.clearsAtS !== null && alert.clearsAtS > lengthS),
    }));
  return {
    rows,
    empty: rows.length === 0 ? 'No alert is expected.' : null,
    basis: `Worked out from the rules and the ${seconds(expected.intervalS)} publish interval; a device that is already running can be up to one interval later.`,
    notes: quietNotes(expected),
  };
}
