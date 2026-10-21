import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StateView } from '../../api/types';
import { axeViolations } from '../../test-axe';
import { viewWithDevices } from '../fleet/fleetTestSupport';
import { graphNode, installReactFlowStubs } from '../topology/topologyTestSupport';
import { address, renderOverview } from './overviewTestSupport';

// The Overview draws the topology, which needs the stand-ins React Flow asks of a browser.
let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The card of a key figure, by its label. */
const kpi = (label: string): HTMLElement => {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.closest('div') as HTMLElement;
};

const runButton = (name = 'server-room-overheat') =>
  screen.findByRole('button', { name: `Run ${name}` });

/** A second read of ingest's metrics, a second later: 10 readings stored, 0.4 s of lag between them. */
function nextRead(view: StateView): StateView {
  const next = structuredClone(view);
  next.metrics.lastOkAt = new Date(
    Date.parse(view.metrics.lastOkAt as string) + 1000,
  ).toISOString();
  for (const sample of next.metrics.samples) {
    if (sample.name === 'telemetry_readings_total' && sample.labels.result === 'stored')
      sample.value += 10;
    if (sample.name === 'telemetry_ingest_lag_seconds_sum') sample.value += 0.4;
    if (sample.name === 'telemetry_ingest_lag_seconds_count') sample.value += 10;
  }
  return next;
}

describe('before there is anything to show', () => {
  it('waits for the first message of the simulator', () => {
    renderOverview({ view: null, link: 'connecting' });
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the first message/)).toBeInTheDocument();
  });

  it('says the simulator has not answered when the link is lost before any message', () => {
    renderOverview({ view: null, link: 'lost' });
    expect(screen.getByText('The simulator has not answered yet.')).toBeInTheDocument();
  });
});

describe('the key figures', () => {
  it('say what is running, as the Fleet and the Alerts say it', () => {
    renderOverview();
    expect(kpi('Devices online')).toHaveTextContent('5 of 6');
    expect(kpi('Devices online')).toHaveTextContent('83.3% availability · 1 paused');
    expect(within(kpi('Devices online')).getByRole('img')).toHaveAccessibleName(
      '5 running, 1 paused, 0 stopped',
    );
    expect(kpi('Active alerts')).toHaveTextContent('1');
    expect(within(kpi('Active alerts')).getByText('high')).toBeInTheDocument();
    expect(kpi('Alert delivery')).toHaveTextContent('1 of 1');
    expect(kpi('Alert delivery')).toHaveTextContent('0 pending · 0 failed');
    expect(kpi('Not reporting')).toHaveTextContent('1');
    expect(kpi('Not reporting')).toHaveTextContent('hub-power-01 paused');
  });

  it('follow the rate of the stream', () => {
    const { store } = renderOverview();
    expect(kpi('Message rate')).toHaveTextContent('0.0 msg/s');
    act(() => store.getState().setPublishRate(2));
    expect(kpi('Message rate')).toHaveTextContent('2.0 msg/s');
    expect(kpi('Message rate')).toHaveTextContent('120 per minute · 0 sequence gaps');
  });

  it('give the lag once there are two reads of ingest to compare, and not before', () => {
    const { store, simulator } = renderOverview();
    expect(kpi('Ingest lag')).toHaveTextContent('unknown');
    expect(kpi('Ingest lag')).toHaveTextContent('no reading was stored between the last two reads');

    act(() => store.getState().setView(nextRead(simulator.state), Date.now()));
    expect(kpi('Ingest lag')).toHaveTextContent('0.04 s');
  });

  it('say "unknown", not zero, for what depends on ingest when it does not answer', () => {
    const { store, simulator } = renderOverview();
    act(() => {
      const down = structuredClone(simulator.state);
      down.ingest.status = 'unreachable';
      down.ingest.alertSink = null;
      store.getState().setView(down, Date.now());
    });
    for (const label of ['Active alerts', 'Ingest lag', 'Alert delivery']) {
      expect(kpi(label)).toHaveTextContent('unknown');
      expect(kpi(label)).toHaveTextContent('ingest does not answer');
      expect(kpi(label)).not.toHaveTextContent(/\b0\b/);
    }
    // What the simulator itself knows is still known.
    expect(kpi('Devices online')).toHaveTextContent('5 of 6');
    expect(screen.getByRole('alert')).toHaveTextContent(/ingest/i);
  });

  it('count the stopped devices the engine does not run', () => {
    const view = structuredClone(viewWithDevices(6));
    view.engine.devices[0]!.state = 'stopped';
    view.engine.devices[1]!.state = 'paused';
    renderOverview({ view, seed: false });
    expect(kpi('Devices online')).toHaveTextContent('4 of 6');
    expect(kpi('Devices online')).toHaveTextContent('66.7% availability · 1 paused, 1 stopped');
  });

  it('say why the rate is zero on a stepped clock', () => {
    renderOverview({ simulated: true });
    expect(kpi('Message rate')).toHaveTextContent('nothing is published between steps');
  });
});

describe('the alert feed', () => {
  it('lists the newest alerts and opens one on the Alerts page', () => {
    renderOverview();
    const feed = screen.getByRole('region', { name: 'Alerts' });
    const link = within(feed).getByRole('link', { name: 'Server room temperature high' });
    expect(link).toHaveAttribute('href', '/alerts?alert=7');
    expect(within(feed).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/alerts');
    expect(within(feed).getByText('Open')).toBeInTheDocument();
    expect(feed).toHaveTextContent('dc-env-01');
  });

  it('says so when no alert has been raised', () => {
    const view = structuredClone(viewWithDevices(2));
    view.alerts.alerts = [];
    renderOverview({ view, seed: false });
    expect(screen.getByText('No alert has been raised yet.')).toBeInTheDocument();
  });

  it('shows the last alerts dimmed, and says why, when ingest does not answer', () => {
    const { store, simulator, container } = renderOverview();
    act(() => {
      const down = structuredClone(simulator.state);
      down.ingest.status = 'unreachable';
      down.alerts.stale = true;
      store.getState().setView(down, Date.now());
    });
    expect(screen.getByText(/Alerts are unknown: ingest does not answer/)).toBeInTheDocument();
    expect(container.querySelector('ul[data-dimmed="true"]')).not.toBeNull();
  });
});

describe('the controls', () => {
  it('offer the scenarios of the library, the first built-in picked', async () => {
    renderOverview();
    const picker = await screen.findByRole('combobox', { name: 'Scenario' });
    expect(picker).toHaveValue('server-room-overheat');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['server-room-overheat', 'crowded-lecture', 'bad-afternoon']);
  });

  it('show the phases of the picked scenario before it runs, from the simulator', async () => {
    renderOverview();
    await runButton();
    const progress = screen.getByRole('group', { name: /Scenario progress/ });
    expect(within(progress).getByText('Normal')).toBeInTheDocument();
    expect(within(progress).getByText('Anomaly')).toBeInTheDocument();
    expect(within(progress).getByText('Not running')).toBeInTheDocument();
    expect(within(progress).getByText('Alert opens about 24 s')).toBeInTheDocument();
  });

  it('run a scenario, show it running, and stop it', async () => {
    const user = userEvent.setup();
    const { simulator } = renderOverview();
    await user.click(await runButton());

    expect(
      await screen.findByRole('button', { name: 'Stop server-room-overheat' }),
    ).toBeInTheDocument();
    expect(simulator.callsTo('POST', '/api/scenarios/server-room-overheat/run')).toHaveLength(1);
    // "Running" is also the word of every healthy device in the graph: ask the controls' card.
    const controlsCard = screen.getByRole('region', { name: 'Simulation controls' });
    expect(within(controlsCard).getByText('Running')).toBeInTheDocument();
    expect(screen.getByText(/Running server-room-overheat\./)).toBeInTheDocument();
    // The header names the scenario and how far it has got.
    expect(screen.getByText(/^server-room-overheat · \d+ s in$/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: /Scenario progress/ })).getByText('No alert yet'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stop server-room-overheat' }));
    expect(await runButton()).toBeInTheDocument();
    expect(simulator.callsTo('POST', '/api/scenarios/server-room-overheat/stop')).toHaveLength(1);
  });

  it('ask before running over what is already playing, and repeat the run with replace on a yes', async () => {
    const user = userEvent.setup();
    const { simulator } = renderOverview();
    simulator.conflicts.set('server-room-overheat', [
      { deviceId: 'dc-env-01', anomalyId: 'a9', runId: 'r9', scenario: 'crowded-lecture' },
    ]);
    await user.click(await runButton());

    const dialog = await screen.findByRole('dialog', { name: 'Replace what is running?' });
    expect(dialog).toHaveTextContent('The run of crowded-lecture');
    await user.click(within(dialog).getByRole('button', { name: 'Replace and run' }));

    expect(
      await screen.findByRole('button', { name: 'Stop server-room-overheat' }),
    ).toBeInTheDocument();
    const bodies = simulator
      .callsTo('POST', '/api/scenarios/server-room-overheat/run')
      .map((call) => call.body);
    expect(bodies).toEqual([undefined, { replace: true }]);
  });

  it('say what the simulator refused, on the controls', async () => {
    const user = userEvent.setup();
    const { simulator } = renderOverview();
    simulator.failRun({ status: 400, message: 'Cannot run: the engine is not started' });
    await user.click(await runButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot run: the engine is not started',
    );
  });

  it('warn before the click that running starts a device that is stopped', async () => {
    renderOverview({ path: '/?scenario=bad-afternoon' });
    expect(await screen.findByRole('combobox', { name: 'Scenario' })).toHaveValue('bad-afternoon');
    expect(screen.getByText(/hub-power-01 is stopped; running this starts it/)).toBeInTheDocument();
  });

  it('keep the scenario of the address in it when another is picked', async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Scenario' }),
      'crowded-lecture',
    );
    expect(address()).toBe('/?scenario=crowded-lecture');
    expect(screen.getByRole('button', { name: 'Run crowded-lecture' })).toBeInTheDocument();
  });

  it('fall back to the default for a name the library does not have, and say so', async () => {
    renderOverview({ path: '/?scenario=nope' });
    expect(await screen.findByRole('combobox', { name: 'Scenario' })).toHaveValue(
      'server-room-overheat',
    );
    expect(screen.getByText(/No scenario is named/)).toHaveTextContent('nope');
  });

  it('pick the scenario that is running when the address names none', async () => {
    const { store, simulator } = renderOverview();
    await screen.findByRole('combobox', { name: 'Scenario' });
    simulator.state = {
      ...simulator.state,
      runs: [
        {
          id: 'r1',
          scenario: 'crowded-lecture',
          startedAt: '2026-10-21T09:00:00.000Z',
          offsetS: 0,
          endsAtS: 110,
          anomalyIds: ['a1'],
          startedDevices: [],
        },
      ],
    };
    act(() => store.getState().setView(simulator.state, Date.now()));
    expect(screen.getByRole('combobox', { name: 'Scenario' })).toHaveValue('crowded-lecture');
    expect(screen.getByRole('button', { name: 'Stop crowded-lecture' })).toBeInTheDocument();
  });

  it('say the library could not be read, and try again', async () => {
    const user = userEvent.setup();
    const { simulator } = renderOverview({
      libraryFailure: { status: 502, message: 'ECONNREFUSED' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The scenarios could not be read: ECONNREFUSED',
    );
    // Pause and Reset do not depend on the library.
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();

    simulator.failLibrary(null);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('combobox', { name: 'Scenario' })).toBeInTheDocument();
  });
});

describe('Pause and Resume', () => {
  it('pause every running device, one after another, and then offer to resume the paused ones', async () => {
    const user = userEvent.setup();
    const { simulator, store } = renderOverview();
    await user.click(await screen.findByRole('button', { name: 'Pause 5' }));

    await waitFor(() =>
      expect(store.getState().view?.engine.devices.every((d) => d.state === 'paused')).toBe(true),
    );
    expect(simulator.callsTo('POST', '/api/devices/dc-env-01/pause')).toHaveLength(1);
    expect(simulator.callsTo('POST', '/api/devices/hub-power-01/pause')).toHaveLength(0);

    const resume = await screen.findByRole('button', { name: 'Resume 6 paused' });
    await user.click(resume);
    await waitFor(() =>
      expect(store.getState().view?.engine.devices.every((d) => d.state === 'running')).toBe(true),
    );
    expect(simulator.callsTo('POST', '/api/devices/hub-power-01/start')).toHaveLength(1);
  });

  it('say that the scenario keeps counting while the devices are paused', () => {
    renderOverview();
    expect(
      screen.getByText(/Pause stops the devices; a scenario that is running keeps counting/),
    ).toBeInTheDocument();
  });

  it('ask first above ten devices, as the Fleet does', async () => {
    const user = userEvent.setup();
    const { simulator } = renderOverview({ view: viewWithDevices(12), seed: false });
    await user.click(await screen.findByRole('button', { name: 'Pause 12' }));

    const confirm = screen.getByRole('group', { name: 'Confirm' });
    expect(confirm).toHaveTextContent('Pause 12 devices?');
    expect(simulator.callsTo('POST', '/api/devices/dev-01/pause')).toHaveLength(0);

    await user.click(within(confirm).getByRole('button', { name: 'Pause 12' }));
    await waitFor(() =>
      expect(simulator.callsTo('POST', '/api/devices/dev-12/pause')).toHaveLength(1),
    );
  });

  it('are absent on a stepped clock, where nothing publishes by itself', async () => {
    renderOverview({ simulated: true });
    await screen.findByRole('combobox', { name: 'Scenario' });
    expect(screen.queryByRole('button', { name: /^Pause/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resume/ })).not.toBeInTheDocument();
  });
});

describe('Step and Reset', () => {
  it('draw no Step on the wall clock: the control is absent, not disabled', async () => {
    renderOverview();
    await screen.findByRole('combobox', { name: 'Scenario' });
    expect(screen.queryByRole('button', { name: /Step/ })).not.toBeInTheDocument();
  });

  it('step the simulated clock by one interval and take the new state at once', async () => {
    const user = userEvent.setup();
    const { simulator, store } = renderOverview({ simulated: true });
    const before = store.getState().view?.engine.elapsedS ?? 0;
    await user.click(await screen.findByRole('button', { name: 'Step +2 s' }));

    await waitFor(() => expect(store.getState().view?.engine.elapsedS).toBe(before + 2));
    expect(simulator.callsTo('POST', '/api/step')).toHaveLength(1);
    expect(
      screen.getByText(/The clock is stepped: nothing is published until you step it/),
    ).toBeInTheDocument();
  });

  it('show the reason of the simulator when it will not step', async () => {
    const user = userEvent.setup();
    const { simulator } = renderOverview({ simulated: true });
    simulator.state = {
      ...simulator.state,
      engine: { ...simulator.state.engine, simulated: false },
    };
    await user.click(await screen.findByRole('button', { name: 'Step +2 s' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('step needs the simulated clock');
  });

  it('reset, end the runs that were playing, and say what it did', async () => {
    const user = userEvent.setup();
    const { simulator, store } = renderOverview();
    await user.click(await runButton());
    await screen.findByRole('button', { name: 'Stop server-room-overheat' });

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(
      await screen.findByText(/^Reset: anomalies and held values are cleared/),
    ).toBeInTheDocument();
    expect(simulator.callsTo('POST', '/api/reset')).toHaveLength(1);
    expect(store.getState().view?.runs).toEqual([]);
    expect(await runButton()).toBeInTheDocument();
  });
});

describe('the link to the simulator', () => {
  it('keeps the last data, dimmed, and says when it was lost', () => {
    const { container, store } = renderOverview();
    act(() => store.getState().setLink('lost', Date.now()));
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
    expect(screen.getByText(/^Lost at \d\d:\d\d:\d\d$/)).toBeInTheDocument();
    expect(kpi('Devices online')).toHaveTextContent('5 of 6');
  });
});

describe('accessibility', () => {
  it('has no violations with the library loaded and a scenario running', async () => {
    const user = userEvent.setup();
    const { container } = renderOverview();
    await user.click(await runButton());
    await screen.findByRole('button', { name: 'Stop server-room-overheat' });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the live topology', () => {
  const nodeCount = () => document.querySelectorAll('.react-flow__node').length;
  const openLink = () => screen.getByRole('link', { name: /Open in Topology/ });

  it('is its own chunk: the figures are there first, the graph follows', async () => {
    renderOverview();
    expect(kpi('Devices online')).toHaveTextContent('5 of 6');
    expect(
      await screen.findByRole('group', { name: 'Find and arrange the graph' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(graphNode('stage:broker')).not.toBeNull());
  });

  it('draws the Topology’s nodes: a node for each device, zone and stage of the six devices', async () => {
    renderOverview();
    await waitFor(() => expect(nodeCount()).toBe(6 + 5 + 7));
    expect(graphNode('device:dc-env-01')).not.toBeNull();
    // No minimap, no zoom bar: nothing over the picture, and no detail row under it.
    expect(document.querySelector('.react-flow__minimap')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/6 devices · 5 zones · groups automatically above 12 devices/),
    ).toBeInTheDocument();
  });

  it('writes the grouping, Problems only and the search into the address, apart from the timeline’s', async () => {
    const user = userEvent.setup();
    renderOverview({ path: '/?scenario=bad-afternoon' });
    await waitFor(() => expect(graphNode('stage:broker')).not.toBeNull());

    await user.click(screen.getByRole('radio', { name: 'Grouped by zone' }));
    expect(address()).toBe('/?scenario=bad-afternoon&group=zone');
    await waitFor(() => expect(graphNode('device:dc-env-01')).toBeNull());
    expect(graphNode('zone:BLD-DC')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /Problems only/ }));
    expect(address()).toContain('problems=1');
    await user.type(screen.getByRole('searchbox', { name: 'Find a device or zone' }), 'hub');
    expect(address()).toContain('gq=hub');
    // The scenario the controls show is still there.
    expect(address()).toContain('scenario=bad-afternoon');
  });

  it('opens a link that keeps the grouping and the filter, and adds the node that was chosen', async () => {
    const user = userEvent.setup();
    renderOverview({ path: '/?group=zone&problems=1&gq=air' });
    await waitFor(() => expect(graphNode('stage:broker')).not.toBeNull());
    expect(openLink()).toHaveAttribute('href', '/topology?q=air&group=zone&problems=1');

    await user.click(screen.getByRole('button', { name: /Problems only/ }));
    expect(openLink()).toHaveAttribute('href', '/topology?q=air&group=zone');
  });

  it('adds the chosen device to that link', async () => {
    renderOverview({ path: '/?group=all' });
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    fireEvent.click(graphNode('device:dc-env-01') as HTMLElement);
    await waitFor(() =>
      expect(openLink()).toHaveAttribute('href', '/topology?group=all&device=dc-env-01'),
    );
  });

  it('shows zone groups, never one node for each of a hundred devices', async () => {
    renderOverview({ view: viewWithDevices(100), seed: false });
    await waitFor(() => expect(graphNode('stage:broker')).not.toBeNull());
    expect(document.querySelectorAll('.react-flow__node[data-id^="device:"]')).toHaveLength(0);
    expect(graphNode('zone:BLD-Z0')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'All devices' })).toBeDisabled();
  });

  it('says so when nothing matches the search, and that the pipeline is still shown', async () => {
    const user = userEvent.setup();
    renderOverview();
    await waitFor(() => expect(graphNode('stage:broker')).not.toBeNull());
    await user.type(
      screen.getByRole('searchbox', { name: 'Find a device or zone' }),
      'nothing-like-this',
    );
    expect(await screen.findByText(/No device matches “nothing-like-this”/)).toBeInTheDocument();
    expect(graphNode('stage:broker')).not.toBeNull();
  });
});
