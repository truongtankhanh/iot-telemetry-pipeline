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
    TwinScene: ({ layout, pins, flow, granted, moving, layers, onUnavailable }: TwinSceneProps) => (
      <div
        data-testid="scene"
        data-zones={layout.zones.length}
        data-pins={pins.length}
        data-arcs={flow.arcs.length}
        data-looks={flow.arcs.map((arc) => `${arc.id}:${arc.look}`).join(',')}
        data-granted={[...granted].sort().join(',')}
        data-moving={[...moving].sort().join(',')}
        data-layers={JSON.stringify(layers)}
      >
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

/** The fixture's state with some faults on, the way the simulator reports them (`FaultsSnapshot`). */
const withFaults = (change: Partial<StateView['engine']['faults']>): StateView => {
  const view = structuredClone(stateViewFixture);
  view.engine.faults = { ...view.engine.faults, ...change };
  return view;
};

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

describe('the Twin page, data flow, beacons and faults (SIM-19)', () => {
  const pipeline = () => screen.getByRole('region', { name: 'The Pipeline, as text' });

  it('hands the scene an arc for every pin, and the lit ones a slot of the animation budget', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    const scene = await screen.findByTestId('scene');
    expect(scene).toHaveAttribute('data-arcs', '2');
    // An open alert is an anomaly to the eye (amber arc), and amber is lit.
    expect(scene.getAttribute('data-looks')).toContain('dc-env-01:warn');
    // The slots are asked for when the page subscribes to the budget, an effect after the scene is first drawn, and the
    // grant is a render later still: wait for it rather than read it on the frame the scene appears.
    await waitFor(() => expect(scene.getAttribute('data-granted')).toContain('dc-env-01'));
    // The fixture has one open alert, on dc-env-01: that beacon may move.
    await waitFor(() => expect(scene).toHaveAttribute('data-moving', 'dc-env-01'));
  });

  it('says the open alert as text in the list and on the card, with a link to the alerts', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    const table = screen.getByRole('table', { name: /Devices in the twin, as text/ });
    const row = within(table).getByRole('row', { name: /dc-env-01/ });
    expect(row).toHaveTextContent('alert #7 high');
    await userEvent.click(row);
    expect(screen.getByText('alert #7 high')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open alerts' })).toHaveAttribute('href', '/alerts');
  });

  it('describes the hub as logical, with no fault on, as text', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    const hub = within(pipeline());
    expect(hub.getByRole('heading', { level: 3, name: 'Pipeline (logical)' })).toBeInTheDocument();
    expect(hub.getByText(/not a place on the campus/)).toBeInTheDocument();
    expect(hub.getByText('No fault is on.')).toBeInTheDocument();
  });

  it('draws a fault from the engine state and says it as text, and the next state without it says nothing', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin(
      withFaults({
        drop: { percent: 10 },
        delay: { delayMs: 800, jitterMs: 100 },
        dropped: 4,
        held: 3,
      }),
    );
    await screen.findByTestId('scene');
    const hub = within(pipeline());
    expect(hub.getByText('dropped 4')).toBeInTheDocument();
    expect(hub.getByText('lag 800 ± 100 ms · 3 held')).toBeInTheDocument();
    expect(hub.getByText('Drop: 10 % of messages on the running devices')).toBeInTheDocument();
    expect(
      hub.getByText('Delay: 800 ms, jitter 100 ms on the running devices; 3 messages held'),
    ).toBeInTheDocument();
  });

  it('turns every arc red when the link is cut, and says so, and is not the Studio link', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin(withFaults({ linkLoss: { since: '2026-10-20T09:14:31.000Z', forS: null } }));
    const scene = await screen.findByTestId('scene');
    for (const look of (scene.getAttribute('data-looks') ?? '').split(',')) {
      expect(look.endsWith(':bad')).toBe(true);
    }
    expect(within(pipeline()).getByText(/Link: No link/)).toBeInTheDocument();
    expect(within(pipeline()).getByText('no link')).toBeInTheDocument();
  });

  it('shows a disconnected broker as the hub being down', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    const view = structuredClone(stateViewFixture);
    view.broker.connected = false;
    renderTwin(view);
    const scene = await screen.findByTestId('scene');
    expect(scene.getAttribute('data-looks')).toContain('dc-env-01:bad');
    expect(within(pipeline()).getByText(/Broker: Disconnected/)).toBeInTheDocument();
  });

  it('has a switch for each layer, and the text stays when the data flow is switched off', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    const scene = await screen.findByTestId('scene');
    for (const name of ['Devices', 'Data flow', 'Alerts', /^Catalogue/]) {
      expect(screen.getByRole('switch', { name })).toBeChecked();
    }
    await userEvent.click(screen.getByRole('switch', { name: 'Data flow' }));
    expect(JSON.parse(scene.getAttribute('data-layers') ?? '{}')).toMatchObject({
      dataFlow: false,
      alerts: true,
    });
    // No arc may move a dot while the layer is off, and the hub is still described.
    expect(scene).toHaveAttribute('data-granted', '');
    expect(within(pipeline()).getByText('No fault is on.')).toBeInTheDocument();
  });

  it('keys the down state and the logical hub in the legend', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    expect(
      within(screen.getByRole('list', { name: 'States' })).getByText('Down'),
    ).toBeInTheDocument();
    expect(screen.getByText('Pipeline hub, logical (not a place)')).toBeInTheDocument();
    expect(
      screen.getByText(/Open alert: a beacon in the alert's severity colour/),
    ).toBeInTheDocument();
  });
});

describe('the Twin page, Inject here (SIM-21)', () => {
  const table = () => screen.getByRole('table', { name: /Devices in the twin, as text/ });

  it('has no card to inject at while nothing is selected', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    expect(screen.queryByRole('heading', { name: /^Inject at / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Inject now' })).toBeNull();
  });

  it('shows the card for a selected device, aimed at it, with a way into the Lab on the same device', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    await userEvent.click(within(table()).getByRole('row', { name: /dc-env-01/ }));

    expect(screen.getByRole('heading', { name: 'Inject at dc-env-01' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inject now' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in lab' })).toHaveAttribute(
      'href',
      '/lab?target=dc-env-01',
    );
  });

  it('moves the card to another device, and takes it away when the selection climbs to a building', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    await userEvent.click(within(table()).getByRole('row', { name: /dc-env-01/ }));
    expect(screen.getByRole('heading', { name: 'Inject at dc-env-01' })).toBeInTheDocument();

    await userEvent.click(within(table()).getByRole('row', { name: /lib-air-01/ }));
    expect(screen.getByRole('heading', { name: 'Inject at lib-air-01' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Inject at dc-env-01' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in lab' })).toHaveAttribute(
      'href',
      '/lab?target=lib-air-01',
    );

    // A building has no card: its devices are chosen from it.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: /^Inject at / })).toBeNull();
  });

  it('has no dock when no guided demo is presented', async () => {
    stubFetch(() => answer(twinLayoutFixture));
    renderTwin();
    await screen.findByTestId('scene');
    expect(screen.queryByRole('region', { name: 'Guided demo' })).toBeNull();
  });
});
