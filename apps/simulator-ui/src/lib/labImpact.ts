import type { Expected, ExpectedAlert, ExpectationPreview } from '../api/types';
import { nameList } from './holdTargets';
import { seconds } from './scenarioExpectation';

/**
 * The words of the expected-impact strip (frames 12 and 19), as pure functions of what the simulator said (`getExpected`)
 * and of the fault. Nothing here works out a time: it says the simulator's numbers, as "about", and says that they are
 * designed from the rules and not observed. When it cannot say (the rules, a stopped device, a signal no rule watches)
 * the strip says so in words instead of staying empty.
 */

export interface ImpactChip {
  id: 'rule' | 'alert' | 'incident' | 'clear';
  tone: 'neutral' | 'warn' | 'ok';
  text: string;
}

export interface ImpactView {
  /** `message` is all there is to say (nothing chosen, still working it out, a refusal, no rules). */
  kind: 'message' | 'chips';
  message: string | null;
  chips: ImpactChip[];
  /** What the chips cannot say by themselves. */
  notes: string[];
}

/** The state of the question to the simulator, as `useExpectedImpact` reports it. */
export type ImpactStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ImpactInput {
  status: ImpactStatus;
  preview: ExpectationPreview | null;
  error: string | null;
  /** Where ingest delivers alerts: `ops-command-center`, `none` (no command center), or `null` when not known. */
  sink: string | null;
}

const message = (text: string): ImpactView => ({
  kind: 'message',
  message: text,
  chips: [],
  notes: [],
});

const range = (values: readonly number[]): string => {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? seconds(low) : `${low} to ${high} s`;
};

function chipsOf(alerts: readonly ExpectedAlert[], sink: string | null): ImpactChip[] {
  const rules = [...new Set(alerts.map((alert) => alert.ruleId))];
  const chips: ImpactChip[] = [
    { id: 'rule', tone: 'neutral', text: rules.length === 1 ? rules[0]! : `${rules.length} rules` },
  ];
  const opens = alerts.map((alert) => alert.opensAtS);
  chips.push({
    id: 'alert',
    tone: 'warn',
    text:
      alerts.length === 1
        ? `Alert, ${alerts[0]!.severity} · about ${seconds(opens[0]!)}`
        : `Up to ${alerts.length} alerts · ${range(opens)}`,
  });
  chips.push(
    sink === 'none'
      ? { id: 'incident', tone: 'neutral', text: 'No command center: no incident' }
      : sink === null
        ? { id: 'incident', tone: 'neutral', text: 'Incident in OCC: not known' }
        : { id: 'incident', tone: 'ok', text: 'Incident in OCC' },
  );
  const clears = alerts.map((alert) => alert.clearsAtS);
  const known = clears.filter((t): t is number => t !== null);
  chips.push({
    id: 'clear',
    tone: 'ok',
    text:
      known.length < clears.length
        ? 'Clear time not known'
        : alerts.length === 1
          ? `Clears about ${seconds(known[0]!)}`
          : `All clear about ${seconds(Math.max(...known))}`,
  });
  return chips;
}

function notesOf(
  expected: Extract<Expected, { available: true }>,
  preview: ExpectationPreview,
): string[] {
  const notes: string[] = [
    'Worked out from the rules and the publish interval, not observed. Times are seconds from now.',
  ];
  if (preview.needsStart.length > 0) {
    const ids = preview.needsStart.map((need) => need.deviceId);
    const many = ids.length > 1;
    notes.push(
      `${nameList(ids, 3)} ${many ? 'are' : 'is'} not running. Injecting does not start ${many ? 'them' : 'it'}, so nothing is published until ${many ? 'they are' : 'it is'} started.`,
    );
  }
  if (expected.alerts.some((alert) => alert.opensMargin)) {
    notes.push(
      'A reading is within the jitter of the raise line: an alert may open later, or not at all.',
    );
  }
  if (expected.alerts.some((alert) => alert.clearsUncertain)) {
    notes.push('A clear may take longer: the baseline is within the noise of the clear line.');
  }
  const quiet = expected.quiet.map(
    (q) =>
      `${q.deviceId} ${q.metric}: ${q.why === 'no-rule' ? 'no rule watches it' : "it never crosses a rule's line"}.`,
  );
  notes.push(...quiet.slice(0, 2));
  if (quiet.length > 2) notes.push(`and ${quiet.length - 2} more raise nothing.`);
  return notes;
}

/** What the strip says. */
export function impactView({ status, preview, error, sink }: ImpactInput): ImpactView {
  if (status === 'idle')
    return message('Choose a target and a fault to see what the rules should do.');
  if (status === 'error' && error !== null) return message(error);
  if (preview === null) return message('Working out what the rules should do…');
  const { expected } = preview;
  if (!expected.available) return message(`Expected alerts are not available: ${expected.reason}`);

  const notes = notesOf(expected, preview);
  if (expected.alerts.length === 0) {
    return {
      kind: 'chips',
      message: null,
      chips: [{ id: 'alert', tone: 'neutral', text: 'No alert expected' }],
      notes,
    };
  }
  return { kind: 'chips', message: null, chips: chipsOf(expected.alerts, sink), notes };
}
