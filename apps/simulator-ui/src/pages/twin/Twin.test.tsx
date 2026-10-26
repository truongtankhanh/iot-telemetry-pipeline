import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { twinLayoutFixture } from '../../api/fixtures/twinLayout';
import type { StateView, TwinLayoutView } from '../../api/types';
import { AnimationBudget } from '../../lib/animationBudget';
import type * as Webgl from '../../lib/webgl';
import { HistoryStore } from '../../state/history';
import { PulseBus } from '../../state/pulses';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import type { TwinSceneProps } from '../../twin/TwinScene';
import { AnimationBudgetProvider } from '../../ui/AnimationBudget';
import { seedHistory } from '../fleet/fleetTestSupport';
import { Twin } from './Twin';

// The scene needs WebGL, which jsdom does not have, and is the one module that imports three.js: it is replaced by a
// stand-in that counts how many times its module was loaded. A module is loaded once and then cached, so the cases that
// must NOT request the scene come first in this file, and the ones that do come after them.
const { probe, sceneLoaded } = vi.hoisted(() => ({ probe: vi.fn(), sceneLoaded: vi.fn() }));
vi.mock('../../lib/webgl', async (importOriginal) => ({
  ...(await importOriginal<typeof Webgl>()),
  webgl2Available: probe,
}));
vi.mock('../../twin/TwinScene', () => {
  sceneLoaded();
  return {
    TwinScene: ({ layout, pins, onUnavailable }: TwinSceneProps) => (
      <div data-testid="scene" data-zones={layout.zones.length} data-pins={pins.length}>
        <button type="button" onClick={() => onUnavailable('context-lost')}>
          Lose the context
        </button>
      </div>
    ),
  };
});
// The Topology draws a graph with React Flow, which has its own tests; here only that it is in place, and without a heading.
vi.mock('../topology/Topology', () => ({
  Topology: ({ showHeader }: { showHeader?: boolean }) => (
    <div data-testid="topology" data-header={String(showHeader)} />
  ),
}));
// The simulation controls and the event timeline are the Overview's, with their own tests and their own requests.
vi.mock('../overview/SimulationControls', () => ({
  SimulationControls: () => <div data-testid="simulation-controls" />,
}));
vi.mock('../overview/EventTimeline', () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock('../overview/useSimulationControls', () => ({ useSimulationControls: () => ({}) }));

const UNAVAILABLE: TwinLayoutView = {
  available: false,
  reason: 'cannot read /x/twin-layout.json (ENOENT)',
  layout: null,
  placement: {
    placed: [],
    unplaced: [{ id: 'dc-env-01', reason: 'the twin layout is not available' }],
    orphans: [],
  },
};

const answer = (body: unknown) => new Response(JSON.stringify(body));
const refusal = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, error: 'Error', message }), { status });

function stubFetch(...answers: (() => Response | Promise<Response>)[]) {
  let next = 0;
  const fetchFn = vi.fn(async () => {
    const make = answers[Math.min(next, answers.length - 1)];
    next += 1;
    if (make === undefined) throw new Error('fetch was not expected');
    return make();
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

/** The page inside what it reads: a store holding the fixture's state (or none), its history and an animation budget. */
const renderTwin = (view: StateView | null = structuredClone(stateViewFixture)) => {
  const store = createStudioStore();
  store.getState().setLink('live', Date.now());
  if (view) store.getState().setView(view, Date.now());
  const history = new HistoryStore();
  if (view) seedHistory(history, view);
  return render(
    <StudioProvider store={store} history={history} pulses={new PulseBus()}>
      <AnimationBudgetProvider budget={new AnimationBudget()}>
        <MemoryRouter initialEntries={['/twin']}>
          <Twin />
        </MemoryRouter>
      </AnimationBudgetProvider>
    </StudioProvider>,
  );
};

beforeEach(() => probe.mockReturnValue(true));
afterEach(() => {
  vi.unstubAllGlobals();
  probe.mockReset();
});

describe('the Twin page, where the scene is not requested', () => {
  it('says the 3D view is not available without WebGL 2, shows the Topology in place, and asks for nothing', () => {
    probe.mockReturnValue(false);
    const fetchFn = stubFetch();
    renderTwin();
    expect(screen.getByRole('heading', { level: 1, name: 'Digital twin' })).toBeInTheDocument();
    expect(screen.queryByText('Spike')).toBeNull();
    expect(screen.getByText(/3D view isn't available on this device/)).toBeInTheDocument();
    expect(
      screen.getByText(/WebGL 2 is off, so Studio shows the topology instead/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open topology' })).toHaveAttribute(
      'href',
      '/topology',
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(sceneLoaded).not.toHaveBeenCalled();
  });

  it('shows the Topology itself, under the twin’s own heading, and never an empty canvas', async () => {
    probe.mockReturnValue(false);
    stubFetch();
    renderTwin();
    const topology = await screen.findByTestId('topology');
    expect(topology).toHaveAttribute('data-header', 'false');
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('says it is reading the layout while the simulator has not answered', () => {
    stubFetch(() => new Promise<Response>(() => {}));
    renderTwin();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the campus layout…');
    expect(sceneLoaded).not.toHaveBeenCalled();
  });

  it('gives the reason and the Topology when the layout is not available', async () => {
    stubFetch(() => answer(UNAVAILABLE));
    renderTwin();
    expect(await screen.findByText(/The twin layout is not available/)).toBeInTheDocument();
    expect(screen.getByText(/cannot read \/x\/twin-layout.json \(ENOENT\)/)).toBeInTheDocument();
    expect(await screen.findByTestId('topology')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open topology' })).toHaveAttribute(
      'href',
      '/topology',
    );
    expect(sceneLoaded).not.toHaveBeenCalled();
  });

  it('says a simulator without the route is too old, and reads again when asked', async () => {
    const fetchFn = stubFetch(
      () => refusal(404, 'No such route'),
      () => answer(UNAVAILABLE),
    );
    renderTwin();
    expect(await screen.findByText(/The twin layout could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/too old for the twin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/The twin layout is not available/)).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sceneLoaded).not.toHaveBeenCalled();
  });

  it('waits for the first message from the simulator before it draws', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin(null);
    expect(
      await screen.findByText('Waiting for the first message from the simulator…'),
    ).toBeInTheDocument();
    expect(sceneLoaded).not.toHaveBeenCalled();
  });
});

describe('the Twin page, where the scene is requested', () => {
  it('loads the scene with the layout and the placed pins, and states what it draws, where it came from and who is not placed', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    const scene = await screen.findByTestId('scene');
    expect(scene).toHaveAttribute('data-zones', '3');
    expect(scene).toHaveAttribute('data-pins', '2');
    expect(sceneLoaded).toHaveBeenCalledTimes(1);

    expect(
      screen.getByText(
        '3 zones, 2 buildings, 1 catalogue asset (not simulated) · 2 of 3 devices placed (2 illustrative)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a copy of ops-command-center at 4b4fe02, compared on 2026-10-26/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Not drawn: the layout has no position for these devices/),
    ).toBeInTheDocument();
    expect(screen.getByText('hub-power-01: no position in the layout')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open topology' })).toBeNull();
    expect(screen.getByTestId('simulation-controls')).toBeInTheDocument();
    expect(screen.getByTestId('event-timeline')).toBeInTheDocument();
  });

  it('lists every device as text with its state, whether or not the scene draws it', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    const table = screen.getByRole('table', { name: /Devices in the twin, as text/ });
    for (const device of stateViewFixture.devices) {
      expect(within(table).getByRole('row', { name: new RegExp(device.id) })).toBeInTheDocument();
    }
    expect(within(table).getByRole('row', { name: /dc-env-01/ })).toHaveTextContent(/Anomaly/);
    const unplaced = within(table).getByRole('row', { name: /hub-power-01/ });
    expect(unplaced).toHaveTextContent(/Paused/);
    expect(unplaced).toHaveTextContent('Not drawn: no position in the layout');
  });

  it('selects a device from the list, and climbs one level at a time on Escape', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    const building = twinLayoutFixture.layout?.zones.find((zone) => zone.code === 'BLD-LIB');
    const device = stateViewFixture.devices.find((candidate) => candidate.id === 'lib-air-01');
    expect(building).toBeDefined();
    expect(device).toBeDefined();
    const name = device?.name ?? 'lib-air-01';

    expect(screen.getByText(/Choose a building or a device/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Devices in the twin, as text/ });
    await userEvent.click(within(table).getByRole('row', { name: /lib-air-01/ }));
    expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Fleet' })).toHaveAttribute(
      'href',
      '/fleet?device=lib-air-01',
    );

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('heading', { level: 3, name: building?.name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText(/Choose a building or a device/)).toBeInTheDocument();
    // Nothing left to climb: the page is still the twin.
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('heading', { level: 1, name: 'Digital twin' })).toBeInTheDocument();
  });

  it('has no accessibility violations once the scene is up', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    const { container } = renderTwin();
    await screen.findByTestId('scene');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('swaps the scene for the Topology when it says its graphics context was lost for good', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await userEvent.click(await screen.findByRole('button', { name: 'Lose the context' }));
    await waitFor(() => expect(screen.queryByTestId('scene')).toBeNull());
    expect(screen.getByText(/The 3D view lost its graphics context/)).toBeInTheDocument();
    expect(await screen.findByTestId('topology')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open topology' })).toHaveAttribute(
      'href',
      '/topology',
    );
  });
});
