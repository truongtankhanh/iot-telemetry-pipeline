import { describe, expect, it } from 'vitest';
import scenariosFixture from '../api/fixtures/scenarios.json';
import { stateViewFixture } from '../api/fixtures/stateView';
import { twinLayoutFixture } from '../api/fixtures/twinLayout';
import type { TwinLayout } from '../api/types';
import { DEMO_AWAIT_TYPES, validateScript } from './demoScript';
import { DEMO_SCRIPTS, OVERHEAT_TO_INCIDENT } from './demoScripts';
import { fillText } from './demoText';
import { cameraMove } from './twinDemoCamera';

describe('the shipped scripts', () => {
  it('every one validates', () => {
    for (const script of DEMO_SCRIPTS) {
      const result = validateScript(script);
      expect(result.ok ? [] : result.problems, script.id).toEqual([]);
    }
  });

  it('have distinct ids', () => {
    const ids = DEMO_SCRIPTS.map((script) => script.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('overheat to incident', () => {
  const library = scenariosFixture.scenarios;
  const rules = stateViewFixture.rules.items;
  const devices = stateViewFixture.devices;

  it('has the six steps of frame 08, in order', () => {
    expect(OVERHEAT_TO_INCIDENT.steps.map((step) => step.title)).toEqual([
      'Everything is normal',
      'The rule behind the alert',
      'Heat the server room',
      'The alert opens',
      'The incident appears',
      'It recovers by itself',
    ]);
  });

  it('starts the scenario at step 3 and waits for the four events in order', () => {
    const [, , heat] = OVERHEAT_TO_INCIDENT.steps;
    expect(heat?.action).toEqual({ type: 'run-scenario', scenario: 'server-room-overheat' });
    expect(OVERHEAT_TO_INCIDENT.steps.map((step) => step.await?.type)).toEqual([
      undefined,
      undefined,
      ...DEMO_AWAIT_TYPES,
    ]);
  });

  it('names a scenario, a rule and a device that exist, so a rename fails here and not on stage', () => {
    const { scenario, subject } = OVERHEAT_TO_INCIDENT;
    expect(library.map((item) => item.name)).toContain(scenario);
    const rule = rules.find((item) => item.id === subject.ruleId);
    expect(rule, 'the rule of the subject').toBeDefined();
    expect(rule?.metric).toBe(subject.metric);
    expect(devices.map((device) => device.id)).toContain(subject.deviceId);
    for (const step of OVERHEAT_TO_INCIDENT.steps) {
      if (step.action?.type === 'run-scenario') {
        expect(library.map((item) => item.name)).toContain(step.action.scenario);
      }
      if (step.await !== undefined) {
        expect(step.await.ruleId).toBe(subject.ruleId);
        expect(step.await.deviceId).toBe(subject.deviceId);
      }
    }
  });

  it('reads its numbers from the rules and the scenario, so the text matches the frame', () => {
    const item = library.find((entry) => entry.name === OVERHEAT_TO_INCIDENT.scenario);
    const facts = {
      devices: 4,
      rate: 2,
      rule: rules.find((entry) => entry.id === OVERHEAT_TO_INCIDENT.subject.ruleId) ?? null,
      scenario: (item ?? null) as never,
      subject: OVERHEAT_TO_INCIDENT.subject,
    };
    const summaries = OVERHEAT_TO_INCIDENT.steps.map((step) => fillText(step.summary, facts));
    expect(summaries[0]).toBe('4 devices, 2.0 msg/s');
    expect(summaries[1]).toBe('Raise 27 °C, clear 25.5 °C, 3 in a row');
    expect(summaries[2]).toBe('dc-env-01 → 29.2 °C for 60 s');
  });

  it('has no number written into its text (they would go stale)', () => {
    for (const step of OVERHEAT_TO_INCIDENT.steps) {
      expect(`${step.title} ${step.summary} ${step.say}`, step.id).not.toMatch(/\d/);
    }
  });
});

describe('overheat to incident, on the twin', () => {
  const layout = twinLayoutFixture.layout as TwinLayout;
  const cameras = OVERHEAT_TO_INCIDENT.steps.map((step) => step.camera);

  it('moves the camera on three steps only: the campus, the Data Center, the campus', () => {
    expect(cameras).toEqual([
      'campus',
      undefined,
      { building: 'BLD-DC' },
      undefined,
      'campus',
      undefined,
    ]);
  });

  it('flies to the building the subject device stands in, and that building is one of the layout', () => {
    const { deviceId } = OVERHEAT_TO_INCIDENT.subject;
    const device = stateViewFixture.devices.find((item) => item.id === deviceId);
    const heat = OVERHEAT_TO_INCIDENT.steps.find((step) => step.id === 'heat');
    expect(heat?.camera).toEqual({ building: device?.zoneCode });
    expect(layout.zones.find((zone) => zone.code === device?.zoneCode)?.kind).toBe('building');
  });

  it('has a camera every one of which this campus layout can follow', () => {
    for (const camera of cameras) {
      if (camera === undefined) continue;
      const { move, problem } = cameraMove(camera, layout);
      expect(problem, JSON.stringify(camera)).toBeNull();
      expect(move, JSON.stringify(camera)).not.toBeNull();
    }
  });

  it('puts the second screen in the notes of the incident step, and says it is only if it is running', () => {
    const incident = OVERHEAT_TO_INCIDENT.steps.find((step) => step.id === 'incident');
    expect(incident?.notes).toMatch(/command center.+twin.+second screen.+if it is running/i);
  });
});
