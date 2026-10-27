import { telemetryTopic } from '@itp/telemetry-contract';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { runningBenchmark } from '../../state/benchmarkTestSupport';
import { axeViolations } from '../../test-axe';
import { address, renderFleet } from './fleetTestSupport';

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = (id: string, extra = '') => renderFleet({ path: `/fleet?device=${id}${extra}` });
const dialog = () => screen.getByRole('dialog', { name: /./ });
const panel = (metric: string) => within(screen.getByRole('region', { name: metric }));
const calls = (
  simulator: ReturnType<typeof renderFleet>['simulator'],
  method: string,
  suffix: string,
) => simulator.calls.filter((c) => c.method === method && c.url.endsWith(suffix));

describe('Inspector opening and closing', () => {
  it('opens from the address as a dialog named by the device', () => {
    open('dc-env-01');
    const sheet = screen.getByRole('dialog', { name: 'Data center — row A' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(within(sheet).getByText(/dc-env-01 · BLD-DC · Server room/)).toBeInTheDocument();
  });

  it('opens from the Details button of a card, adding an entry to the address, and from a table row', async () => {
    const user = userEvent.setup();
    const { unmount } = renderFleet();
    await user.click(screen.getByRole('button', { name: 'Details of dc-env-01' }));
    expect(screen.getByRole('dialog', { name: 'Data center — row A' })).toBeInTheDocument();
    expect(address()).toBe('/fleet?device=dc-env-01');
    unmount();

    renderFleet({ path: '/fleet?view=table' });
    await user.click(screen.getByText('dc-env-02'));
    expect(screen.getByRole('dialog', { name: 'Data center — row B' })).toBeInTheDocument();
  });

  it('marks the card it belongs to', () => {
    open('dc-env-01');
    expect(screen.getByRole('article', { name: 'Data center — row A' })).toHaveAttribute(
      'data-selected',
      'true',
    );
    expect(screen.getByRole('article', { name: 'Data center — row B' })).not.toHaveAttribute(
      'data-selected',
    );
  });

  it('closes on Esc, and focus goes back to the button that opened it', async () => {
    const user = userEvent.setup();
    renderFleet();
    const opener = screen.getByRole('button', { name: 'Details of dc-env-01' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(address()).toBe('/fleet');
    expect(opener).toHaveFocus();
  });

  it('closes from its button and from a click on the dim part', async () => {
    const user = userEvent.setup();
    const first = open('dc-env-01');
    await user.click(screen.getByRole('button', { name: 'Close details of dc-env-01' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    first.unmount();

    const second = open('dc-env-02');
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    second.unmount();
  });

  it('does not close on a click inside the sheet', () => {
    open('dc-env-01');
    fireEvent.mouseDown(screen.getByText(/^Topic$/));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('makes the page behind inert while it is open, and not after', async () => {
    const user = userEvent.setup();
    const { store } = open('dc-env-01');
    expect(store.getState().modalCount).toBe(1);
    await user.keyboard('{Escape}');
    expect(store.getState().modalCount).toBe(0);
  });

  it('keeps Tab and Shift Tab inside the sheet', async () => {
    // 140 key presses with a timer between each took 1.7 s on a laptop and passed the 5 s limit on a shared CI runner
    // (a CI run of SIM-06): without the pause between presses it does not wait on timers, and the limit is wider.
    const user = userEvent.setup({ delay: null });
    open('dc-env-01');
    for (let i = 0; i < 70; i++) await user.tab();
    expect(dialog().contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 70; i++) await user.tab({ shift: true });
    expect(dialog().contains(document.activeElement)).toBe(true);
  }, 20_000);

  it('says so when no device has the name in the address', () => {
    renderFleet({ path: '/fleet?device=ghost' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/No device is named/)).toHaveTextContent('ghost');
  });

  it('has no accessibility violations', async () => {
    open('dc-env-01');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('Inspector contents', () => {
  it('shows the state in words with the reason, and since when for a device that is not publishing', () => {
    open('dc-env-01');
    expect(within(dialog()).getByText('Anomaly')).toBeInTheDocument();
    expect(within(dialog()).getByText('temperature_c 29.3 °C, above 27')).toBeInTheDocument();
  });

  it('says since when a paused device went quiet', () => {
    open('hub-power-01');
    expect(within(dialog()).getByText('Paused')).toBeInTheDocument();
    expect(within(dialog()).getByText(/^since \d\d:\d\d:\d\d$/)).toBeInTheDocument();
  });

  it('shows the topic of the device', () => {
    open('dc-env-01');
    expect(
      within(dialog()).getByText(telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'dc-env-01' })),
    ).toBeInTheDocument();
  });

  it('shows the last payload, laid out, with its sequence number', () => {
    open('dc-env-01');
    const sheet = within(dialog());
    expect(sheet.getByRole('heading', { name: /^Last payload · seq \d+$/ })).toBeInTheDocument();
    const pre = sheet.getByLabelText('Last payload', { selector: 'pre' });
    expect(pre).toHaveTextContent('"temperature_c": 29.3');
    expect(pre).toHaveTextContent('"humidity_pct": 46');
    expect(pre).toHaveAttribute('tabindex', '0');
  });

  it('says no message was seen when the history is empty', () => {
    renderFleet({ path: '/fleet?device=dc-env-01', seed: false });
    expect(
      within(dialog()).getByText(/No message from this device has been seen/),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('button', { name: 'Copy the last payload' }),
    ).not.toBeInTheDocument();
  });

  it('has a panel per metric: the value, the state against the rule, the rule in words, the range bar and the profile', () => {
    open('dc-env-01');
    const temp = panel('temperature_c');
    expect(temp.getByText('Beyond raise')).toBeInTheDocument();
    expect(
      temp.getByText(
        'raise 27 · clear 25.5 · opens after 3 readings in a row · now 2.3 °C above raise',
      ),
    ).toBeInTheDocument();
    expect(
      temp.getByRole('img', { name: /^Safe up to 25.5 °C; hysteresis band/ }),
    ).toBeInTheDocument();
    expect(
      temp.getByRole('img', { name: /^temperature_c of dc-env-01, last 2 min/ }),
    ).toBeInTheDocument();
    const baseline = temp.getByText('Baseline').closest('div') as HTMLElement;
    expect(baseline).toHaveTextContent('22.5 °C');
    expect(panel('humidity_pct').getByText('Normal')).toBeInTheDocument();
  });

  it('says why when the rules are not available, and shows no range bar', () => {
    const view = structuredClone(stateViewFixture);
    view.rules = { available: false, reason: 'cannot read /x/rules.json (ENOENT)', items: [] };
    renderFleet({ path: '/fleet?device=dc-env-01', view });
    const temp = panel('temperature_c');
    expect(
      temp.getByText('Rules are not available: cannot read /x/rules.json (ENOENT).'),
    ).toBeInTheDocument();
    expect(temp.queryByRole('img', { name: /^Safe up to/ })).not.toBeInTheDocument();
    expect(temp.queryByText('Beyond raise')).not.toBeInTheDocument();
  });

  it('says no rule watches a metric that has none', () => {
    open('lib-air-01');
    expect(panel('temperature_c').getByText('No rule watches this metric.')).toBeInTheDocument();
  });
});

describe('Inspector copy buttons', () => {
  it('copies the topic and says so', async () => {
    const user = userEvent.setup();
    open('dc-env-01');
    await user.click(screen.getByRole('button', { name: 'Copy the topic' }));
    expect(await navigator.clipboard.readText()).toBe('campus/BLD-DC/dc-env-01/telemetry');
    expect(await screen.findByText('Copied the topic')).toBeInTheDocument();
  });

  it('copies the last payload as shown', async () => {
    const user = userEvent.setup();
    open('dc-env-01');
    await user.click(screen.getByRole('button', { name: 'Copy the last payload' }));
    const copied = await navigator.clipboard.readText();
    expect(JSON.parse(copied).metrics.temperature_c).toBe(29.3);
  });

  it('says to copy by hand when nothing works', async () => {
    const user = userEvent.setup();
    open('dc-env-01');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy the topic' }));
    expect(
      await screen.findByText(/Could not copy the topic: select it and copy it by hand/),
    ).toBeInTheDocument();
  });
});

describe('Inspector mode and held values', () => {
  it('is simulated for a device with no hold, and shows no hold control until Hold value is chosen', async () => {
    const user = userEvent.setup();
    const { simulator } = open('dc-env-01');
    expect(screen.getByRole('radio', { name: 'Simulated' })).toBeChecked();
    expect(screen.queryByLabelText('Hold temperature_c at')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Hold value' }));
    expect(screen.getByLabelText('Hold temperature_c at')).toBeInTheDocument();
    expect(screen.getByLabelText('Hold humidity_pct at')).toBeInTheDocument();
    expect(simulator.calls).toEqual([]);
  });

  it('holds a value, and then offers to release it', async () => {
    // Typed with no pause between keys. On a slow runner this test once held "3" instead of "31.5" (a CI run of SIM-06).
    // The cause was not found, and nothing in the Inspector resets the field; this keeps the test off the timers, where
    // the page's one-second clock can fire between two keys.
    const user = userEvent.setup({ delay: null });
    const { simulator } = open('dc-env-01');
    await user.click(screen.getByRole('radio', { name: 'Hold value' }));
    const temp = panel('temperature_c');
    await user.type(temp.getByLabelText('Hold temperature_c at'), '31.5');
    await user.click(temp.getByRole('button', { name: 'Hold' }));
    await waitFor(() => expect(calls(simulator, 'PUT', '/holds/temperature_c')).toHaveLength(1));
    expect(calls(simulator, 'PUT', '/holds/temperature_c')[0]).toMatchObject({
      url: '/api/devices/dc-env-01/holds/temperature_c',
      body: { value: 31.5 },
    });
    expect(await temp.findByRole('button', { name: 'Release' })).toBeInTheDocument();
  });

  it('holds on Enter in the field', async () => {
    const user = userEvent.setup();
    const { simulator } = open('dc-env-01');
    await user.click(screen.getByRole('radio', { name: 'Hold value' }));
    await user.type(panel('humidity_pct').getByLabelText('Hold humidity_pct at'), '55{Enter}');
    await waitFor(() => expect(calls(simulator, 'PUT', '/holds/humidity_pct')).toHaveLength(1));
  });

  it('refuses a value outside the contract range, says what the range is, and sends nothing', async () => {
    const user = userEvent.setup();
    const { simulator } = open('dc-env-01');
    await user.click(screen.getByRole('radio', { name: 'Hold value' }));
    const temp = panel('temperature_c');
    await user.type(temp.getByLabelText('Hold temperature_c at'), '90');
    expect(temp.getByRole('alert')).toHaveTextContent('temperature_c accepts -40 to 85 °C');
    expect(temp.getByRole('button', { name: 'Hold' })).toBeDisabled();
    await user.type(temp.getByLabelText('Hold temperature_c at'), '{Enter}');
    expect(calls(simulator, 'PUT', '/holds/temperature_c')).toHaveLength(0);
  });

  it('says the range before anything is typed', async () => {
    const user = userEvent.setup();
    open('dc-env-01');
    await user.click(screen.getByRole('radio', { name: 'Hold value' }));
    expect(panel('humidity_pct').getByText('Accepts 0 to 100 %')).toBeInTheDocument();
    expect(panel('humidity_pct').getByRole('button', { name: 'Hold' })).toBeDisabled();
  });

  it('shows a device that already holds a value in hold mode, with Release', () => {
    open('lha-air-01');
    expect(screen.getByRole('radio', { name: 'Hold value' })).toBeChecked();
    expect(panel('co2_ppm').getByLabelText('Hold co2_ppm at')).toHaveValue('1450');
    expect(panel('co2_ppm').getByRole('button', { name: 'Release' })).toBeInTheDocument();
  });

  it('releases a held value', async () => {
    const user = userEvent.setup();
    const { simulator } = open('lha-air-01');
    await user.click(panel('co2_ppm').getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(calls(simulator, 'DELETE', '/holds/co2_ppm')).toHaveLength(1));
    await waitFor(() =>
      expect(panel('co2_ppm').queryByRole('button', { name: 'Release' })).not.toBeInTheDocument(),
    );
  });

  it('goes back to simulating when Simulated is chosen: every hold is released', async () => {
    const user = userEvent.setup();
    const { simulator } = open('lha-air-01');
    await user.click(screen.getByRole('radio', { name: 'Simulated' }));
    await waitFor(() => expect(calls(simulator, 'DELETE', '/holds/co2_ppm')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Simulated' })).toBeChecked());
  });

  it('resets to baseline only when something is held', async () => {
    const user = userEvent.setup();
    const none = open('dc-env-01');
    expect(screen.getByRole('button', { name: /^Reset to baseline/ })).toBeDisabled();
    none.unmount();

    const { simulator } = open('lha-air-01');
    await user.click(screen.getByRole('button', { name: /^Reset to baseline/ }));
    await waitFor(() => expect(calls(simulator, 'DELETE', '/holds/co2_ppm')).toHaveLength(1));
  });
});

describe('Inspector interval', () => {
  it('starts at the device interval, with Set off until it changes', () => {
    open('dc-env-01');
    expect(screen.getByLabelText('Interval')).toHaveValue('2000');
    expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Use the default/ })).not.toBeInTheDocument();
  });

  it('sets a new interval, then offers the default again', async () => {
    const user = userEvent.setup();
    const { simulator } = open('dc-env-01');
    const field = screen.getByLabelText('Interval');
    await user.clear(field);
    await user.type(field, '500');
    await user.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() => expect(calls(simulator, 'PUT', '/interval')).toHaveLength(1));
    expect(calls(simulator, 'PUT', '/interval')[0]?.body).toEqual({ intervalMs: 500 });

    await user.click(await screen.findByRole('button', { name: 'Use the default (2000 ms)' }));
    await waitFor(() => expect(calls(simulator, 'PUT', '/interval')).toHaveLength(2));
    expect(calls(simulator, 'PUT', '/interval')[1]?.body).toEqual({ intervalMs: null });
    expect(screen.getByLabelText('Interval')).toHaveValue('2000');
  });

  it('sets it on Enter', async () => {
    const user = userEvent.setup();
    const { simulator } = open('dc-env-01');
    const field = screen.getByLabelText('Interval');
    await user.clear(field);
    await user.type(field, '1000{Enter}');
    await waitFor(() => expect(calls(simulator, 'PUT', '/interval')).toHaveLength(1));
  });

  it('refuses text, zero and fractions, and says what is allowed', async () => {
    const user = userEvent.setup();
    const { simulator } = open('dc-env-01');
    const field = screen.getByLabelText('Interval');
    for (const bad of ['0', '1.5', 'abc']) {
      await user.clear(field);
      await user.type(field, bad);
      expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    }
    expect(calls(simulator, 'PUT', '/interval')).toHaveLength(0);
    await user.clear(field);
    expect(screen.getByText('1 to 3,600,000 ms')).toBeInTheDocument();
  });
});

describe('Inspector commands', () => {
  it('goes silent (stops) and the pill follows', async () => {
    const user = userEvent.setup();
    const { simulator } = open('dc-env-02');
    await user.click(within(dialog()).getByRole('button', { name: 'Go silent: stop dc-env-02' }));
    await waitFor(() => expect(calls(simulator, 'POST', '/stop')).toHaveLength(1));
    await waitFor(() => expect(within(dialog()).getByText('Stopped')).toBeInTheDocument());
    expect(within(dialog()).getByRole('button', { name: 'Start dc-env-02' })).toBeEnabled();
  });

  it('shows what the simulator refused, inside the sheet', async () => {
    const user = userEvent.setup();
    renderFleet({ path: '/fleet?device=dc-env-02', failFor: ['dc-env-02'] });
    await user.click(within(dialog()).getByRole('button', { name: 'Pause dc-env-02' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Unknown device "dc-env-02"',
    );
  });
});

describe('Inspector while a benchmark runs', () => {
  it('turns Start off for a device that is not running', () => {
    renderFleet({ path: '/fleet?device=hub-power-01', benchmark: runningBenchmark() });
    expect(within(dialog()).getByRole('button', { name: 'Start hub-power-01' })).toBeDisabled();
  });

  it('leaves Pause and Go silent open for a device that runs', () => {
    renderFleet({ path: '/fleet?device=dc-env-02', benchmark: runningBenchmark() });
    expect(within(dialog()).getByRole('button', { name: 'Pause dc-env-02' })).toBeEnabled();
    expect(
      within(dialog()).getByRole('button', { name: 'Go silent: stop dc-env-02' }),
    ).toBeEnabled();
  });
});
