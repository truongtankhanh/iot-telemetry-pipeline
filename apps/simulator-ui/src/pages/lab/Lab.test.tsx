import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import scenariosFixture from '../../api/fixtures/scenarios.json';
import type { Anomaly, ScenarioLibraryView } from '../../api/types';
import { fromAnomalies } from '../../lib/timelineEditor';
import { runningBenchmark } from '../../state/benchmarkTestSupport';
import { EditorDrafts } from '../../state/editorDrafts';
import { axeViolations } from '../../test-axe';
import { installReactFlowStubs } from '../topology/topologyTestSupport';
import { labFleet, renderLab } from './labTestSupport';

let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());
afterEach(() => vi.unstubAllGlobals());

const button = (name: string) => screen.getByRole('button', { name });
const location = () => screen.getByTestId('location').textContent ?? '';

/** `server-room-overheat` of the library, the scenario a breach injected from the Lab has to be equivalent to. */
const overheat = (scenariosFixture as unknown as ScenarioLibraryView).scenarios.find(
  (scenario) => scenario.name === 'server-room-overheat',
)!;

const twelve = Array.from(
  { length: 12 },
  (_, i) => `target=d${String(i + 1).padStart(3, '0')}`,
).join('&');

describe('Lab: before there is anything to show', () => {
  it('waits for the first message from the simulator', () => {
    renderLab({ state: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Simulation lab' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waiting for the first message from the simulator…',
    );
  });

  it('says the simulator has not answered when the link is lost before the first message', () => {
    renderLab({ state: null, link: 'lost' });
    expect(screen.getByRole('status')).toHaveTextContent('The simulator has not answered yet.');
  });

  it('says there is nothing to inject a fault into when the simulator plays no device', () => {
    const state = labFleet(6);
    state.devices = [];
    state.engine.devices = [];
    renderLab({ state });
    expect(screen.getByRole('heading', { name: 'No devices' })).toBeInTheDocument();
    expect(screen.getByText(/nothing to inject a fault into/)).toBeInTheDocument();
  });
});

describe('Lab: the workspace', () => {
  it('has its three zones, the bar and the dock, and the switch to the Lab’s other pages', () => {
    renderLab();
    expect(screen.getByRole('heading', { level: 1, name: 'Simulation lab' })).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'Scenario configuration' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Simulation canvas' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Execution inspector' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('aria-current', 'page');
    // The switch above the Lab and the bar both lead to the Lab's other pages.
    for (const link of screen.getAllByRole('link', { name: 'Faults' })) {
      expect(link).toHaveAttribute('href', '/lab/faults');
    }
  });

  it('dims what it shows, and says when the link was lost', () => {
    const { container } = renderLab({ link: 'lost' });
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
    expect(screen.getAllByText(/^Lost/).length).toBeGreaterThan(0);
  });

  it('cannot send until a target is chosen, and says so', () => {
    renderLab();
    expect(button('Inject now')).toBeDisabled();
    expect(screen.getByText('Choose at least one target')).toBeInTheDocument();
    expect(
      screen.getByText('Choose a target and a fault to see what the rules should do.'),
    ).toBeInTheDocument();
  });
});

describe('Lab: a breach on one device', () => {
  it('rings the target, says what the rules should do, injects the scenario’s own anomaly, and can take it out', async () => {
    const user = userEvent.setup();
    const { simulator } = renderLab();

    await user.click(button('Choose targets…'));
    await user.click(screen.getByRole('checkbox', { name: 'Select d001' }));
    await user.click(button('Done'));
    expect(location()).toBe('/lab?target=d001');
    await waitFor(() =>
      expect(
        document.querySelector('.react-flow__node[data-id="device:d001"] [data-targeted="true"]'),
      ).not.toBeNull(),
    );

    // The question the Lab asks is the scenario's anomaly, on the target: the same alert as the equivalent scenario.
    expect(await screen.findByText('Alert, high · about 24 s')).toBeInTheDocument();
    const asked = simulator.callsTo('POST', '/api/expectations').at(-1)!.body as {
      anomalies: Anomaly[];
    };
    expect(asked.anomalies).toEqual([{ ...overheat.anomalies[0]!, deviceId: 'd001' }]);

    await user.click(button('Inject now'));
    expect(await screen.findByText('Injected 1 fault.')).toBeInTheDocument();
    // The engine clock was read first (10 s in the fixture), and the start is on it: 20 s from now is 30 s.
    expect(simulator.callsTo('GET', '/api/state').length).toBeGreaterThan(0);
    expect(simulator.callsTo('POST', '/api/anomalies').map((call) => call.body)).toEqual([
      { deviceId: 'd001', metric: 'temperature_c', value: 29.2, startAt: 30, duration: 60 },
    ]);
    expect(screen.getByRole('region', { name: 'Faults on the engine' })).toHaveTextContent(
      '1 fault on the engine',
    );
    expect(
      screen.getByText(/Injected a breach on 1 device: temperature_c → 29.2/),
    ).toBeInTheDocument();

    // It will not be sent again over itself, and says which device is in the way.
    expect(button('Inject now')).toBeDisabled();
    expect(
      screen.getByText('d001 already has a fault on temperature_c from 20 s to 80 s from now'),
    ).toBeInTheDocument();

    await user.click(button('Remove all'));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Faults on the engine' })).toBeNull(),
    );
    expect(button('Inject now')).toBeEnabled();
  });

  it('adds the fault to the timeline, draws it, and refuses a second one over it', async () => {
    const user = userEvent.setup();
    renderLab({ path: '/lab?target=d001' });

    await user.click(button('Add to timeline'));
    expect(
      await screen.findByText('Added 1 fault to the timeline (1 in all).'),
    ).toBeInTheDocument();
    const dock = screen.getByRole('region', { name: 'Timeline' });
    expect(within(dock).getByText('1 anomaly · 80 s')).toBeInTheDocument();
    expect(within(dock).getByRole('img', { name: /1 anomaly on 1 device/ })).toBeInTheDocument();

    await user.click(button('Add to timeline'));
    expect(
      await screen.findByText(
        'd001 already has a fault on temperature_c in the timeline from 20 s to 80 s',
      ),
    ).toBeInTheDocument();
  });

  it('injects the timeline, and records it in the log', async () => {
    const user = userEvent.setup();
    const { simulator } = renderLab({ path: '/lab?target=d001' });
    await user.click(button('Add to timeline'));
    await user.click(button('Inject timeline'));

    expect(await screen.findByText('Injected 1 fault.')).toBeInTheDocument();
    expect(simulator.callsTo('POST', '/api/anomalies')).toHaveLength(1);
    expect(screen.getByText('Injected a timeline of 1 fault')).toBeInTheDocument();
  });
});

describe('Lab: the link to the timeline editor', () => {
  it('hands the timeline over as a new scenario that is not saved yet', async () => {
    const user = userEvent.setup();
    const { drafts } = renderLab({ path: '/lab?target=d001' });
    await user.click(button('Add to timeline'));
    expect(drafts.get('new')).toBeUndefined();

    await user.click(screen.getByRole('link', { name: 'Open timeline editor' }));

    const handed = drafts.get('new');
    expect(handed?.base).toBeNull();
    expect(handed?.doc.name).toBe('');
    expect(handed?.doc.entries.map((entry) => entry.anomaly)).toMatchObject([
      { deviceId: 'd001', metric: 'temperature_c', startAt: 20, duration: 60 },
    ]);
    await waitFor(() => expect(location()).toBe('/lab/timeline'));
  });

  it('hands nothing over when the timeline is empty, and leaves a scenario being edited there alone', async () => {
    const user = userEvent.setup();
    const drafts = new EditorDrafts();
    const mine = { doc: fromAnomalies([]), base: null };
    drafts.set('new', mine);
    renderLab({ path: '/lab?target=d001', drafts });

    await user.click(screen.getByRole('link', { name: 'Open timeline editor' }));

    expect(drafts.get('new')).toBe(mine);
    await waitFor(() => expect(location()).toBe('/lab/timeline'));
  });
});

describe('Lab: 100 devices and a fault on 12 of them (frame 19)', () => {
  it('shows a list of zones worst first and the pipeline once, never one node for each device', () => {
    renderLab({ state: labFleet(100, 20), path: `/lab?${twelve}` });
    expect(screen.getByText('Applies to 12 of 100 devices in 12 zones')).toBeInTheDocument();

    const zones = screen.getByRole('list', { name: 'Zones, worst first' });
    expect(within(zones).getAllByRole('listitem')).toHaveLength(20);
    expect(
      within(zones).getByRole('button', { name: /^Z01, 5 devices · 1 targeted/ }),
    ).toBeInTheDocument();
    expect(within(zones).getByRole('button', { name: /^Z20, 5 devices,/ })).toBeInTheDocument();

    // The pipeline is outside the box that scrolls, so scrolling the list cannot move it.
    expect(screen.getAllByRole('list', { name: 'Pipeline' })).toHaveLength(1);
    expect(zones.contains(screen.getByRole('list', { name: 'Pipeline' }))).toBe(false);
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(0);
  });

  it('opens the table of a zone from the list, and keeps the choice in the address', async () => {
    const user = userEvent.setup();
    renderLab({ state: labFleet(100, 20), path: `/lab?${twelve}` });
    await user.click(screen.getByRole('button', { name: /^Z01,/ }));

    expect(location()).toContain('zone=Z01');
    expect(screen.getByRole('table', { name: 'Devices of Z01' })).toBeInTheDocument();
    expect(screen.getByText('5 devices · the zone selected in the list')).toBeInTheDocument();

    await user.click(button('Collapse all'));
    expect(screen.queryByRole('table', { name: 'Devices of Z01' })).not.toBeInTheDocument();
    expect(location()).not.toContain('zone=');
  });

  it('staggers twelve starts by two seconds, asks the simulator what the rules should do, and injects them in order', async () => {
    const user = userEvent.setup();
    const { simulator } = renderLab({ state: labFleet(100, 20), path: `/lab?${twelve}` });

    expect(screen.getByText(/First device at 20 s, the last of 12 at 42 s\./)).toBeInTheDocument();
    expect(await screen.findByText('Up to 12 alerts · 24 to 46 s')).toBeInTheDocument();

    await user.click(button('Inject now'));
    expect(
      await screen.findByText('Injected 12 faults.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    const starts = simulator
      .callsTo('POST', '/api/anomalies')
      .map((call) => (call.body as { startAt: number }).startAt);
    expect(starts).toEqual(Array.from({ length: 12 }, (_, i) => 30 + 2 * i));
    expect(screen.getByRole('region', { name: 'Faults on the engine' })).toHaveTextContent(
      '12 faults on the engine',
    );
  });
});

describe('Lab: accessibility', () => {
  it('has no violation with a fault ready to send', async () => {
    const { container } = renderLab({ path: '/lab?target=d001' });
    await screen.findByText('Alert, high · about 24 s');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Lab while a benchmark runs', () => {
  it('turns Inject now off, and leaves Add to timeline on', async () => {
    const user = userEvent.setup();
    renderLab({ path: '/lab?target=d001', benchmark: runningBenchmark() });
    expect(button('Inject now')).toBeDisabled();
    expect(button('Add to timeline')).toBeEnabled();

    await user.click(button('Add to timeline'));
    await screen.findByText('Added 1 fault to the timeline (1 in all).');
    expect(button('Inject timeline')).toBeDisabled();
  });

  it('turns Reset off, as on the Overview', () => {
    renderLab({ path: '/lab?target=d001', benchmark: runningBenchmark() });
    expect(button('Reset')).toBeDisabled();
  });

  it('keeps them on when no benchmark runs', () => {
    renderLab({ path: '/lab?target=d001' });
    expect(button('Inject now')).toBeEnabled();
    expect(button('Reset')).toBeEnabled();
  });
});
