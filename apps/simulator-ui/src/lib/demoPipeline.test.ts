import { describe, expect, it } from 'vitest';
import {
  DEMO_STAGE_ORDER,
  type DemoStage,
  type DemoStageId,
  demoPipeline,
  type DemoPipelineInput,
} from './demoPipeline';

const input = (overrides: Partial<DemoPipelineInput> = {}): DemoPipelineInput => ({
  deviceId: 'dc-env-01',
  reading: { value: '29.3', unit: '°C' },
  ingestStatus: 'ready',
  lagSeconds: 0.04,
  rule: { counted: 2, of: 3 },
  ruleRaised: false,
  alert: 'none',
  incident: false,
  alertSink: 'ops-command-center',
  linkLost: false,
  ...overrides,
});

const byId = (stages: DemoStage[]) =>
  Object.fromEntries(stages.map((stage) => [stage.id, stage])) as Record<DemoStageId, DemoStage>;

describe('demoPipeline', () => {
  it('has five stages in the order of the frame', () => {
    expect(demoPipeline(input()).map((stage) => stage.id)).toEqual([...DEMO_STAGE_ORDER]);
    expect(demoPipeline(input()).map((stage) => stage.label)).toEqual([
      'Device',
      'Ingest',
      'Rule',
      'Alert',
      'Command Center',
    ]);
  });

  it('draws step 3 as the frame does: device and ingest live, the rule counting, the alert and the Command Center not yet', () => {
    const stages = byId(demoPipeline(input()));
    expect(stages.device).toMatchObject({
      value: '29.3',
      unit: '°C',
      caption: 'dc-env-01',
      state: 'live',
    });
    expect(stages.ingest).toMatchObject({
      value: '0.04',
      unit: 's lag',
      caption: 'storing readings',
      state: 'live',
    });
    expect(stages.rule).toMatchObject({
      value: '2',
      unit: 'of 3',
      caption: 'counting',
      state: 'live',
    });
    expect(stages.alert).toMatchObject({ value: '—', caption: 'not yet', state: 'idle' });
    expect(stages.commandCenter).toMatchObject({ value: '—', caption: 'not yet', state: 'idle' });
  });

  it('says every idle stage in words, never by colour alone', () => {
    for (const stage of demoPipeline(input({ rule: null, reading: null, lagSeconds: null }))) {
      expect(stage.caption.length).toBeGreaterThan(0);
    }
  });

  it('watches before the first breaching reading', () => {
    const stages = byId(demoPipeline(input({ rule: { counted: 0, of: 3 } })));
    expect(stages.rule).toMatchObject({ value: '—', caption: 'watching', state: 'idle' });
  });

  it('fires the rule when it has raised, and the alert when it is open', () => {
    const raised = byId(demoPipeline(input({ ruleRaised: true, rule: { counted: 3, of: 3 } })));
    expect(raised.rule).toMatchObject({
      value: '3',
      unit: 'of 3',
      caption: 'raised',
      state: 'fired',
    });
    expect(raised.alert.state).toBe('idle');

    const open = byId(demoPipeline(input({ alert: 'open' })));
    expect(open.rule).toMatchObject({ caption: 'raised', state: 'fired' });
    expect(open.alert).toMatchObject({ value: 'Open', caption: 'opened', state: 'fired' });
    expect(open.commandCenter.state).toBe('idle');
  });

  it('shows the Command Center done once the incident exists', () => {
    const stages = byId(demoPipeline(input({ alert: 'open', incident: true })));
    expect(stages.commandCenter).toMatchObject({
      value: 'Incident',
      caption: 'opened',
      state: 'done',
    });
  });

  it('shows everything downstream of the device done after the clear', () => {
    const stages = byId(
      demoPipeline(input({ alert: 'cleared', incident: true, rule: { counted: 0, of: 3 } })),
    );
    expect(stages.rule).toMatchObject({ caption: 'cleared', state: 'done' });
    expect(stages.alert).toMatchObject({ value: 'Cleared', caption: 'cleared', state: 'done' });
    expect(stages.commandCenter.state).toBe('done');
    expect(stages.device.state).toBe('live');
    expect(stages.ingest.state).toBe('live');
  });

  it('says there is no command center instead of "not yet"', () => {
    const stages = byId(demoPipeline(input({ alert: 'open', alertSink: 'none' })));
    expect(stages.commandCenter).toMatchObject({ caption: 'not configured', state: 'idle' });
  });

  it('writes the lag with two decimals under a second and one above, and a dash when it cannot be told', () => {
    expect(byId(demoPipeline(input({ lagSeconds: 0.5 }))).ingest.value).toBe('0.50');
    expect(byId(demoPipeline(input({ lagSeconds: 2.34 }))).ingest.value).toBe('2.3');
    const none = byId(demoPipeline(input({ lagSeconds: null }))).ingest;
    expect(none).toMatchObject({ value: '—', unit: null, state: 'live' });
  });

  it('dims and says so when ingest does not answer', () => {
    const stages = byId(demoPipeline(input({ ingestStatus: 'unreachable', alert: 'open' })));
    expect(stages.ingest).toMatchObject({ caption: 'unreachable', state: 'idle', dimmed: true });
    expect(stages.alert.dimmed).toBe(true);
    expect(stages.commandCenter.dimmed).toBe(true);
    expect(stages.device.dimmed).toBe(false);
  });

  it('says ingest is not ready', () => {
    expect(byId(demoPipeline(input({ ingestStatus: 'not-ready' }))).ingest).toMatchObject({
      caption: 'not ready',
      state: 'idle',
    });
  });

  it('dims every stage and stops calling anything live when the link to the simulator is lost', () => {
    const stages = demoPipeline(input({ linkLost: true, alert: 'open', incident: true }));
    expect(stages.every((stage) => stage.dimmed)).toBe(true);
    const ids = byId(stages);
    expect(ids.device.state).toBe('idle');
    expect(ids.ingest.state).toBe('idle');
  });

  it('says a device without a reading, and a metric without a unit', () => {
    expect(byId(demoPipeline(input({ reading: null }))).device).toMatchObject({
      value: '—',
      caption: 'dc-env-01, no reading yet',
      state: 'idle',
    });
    expect(
      byId(demoPipeline(input({ reading: { value: '5.0', unit: '' } }))).device.unit,
    ).toBeNull();
  });

  it('says there is no rule to read', () => {
    expect(byId(demoPipeline(input({ rule: null }))).rule).toMatchObject({
      caption: 'no rule to read',
      state: 'idle',
    });
  });
});
