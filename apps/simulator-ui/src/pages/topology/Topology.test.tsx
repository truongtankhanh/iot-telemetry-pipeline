import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { axeViolations } from '../../test-axe';
import { viewWithDevices } from '../fleet/fleetTestSupport';
import { Topology } from './Topology';
import { address, graphNode, installReactFlowStubs, renderTopology } from './topologyTestSupport';

let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());
afterEach(() => {
  vi.unstubAllGlobals();
});

const page = (path = '/topology', options: Parameters<typeof renderTopology>[1] = {}) =>
  renderTopology(<Topology />, { path, ...options });
const nodeCount = () => document.querySelectorAll('.react-flow__node').length;
const nodeLabel = (id: string) => graphNode(id)?.getAttribute('aria-label');

describe('Topology before and without data', () => {
  it('waits for the first message', () => {
    page('/topology', { view: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Topology' })).toBeInTheDocument();
    expect(
      screen.getByText('Waiting for the first message from the simulator…'),
    ).toBeInTheDocument();
  });

  it('says the simulator has not answered when the link is lost before any data', () => {
    page('/topology', { view: null, link: 'lost' });
    expect(screen.getByText('The simulator has not answered yet.')).toBeInTheDocument();
  });

  it('says there is nothing to follow for a registry with no devices', () => {
    page('/topology', { view: viewWithDevices(0) });
    expect(screen.getByText(/plays no device/)).toBeInTheDocument();
  });
});

describe('the campus of the frames: six devices in five zones', () => {
  it('says what the graph holds in words, and draws a node for each zone, device and stage', async () => {
    page();
    expect(screen.getByText('6 devices · 5 zones · 3 problems')).toBeInTheDocument();
    await waitFor(() => expect(nodeCount()).toBe(5 + 6 + 7));
  });

  it('names each node with its state in words', async () => {
    page();
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    expect(nodeLabel('device:dc-env-01')).toBe(
      'Data center — row A, temperature_c 29.3 °C, anomaly',
    );
    expect(nodeLabel('device:hub-power-01')).toMatch(/paused$/);
    expect(nodeLabel('zone:BLD-DC')).toBe('BLD-DC, 2 devices, anomaly');
    expect(nodeLabel('stage:broker')).toMatch(/^Broker, connected/);
  });

  it('shows the alert chain: the rule counting, the alert, its delivery and the incident', async () => {
    page();
    await waitFor(() => expect(graphNode('stage:rules')).not.toBeNull());
    expect(
      within(graphNode('stage:rules') as HTMLElement).getByText('server-room-hot'),
    ).toBeInTheDocument();
    expect(
      within(graphNode('stage:alert') as HTMLElement).getByText('#7 · high'),
    ).toBeInTheDocument();
    expect(
      within(graphNode('stage:outbox') as HTMLElement).getByText('Delivered'),
    ).toBeInTheDocument();
    expect(
      within(graphNode('stage:commandCenter') as HTMLElement).getByText('incident c3a1…'),
    ).toBeInTheDocument();
  });

  it('draws nothing over the graph but the minimap, and no library badge', async () => {
    page();
    await waitFor(() => expect(nodeCount()).toBeGreaterThan(0));
    expect(document.querySelector('.react-flow__attribution')).toBeNull();
    expect(document.querySelector('.react-flow__controls')).toBeNull();
    const panels = document.querySelectorAll('.react-flow__panel');
    expect(panels).toHaveLength(1);
    // React Flow's minimap is itself the panel
    expect(panels[0]).toHaveClass('react-flow__minimap');
  });

  it('has the Topology | Twin switch, and no layer switch (those come with later tickets)', () => {
    page();
    const view = screen.getByRole('radiogroup', { name: 'View' });
    expect(within(view).getByRole('radio', { name: 'Topology' })).toBeChecked();
    expect(within(view).getByRole('radio', { name: 'Twin' })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Data flow' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry now/ })).toBeNull();
  });
});

describe('the address is the state', () => {
  it('keeps only the devices that need a look for ?problems=1, and the pipeline', async () => {
    page('/topology?problems=1');
    await waitFor(() => expect(nodeCount()).toBe(3 + 3 + 7));
    expect(graphNode('device:dc-env-02')).toBeNull();
    expect(graphNode('device:lha-air-01')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Problems only/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('finds a device or a zone by ?q=', async () => {
    page('/topology?q=BLD-DC');
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    expect(graphNode('device:dc-env-02')).not.toBeNull();
    expect(graphNode('device:lib-air-01')).toBeNull();
  });

  it('says so when nothing matches, and still draws the pipeline', async () => {
    page('/topology?q=zzzz');
    expect(await screen.findByText(/No device matches/)).toBeInTheDocument();
    expect(screen.getByText(/The pipeline is still shown/)).toBeInTheDocument();
    await waitFor(() => expect(nodeCount()).toBe(7));
  });

  it('writes a search, the grouping and _Problems only_ into the address', async () => {
    const user = userEvent.setup();
    page();
    await user.type(screen.getByRole('searchbox', { name: 'Find a device or zone' }), 'lib');
    await waitFor(() => expect(address()).toBe('/topology?q=lib'));

    await user.click(screen.getByRole('radio', { name: 'Grouped by zone' }));
    await waitFor(() => expect(address()).toContain('group=zone'));

    await user.click(screen.getByRole('button', { name: /Problems only/ }));
    await waitFor(() => expect(address()).toContain('problems=1'));
  });

  it('says so for a device or a zone the registry does not have', () => {
    page('/topology?device=nope');
    expect(screen.getByText('No device called nope is registered.')).toBeInTheDocument();
  });

  it('says so for a zone that has no device', () => {
    page('/topology?zone=NOPE');
    expect(screen.getByText('No zone called NOPE has a device.')).toBeInTheDocument();
  });
});

describe('choosing a node', () => {
  it('writes the choice into the address when a node is clicked, replacing the entry', async () => {
    page();
    await waitFor(() => expect(graphNode('device:dc-env-02')).not.toBeNull());
    fireEvent.click(graphNode('device:dc-env-02') as HTMLElement);
    await waitFor(() => expect(address()).toBe('/topology?device=dc-env-02'));
  });

  it('opens a zone in place with its chevron', async () => {
    const user = userEvent.setup();
    page('/topology?group=zone');
    await waitFor(() => expect(graphNode('zone:BLD-DC')).not.toBeNull());
    expect(graphNode('device:dc-env-01')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open BLD-DC, 2 devices' }));
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Close BLD-DC, 2 devices' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('closes every zone with "Collapse all zones", which is off when there is nothing to close', async () => {
    const user = userEvent.setup();
    page('/topology?group=zone');
    await waitFor(() => expect(graphNode('zone:BLD-DC')).not.toBeNull());
    const collapse = screen.getByRole('button', { name: 'Collapse all zones' });
    expect(collapse).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open BLD-DC, 2 devices' }));
    await waitFor(() => expect(collapse).toBeEnabled());
    await user.click(collapse);
    await waitFor(() => expect(graphNode('device:dc-env-01')).toBeNull());
  });
});

describe('the row under the graph', () => {
  it('shows a device: its detail, the rule evaluation and its alerts', () => {
    page('/topology?device=dc-env-01');
    expect(screen.getByRole('heading', { level: 2, name: 'dc-env-01' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Rule evaluation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' })).toBeInTheDocument();
    // the state is a note beside the name, and the chart carries no alert marker
    expect(screen.getAllByText(/above 27/).length).toBeGreaterThan(0);
    // the rule is also the headline of the Rules node in the graph, so look for it in the card
    const evaluation = screen
      .getByRole('heading', { level: 2, name: 'Rule evaluation' })
      .closest('section');
    expect(within(evaluation as HTMLElement).getByText('server-room-hot')).toBeInTheDocument();
    expect(screen.getByText('Server room temperature high')).toBeInTheDocument();
    expect(screen.getByText(/Delivered · 1 attempt/)).toBeInTheDocument();
  });

  it('links to the device in the Fleet, and offers no Twin or Lab link', () => {
    page('/topology?device=dc-env-01');
    expect(screen.getByRole('link', { name: 'Open dc-env-01 in the Fleet' })).toHaveAttribute(
      'href',
      '/fleet?device=dc-env-01',
    );
    expect(screen.queryByRole('link', { name: /twin/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /lab/i })).toBeNull();
  });

  it('shows a stage: what it is, and what Studio asked', () => {
    page('/topology?node=rules');
    expect(screen.getByRole('heading', { level: 2, name: 'Rules' })).toBeInTheDocument();
    expect(screen.getByText(/threshold rules/)).toBeInTheDocument();
    expect(screen.getByText('GET /api/ready answered: ready')).toBeInTheDocument();
  });

  it('says the command center is never read by Studio', () => {
    page('/topology?node=commandCenter');
    expect(screen.getByText(/Studio never reads it/)).toBeInTheDocument();
    expect(screen.getByText('Ingest reports alertSink: ops-command-center')).toBeInTheDocument();
  });

  it('shows a zone as a list of its devices, and choosing one selects it', async () => {
    const user = userEvent.setup();
    page('/topology?zone=BLD-DC');
    expect(screen.getByRole('heading', { level: 2, name: 'BLD-DC' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Devices in BLD-DC' });
    await user.click(within(list).getByRole('button', { name: /dc-env-01/ }));
    await waitFor(() => expect(address()).toBe('/topology?device=dc-env-01'));
  });

  it('only says what to do when nothing is selected and nothing is wrong', () => {
    page();
    expect(screen.getByText(/Choose a device, a zone or a stage/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Checks' })).toBeNull();
  });

  it('names the severity and the delivery of an alert, and the plain incident id', () => {
    page('/topology?device=dc-env-01');
    const alerts = screen.getByRole('heading', { level: 2, name: 'Alerts' }).closest('section');
    expect(within(alerts as HTMLElement).getByText('high')).toBeInTheDocument();
    expect(within(alerts as HTMLElement).getByText(/c3a1d0f2/)).toBeInTheDocument();
    // no console URL is set in the fixture, so there is no link out
    expect(within(alerts as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('links to the command center when its console URL is set', () => {
    const view = structuredClone(stateViewFixture);
    view.config.consoleUrl = 'https://occ.example.test/';
    page('/topology?device=dc-env-01', { view });
    expect(screen.getByRole('link', { name: 'Open the command center' })).toHaveAttribute(
      'href',
      'https://occ.example.test/',
    );
  });

  it('shows only the Open alerts first and All on request', async () => {
    const user = userEvent.setup();
    const view = structuredClone(stateViewFixture);
    const first = view.alerts.alerts[0];
    if (first === undefined) throw new Error('the fixture has an alert');
    view.alerts.alerts.push({ ...first, id: '6', status: 'cleared', clearedAt: first.openedAt });
    page('/topology?device=dc-env-01', { view });
    const alerts = screen
      .getByRole('heading', { level: 2, name: 'Alerts' })
      .closest('section') as HTMLElement;
    expect(within(alerts).queryByText('#6')).toBeNull();
    await user.click(within(alerts).getByRole('radio', { name: 'All 2' }));
    expect(within(alerts).getByText('#6')).toBeInTheDocument();
  });
});

describe('13 and 61 devices', () => {
  it('draws one node per zone from 13 devices, and opens one in place', async () => {
    const user = userEvent.setup();
    page('/topology', { view: viewWithDevices(13) });
    expect(screen.getByText('13 devices · 3 zones · 0 problems')).toBeInTheDocument();
    await waitFor(() => expect(nodeCount()).toBe(3 + 7));
    await user.click(screen.getByRole('button', { name: 'Open BLD-Z0, 5 devices' }));
    await waitFor(() => expect(nodeCount()).toBe(3 + 5 + 7));
  });

  it('shows counts only from 61 devices, and does not offer every device as a node', async () => {
    page('/topology', { view: viewWithDevices(61) });
    await waitFor(() => expect(nodeCount()).toBe(3 + 7));
    expect(screen.getByRole('radio', { name: 'All devices' })).toBeDisabled();
  });
});

describe('when the link to the simulator is lost', () => {
  it('says so in the toolbar and dims the page, keeping the last data', async () => {
    page('/topology', { link: 'lost' });
    expect(screen.getAllByText(/Lost/).length).toBeGreaterThan(0);
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    expect(graphNode('device:dc-env-01')?.querySelector('[data-dimmed="true"]')).not.toBeNull();
  });
});

describe('the page and a store that changes under it', () => {
  it('follows a state that changes: a device paused in the simulator becomes a problem', async () => {
    const { store } = page();
    await waitFor(() => expect(graphNode('device:dc-env-02')).not.toBeNull());
    expect(screen.getByText('6 devices · 5 zones · 3 problems')).toBeInTheDocument();
    act(() => {
      const view = structuredClone(stateViewFixture);
      const device = view.engine.devices.find((d) => d.id === 'dc-env-02');
      if (device) device.state = 'paused';
      store.getState().setView(view, Date.now());
    });
    await waitFor(() =>
      expect(screen.getByText('6 devices · 5 zones · 4 problems')).toBeInTheDocument(),
    );
  });
});

describe('accessibility', () => {
  it('has no axe violations on the graph and the row under it', async () => {
    const { container } = page('/topology?device=dc-env-01');
    await waitFor(() => expect(nodeCount()).toBeGreaterThan(0));
    expect(await axeViolations(container)).toEqual([]);
  });
});
