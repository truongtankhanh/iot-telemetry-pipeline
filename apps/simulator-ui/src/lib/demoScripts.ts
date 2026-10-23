import type { DemoScript } from './demoScript';

const SUBJECT = {
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  ruleId: 'server-room-hot',
} as const;

/**
 * "Overheat to incident" (frame 08): the server room gets hot, the rule counts, an alert opens, the incident appears in the
 * Command Center, and the alert clears by itself. The numbers in the text are tokens, read from the rules and the scenario, so a
 * change to `rules.json` or to the scenario changes what the presenter reads and not a line of this file.
 */
export const OVERHEAT_TO_INCIDENT: DemoScript = {
  id: 'overheat-to-incident',
  title: 'Overheat to incident',
  summary:
    'A hot server room, followed through the pipeline until the incident reaches the Command Center and the alert clears by itself.',
  subject: SUBJECT,
  scenario: 'server-room-overheat',
  steps: [
    {
      id: 'normal',
      title: 'Everything is normal',
      summary: '{devices}, {rate}',
      say: '“Every device on the campus is publishing readings, and the pipeline is storing them. Nothing is wrong yet.”',
      notes: 'The rate is the stream the simulator carries now, not a target.',
    },
    {
      id: 'rule',
      title: 'The rule behind the alert',
      summary: 'Raise {rule.raise}, clear {rule.clear}, {rule.for} in a row',
      say: '“This is the rule that will fire. An alert opens after {rule.for} readings in a row above {rule.raise}, and clears only when the value is back under {rule.clear}. That gap is the hysteresis: one noisy reading cannot open and close an alert.”',
      notes: 'The thresholds are the simulator’s copy of the rules that ingest read at boot.',
    },
    {
      id: 'heat',
      title: 'Heat the server room',
      summary: '{device} → {value} for {duration}',
      say: '“Row A in the data center just got hotter than it should be. Nothing in the pipeline knows that yet. Watch the rule count the readings.”',
      action: { type: 'run-scenario', scenario: 'server-room-overheat' },
      await: { type: 'rule-raised', ruleId: SUBJECT.ruleId, deviceId: SUBJECT.deviceId },
      notes:
        'The anomaly begins a few seconds after the scenario starts; the count follows the readings Studio sees.',
    },
    {
      id: 'alert',
      title: 'The alert opens',
      summary: 'Rule, alert, outbox',
      say: '“The rule has counted enough readings. Ingest opens an alert and writes it to the outbox, so it survives a crash before it is delivered.”',
      await: { type: 'alert-opened', ruleId: SUBJECT.ruleId, deviceId: SUBJECT.deviceId },
    },
    {
      id: 'incident',
      title: 'The incident appears',
      summary: 'In the Command Center',
      say: '“The outbox worker delivers the alert, and the Command Center opens an incident for the operators.”',
      await: { type: 'incident-delivered', ruleId: SUBJECT.ruleId, deviceId: SUBJECT.deviceId },
    },
    {
      id: 'recover',
      title: 'It recovers by itself',
      summary: 'Hysteresis clears the alert',
      say: '“The scenario ends, the temperature falls back under {rule.clear}, and the alert clears on its own. Nobody touched anything.”',
      await: { type: 'alert-cleared', ruleId: SUBJECT.ruleId, deviceId: SUBJECT.deviceId },
    },
  ],
};

/** The scripts the demo page offers. */
export const DEMO_SCRIPTS: readonly DemoScript[] = [OVERHEAT_TO_INCIDENT];
