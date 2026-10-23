import { describe, expect, it } from 'vitest';
import type { Expected, StateView } from '../api/types';
import { stateViewFixture } from '../api/fixtures/stateView';
import type { MatchProgress } from './demoEvents';
import type { DemoAwait, DemoStep } from './demoScript';
import {
  alertOpensIn,
  countSentence,
  DEFAULT_TIMEOUT_S,
  happenedSentence,
  likelyCause,
  moveOnLabel,
  startNotices,
  TIMEOUT_MARGIN_S,
  timeoutFor,
  waitingSentence,
} from './demoWaiting';

const awaiting = (type: DemoAwait['type']): DemoAwait => ({
  type,
  ruleId: 'server-room-hot',
  deviceId: 'dc-env-01',
});

const step = (overrides: Partial<DemoStep> = {}): DemoStep => ({
  id: 's',
  title: 'S',
  summary: 'S',
  say: 'S',
  ...overrides,
});

const expected = (clearsAtS: number | null = 62): Expected => ({
  available: true,
  intervalS: 2,
  horizonS: 80,
  alerts: [
    {
      ruleId: 'server-room-hot',
      title: 'Server room temperature high',
      severity: 'high',
      deviceId: 'dc-env-01',
      metric: 'temperature_c',
      opensAtS: 26,
      opensMargin: false,
      clearsAtS,
      clearsUncertain: false,
    },
  ],
  quiet: [],
  series: [],
});

/** A healthy stack on the wall clock: the fixture is on the simulated clock, which is a cause of its own. */
const healthy = (change: (view: StateView) => void = () => {}): StateView => {
  const view = structuredClone(stateViewFixture);
  view.engine.simulated = false;
  view.engine.devices = view.engine.devices.map((device) => ({ ...device, state: 'running' }));
  change(view);
  return view;
};

describe('timeoutFor', () => {
  it('uses the step’s own timeoutS first', () => {
    expect(timeoutFor(step({ timeoutS: 12, await: awaiting('alert-opened') }), expected())).toBe(
      12,
    );
  });

  it('is the scenario’s opensAtS plus the margin for a step that starts the scenario and waits for the rule', () => {
    const heat = step({
      action: { type: 'run-scenario', scenario: 'server-room-overheat' },
      await: awaiting('rule-raised'),
    });
    expect(timeoutFor(heat, expected())).toBe(26 + TIMEOUT_MARGIN_S);
  });

  it('is the margin for a step that waits for the rule without starting anything, for an alert and for an incident', () => {
    expect(timeoutFor(step({ await: awaiting('rule-raised') }), expected())).toBe(TIMEOUT_MARGIN_S);
    expect(timeoutFor(step({ await: awaiting('alert-opened') }), expected())).toBe(
      TIMEOUT_MARGIN_S,
    );
    expect(timeoutFor(step({ await: awaiting('incident-delivered') }), expected())).toBe(
      TIMEOUT_MARGIN_S,
    );
  });

  it('is the time between the open and the clear plus the margin for a clear', () => {
    expect(timeoutFor(step({ await: awaiting('alert-cleared') }), expected(62))).toBe(
      62 - 26 + TIMEOUT_MARGIN_S,
    );
  });

  it('is 60 s when the simulator does not predict a clear, or any alert, or says it cannot tell', () => {
    expect(timeoutFor(step({ await: awaiting('alert-cleared') }), expected(null))).toBe(
      DEFAULT_TIMEOUT_S,
    );
    const other: Expected = {
      ...(expected() as Extract<Expected, { available: true }>),
      alerts: [],
    };
    expect(timeoutFor(step({ await: awaiting('alert-opened') }), other)).toBe(DEFAULT_TIMEOUT_S);
    expect(
      timeoutFor(step({ await: awaiting('alert-opened') }), {
        available: false,
        reason: 'no rules',
      }),
    ).toBe(DEFAULT_TIMEOUT_S);
    expect(timeoutFor(step({ await: awaiting('alert-opened') }), null)).toBe(DEFAULT_TIMEOUT_S);
    expect(timeoutFor(step({ await: awaiting('alert-opened') }), undefined)).toBe(
      DEFAULT_TIMEOUT_S,
    );
  });

  it('is 60 s for a step that waits for nothing', () => {
    expect(timeoutFor(step(), expected())).toBe(DEFAULT_TIMEOUT_S);
  });
});

describe('alertOpensIn', () => {
  it('is the seconds left until the predicted open, rounded, never negative', () => {
    expect(alertOpensIn(expected(), awaiting('alert-opened'), 14)).toBe(12);
    expect(alertOpensIn(expected(), awaiting('alert-opened'), 14.4)).toBe(12);
    expect(alertOpensIn(expected(), awaiting('alert-opened'), 40)).toBe(0);
  });

  it('is null when nothing is predicted for the rule and the device', () => {
    expect(alertOpensIn(null, awaiting('alert-opened'), 0)).toBeNull();
    expect(alertOpensIn({ available: false, reason: 'x' }, awaiting('alert-opened'), 0)).toBeNull();
    expect(
      alertOpensIn(expected(), { ...awaiting('alert-opened'), deviceId: 'lha-air-01' }, 0),
    ).toBeNull();
  });
});

describe('the sentences', () => {
  it('says what each event waits for, naming the rule and the device', () => {
    expect(waitingSentence(awaiting('rule-raised'))).toBe(
      'the rule server-room-hot to raise on dc-env-01',
    );
    expect(waitingSentence(awaiting('alert-opened'))).toBe(
      'the alert of server-room-hot on dc-env-01 to open',
    );
    expect(waitingSentence(awaiting('incident-delivered'))).toBe(
      'the incident for the alert of server-room-hot on dc-env-01 to reach the Command Center',
    );
    expect(waitingSentence(awaiting('alert-cleared'))).toBe(
      'the alert of server-room-hot on dc-env-01 to clear',
    );
  });

  it('has a "what happened" and a "move on" line for every event', () => {
    expect(happenedSentence['alert-opened']).toBe('the alert opened');
    expect(moveOnLabel['alert-opened']).toBe('Move on without the alert');
    for (const type of [
      'rule-raised',
      'alert-opened',
      'incident-delivered',
      'alert-cleared',
    ] as const) {
      expect(happenedSentence[type].length).toBeGreaterThan(0);
      expect(moveOnLabel[type]).toMatch(/^Move on without /);
    }
  });
});

describe('likelyCause', () => {
  const cause = (
    view: StateView | null,
    awaited = awaiting('alert-opened'),
    extra: { link?: 'live' | 'lost' | 'connecting'; alreadyOpen?: boolean } = {},
  ) =>
    likelyCause({
      link: extra.link ?? 'live',
      view,
      awaited,
      alreadyOpen: extra.alreadyOpen ?? false,
    });

  it('is null for a healthy stack, and before the first state', () => {
    expect(cause(healthy())).toBeNull();
    expect(cause(null)).toBeNull();
  });

  it('names a lost link first, whatever else is wrong', () => {
    const view = healthy((v) => (v.ingest.status = 'unreachable'));
    expect(cause(view, awaiting('alert-opened'), { link: 'lost' })?.code).toBe('link-lost');
    expect(cause(null, awaiting('alert-opened'), { link: 'lost' })?.code).toBe('link-lost');
  });

  it('names ingest next: unreachable, then not ready', () => {
    expect(cause(healthy((v) => (v.ingest.status = 'unreachable')))?.code).toBe(
      'ingest-unreachable',
    );
    expect(cause(healthy((v) => (v.ingest.status = 'not-ready')))?.code).toBe('ingest-not-ready');
  });

  it('names a missing command center only for an incident, and in words that say what to fix', () => {
    const view = healthy((v) => (v.ingest.alertSink = 'none'));
    expect(cause(view, awaiting('incident-delivered'))?.code).toBe('no-command-center');
    expect(cause(view, awaiting('incident-delivered'))?.text).toContain('OCC_API_URL');
    expect(cause(view, awaiting('alert-opened'))).toBeNull();
    expect(cause(view, awaiting('alert-cleared'))).toBeNull();
  });

  it('names rules that are not available, with the simulator’s reason', () => {
    const view = healthy((v) => {
      v.rules = { available: false, reason: 'rules.json was not found', items: [] };
    });
    const found = cause(view);
    expect(found?.code).toBe('rules-unavailable');
    expect(found?.text).toContain('rules.json was not found');
  });

  it('names a stopped engine, a stopped or paused device, and a device that is not in the registry', () => {
    expect(cause(healthy((v) => (v.engine.running = false)))?.code).toBe('engine-stopped');
    const paused = cause(
      healthy((v) => {
        const device = v.engine.devices.find((d) => d.id === 'dc-env-01');
        if (device) device.state = 'paused';
      }),
    );
    expect(paused?.code).toBe('device-not-running');
    expect(paused?.text).toContain('dc-env-01 is paused');
    expect(cause(healthy(), { ...awaiting('alert-opened'), deviceId: 'ghost-01' })?.code).toBe(
      'device-not-running',
    );
  });

  it('names the simulated clock', () => {
    const view = healthy((v) => (v.engine.simulated = true));
    expect(cause(view)?.code).toBe('simulated-clock');
    expect(cause(view)?.text).toContain('Step');
  });

  it('names an alert that was already open, for the alert-opened step only', () => {
    expect(cause(healthy(), awaiting('alert-opened'), { alreadyOpen: true })?.code).toBe(
      'already-open',
    );
    expect(cause(healthy(), awaiting('alert-cleared'), { alreadyOpen: true })).toBeNull();
  });

  it('gives one cause, in the order of the list', () => {
    const view = healthy((v) => {
      v.ingest.status = 'not-ready';
      v.ingest.alertSink = 'none';
      v.engine.simulated = true;
    });
    expect(cause(view, awaiting('incident-delivered'), { alreadyOpen: true })?.code).toBe(
      'ingest-not-ready',
    );
    const second = healthy((v) => {
      v.ingest.alertSink = 'none';
      v.engine.simulated = true;
    });
    expect(cause(second, awaiting('incident-delivered'))?.code).toBe('no-command-center');
    const third = healthy((v) => (v.engine.simulated = true));
    expect(cause(third, awaiting('alert-opened'), { alreadyOpen: true })?.code).toBe(
      'simulated-clock',
    );
  });
});

describe('startNotices', () => {
  const notices = (
    view: StateView | null,
    link: 'live' | 'lost' = 'live',
    sink: string | null = null,
  ) => startNotices({ link, view, lastAlertSink: sink });

  it('says nothing for a healthy stack and before the first state', () => {
    expect(notices(healthy())).toEqual([]);
    expect(notices(null)).toEqual([]);
  });

  it('says there is no command center, and that alerts will still open', () => {
    const [notice] = notices(healthy((v) => (v.ingest.alertSink = 'none')));
    expect(notice?.code).toBe('no-command-center');
    expect(notice?.text).toContain('no incident will appear');
  });

  it('remembers the alert sink while ingest is unreachable, so a missing command center is still told', () => {
    const view = healthy((v) => {
      v.ingest.status = 'unreachable';
      v.ingest.alertSink = null;
    });
    expect(notices(view, 'live', 'none').map((n) => n.code)).toEqual([
      'ingest-unreachable',
      'no-command-center',
    ]);
    expect(notices(view, 'live', 'ops-command-center').map((n) => n.code)).toEqual([
      'ingest-unreachable',
    ]);
  });

  it('says ingest is not ready, the simulated clock, missing rules and a lost link', () => {
    expect(notices(healthy((v) => (v.ingest.status = 'not-ready'))).map((n) => n.code)).toEqual([
      'ingest-not-ready',
    ]);
    expect(notices(healthy((v) => (v.engine.simulated = true))).map((n) => n.code)).toEqual([
      'simulated-clock',
    ]);
    expect(
      notices(healthy((v) => (v.rules = { available: false, reason: null, items: [] }))).map(
        (n) => n.code,
      ),
    ).toEqual(['rules-unavailable']);
    expect(notices(healthy(), 'lost').map((n) => n.code)).toEqual(['link-lost']);
  });
});

describe('countSentence', () => {
  const rule = stateViewFixture.rules.items.find((item) => item.id === 'server-room-hot')!;
  const progress = (counted: number | null, of: number | null = 3): MatchProgress => ({
    counted,
    of,
    latest: 29.3,
    alreadyOpen: false,
  });

  it('says the count as the frame does', () => {
    expect(countSentence(awaiting('rule-raised'), rule, progress(2))).toBe(
      'server-room-hot has 2 of 3 readings above 27 °C',
    );
    expect(countSentence(awaiting('rule-raised'), rule, progress(0))).toBe(
      'server-room-hot has 0 of 3 readings above 27 °C',
    );
  });

  it('says below for a rule that raises below its line', () => {
    expect(
      countSentence(awaiting('rule-raised'), { ...rule, direction: 'below' }, progress(1)),
    ).toContain('readings below 27 °C');
  });

  it('says nothing for another event, without a rule, or without a count', () => {
    expect(countSentence(awaiting('alert-opened'), rule, progress(2))).toBeNull();
    expect(countSentence(awaiting('rule-raised'), null, progress(2))).toBeNull();
    expect(countSentence(awaiting('rule-raised'), rule, null)).toBeNull();
    expect(countSentence(awaiting('rule-raised'), rule, progress(null))).toBeNull();
    expect(countSentence(awaiting('rule-raised'), rule, progress(2, null))).toBeNull();
  });
});
