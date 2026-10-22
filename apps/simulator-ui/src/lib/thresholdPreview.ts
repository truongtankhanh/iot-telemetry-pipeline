import type { Anomaly, DeviceInfo, Expected, RulesView, ScenarioItem } from '../api/types';
import { ruleSentence, rulesFor } from './rules';
import { seconds } from './scenarioExpectation';

/**
 * What the editor's inspector shows about the selected anomaly: the card chart of its signal (the value against the rule's
 * raise and clear lines, with the alert and the clear as flags), the rule in words, and what the rules should do with it. All of
 * it comes from what the simulator worked out for the whole scenario; nothing is computed here but a filter.
 */

type Signal = Pick<Anomaly, 'deviceId' | 'metric'>;

const sameSignal =
  (wanted: Signal) =>
  (other: Signal): boolean =>
    other.deviceId === wanted.deviceId && other.metric === wanted.metric;

const end = (anomaly: Anomaly) => anomaly.startAt + anomaly.duration;

/**
 * The scenario as the chart of a card wants it, narrowed to the selected anomaly's signal: every anomaly on that device and
 * metric, and the simulator's series, alerts and quiet notes for it. `null` when there is nothing honest to draw (no answer yet,
 * the rules could not be read, or no series for the signal).
 */
export function previewItem(
  anomalies: readonly Anomaly[],
  selected: Anomaly | null,
  expected: Expected | null,
): ScenarioItem | null {
  if (selected === null || expected === null || !expected.available) return null;
  const mine = anomalies.filter(sameSignal(selected));
  const series = expected.series.filter(sameSignal(selected));
  if (series.length === 0 || mine.length === 0) return null;
  return {
    name: 'preview',
    description: '',
    source: 'custom',
    imported: false,
    anomalies: mine,
    lengthS: Math.max(...mine.map(end)),
    needsStart: [],
    lastRunAt: null,
    running: false,
    expected: {
      ...expected,
      alerts: expected.alerts.filter(sameSignal(selected)),
      quiet: expected.quiet.filter(sameSignal(selected)),
      series,
    },
  };
}

/** "raise 27 · clear 25.5 · opens after 3 readings in a row" for the rule that watches the signal, or `null` when none does. */
export function ruleLineFor(
  rules: RulesView,
  devices: readonly DeviceInfo[],
  anomaly: Anomaly,
): string | null {
  const device = devices.find((candidate) => candidate.id === anomaly.deviceId);
  if (device === undefined) return null;
  const rule = rulesFor(rules, device, anomaly.metric)[0];
  return rule === undefined ? null : ruleSentence(rule);
}

/**
 * What the rules should do with the signal of the selected anomaly, as one or two sentences in the words of the scenario
 * cards: "Raises Server room temperature high (high) about 50 s; clears about 106 s."
 */
export function raisesFor(expected: Expected | null, anomaly: Anomaly): string {
  if (expected === null) return 'Working out the alerts…';
  if (!expected.available) return `Expected alerts are not available: ${expected.reason}`;
  const alerts = expected.alerts.filter(sameSignal(anomaly));
  if (alerts.length === 0) {
    const quiet = expected.quiet.find(sameSignal(anomaly));
    if (quiet?.why === 'no-rule')
      return `No rule watches ${anomaly.metric} on ${anomaly.deviceId}.`;
    if (quiet?.why === 'never-crosses') {
      return `${anomaly.metric} on ${anomaly.deviceId} never goes beyond a raise line.`;
    }
    return 'Raises no alert.';
  }
  return alerts
    .map((alert) => {
      const clears =
        alert.clearsAtS === null
          ? 'clear time not known'
          : `clears about ${seconds(alert.clearsAtS)}${alert.clearsUncertain ? ' or later' : ''}`;
      return `Raises ${alert.title} (${alert.severity}) about ${seconds(alert.opensAtS)}; ${clears}.`;
    })
    .join(' ');
}
