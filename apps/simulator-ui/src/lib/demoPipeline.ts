import type { IngestStatus } from '../api/types';

export type DemoStageId = 'device' | 'ingest' | 'rule' | 'alert' | 'commandCenter';

/**
 * `live`: working now. `fired`: it has just done what the demo is about (the rule raised, the alert is open). `done`: it has done
 * it and finished (the alert cleared, the incident exists). `idle`: nothing has reached it yet. Each is also said in words (the stage's
 * `caption`), so a state is never colour alone.
 */
export type DemoStageState = 'live' | 'fired' | 'done' | 'idle';

export const DEMO_STAGE_ORDER: readonly DemoStageId[] = [
  'device',
  'ingest',
  'rule',
  'alert',
  'commandCenter',
];

export const DEMO_STAGE_LABELS: Record<DemoStageId, string> = {
  device: 'Device',
  ingest: 'Ingest',
  rule: 'Rule',
  alert: 'Alert',
  commandCenter: 'Command Center',
};

export interface DemoStage {
  id: DemoStageId;
  label: string;
  /** The big figure: "29.3", "0.04", "2", or a dash while nothing has reached the stage. */
  value: string;
  /** The small unit after it: "°C", "s lag", "of 3"; `null` for none. */
  unit: string | null;
  /** The line under it, in words: "dc-env-01", "counting", "not yet". */
  caption: string;
  state: DemoStageState;
  /** The figure is an old answer (the link to the simulator is lost, or ingest does not answer): drawn dimmed. */
  dimmed: boolean;
}

/** What the strip is drawn from: what Studio already knows, worked out by the page from the stores. */
export interface DemoPipelineInput {
  deviceId: string;
  /** The newest reading of the subject metric, with its unit; `null` before the first. */
  reading: { value: string; unit: string } | null;
  ingestStatus: IngestStatus;
  /** Mean seconds from measurement to storage between the last two reads of ingest's metrics; `null` when it cannot be told. */
  lagSeconds: number | null;
  /** The rule's count: readings in a row beyond the raise line, and how many it needs; `null` without a rule. */
  rule: { counted: number; of: number } | null;
  /** The rule has raised (Studio's count reached `of`), or an alert of it has opened. */
  ruleRaised: boolean;
  alert: 'none' | 'open' | 'cleared';
  /** An incident has been delivered for the alert. */
  incident: boolean;
  /** `none` when ingest has no command center. */
  alertSink: string | null;
  /** The link to the simulator is lost: every figure is an old answer. */
  linkLost: boolean;
}

const fixed = (n: number, digits: number) => n.toFixed(digits);

/** The five stages of the demo's strip (frame 08), in the order a reading and its incident pass through them. */
export function demoPipeline(input: DemoPipelineInput): DemoStage[] {
  const { linkLost } = input;
  const ingestDown = input.ingestStatus === 'unreachable';

  const device: DemoStage =
    input.reading === null
      ? {
          id: 'device',
          label: DEMO_STAGE_LABELS.device,
          value: '—',
          unit: null,
          caption: `${input.deviceId}, no reading yet`,
          state: 'idle',
          dimmed: linkLost,
        }
      : {
          id: 'device',
          label: DEMO_STAGE_LABELS.device,
          value: input.reading.value,
          unit: input.reading.unit === '' ? null : input.reading.unit,
          caption: input.deviceId,
          state: linkLost ? 'idle' : 'live',
          dimmed: linkLost,
        };

  let ingest: DemoStage;
  if (ingestDown) {
    ingest = {
      id: 'ingest',
      label: DEMO_STAGE_LABELS.ingest,
      value: '—',
      unit: null,
      caption: 'unreachable',
      state: 'idle',
      dimmed: true,
    };
  } else if (input.ingestStatus === 'not-ready') {
    ingest = {
      id: 'ingest',
      label: DEMO_STAGE_LABELS.ingest,
      value: '—',
      unit: null,
      caption: 'not ready',
      state: 'idle',
      dimmed: linkLost,
    };
  } else {
    const lag = input.lagSeconds;
    ingest = {
      id: 'ingest',
      label: DEMO_STAGE_LABELS.ingest,
      value: lag === null ? '—' : fixed(lag, lag < 1 ? 2 : 1),
      unit: lag === null ? null : 's lag',
      caption: input.ingestStatus === 'ready' ? 'storing readings' : 'waiting for ingest',
      state: input.ingestStatus === 'ready' && !linkLost ? 'live' : 'idle',
      dimmed: linkLost,
    };
  }

  const alertSeen = input.alert !== 'none';
  let rule: DemoStage;
  if (input.alert === 'cleared') {
    rule = {
      id: 'rule',
      label: DEMO_STAGE_LABELS.rule,
      value: input.rule === null ? '—' : String(input.rule.of),
      unit: input.rule === null ? null : `of ${input.rule.of}`,
      caption: 'cleared',
      state: 'done',
      dimmed: linkLost,
    };
  } else if (input.ruleRaised || alertSeen) {
    rule = {
      id: 'rule',
      label: DEMO_STAGE_LABELS.rule,
      value: input.rule === null ? '—' : String(input.rule.of),
      unit: input.rule === null ? null : `of ${input.rule.of}`,
      caption: 'raised',
      state: 'fired',
      dimmed: linkLost,
    };
  } else if (input.rule !== null && input.rule.counted > 0) {
    rule = {
      id: 'rule',
      label: DEMO_STAGE_LABELS.rule,
      value: String(input.rule.counted),
      unit: `of ${input.rule.of}`,
      caption: 'counting',
      state: 'live',
      dimmed: linkLost,
    };
  } else {
    rule = {
      id: 'rule',
      label: DEMO_STAGE_LABELS.rule,
      value: '—',
      unit: null,
      caption: input.rule === null ? 'no rule to read' : 'watching',
      state: 'idle',
      dimmed: linkLost,
    };
  }

  const alert: DemoStage = {
    id: 'alert',
    label: DEMO_STAGE_LABELS.alert,
    value: input.alert === 'none' ? '—' : input.alert === 'open' ? 'Open' : 'Cleared',
    unit: null,
    caption: input.alert === 'none' ? 'not yet' : input.alert === 'open' ? 'opened' : 'cleared',
    state: input.alert === 'none' ? 'idle' : input.alert === 'open' ? 'fired' : 'done',
    dimmed: linkLost || ingestDown,
  };

  const commandCenter: DemoStage = input.incident
    ? {
        id: 'commandCenter',
        label: DEMO_STAGE_LABELS.commandCenter,
        value: 'Incident',
        unit: null,
        caption: 'opened',
        state: 'done',
        dimmed: linkLost,
      }
    : {
        id: 'commandCenter',
        label: DEMO_STAGE_LABELS.commandCenter,
        value: '—',
        unit: null,
        caption: input.alertSink === 'none' ? 'not configured' : 'not yet',
        state: 'idle',
        dimmed: linkLost || ingestDown,
      };

  return [device, ingest, rule, alert, commandCenter];
}
