import type { StateView } from '../api/types';
import { formatClockTime } from './time';

export interface DependencyNote {
  id:
    | 'broker-disconnected'
    | 'ingest-unreachable'
    | 'ingest-not-ready'
    | 'no-alert-sink'
    | 'delivery-failing';
  /** `bad` stops something; `warn` limits what the demo can show. */
  tone: 'warn' | 'bad';
  title: string;
  text: string;
}

/**
 * In a sentence each, what is wrong with what the pipeline depends on, and what it means for the demo
 * ("an unexpected state must explain itself in a sentence, not in a stack trace", the brief). Nothing is
 * said when everything is fine. While ingest does not answer, the alert sink is the last one it reported.
 */
export function dependencyNotes(
  view: StateView | null,
  lastAlertSink: string | null,
): DependencyNote[] {
  if (view === null) return [];
  const notes: DependencyNote[] = [];
  const { ingest } = view;

  if (!view.broker.connected) {
    notes.push({
      id: 'broker-disconnected',
      tone: 'bad',
      title: 'The simulator is not connected to the broker',
      text: 'Nothing is being published. It keeps retrying, and publishing resumes by itself.',
    });
  }

  if (ingest.status === 'unreachable') {
    const since = ingest.since ? ` since ${formatClockTime(Date.parse(ingest.since))}` : '';
    notes.push({
      id: 'ingest-unreachable',
      tone: 'bad',
      title: 'Ingest is unreachable',
      text: `Studio cannot reach ${view.config.ingestUrl}${since}${ingest.detail ? ` (${ingest.detail})` : ''}. Publishing continues; nothing downstream can be shown.`,
    });
  } else if (ingest.status === 'not-ready') {
    const down = [
      ingest.database === 'down' ? 'the database' : null,
      ingest.broker === 'down' ? 'the broker' : null,
    ]
      .filter((name): name is string => name !== null)
      .join(' and ');
    notes.push({
      id: 'ingest-not-ready',
      tone: 'warn',
      title: 'Ingest is not ready',
      text: down
        ? `Ingest answers, but ${down} ${down.includes(' and ') ? 'are' : 'is'} down for it, so it is not storing what arrives.`
        : 'Ingest answers but says it is not ready.',
    });
  }

  const answering = ingest.status === 'ready' || ingest.status === 'not-ready';
  const sink = answering ? ingest.alertSink : lastAlertSink;
  if (sink === 'none') {
    notes.push({
      id: 'no-alert-sink',
      tone: 'warn',
      title: 'No alert sink',
      text: `${answering ? 'Ingest reports' : 'The last time ingest answered it reported'} alertSink: none. Alerts are recorded and marked skipped, and no incident is created in the Command Center.`,
    });
  } else if (
    sink !== null &&
    view.alerts.alerts.some((alert) => alert.deliveryStatus === 'failed')
  ) {
    notes.push({
      id: 'delivery-failing',
      tone: 'bad',
      title: 'Delivery to the Command Center is failing',
      text: 'At least one alert could not be delivered. Ingest retries; the alert trail shows the error.',
    });
  }

  return notes;
}
