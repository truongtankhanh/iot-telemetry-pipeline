import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test-axe';
import {
  advance,
  alertCleared,
  alertOpened,
  createDemoHarness,
  healthyView,
  incidentDelivered,
  renderDemo,
  T0,
} from './demoTestSupport';

const RUN = '/api/scenarios/server-room-overheat/run';

beforeEach(() => {
  // `shouldAdvanceTime`: user-event (through Testing Library) waits on a `setTimeout(0)` after every key, and Testing Library moves a fake clock
  // on only when it sees Jest; with Vitest the clock must run by itself or the first key never finishes. `advance` still does the real moving.
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    shouldAdvanceTime: true,
  });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Waits for something that needs real turns of the event loop (the lazy page, a dialog) while the clock is fake: `findBy*` waits on
 * timers that are faked here and would never fire; `vi.waitFor` moves the fake clock on while it waits.
 */
const eventually = <T,>(check: () => T): Promise<T> => vi.waitFor(check, { timeout: 3_000 });

/** A person at the keyboard: user-event told to move the fake clock when it waits. */
const keyboardUser = () =>
  userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms), delay: null });

/** Counts the events a pointer would make; a demo run with the keyboard makes none. */
function watchPointer() {
  const seen: string[] = [];
  const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup'];
  const listener = (event: Event) => void seen.push(event.type);
  for (const type of types) document.addEventListener(type, listener, true);
  return {
    seen,
    stop: () => types.forEach((type) => document.removeEventListener(type, listener, true)),
  };
}

const heading = (name: string) => eventually(() => screen.getByRole('heading', { level: 2, name }));

/** Opens the page and starts the presenter from the keyboard: the page has the focus, Tab reaches the button, Enter presses it. */
async function startFromKeyboard(user: ReturnType<typeof keyboardUser>) {
  // the page is a lazy chunk: it has to be there before the keyboard can reach it
  await eventually(() => screen.getByRole('button', { name: 'Start presenter' }));
  const main = document.getElementById('main');
  act(() => main?.focus());
  await user.tab();
  expect(screen.getByRole('button', { name: 'Start presenter' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await advance(100);
}

describe('the guided demo, end to end with the keyboard', () => {
  it('runs “overheat to incident” from the first step to Finish without a pointer', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    const pointer = watchPointer();
    renderDemo(harness);

    expect(
      await eventually(() => screen.getByRole('heading', { level: 1, name: 'Guided demo' })),
    ).toBeInTheDocument();
    await startFromKeyboard(user);

    // The presenter view: no navigation, the first step, the primary button has the focus.
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
    expect(await heading('Everything is normal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Next: The rule behind the alert/ })).toHaveFocus();
    expect(screen.getByText('Step 1 of 6', { exact: false })).toBeInTheDocument();

    // Space moves on by hand.
    await user.keyboard(' ');
    await advance(50);
    expect(await heading('The rule behind the alert')).toBeInTheDocument();
    expect(screen.getByText('Raise 27 °C, clear 25.5 °C, 3 in a row')).toBeInTheDocument();
    await user.keyboard(' ');
    await advance(100);

    // Step 3 starts the scenario by itself and waits for the rule.
    expect(await heading('Heat the server room')).toBeInTheDocument();
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
    expect(
      screen.getByText(/Waiting for the rule server-room-hot to raise on dc-env-01/),
    ).toBeInTheDocument();
    expect(screen.getByText('dc-env-01 → 29.2 °C for 60 s')).toBeInTheDocument();

    // The rule raises: the step moves on by itself.
    harness.readings(28, 28.5, 29.3);
    await advance(3_000);
    expect(await heading('The alert opens')).toBeInTheDocument();
    expect(screen.getByText('Moved on: the rule raised')).toBeInTheDocument();

    // The alert opens, the incident is delivered, the alert clears: three more steps by themselves.
    harness.emit(alertOpened(1));
    await advance(3_000);
    expect(await heading('The incident appears')).toBeInTheDocument();
    harness.emit(incidentDelivered(2));
    await advance(3_000);
    expect(await heading('It recovers by itself')).toBeInTheDocument();
    harness.emit(alertCleared(3));
    await advance(3_000);
    expect(screen.getByText('Done: the alert cleared')).toBeInTheDocument();

    // The last step stays for the presenter; Space finishes.
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    await user.keyboard(' ');
    await advance(100);
    expect(harness.demo.get().status).toBe('finished');
    expect(await eventually(() => screen.getByText(/The demo finished/))).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeInTheDocument();

    expect(harness.demo.get().satisfied).toEqual(['heat', 'alert', 'incident', 'recover']);
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
    pointer.stop();
    expect(pointer.seen).toEqual([]);
  });

  it('says what a step is still waiting for when it does not happen, and Space moves on', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    await user.keyboard(' ');
    await user.keyboard(' ');
    await advance(100);
    expect(await heading('Heat the server room')).toBeInTheDocument();

    await advance(60_000);
    expect(
      screen.getByText('Late: still waiting for the rule server-room-hot to raise on dc-env-01'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Still not here after/)).toBeInTheDocument();
    // it did not move on by itself
    expect(
      screen.getByRole('heading', { level: 2, name: 'Heat the server room' }),
    ).toBeInTheDocument();

    const way = screen.getByRole('button', { name: 'Move on without the rule' });
    expect(way).toBeInTheDocument();
    await user.keyboard(' ');
    await advance(100);
    expect(await heading('The alert opens')).toBeInTheDocument();
  });

  it('names a cause as soon as one is visible: a device that is paused', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    await user.keyboard(' ');
    await user.keyboard(' ');
    await advance(100);
    act(() =>
      harness.store.getState().setView(
        healthyView((view) => {
          const device = view.engine.devices.find((entry) => entry.id === 'dc-env-01');
          if (device) device.state = 'paused';
        }),
        Date.now(),
      ),
    );
    await advance(50);
    expect(screen.getByText(/dc-env-01 is paused/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move on without the rule' })).toBeInTheDocument();
  });

  it('answers the question about a run in the way from the keyboard', async () => {
    const harness = createDemoHarness();
    harness.simulator.conflicts.set('server-room-overheat', [
      { deviceId: 'dc-env-01', anomalyId: 'a9', runId: null, scenario: null },
    ]);
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    await user.keyboard(' ');
    await user.keyboard(' ');
    await advance(100);

    const dialog = await eventually(() =>
      screen.getByRole('dialog', { name: 'Replace what is running?' }),
    );
    expect(dialog).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Replace and run' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await advance(100);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(2);
    expect(harness.demo.get().entered).toContain('heat');
  });

  it('leaves with Esc without stopping anything, and resumes where it was', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    await user.keyboard(' ');
    await user.keyboard(' ');
    await advance(100);
    expect(await heading('Heat the server room')).toBeInTheDocument();
    const writes = () => harness.simulator.calls.filter((call) => call.method !== 'GET').length;
    const before = writes();

    await user.keyboard('{Escape}');
    await advance(100);
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    const resume = screen.getByRole('button', { name: 'Resume at step 3' });
    expect(resume).toHaveFocus();
    expect(screen.getByText(/Leaving stopped nothing/)).toBeInTheDocument();
    expect(writes()).toBe(before);

    await user.keyboard('{Enter}');
    await advance(100);
    expect(await heading('Heat the server room')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
  });

  it('goes back with ← and shows a step that already happened as done', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    await user.keyboard(' ');
    await user.keyboard(' ');
    await advance(100);
    harness.readings(28, 28.5, 29.3);
    await advance(3_000);
    expect(await heading('The alert opens')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    await advance(50);
    expect(await heading('Heat the server room')).toBeInTheDocument();
    expect(screen.getByText('Done: the rule raised')).toBeInTheDocument();
    expect(harness.simulator.callsTo('POST', RUN)).toHaveLength(1);
  });

  it('shows and hides the presenter notes with N, and leaves N alone in a field', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    await user.keyboard(' ');
    await advance(50);
    expect(await heading('The rule behind the alert')).toBeInTheDocument();
    const notes = 'The thresholds are the simulator’s copy of the rules that ingest read at boot.';
    expect(screen.queryByText(notes)).toBeNull();
    await user.keyboard('n');
    expect(screen.getByText(notes)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('n');
    expect(screen.queryByText(notes)).toBeNull();
  });
});

describe('what the page says before and during a demo', () => {
  it('lists the steps with the live numbers and about how long it takes', async () => {
    const harness = createDemoHarness();
    renderDemo(harness);
    expect(
      await eventually(() => screen.getByRole('heading', { level: 1, name: 'Guided demo' })),
    ).toBeInTheDocument();
    await advance(100);
    expect(screen.getByText('6 devices, 0.0 msg/s')).toBeInTheDocument();
    expect(screen.getByText('dc-env-01 → 29.2 °C for 60 s')).toBeInTheDocument();
    expect(
      screen.getByText('Script: overheat-to-incident · 6 steps · about 4 min'),
    ).toBeInTheDocument();
    expect(screen.getByText(/a reload forgets it/)).toBeInTheDocument();
  });

  it('says before the demo starts that no incident will appear without a command center', async () => {
    const harness = createDemoHarness({
      view: healthyView((view) => (view.ingest.alertSink = 'none')),
    });
    renderDemo(harness);
    expect(
      await eventually(() => screen.getByText(/no command center configured/)),
    ).toBeInTheDocument();
    expect(screen.getByText(/OCC_API_URL/)).toBeInTheDocument();
  });

  it('says before the demo starts that nothing publishes on the simulated clock', async () => {
    const harness = createDemoHarness({
      view: healthyView((view) => (view.engine.simulated = true)),
    });
    renderDemo(harness);
    expect(await eventually(() => screen.getByText(/simulated clock/))).toBeInTheDocument();
  });

  it('names the missing command center on the incident step and offers the way on', async () => {
    const harness = createDemoHarness({
      view: healthyView((view) => (view.ingest.alertSink = 'none')),
    });
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    for (let i = 0; i < 4; i++) {
      await user.keyboard(' ');
      await advance(100);
    }
    expect(await heading('The incident appears')).toBeInTheDocument();
    expect(screen.getByText(/OCC_API_URL is not set/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move on without the incident' }),
    ).toBeInTheDocument();
  });

  it('keeps the lost-link banner and the dependency pills in presenter mode', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    renderDemo(harness);
    await startFromKeyboard(user);
    act(() => harness.store.getState().setLink('lost', Date.now()));
    await advance(50);
    expect(screen.getByText(/Lost the simulator at/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Dependencies' })).toBeInTheDocument();
  });

  it('offers no Stop button before anything was started', async () => {
    const harness = createDemoHarness();
    renderDemo(harness);
    await eventually(() => screen.getByRole('heading', { level: 1, name: 'Guided demo' }));
    expect(screen.queryByRole('button', { name: 'Stop demo and release' })).toBeNull();
  });
});

describe('accessibility', () => {
  it('has no violations on the start screen, in the presenter view or when a step is late', async () => {
    const harness = createDemoHarness();
    const user = keyboardUser();
    const view = renderDemo(harness);
    await eventually(() => screen.getByRole('heading', { level: 1, name: 'Guided demo' }));
    await advance(100);
    expect(await axeViolations(view.container)).toEqual([]);

    await startFromKeyboard(user);
    expect(await heading('Everything is normal')).toBeInTheDocument();
    expect(await axeViolations(view.container)).toEqual([]);

    await user.keyboard(' ');
    await user.keyboard(' ');
    await advance(61_000);
    expect(screen.getByText(/Late: still waiting/)).toBeInTheDocument();
    expect(await axeViolations(view.container)).toEqual([]);
  });
});
