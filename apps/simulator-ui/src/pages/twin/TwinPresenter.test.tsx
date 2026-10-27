import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { twinLayoutFixture } from '../../api/fixtures/twinLayout';
import { StudioFrame } from '../../App';
import { AnimationBudget } from '../../lib/animationBudget';
import { OVERHEAT_TO_INCIDENT } from '../../lib/demoScripts';
import type * as Webgl from '../../lib/webgl';
import { DemoSessionStore } from '../../state/demoSessionStore';
import { HistoryStore } from '../../state/history';
import { PulseBus } from '../../state/pulses';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import type { TwinSceneProps } from '../../twin/TwinScene';
import { AnimationBudgetProvider } from '../../ui/AnimationBudget';
import { seedHistory } from '../fleet/fleetTestSupport';

// The scene needs WebGL, which jsdom does not have: a stand-in that keeps the camera handle the page flies it with, and shows
// where the page asked it to start. The calls it receives are what these tests look at.
const { probe, fly, nudge } = vi.hoisted(() => ({
  probe: vi.fn(),
  fly: vi.fn(),
  nudge: vi.fn(),
}));
vi.mock('../../lib/webgl', async (importOriginal) => ({
  ...(await importOriginal<typeof Webgl>()),
  webgl2Available: probe,
}));
vi.mock('../../twin/TwinScene', async () => {
  const { useImperativeHandle } = await import('react');
  return {
    TwinScene: ({ ref, start, selection }: TwinSceneProps) => {
      useImperativeHandle(ref, () => ({ fly, nudge }), []);
      return (
        <div
          data-testid="scene"
          data-start={start === undefined ? '' : typeof start === 'string' ? start : 'building'}
          data-selection={selection === null ? '' : `${selection.type}:${selection.id}`}
        />
      );
    },
  };
});
vi.mock('../topology/Topology', () => ({
  Topology: () => <div data-testid="topology" />,
}));
vi.mock('../overview/SimulationControls', () => ({
  SimulationControls: () => <div data-testid="simulation-controls" />,
}));
vi.mock('../overview/EventTimeline', () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock('../overview/useSimulationControls', () => ({ useSimulationControls: () => ({}) }));

const NOW = Date.parse('2026-10-27T09:15:00.000Z');
const DATA_CENTER = twinLayoutFixture.layout?.zones.find((zone) => zone.code === 'BLD-DC');

/** The simulator, as the twin sees it: the layout, and a refusal for anything else (a step's action is not what is looked at). */
function stubSimulator() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new URL(url, 'http://localhost').pathname === '/api/twin-layout'
        ? new Response(JSON.stringify(twinLayoutFixture))
        : new Response(JSON.stringify({ statusCode: 404, error: 'Not Found', message: url }), {
            status: 404,
          }),
    ),
  );
}

/** A demo that has started, at step `step` (from 0). */
function presentedAt(step = 0): DemoSessionStore {
  const demo = new DemoSessionStore();
  demo.dispatch({
    type: 'start',
    scriptId: OVERHEAT_TO_INCIDENT.id,
    stepCount: OVERHEAT_TO_INCIDENT.steps.length,
    now: NOW,
  });
  for (let i = 0; i < step; i++) demo.dispatch({ type: 'next', now: NOW + (i + 1) * 1000 });
  return demo;
}

/** The whole frame (shell, header, page) at `/twin`, the way a person meets it. */
function renderTwinFrame(demo: DemoSessionStore, path = '/twin') {
  const store = createStudioStore();
  const view = structuredClone(stateViewFixture);
  store.getState().setLink('live', Date.now());
  store.getState().setView(view, Date.now());
  const history = new HistoryStore();
  seedHistory(history, view);
  return render(
    <StudioProvider store={store} history={history} pulses={new PulseBus()} demo={demo}>
      <AnimationBudgetProvider budget={new AnimationBudget()}>
        <MemoryRouter initialEntries={[path]}>
          <StudioFrame />
        </MemoryRouter>
      </AnimationBudgetProvider>
    </StudioProvider>,
  );
}

const dock = () => screen.findByRole('region', { name: 'Guided demo' });

beforeEach(() => {
  probe.mockReturnValue(true);
  stubSimulator();
});
afterEach(() => {
  vi.unstubAllGlobals();
  probe.mockReset();
  fly.mockReset();
  nudge.mockReset();
});

describe('the Twin page while a guided demo is presented on it', () => {
  it('is presenter mode: no navigation, the presenter header, and the current step beside the scene', async () => {
    renderTwinFrame(presentedAt(0));
    await screen.findByTestId('scene');
    expect(screen.getByRole('button', { name: /Exit presenter/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();

    const card = within(await dock());
    expect(
      card.getByRole('heading', { level: 2, name: 'Everything is normal' }),
    ).toBeInTheDocument();
    expect(card.getByText('Step 1')).toBeInTheDocument();
    // The dock says its keys, and the pipeline strip of the Demo page is not drawn here.
    expect(card.getAllByText('Space').length).toBeGreaterThan(0);
    expect(card.getAllByText('Esc').length).toBeGreaterThan(0);
  });

  it('starts the scene at the camera of the step on screen, and does not fly it there', async () => {
    renderTwinFrame(presentedAt(0));
    const scene = await screen.findByTestId('scene');
    expect(scene).toHaveAttribute('data-start', 'campus');
    expect(fly).not.toHaveBeenCalled();
  });

  it('starts at the building when the step on screen names one, and selects it', async () => {
    renderTwinFrame(presentedAt(2));
    const scene = await screen.findByTestId('scene');
    expect(scene).toHaveAttribute('data-start', 'building');
    // The selection is made by an effect after the scene is up, so it is waited for.
    await waitFor(() => expect(scene).toHaveAttribute('data-selection', 'zone:BLD-DC'));
    expect(fly).not.toHaveBeenCalled();
  });

  it('flies to the Data Center when the demo reaches the heat step, and back to the campus at the incident', async () => {
    const demo = presentedAt(0);
    renderTwinFrame(demo);
    const scene = await screen.findByTestId('scene');

    act(() => demo.dispatch({ type: 'next', now: NOW + 10_000 }));
    // "The rule behind the alert" has no camera: the view stays where the presenter put it.
    expect(fly).not.toHaveBeenCalled();

    act(() => demo.dispatch({ type: 'next', now: NOW + 11_000 }));
    await waitFor(() => expect(fly).toHaveBeenCalledTimes(1));
    expect(fly).toHaveBeenLastCalledWith({
      building: expect.objectContaining({ heightM: DATA_CENTER?.heightM }) as unknown,
    });
    await waitFor(() => expect(scene).toHaveAttribute('data-selection', 'zone:BLD-DC'));
    expect(screen.getByRole('heading', { level: 3, name: DATA_CENTER?.name })).toBeInTheDocument();

    act(() => demo.dispatch({ type: 'next', now: NOW + 12_000 }));
    act(() => demo.dispatch({ type: 'next', now: NOW + 13_000 }));
    await waitFor(() => expect(fly).toHaveBeenLastCalledWith('campus'));
    expect(scene).toHaveAttribute('data-selection', '');
  });

  it('moves the camera again when a step is gone back to', async () => {
    const demo = presentedAt(2);
    renderTwinFrame(demo);
    await screen.findByTestId('scene');
    act(() => demo.dispatch({ type: 'back', now: NOW + 10_000 }));
    act(() => demo.dispatch({ type: 'next', now: NOW + 11_000 }));
    await waitFor(() => expect(fly).toHaveBeenCalledTimes(1));
  });

  it('draws the Inject card for a selected device and the dock together, in the one column', async () => {
    renderTwinFrame(presentedAt(0), '/twin?device=dc-env-01');
    await screen.findByTestId('scene');
    expect(await screen.findByRole('heading', { name: 'Inject at dc-env-01' })).toBeInTheDocument();
    expect(await dock()).toBeInTheDocument();
  });
});

describe('the keys of the Twin page while a guided demo is presented on it', () => {
  it('Esc leaves presenter mode and does not climb a level', async () => {
    const demo = presentedAt(2);
    renderTwinFrame(demo);
    const scene = await screen.findByTestId('scene');
    await waitFor(() => expect(scene).toHaveAttribute('data-selection', 'zone:BLD-DC'));

    await userEvent.keyboard('{Escape}');
    expect(demo.get().status).toBe('paused-for-exit');
    // Still at the building: the first Esc was the presenter's.
    expect(scene).toHaveAttribute('data-selection', 'zone:BLD-DC');
    expect(await screen.findByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Guided demo' })).toBeNull();

    // Once the demo is no longer presented, the twin has Esc back.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(scene).toHaveAttribute('data-selection', ''));
  });

  it('← goes back a step and does not pan, even with focus on the stage', async () => {
    const demo = presentedAt(1);
    renderTwinFrame(demo);
    await screen.findByTestId('scene');
    screen.getByRole('group', { name: /Campus view/ }).focus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(demo.get().stepIndex).toBe(0);
    expect(nudge).not.toHaveBeenCalled();

    // The other arrows are still the twin's.
    await userEvent.keyboard('{ArrowRight}');
    expect(nudge).toHaveBeenCalledWith('pan-right');
  });

  it('Space moves to the next step', async () => {
    const demo = presentedAt(0);
    renderTwinFrame(demo);
    await screen.findByTestId('scene');
    await userEvent.keyboard(' ');
    expect(demo.get().stepIndex).toBe(1);
    expect(
      await within(await dock()).findByRole('heading', {
        level: 2,
        name: 'The rule behind the alert',
      }),
    ).toBeInTheDocument();
  });
});

describe('the Twin page when no demo is presented', () => {
  it('has the ordinary shell and no dock, and Esc climbs a level as it always did', async () => {
    renderTwinFrame(new DemoSessionStore(), '/twin?zone=BLD-DC');
    const scene = await screen.findByTestId('scene');
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Guided demo' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Exit presenter/ })).toBeNull();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(scene).toHaveAttribute('data-selection', ''));
  });

  it('has no dock while the demo is left with Esc, and shows it again on resume', async () => {
    const demo = presentedAt(0);
    renderTwinFrame(demo);
    await dock();
    act(() => demo.dispatch({ type: 'exit' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Guided demo' })).toBeNull());
    act(() => demo.dispatch({ type: 'resume', now: NOW + 5_000 }));
    expect(await dock()).toBeInTheDocument();
  });
});

describe('the Twin page where the campus is not drawn, with a demo presented', () => {
  it('keeps the step and the way on under the fallback when the device has no WebGL 2', async () => {
    probe.mockReturnValue(false);
    const demo = presentedAt(0);
    renderTwinFrame(demo);
    expect(await screen.findByText(/3D view isn't available on this device/)).toBeInTheDocument();
    const card = within(await dock());
    expect(
      card.getByRole('heading', { level: 2, name: 'Everything is normal' }),
    ).toBeInTheDocument();

    await userEvent.keyboard(' ');
    expect(demo.get().stepIndex).toBe(1);
    await userEvent.keyboard('{Escape}');
    expect(demo.get().status).toBe('paused-for-exit');
    expect(await screen.findByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
  });

  it('keeps the step while the layout cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ statusCode: 404, message: 'x' }), { status: 404 }),
      ),
    );
    renderTwinFrame(presentedAt(0));
    expect(await screen.findByText(/The twin layout could not be read/)).toBeInTheDocument();
    expect(await dock()).toBeInTheDocument();
  });
});

describe('the Demo page’s way onto the twin', () => {
  it('starts the demo and opens the twin, where the step is drawn and the scene starts at its camera', async () => {
    const demo = new DemoSessionStore();
    renderTwinFrame(demo, '/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Present on the twin' }));

    expect(demo.get().status).toBe('presenting');
    expect(demo.get().stepIndex).toBe(0);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Digital twin' }),
    ).toBeInTheDocument();
    expect(
      within(await dock()).getByRole('heading', { level: 2, name: 'Everything is normal' }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('scene')).toHaveAttribute('data-start', 'campus');
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('resumes on the twin at the step it was left at', async () => {
    const demo = presentedAt(1);
    demo.dispatch({ type: 'exit' });
    renderTwinFrame(demo, '/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Resume on the twin' }));

    expect(demo.get().status).toBe('presenting');
    expect(demo.get().stepIndex).toBe(1);
    expect(
      await within(await dock()).findByRole('heading', {
        level: 2,
        name: 'The rule behind the alert',
      }),
    ).toBeInTheDocument();
  });

  it('still starts on the Demo page itself, as before', async () => {
    const demo = new DemoSessionStore();
    renderTwinFrame(demo, '/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Start presenter' }));
    expect(demo.get().status).toBe('presenting');
    expect(await screen.findByRole('navigation', { name: 'Demo steps' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Digital twin' })).toBeNull();
  });
});

describe('the Twin page in presenter mode, accessibility', () => {
  it('has no violations with the dock and the scene up', async () => {
    const { container } = renderTwinFrame(presentedAt(0));
    await screen.findByTestId('scene');
    await dock();
    expect(await axeViolations(container)).toEqual([]);
  });
});
