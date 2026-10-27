import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { StateView } from '../../api/types';
import { runningBenchmark } from '../../state/benchmarkTestSupport';
import { axeViolations } from '../../test-axe';
import { address, deviceCalls, renderFleet, viewWithDevices } from './fleetTestSupport';

afterEach(() => {
  vi.unstubAllGlobals();
});

const card = (name: string) => screen.getByRole('article', { name });
const tab = (name: RegExp) => screen.getByRole('tab', { name });
const bulkLine = (text: string) =>
  screen.findByText((_, element) => element?.tagName === 'P' && element.textContent === text);
const rulesGone = (): StateView => {
  const view = structuredClone(stateViewFixture);
  view.rules = { available: false, reason: 'cannot read /x/rules.json (ENOENT)', items: [] };
  return view;
};

describe('Fleet before and without data', () => {
  it('waits for the first message', () => {
    renderFleet({ view: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Device fleet' })).toBeInTheDocument();
    expect(
      screen.getByText('Waiting for the first message from the simulator…'),
    ).toBeInTheDocument();
  });

  it('says the simulator has not answered when the link is lost before any data', () => {
    renderFleet({ view: null, link: 'lost' });
    expect(screen.getByText('The simulator has not answered yet.')).toBeInTheDocument();
  });

  it('says there is nothing to play for a registry with no devices', () => {
    renderFleet({ view: viewWithDevices(0) });
    expect(screen.getByText(/registry has no devices/)).toBeInTheDocument();
  });
});

describe('Fleet as cards (six devices)', () => {
  it('shows a card per device, in "problems first" order', () => {
    renderFleet();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    // Anomalies first (dc-env-01, lha-air-01), then paused (hub), then the running ones, by id.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Data center — row A',
      'Lecture Hall A',
      'Innovation Hub main feed',
      'Data center — row B',
      'Library reading room',
      'Student Center hall',
    ]);
  });

  it("says each device's state in words: an anomaly with its reason, paused, running", () => {
    renderFleet();
    const dc = within(card('Data center — row A'));
    expect(dc.getByText('Anomaly')).toBeInTheDocument();
    expect(dc.getByText('temperature_c 29.3 °C, above 27')).toBeInTheDocument();
    expect(within(card('Innovation Hub main feed')).getByText('Paused')).toBeInTheDocument();
    expect(within(card('Library reading room')).getByText('Running')).toBeInTheDocument();
  });

  it('shows the latest values with the unit and the raise line, and a held value as such', () => {
    renderFleet();
    const dc = within(card('Data center — row A'));
    const values = within(dc.getByRole('list', { name: 'Latest values' }));
    expect(values.getByText('29.3')).toBeInTheDocument();
    expect(values.getByText('temperature_c · raise 27')).toBeInTheDocument();
    expect(within(card('Lecture Hall A')).getByText('held at 1450')).toBeInTheDocument();
  });

  it('draws a chart per card, named by a sentence, with the headroom in words', () => {
    renderFleet();
    const dc = within(card('Data center — row A'));
    expect(
      dc.getByRole('img', { name: /^temperature_c of dc-env-01, last 2 min/ }),
    ).toBeInTheDocument();
    expect(dc.getByText('2.3 °C above raise')).toBeInTheDocument();
  });

  it('counts the states in the tabs', () => {
    renderFleet();
    expect(tab(/^All/)).toHaveTextContent('6');
    expect(tab(/^Running/)).toHaveTextContent('3');
    expect(tab(/^Anomaly/)).toHaveTextContent('2');
    expect(tab(/^Paused/)).toHaveTextContent('1');
    expect(tab(/^Stopped/)).toHaveTextContent('0');
    expect(tab(/^Silent/)).toHaveTextContent('0');
  });

  it('shows the four figures over the list', () => {
    renderFleet();
    const kpi = (name: string) => screen.getByText(name).closest('div') as HTMLElement;
    expect(kpi('Published')).toHaveTextContent('36');
    expect(kpi('Active devices')).toHaveTextContent('5 of 6');
    expect(kpi('Active devices')).toHaveTextContent('1 paused');
    expect(kpi('Held values')).toHaveTextContent('1');
    expect(kpi('Held values')).toHaveTextContent('on 1 device');
  });

  it('pages the cards 12 to a page, with the range', () => {
    renderFleet();
    const pager = screen.getByRole('navigation', { name: 'Devices pages' });
    expect(pager).toHaveTextContent('1–6');
    expect(pager).toHaveTextContent('of 6');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderFleet();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Fleet filters live in the address', () => {
  it('filters by state with a tab and writes it in the address', async () => {
    const user = userEvent.setup();
    renderFleet();
    await user.click(tab(/^Paused/));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Innovation Hub main feed' })).toBeInTheDocument();
    expect(address()).toBe('/fleet?tab=paused');
    expect(tab(/^Paused/)).toHaveAttribute('aria-selected', 'true');
  });

  it('opens with the filters of the address (a reload, a shared link)', () => {
    renderFleet({ path: '/fleet?tab=anomaly&sort=device' });
    expect(tab(/^Anomaly/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Data center — row A',
      'Lecture Hall A',
    ]);
  });

  it('searches the id, the name and the zone, and keeps the search in the address', async () => {
    const user = userEvent.setup();
    renderFleet();
    await user.type(screen.getByRole('searchbox', { name: 'Find by id, name or zone' }), 'hall');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(address()).toBe('/fleet?q=hall');
  });

  it('filters by zone and by class', async () => {
    const user = userEvent.setup();
    renderFleet();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Zone' }), 'BLD-LIB');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(address()).toBe('/fleet?zone=BLD-LIB');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Zone' }), '');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Class' }), 'indoor_air');
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('says nothing matches, and clears the filters', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?q=zzz' });
    expect(screen.getByText('No device matches the search and filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(address()).toBe('/fleet');
  });

  it('groups the cards under their zone', async () => {
    const user = userEvent.setup();
    renderFleet();
    await user.click(screen.getByRole('checkbox', { name: 'Group by zone' }));
    expect(address()).toBe('/fleet?group=1');
    const zone = screen.getByRole('region', { name: 'Zone BLD-DC' });
    expect(within(zone).getAllByRole('article')).toHaveLength(2);
  });
});

describe('Fleet table', () => {
  it('can be asked for with six devices, and says so in the address', async () => {
    const user = userEvent.setup();
    renderFleet();
    expect(screen.getByRole('radio', { name: 'Cards' })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: 'Table' }));
    const table = screen.getByRole('table', {
      name: 'Devices with their state, readings and last seen',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(address()).toBe('/fleet?view=table');
  });

  it('is the view above 12 devices, and Cards is not offered', () => {
    renderFleet({ view: viewWithDevices(13) });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cards' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked();
  });

  it('pages the table, 10 rows by default and the size in the address', async () => {
    const user = userEvent.setup();
    renderFleet({ view: viewWithDevices(13) });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    await user.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(address()).toBe('/fleet?page=2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '25');
    expect(address()).toBe('/fleet?size=25');
    expect(within(table).getAllByRole('row')).toHaveLength(14);
  });

  it('sorts by a column from its header, then the other way, and says so', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?view=table' });
    const table = screen.getByRole('table');
    await user.click(within(table).getByRole('button', { name: 'Device' }));
    expect(address()).toBe('/fleet?sort=device&view=table');
    expect(within(table).getByRole('columnheader', { name: 'Device' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(within(table).getByRole('button', { name: 'Device' }));
    expect(address()).toBe('/fleet?sort=device&dir=desc&view=table');
    expect(within(table).getByRole('columnheader', { name: 'Device' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('hides a column that the chooser unticks, but never the device', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?view=table' });
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('checkbox', { name: 'Device' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Zone' }));
    expect(screen.queryByRole('columnheader', { name: 'Zone' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Device/ })).toBeInTheDocument();
  });

  it('shows the readings, a sparkline and when the device was last heard from', () => {
    renderFleet({ path: '/fleet?view=table' });
    const row = screen.getByText('dc-env-01').closest('tr') as HTMLElement;
    expect(within(row).getByText('29.3')).toBeInTheDocument();
    expect(
      within(row).getByRole('img', { name: /^Temp of dc-env-01, last 2 minutes/ }),
    ).toBeInTheDocument();
    expect(within(row).getByText(/s ago$/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderFleet({ path: '/fleet?view=table' });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Fleet commands on one device', () => {
  it('pauses a device, and the card follows the answer of the simulator', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet();
    await user.click(screen.getByRole('button', { name: 'Pause dc-env-02' }));
    await waitFor(() => expect(deviceCalls(simulator, 'POST', 'pause')).toHaveLength(1));
    expect(deviceCalls(simulator, 'POST', 'pause')[0]?.url).toBe('/api/devices/dc-env-02/pause');
    await waitFor(() =>
      expect(within(card('Data center — row B')).getByText('Paused')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Start dc-env-02' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pause dc-env-02' })).toBeDisabled();
  });

  it('starts a paused device and stops a running one', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet();
    await user.click(screen.getByRole('button', { name: 'Start hub-power-01' }));
    await user.click(screen.getByRole('button', { name: 'Stop dc-env-02' }));
    await waitFor(() => {
      expect(deviceCalls(simulator, 'POST', 'start')).toHaveLength(1);
      expect(deviceCalls(simulator, 'POST', 'stop')).toHaveLength(1);
    });
    await waitFor(() =>
      expect(within(card('Data center — row B')).getByText('Stopped')).toBeInTheDocument(),
    );
  });

  it('offers only what makes sense: a running device cannot be started, a paused one cannot be paused', () => {
    renderFleet();
    expect(screen.getByRole('button', { name: 'Start dc-env-02' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause hub-power-01' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start hub-power-01' })).toBeEnabled();
  });

  it('shows what the simulator refused, on the card, and lets it go', async () => {
    const user = userEvent.setup();
    renderFleet({ failFor: ['dc-env-02'] });
    await user.click(screen.getByRole('button', { name: 'Pause dc-env-02' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('dc-env-02: Unknown device "dc-env-02"');
    expect(within(card('Data center — row B')).getByRole('alert')).toBe(alert);
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Fleet without rules, and with the link lost', () => {
  it("judges by the engine's own anomaly and shows no raise line when the rules are not available", () => {
    renderFleet({ view: rulesGone() });
    expect(
      within(card('Data center — row A')).getByText('temperature_c is being driven to 29.2'),
    ).toBeInTheDocument();
    expect(within(card('Lecture Hall A')).getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText(/raise/)).not.toBeInTheDocument();
  });

  it('dims the page and says when the simulator was lost', () => {
    const { container } = renderFleet({ link: 'lost' });
    expect(screen.getByText(/^Lost at /)).toBeInTheDocument();
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
  });

  it('shows a card for a device that has said nothing yet, with no values', () => {
    renderFleet({ seed: false });
    const dc = within(card('Data center — row A'));
    expect(dc.getAllByText('—').length).toBeGreaterThan(0);
    expect(dc.getByText('No readings in the last 2 min')).toBeInTheDocument();
  });

  it('follows the state when it changes under the page', async () => {
    const { store } = renderFleet();
    const next = structuredClone(stateViewFixture);
    next.engine.devices[1]!.state = 'stopped';
    act(() => store.getState().setView(next, Date.now()));
    expect(await within(card('Data center — row B')).findByText('Stopped')).toBeInTheDocument();
  });
});

describe('Fleet bulk commands', () => {
  it('pauses all devices one after another, and says it is done', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet();
    await user.click(screen.getByRole('button', { name: 'Pause all' }));
    await bulkLine('Pausing: 6 of 6 done.');
    expect(deviceCalls(simulator, 'POST', 'pause').map((c) => c.url)).toEqual(
      stateViewFixture.devices.map((d) => `/api/devices/${d.id}/pause`),
    );
    expect(tab(/^Paused/)).toHaveTextContent('6');
  });

  it('asks first above ten devices, and does nothing if the answer is no', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet({ view: viewWithDevices(13) });
    await user.click(screen.getByRole('button', { name: 'Pause all' }));
    const confirm = screen.getByRole('group', { name: 'Confirm' });
    expect(confirm).toHaveTextContent('Pause 13 devices?');
    expect(within(confirm).getByRole('button', { name: 'Pause 13' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(deviceCalls(simulator, 'POST', 'pause')).toHaveLength(0);
  });

  it('runs it when the answer is yes', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet({ view: viewWithDevices(13) });
    await user.click(screen.getByRole('button', { name: 'Start all' }));
    await user.click(
      within(screen.getByRole('group', { name: 'Confirm' })).getByRole('button', {
        name: 'Start 13',
      }),
    );
    await bulkLine('Starting: 13 of 13 done.');
    expect(deviceCalls(simulator, 'POST', 'start')).toHaveLength(13);
  });

  it('reports the devices that failed and why, and goes on with the rest', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet({ failFor: ['dc-env-02'] });
    await user.click(screen.getByRole('button', { name: 'Pause all' }));
    await bulkLine('Pausing: 5 of 6 done, 1 failed.');
    expect(screen.getByText(/Unknown device "dc-env-02"/)).toBeInTheDocument();
    expect(deviceCalls(simulator, 'POST', 'pause')).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/1 failed/)).not.toBeInTheDocument();
  });
});

describe('Fleet while a benchmark runs', () => {
  it('turns Start off on every card and Start all, and leaves Pause, Stop and Pause all open', () => {
    renderFleet({ benchmark: runningBenchmark() });
    // A paused device could be started before; the simulator refuses it now.
    expect(screen.getByRole('button', { name: 'Start hub-power-01' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause dc-env-02' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop dc-env-02' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pause all' })).toBeEnabled();
  });

  it('turns Start on again when the run ends', () => {
    const benchmark = runningBenchmark();
    renderFleet({ benchmark });
    expect(screen.getByRole('button', { name: 'Start all' })).toBeDisabled();

    const run = benchmark.get().current;
    act(() =>
      benchmark.applyEvent({
        run: { ...run!, phase: 'ended', outcome: 'stopped', elapsedMs: 99_000 },
        point: null,
      }),
    );
    expect(screen.getByRole('button', { name: 'Start hub-power-01' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start all' })).toBeEnabled();
  });

  it('does not send a start that the control would not let through', async () => {
    const user = userEvent.setup();
    const { simulator } = renderFleet({ benchmark: runningBenchmark() });
    await user.click(screen.getByRole('button', { name: 'Start hub-power-01' }));
    await user.click(screen.getByRole('button', { name: 'Start all' }));
    expect(deviceCalls(simulator, 'POST', 'start')).toHaveLength(0);
  });
});
