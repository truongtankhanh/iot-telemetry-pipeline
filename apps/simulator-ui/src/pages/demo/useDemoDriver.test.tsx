import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { DemoScript } from '../../lib/demoScript';
import { OVERHEAT_TO_INCIDENT } from '../../lib/demoScripts';
import {
  advance,
  alertOpened,
  createDemoHarness,
  healthyView,
  incidentDelivered,
  nextStep,
  renderDemoDriver,
  startDemo,
  T0,
} from './demoTestSupport';

const RUN = '/api/scenarios/server-room-overheat/run';
const STOP = '/api/scenarios/server-room-overheat/stop';

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The demo at step 3 ("Heat the server room"): started, two steps on, the scenario running. */
async function atHeat(options: Parameters<typeof createDemoHarness>[0] = {}) {
  const harness = createDemoHarness(options);
  const hook = renderDemoDriver(harness);
  await startDemo(harness);
  await nextStep(harness, 2);
  return { harness, hook };
}

const holdScript: DemoScript = {
  ...OVERHEAT_TO_INCIDENT,
  id: 'hold',
  steps: [
    {
      id: 'hold',
      title: 'Hold',
      summary: 'Hold',
      say: 'Hold it.',
      action: { type: 'hold-value', deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.5 },
    },
    { id: 'end', title: 'End', summary: 'End', say: 'Done.' },
  ],
};

describe('entering a step', () => {
  it('enters the first step at once, and a step with no action asks nothing of the simulator', async () => {
    const harness = createDemoHarness();
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    expect(harness.demo.get().entered).toEqual(['normal']);
    expect(harness.demo.get().baselines.normal).toBeDefined();
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(0);
    expect(hook.result.current.phase).toBe('none');
  });

  it('runs the scenario once when the step is entered, and not again when the page renders', async () => {
    const { harness, hook } = await atHeat();
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
    expect(harness.demo.get().entered).toEqual(['normal', 'rule', 'heat']);
    expect(hook.result.current.phase).toBe('waiting');
    expect(hook.result.current.scenarioStarted).toBe(true);
    await advance(5_000);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
  });

  it('does not enter a step while the demo is not being presented', async () => {
    const harness = createDemoHarness();
    renderDemoDriver(harness);
    await advance(2_000);
    expect(harness.demo.get().entered).toEqual([]);
  });

  it('does not run an action again when the presenter goes back to a step and forward', async () => {
    const { harness } = await atHeat();
    act(() => harness.demo.dispatch({ type: 'back', now: Date.now() }));
    await advance(100);
    await nextStep(harness);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
  });

  it('asks the replace question when something is in the way, and does not enter until it is answered', async () => {
    const harness = createDemoHarness();
    harness.simulator.conflicts.set('server-room-overheat', [
      { deviceId: 'dc-env-01', anomalyId: 'a9', runId: null, scenario: null },
    ]);
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    await nextStep(harness, 2);

    expect(hook.result.current.pendingReplace).not.toBeNull();
    expect(hook.result.current.phase).toBe('failed');
    expect(harness.demo.get().entered).not.toContain('heat');

    await act(async () => {
      await hook.result.current.actions.confirmReplace();
    });
    await advance(50);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(2);
    expect(harness.simulator.callsTo('POST', RUN)[1]?.body).toEqual({ replace: true });
    expect(hook.result.current.pendingReplace).toBeNull();
    expect(harness.demo.get().entered).toContain('heat');
    expect(hook.result.current.phase).toBe('waiting');
  });

  it('keeps the step open when the question is dismissed, and Retry asks it again', async () => {
    const harness = createDemoHarness();
    harness.simulator.conflicts.set('server-room-overheat', [
      { deviceId: 'dc-env-01', anomalyId: 'a9', runId: null, scenario: null },
    ]);
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    await nextStep(harness, 2);
    act(() => hook.result.current.actions.cancelReplace());
    await advance(50);
    expect(hook.result.current.pendingReplace).toBeNull();
    expect(harness.demo.get().entered).not.toContain('heat');
    act(() => hook.result.current.actions.retry());
    await advance(50);
    expect(hook.result.current.pendingReplace).not.toBeNull();
  });

  it('keeps a refused run on screen with the simulator’s reason, does not try again by itself, and Retry enters it', async () => {
    const harness = createDemoHarness();
    harness.simulator.failRun({ status: 400, message: 'the engine refused the run' });
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    await nextStep(harness, 2);

    expect(hook.result.current.startFailure).toBe('the engine refused the run');
    expect(hook.result.current.phase).toBe('failed');
    expect(harness.demo.get().entered).not.toContain('heat');
    await advance(5_000);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);

    harness.simulator.failRun(null);
    act(() => hook.result.current.actions.retry());
    await advance(50);
    expect(harness.demo.get().entered).toContain('heat');
    expect(hook.result.current.startFailure).toBeNull();
  });

  it('holds a value for a hold step, remembers it, and lets it go when the demo finishes', async () => {
    const harness = createDemoHarness();
    const hook = renderDemoDriver(harness, holdScript);
    await startDemo(harness, holdScript);

    const puts = harness.simulator.callsTo('PUT', '/api/devices/dc-env-01/holds/temperature_c');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toEqual({ value: 29.5 });
    expect(harness.demo.get().holds).toEqual([{ deviceId: 'dc-env-01', metric: 'temperature_c' }]);
    expect(harness.demo.get().entered).toEqual(['hold']);

    await nextStep(harness, 2); // to the last step, then Finish
    expect(harness.demo.get().status).toBe('finished');
    expect(
      harness.simulator.callsTo('DELETE', '/api/devices/dc-env-01/holds/temperature_c'),
    ).toHaveLength(1);
    expect(harness.demo.get().holds).toEqual([]);
    expect(hook.result.current.releaseError).toBeNull();
  });

  it('shows a refused hold and does not remember it', async () => {
    const harness = createDemoHarness();
    harness.simulator.failHold({ status: 409, message: 'dc-env-01 is stopped' });
    const hook = renderDemoDriver(harness, holdScript);
    await startDemo(harness, holdScript);
    expect(hook.result.current.startFailure).toBe('dc-env-01 is stopped');
    expect(harness.demo.get().holds).toEqual([]);
    expect(harness.demo.get().entered).toEqual([]);
  });
});

describe('the awaited event', () => {
  it('moves on by itself when the rule has raised, and says so', async () => {
    const { harness, hook } = await atHeat();
    harness.readings(28, 28.5, 29);
    await advance(2_500);
    expect(harness.demo.get().stepIndex).toBe(3);
    expect(harness.demo.get().satisfied).toEqual(['heat']);
    expect(harness.demo.get().advancedBy.heat).toBe('event');
    expect(hook.result.current.movedOn).toBe('the rule raised');
    expect(hook.result.current.step?.id).toBe('alert');
  });

  it('shows the count while the rule is still counting', async () => {
    const { harness, hook } = await atHeat();
    harness.readings(22, 28, 28.5);
    await advance(200);
    expect(hook.result.current.progress).toMatchObject({ counted: 2, of: 3 });
    expect(hook.result.current.phase).toBe('waiting');
    expect(hook.result.current.stages.find((s) => s.id === 'rule')).toMatchObject({
      value: '2',
      caption: 'counting',
    });
  });

  it('moves one step at a time when the events are already there, and the last step stays for the presenter', async () => {
    const { harness } = await atHeat();
    harness.readings(28, 28.5, 29);
    harness.emit(alertOpened(1), incidentDelivered(2));
    const seen: number[] = [harness.demo.get().stepIndex];
    for (let i = 0; i < 20; i++) {
      await advance(500);
      seen.push(harness.demo.get().stepIndex);
    }
    for (let i = 1; i < seen.length; i++) {
      expect((seen[i] as number) - (seen[i - 1] as number)).toBeLessThanOrEqual(1);
    }
    // heat, alert and incident are satisfied; the clear has not come, so the demo waits on step 6
    expect(harness.demo.get().satisfied).toEqual(['heat', 'alert', 'incident']);
    expect(harness.demo.get().stepIndex).toBe(5);
    expect(harness.demo.get().status).toBe('presenting');
  });

  it('counts an event that came while the presenter was still reading the step before', async () => {
    const { harness } = await atHeat();
    harness.readings(28, 28.5, 29);
    await advance(2_500);
    expect(harness.demo.get().stepIndex).toBe(3);
    // the alert opens and the presenter takes their time; Space moves on to the incident step by hand
    harness.emit(alertOpened(1), incidentDelivered(2));
    await nextStep(harness);
    await advance(3_000);
    expect(harness.demo.get().satisfied).toContain('incident');
  });

  it('says it is late after the time limit, and never moves on by itself because of it', async () => {
    const { harness, hook } = await atHeat();
    expect(hook.result.current.timeoutS).toBe(54); // opensAtS 24 + 30 s
    await advance(50_000);
    expect(hook.result.current.phase).toBe('waiting');
    await advance(5_000);
    expect(hook.result.current.phase).toBe('slow');
    expect(hook.result.current.late).toBe(true);
    expect(harness.demo.get().stepIndex).toBe(2);
    expect(hook.result.current.moveOnLabel).toBe('Move on without the rule');
    expect(hook.result.current.waitingFor).toBe('the rule server-room-hot to raise on dc-env-01');
  });

  it('names what is wrong as soon as a cause is visible: a paused device', async () => {
    const { harness, hook } = await atHeat();
    act(() =>
      harness.store.getState().setView(
        healthyView((view) => {
          const device = view.engine.devices.find((d) => d.id === 'dc-env-01');
          if (device) device.state = 'paused';
        }),
        Date.now(),
      ),
    );
    await advance(50);
    expect(hook.result.current.cause?.code).toBe('device-not-running');
    expect(hook.result.current.late).toBe(true);
    expect(hook.result.current.phase).toBe('waiting');
  });

  it('says an alert was already open before the step, and offers the way on at once', async () => {
    const open = {
      ...structuredClone(stateViewFixture.alerts.alerts[0]!),
      id: '3',
      ruleId: 'server-room-hot',
      deviceId: 'dc-env-01',
      status: 'open' as const,
    };
    const harness = createDemoHarness({
      view: healthyView((view) => {
        view.alerts.alerts = [open];
      }),
    });
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    await nextStep(harness, 3);
    expect(hook.result.current.step?.id).toBe('alert');
    expect(hook.result.current.progress?.alreadyOpen).toBe(true);
    expect(hook.result.current.cause?.code).toBe('already-open');
    expect(hook.result.current.late).toBe(true);
    expect(hook.result.current.moveOnLabel).toBe('Move on without the alert');
  });
});

describe('Restart, Pause and Esc', () => {
  it('Restart stops the scenario and runs it again, and begins the wait again from now', async () => {
    const { harness, hook } = await atHeat();
    const before = harness.demo.get().baselines.heat;
    await advance(3_000);
    await act(async () => {
      await hook.result.current.actions.restart();
    });
    await advance(50);
    expect(harness.simulator.callsTo('POST', STOP)).toHaveLength(1);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(2);
    expect(harness.demo.get().baselines.heat?.at).toBeGreaterThan(before?.at ?? 0);
    expect(harness.demo.get().stepIndex).toBe(2);
  });

  it('Restart tolerates a scenario that is no longer running (the simulator answers 409 to the stop)', async () => {
    const { harness, hook } = await atHeat();
    harness.simulator.state = { ...harness.simulator.state, runs: [] };
    await act(async () => {
      await hook.result.current.actions.restart();
    });
    await advance(50);
    expect(harness.simulator.callsTo('POST', STOP)).toHaveLength(1);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(2);
    expect(hook.result.current.notice).toBeNull();
  });

  it('Restart on a step with no action only begins its wait again', async () => {
    const harness = createDemoHarness();
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    await nextStep(harness, 3); // the alert step: no action
    const before = harness.demo.get().baselines.alert;
    await advance(1_000);
    await act(async () => {
      await hook.result.current.actions.restart();
    });
    expect(harness.simulator.callsTo('POST', STOP)).toHaveLength(0);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
    expect(harness.demo.get().baselines.alert?.at).toBeGreaterThan(before?.at ?? 0);
  });

  it('P pauses every running device, then resumes them', async () => {
    const harness = createDemoHarness();
    const hook = renderDemoDriver(harness);
    await startDemo(harness);

    await act(async () => {
      await hook.result.current.actions.togglePause();
    });
    const pauses = harness.simulator.calls.filter((c) => c.path.endsWith('/pause'));
    expect(pauses).toHaveLength(6);
    expect(hook.result.current.notice).toEqual({ tone: 'ok', text: 'Paused 6 devices.' });
    expect(hook.result.current.devicesPaused).toBe(true);

    await act(async () => {
      await hook.result.current.actions.togglePause();
    });
    expect(harness.simulator.calls.filter((c) => c.path.endsWith('/start'))).toHaveLength(6);
    expect(hook.result.current.notice).toEqual({ tone: 'ok', text: 'Started 6 devices.' });
    expect(hook.result.current.devicesPaused).toBe(false);
  });

  it('P does nothing above ten devices, and says where to go instead', async () => {
    const view = healthyView((v) => {
      const [first] = v.engine.devices;
      for (let i = 0; i < 6; i++) {
        v.engine.devices.push({ ...structuredClone(first!), id: `extra-${i}` });
      }
    });
    const harness = createDemoHarness({ view });
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    await act(async () => {
      await hook.result.current.actions.togglePause();
    });
    expect(harness.simulator.calls.filter((c) => c.path.endsWith('/pause'))).toHaveLength(0);
    expect(hook.result.current.notice?.text).toBe(
      'Pause asks for a confirmation above 10 devices: use the Overview.',
    );
  });

  it('P says it is not available on the simulated clock', async () => {
    const harness = createDemoHarness({ view: healthyView((v) => (v.engine.simulated = true)) });
    const hook = renderDemoDriver(harness);
    await startDemo(harness);
    await act(async () => {
      await hook.result.current.actions.togglePause();
    });
    expect(harness.simulator.calls.filter((c) => c.path.endsWith('/pause'))).toHaveLength(0);
    expect(hook.result.current.notice?.text).toMatch(/simulated clock/);
  });

  it('Esc leaves what is running running, keeps the step and the entries, and sends nothing', async () => {
    const { harness, hook } = await atHeat();
    const writes = () => harness.simulator.calls.filter((c) => c.method !== 'GET').length;
    const before = writes();
    act(() => hook.result.current.actions.exit());
    await advance(5_000);
    expect(writes()).toBe(before);
    expect(harness.demo.get()).toMatchObject({ status: 'paused-for-exit', stepIndex: 2 });
    expect(harness.demo.get().entered).toEqual(['normal', 'rule', 'heat']);

    act(() => hook.result.current.actions.resume());
    await advance(50);
    expect(harness.demo.get().status).toBe('presenting');
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
  });

  it('stopping the demo from the start screen lets go of a hold and forgets the session', async () => {
    const harness = createDemoHarness();
    const hook = renderDemoDriver(harness, holdScript);
    await startDemo(harness, holdScript);
    act(() => hook.result.current.actions.exit());
    await act(async () => {
      await hook.result.current.actions.stopDemo();
    });
    await advance(50);
    expect(
      harness.simulator.callsTo('DELETE', '/api/devices/dc-env-01/holds/temperature_c'),
    ).toHaveLength(1);
    expect(harness.demo.get().status).toBe('idle');
    expect(harness.demo.get().holds).toEqual([]);
  });
});

describe('the clock', () => {
  it('stops counting while the engine is stopped', async () => {
    const harness = createDemoHarness();
    renderDemoDriver(harness);
    await startDemo(harness);
    act(() =>
      harness.store.getState().setView(
        healthyView((view) => (view.engine.running = false)),
        Date.now(),
      ),
    );
    await advance(50);
    expect(harness.demo.get().stoppedSince).not.toBeNull();
    act(() => harness.store.getState().setView(healthyView(), Date.now()));
    await advance(50);
    expect(harness.demo.get().stoppedSince).toBeNull();
  });
});
