import type { ExpectedAlert, ScenarioItem } from '../api/types';

/**
 * The words of a scenario card, as pure functions of the `ScenarioItem` the simulator sent. Nothing here works out an
 * alert time: the simulator did (`expected`), and a card only says it. Times are plain seconds from the start of the
 * scenario, never `t+N`. They are a best case to within one publish interval, which is why they read "about".
 */

/** The most devices a card lists as chips before it says "+ n". */
export const CHIP_LIMIT = 6;
/** Up to this many alerts a card names their severities in order; above it, it counts them by severity. */
const NAMED_SEVERITIES = 3;

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

/** `24 s`, or `22.5 s` when the time is not a whole second. */
export function seconds(value: number): string {
  return Number.isInteger(value) ? `${value} s` : `${Math.round(value * 10) / 10} s`;
}

/** "built-in · 1 anomaly · 80 s", "custom · imported · 3 anomalies · 120 s". */
export function scenarioMeta(item: ScenarioItem): string {
  const count = item.anomalies.length;
  return [
    item.source,
    ...(item.imported ? ['imported'] : []),
    `${count} ${count === 1 ? 'anomaly' : 'anomalies'}`,
    seconds(item.lengthS),
  ].join(' · ');
}

/** The device chips of a card; a scenario of one anomaly also says what the metric is moved to. */
export function scenarioChips(item: ScenarioItem): string[] {
  const only = item.anomalies.length === 1 ? item.anomalies[0] : undefined;
  if (only) return [only.deviceId, `${only.metric} → ${only.value}`];
  const devices = [...new Set(item.anomalies.map((anomaly) => anomaly.deviceId))];
  const shown = devices.slice(0, CHIP_LIMIT);
  return devices.length > CHIP_LIMIT ? [...shown, `+ ${devices.length - CHIP_LIMIT}`] : shown;
}

/** What the card says the rules should do: before the emphasised part, the part (a rule title), and after it. */
export interface ExpectationView {
  kind: 'alerts' | 'none' | 'unavailable';
  before: string;
  /** A rule title, drawn in bold; empty when there is none. */
  strong: string;
  after: string;
  /** What the sentence cannot say by itself: a margin, a clear that may not come, an anomaly no rule watches. */
  notes: string[];
}

const endSentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

function clearsPart(alert: ExpectedAlert): string {
  if (alert.clearsAtS === null) return 'clear time not known';
  return `clears about ${seconds(alert.clearsAtS)}${alert.clearsUncertain ? ' or later' : ''}`;
}

function severitySummary(alerts: readonly ExpectedAlert[]): string {
  if (alerts.length <= NAMED_SEVERITIES) return alerts.map((alert) => alert.severity).join(', ');
  return SEVERITY_ORDER.map(
    (severity) => [severity, alerts.filter((alert) => alert.severity === severity).length] as const,
  )
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${severity} ${count}`)
    .join(', ');
}

/** "Raises Server room temperature high (high) about 24 s; clears about 80 s." and what goes with it. */
export function expectationView(item: ScenarioItem): ExpectationView {
  const { expected } = item;
  if (!expected.available) {
    return {
      kind: 'unavailable',
      before: 'Expected alerts are not available: ',
      strong: '',
      after: endSentence(expected.reason),
      notes: [],
    };
  }

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

  const [only, ...rest] = expected.alerts;
  if (only === undefined) {
    return { kind: 'none', before: 'Raises no alert.', strong: '', after: '', notes };
  }
  if (rest.length === 0) {
    return {
      kind: 'alerts',
      before: 'Raises ',
      strong: only.title,
      after: ` (${only.severity}) about ${seconds(only.opensAtS)}; ${clearsPart(only)}.`,
      notes,
    };
  }
  return {
    kind: 'alerts',
    before: `Raises ${expected.alerts.length} alerts: `,
    strong: '',
    after: `${severitySummary(expected.alerts)}.`,
    notes,
  };
}

const VERBS = { step: 'held at', ramp: 'rising to', spike: 'spiking to' } as const;

/**
 * What the chart says, in a sentence, for `role="img"`: every anomaly, the alert and the clear, and where the playhead
 * is while the scenario runs (`nowS`, seconds from its start; `null` when it does not).
 */
export function chartDescription(item: ScenarioItem, nowS: number | null): string {
  const anomalies = item.anomalies.map(
    (a) =>
      `${a.deviceId} ${a.metric} ${VERBS[a.shape ?? 'step']} ${a.value} from ${seconds(a.startAt)} for ${seconds(a.duration)}`,
  );

  let alerts: string;
  const { expected } = item;
  if (!expected.available) {
    alerts = 'expected alerts are not available';
  } else if (expected.alerts.length === 0) {
    alerts = 'no alert expected';
  } else if (expected.alerts.length === 1) {
    const alert = expected.alerts[0]!;
    const clear =
      alert.clearsAtS === null
        ? 'clear time not known'
        : `clears at ${seconds(alert.clearsAtS)}${alert.clearsUncertain ? ' or later' : ''}`;
    alerts = `alert expected at ${seconds(alert.opensAtS)}, ${clear}`;
  } else {
    alerts = `${expected.alerts.length} alerts expected, the first at ${seconds(expected.alerts[0]!.opensAtS)}`;
  }

  const parts = [
    anomalies.join('; '),
    alerts,
    ...(nowS === null ? [] : [`now at ${seconds(nowS)}`]),
  ];
  return `${item.name}: ${parts.join('; ')}`;
}
