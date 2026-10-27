import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { runningBenchmark } from '../../state/benchmarkTestSupport';
import { axeViolations } from '../../test-axe';
import { counter, faultState, renderFaults } from './faultsTestSupport';

afterEach(() => vi.unstubAllGlobals());

const SINCE = '2026-10-23T08:00:00.000Z';
/** The devices the fixture's engine is running, which is what "devices" in the banner counts when nothing is selected. */
const RUNNING = stateViewFixture.engine.devices.filter((d) => d.state === 'running').length;
const BASELINE = [
  counter('telemetry_sequence_gaps_total', 4),
  counter('telemetry_messages_total', 100, { result: 'accepted' }),
  counter('telemetry_readings_total', 220, { result: 'stored' }),
  counter('telemetry_rejections_total', 6, { reason: 'range' }),
];
const NOW = [
  counter('telemetry_sequence_gaps_total', 29),
  counter('telemetry_messages_total', 604, { result: 'accepted' }),
  counter('telemetry_readings_total', 683, { result: 'stored' }),
  counter('telemetry_rejections_total', 20, { reason: 'range' }),
];

/** drop and malformed on, with a baseline and counters that have moved since. */
const busy = () =>
  faultState(
    {
      drop: { percent: 5 },
      malformed: { percent: 3, kinds: ['range'] },
      activeCount: 2,
      deviceCount: RUNNING,
    },
    {
      faultEffect: { since: SINCE, baseline: BASELINE },
      metrics: { samples: NOW, lastOkAt: SINCE, stale: false },
    },
  );

const sw = (name: string) => screen.getByRole('switch', { name });
const call = (
  sim: { calls: { method: string; path: string; body: unknown }[] },
  method: string,
  path: string,
) => sim.calls.find((c) => c.method === method && c.path === path);

describe('Faults: the page from the engine’s state', () => {
  it('shows the seven faults, all off, with no banner and an empty effect panel', () => {
    renderFaults();
    expect(screen.getByRole('heading', { level: 1, name: 'Faults' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Simulation lab' })).toBeInTheDocument();
    for (const name of [
      'Drop messages',
      'Duplicate messages',
      'Malformed payloads',
      'Delay and jitter',
      'Out-of-order delivery',
      'Link loss',
    ]) {
      expect(sw(name)).not.toBeChecked();
    }
    expect(screen.getByRole('button', { name: 'Send 1,000' })).toBeEnabled();
    expect(screen.queryByText(/active on/)).toBeNull();
    expect(screen.getByText('Switch a fault on to see what ingest counts.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All running' })).toBeChecked();
    // The controls of a fault show only while it is on.
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('waits for the first message of the simulator, and says so when it never came', () => {
    const first = renderFaults({ state: null, link: 'connecting' });
    expect(screen.getByText(/Waiting for the first message/)).toBeInTheDocument();
    first.unmount();
    renderFaults({ state: null, link: 'lost' });
    expect(screen.getByText('The simulator has not answered yet.')).toBeInTheDocument();
  });

  it('draws what the engine has on: the switches, the values, the kind, the banner and the line of what it does', () => {
    renderFaults({ state: busy() });
    expect(sw('Drop messages')).toBeChecked();
    expect(sw('Malformed payloads')).toBeChecked();
    expect(sw('Duplicate messages')).not.toBeChecked();
    expect(screen.getByLabelText('Drop messages (percent)')).toHaveValue('5');
    expect(screen.getByRole('slider', { name: 'Drop messages slider' })).toHaveValue('5');
    expect(screen.getByLabelText('Malformed payloads share (percent)')).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'range' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'json' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(`2 faults are active on ${RUNNING} devices.`)).toBeInTheDocument();
    expect(screen.getByText('5 % of messages are not sent')).toBeInTheDocument();
  });

  it('reads the effect from the baseline and the counters now', () => {
    renderFaults({ state: busy() });
    expect(screen.getByLabelText('telemetry_sequence_gaps_total: +25')).toBeInTheDocument();
    expect(
      screen.getByLabelText('telemetry_rejections_total{reason="range"}: +14'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('telemetry_messages_total: +504')).toBeInTheDocument();
    expect(
      screen.getByLabelText('telemetry_readings_total{result="stored"}: +463'),
    ).toBeInTheDocument();
    expect(screen.getByText(/never arrived/)).toBeInTheDocument();
  });

  it('says there is no baseline when ingest could not be read, instead of showing zeros', () => {
    renderFaults({
      state: faultState(
        { drop: { percent: 5 }, activeCount: 1 },
        { faultEffect: { since: SINCE, baseline: null } },
      ),
    });
    expect(screen.getByText('No baseline')).toBeInTheDocument();
    expect(screen.getByLabelText('telemetry_sequence_gaps_total: no figure')).toBeInTheDocument();
  });

  it('has no accessibility violations, with nothing on and with faults on', async () => {
    const quiet = renderFaults();
    expect(await axeViolations(quiet.container)).toEqual([]);
    quiet.unmount();
    const loud = renderFaults({ state: busy() });
    expect(await axeViolations(loud.container)).toEqual([]);
  });
});

describe('Faults: switching and changing', () => {
  it('switches a fault on with the defaults, and the page follows the engine’s answer', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    await user.click(sw('Drop messages'));

    await waitFor(() => expect(sw('Drop messages')).toBeChecked());
    expect(call(sim, 'PUT', '/api/faults/drop')?.body).toEqual({ percent: 5 });
    expect(screen.getByRole('slider', { name: 'Drop messages slider' })).toBeInTheDocument();
    expect(screen.getByText(`1 fault is active on ${RUNNING} devices.`)).toBeInTheDocument();
  });

  it('switches on each kind with its own settings', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    await user.click(sw('Duplicate messages'));
    await user.click(sw('Malformed payloads'));
    await user.click(sw('Delay and jitter'));
    await user.click(sw('Out-of-order delivery'));
    await waitFor(() => expect(sw('Out-of-order delivery')).toBeChecked());
    expect(call(sim, 'PUT', '/api/faults/duplicate')?.body).toEqual({ percent: 2 });
    expect(call(sim, 'PUT', '/api/faults/malformed')?.body).toEqual({
      percent: 3,
      kinds: ['range'],
    });
    expect(call(sim, 'PUT', '/api/faults/delay')?.body).toEqual({ delayMs: 500, jitterMs: 100 });
    expect(call(sim, 'PUT', '/api/faults/reorder')?.body).toEqual({ window: 4 });
    expect(screen.getByLabelText('Delay')).toHaveValue('500');
    expect(screen.getByLabelText('Window')).toHaveValue('4');
  });

  it('switches a fault off', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults({ state: busy() });
    await user.click(sw('Drop messages'));
    await waitFor(() => expect(sw('Drop messages')).not.toBeChecked());
    expect(call(sim, 'DELETE', '/api/faults/drop')).toBeDefined();
    expect(screen.queryByRole('slider', { name: 'Drop messages slider' })).toBeNull();
    expect(screen.getByText(`1 fault is active on ${RUNNING} devices.`)).toBeInTheDocument();
  });

  it('sends a value that is typed and confirmed, and a slider that is released, once each', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults({ state: busy() });
    const number = screen.getByLabelText('Drop messages (percent)');
    await user.clear(number);
    await user.type(number, '8{Enter}');
    await waitFor(() => expect(call(sim, 'PUT', '/api/faults/drop')?.body).toEqual({ percent: 8 }));

    const slider = screen.getByRole('slider', { name: 'Drop messages slider' });
    fireEvent.change(slider, { target: { value: '10' } });
    fireEvent.change(slider, { target: { value: '12' } });
    expect(sim.calls.filter((c) => c.path === '/api/faults/drop')).toHaveLength(1);
    fireEvent.pointerUp(slider);
    await waitFor(() =>
      expect(sim.calls.filter((c) => c.path === '/api/faults/drop').at(-1)?.body).toEqual({
        percent: 12,
      }),
    );
  });

  it('does not send a value the simulator would refuse, and says why under the field', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults({ state: busy() });
    const number = screen.getByLabelText('Drop messages (percent)');
    await user.clear(number);
    await user.type(number, '150{Enter}');
    expect(sim.calls).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('A percentage is above 0 and at most 100');
  });

  it('shows what the simulator refused under the fault, and puts the control back to what the engine has', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults({ state: busy() });
    sim.refuseNext(
      (c) => c.method === 'PUT' && c.path === '/api/faults/drop',
      400,
      '"percent" must be a number above 0 and at most 100',
    );
    const number = screen.getByLabelText('Drop messages (percent)');
    await user.clear(number);
    await user.type(number, '8{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('"percent" must be a number');
    // The control went back to what the engine has, even though it still has focus; leaving it sends nothing more.
    await waitFor(() => expect(screen.getByLabelText('Drop messages (percent)')).toHaveValue('5'));
    const before = sim.calls.length;
    await user.tab();
    expect(sim.calls).toHaveLength(before);
  });

  it('turns a kind of malformed on and off, sends each, and keeps the last one on', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults({ state: busy() });
    await user.click(screen.getByRole('button', { name: 'json' }));
    await waitFor(() =>
      expect(call(sim, 'PUT', '/api/faults/malformed')?.body).toEqual({
        percent: 3,
        kinds: ['range', 'json'],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'range' }));
    await waitFor(() =>
      expect(sim.calls.filter((c) => c.path === '/api/faults/malformed').at(-1)?.body).toEqual({
        percent: 3,
        kinds: ['json'],
      }),
    );
    const before = sim.calls.length;
    await user.click(screen.getByRole('button', { name: 'json' }));
    expect(sim.calls).toHaveLength(before);
    expect(screen.getByRole('button', { name: 'json' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('commits the delay and the jitter, and refuses a jitter above the delay in words', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults({
      state: faultState({ delay: { delayMs: 500, jitterMs: 100 }, activeCount: 1 }),
    });
    const jitter = screen.getByLabelText('Jitter');
    await user.clear(jitter);
    await user.type(jitter, '900{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('The jitter is from 0 to the delay');
    expect(sim.calls).toEqual([]);
    await user.clear(jitter);
    await user.type(jitter, '200{Enter}');
    await waitFor(() =>
      expect(call(sim, 'PUT', '/api/faults/delay')?.body).toEqual({ delayMs: 500, jitterMs: 200 }),
    );
  });
});

describe('Faults: the scope', () => {
  it('sends nothing when Selected is chosen with no device, says so, and sends the devices when one is', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    const first = stateViewFixture.devices[0]!.id;

    await user.click(screen.getByRole('radio', { name: 'Selected' }));
    expect(sim.calls).toEqual([]);
    expect(screen.getByText(/Choose at least one device/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choose targets…' }));
    await user.click(screen.getByRole('checkbox', { name: `Select ${first}` }));
    await waitFor(() =>
      expect(call(sim, 'PUT', '/api/faults/scope')?.body).toEqual({
        mode: 'selected',
        deviceIds: [first],
      }),
    );
    await waitFor(() => expect(screen.getByText(/1 device chosen/)).toBeInTheDocument());

    await user.click(screen.getByRole('radio', { name: 'All running' }));
    await waitFor(() =>
      expect(sim.calls.filter((c) => c.path === '/api/faults/scope').at(-1)?.body).toEqual({
        mode: 'running',
      }),
    );
  });

  it('draws the engine’s selection when the page opens', () => {
    const first = stateViewFixture.devices[0]!.id;
    renderFaults({
      state: faultState({ scope: { mode: 'selected', deviceIds: [first] }, deviceCount: 1 }),
    });
    expect(screen.getByRole('radio', { name: 'Selected' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add…' })).toBeInTheDocument();
    expect(screen.getByText(/1 device chosen/)).toBeInTheDocument();
  });

  it('shows what the simulator refused under the scope', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    const first = stateViewFixture.devices[0]!.id;
    sim.refuseNext((c) => c.path === '/api/faults/scope', 404, 'Unknown device "ghost"');
    await user.click(screen.getByRole('radio', { name: 'Selected' }));
    await user.click(screen.getByRole('button', { name: 'Choose targets…' }));
    await user.click(screen.getByRole('checkbox', { name: `Select ${first}` }));
    expect(await screen.findByText('Unknown device "ghost"')).toBeInTheDocument();
  });
});

describe('Faults: link loss, burst, Clear all and Reset counters', () => {
  it('cuts the link with the restore time that was typed, and says it is down', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    await user.type(screen.getByLabelText(/Restore after/), '30');
    await user.click(sw('Link loss'));
    await waitFor(() => expect(sw('Link loss')).toBeChecked());
    expect(call(sim, 'PUT', '/api/faults/link-loss')?.body).toEqual({ forS: 30 });
    expect(screen.getByText(/restores itself after 30 s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send 1,000' })).toBeDisabled();
    expect(screen.queryByLabelText(/Restore after/)).toBeNull();
  });

  it('cuts it with no restore time when the field is empty, and restores it by switching off', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    await user.click(sw('Link loss'));
    await waitFor(() => expect(sw('Link loss')).toBeChecked());
    expect(call(sim, 'PUT', '/api/faults/link-loss')?.body).toEqual({});
    await user.click(sw('Link loss'));
    await waitFor(() => expect(sw('Link loss')).not.toBeChecked());
    expect(call(sim, 'DELETE', '/api/faults/link-loss')).toBeDefined();
  });

  it('shows why the link could not be cut under the row', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    sim.refuseNext(
      (c) => c.path === '/api/faults/link-loss',
      409,
      'This simulator has no broker link it can cut',
    );
    await user.click(sw('Link loss'));
    expect(await screen.findByRole('alert')).toHaveTextContent('no broker link it can cut');
    expect(sw('Link loss')).not.toBeChecked();
  });

  it('sends a burst of 1,000 and tells how many went', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    await user.click(screen.getByRole('button', { name: 'Send 1,000' }));
    expect(await screen.findByText('Sent 1,000 messages, 0 failed.')).toBeInTheDocument();
    expect(call(sim, 'POST', '/api/faults/burst')?.body).toEqual({ count: 1000 });
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Sent 1,000/)).toBeNull();
  });

  it('shows the simulator’s sentence when a burst cannot be sent', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    sim.refuseNext((c) => c.path === '/api/faults/burst', 409, 'A burst is already being sent');
    await user.click(screen.getByRole('button', { name: 'Send 1,000' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A burst is already being sent');
  });

  it('clears every fault, keeps the scope and says so', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults({ state: busy() });
    await user.click(screen.getByRole('button', { name: 'Clear all faults' }));
    await waitFor(() => expect(sw('Drop messages')).not.toBeChecked());
    expect(call(sim, 'DELETE', '/api/faults')).toBeDefined();
    expect(sw('Malformed payloads')).not.toBeChecked();
    expect(screen.getByText(/All faults cleared/)).toBeInTheDocument();
    expect(screen.queryByText(/active on/)).toBeNull();
    // The effect session goes on after the faults are cleared.
    expect(screen.getByLabelText('telemetry_sequence_gaps_total: +25')).toBeInTheDocument();
  });

  it('starts the counters again from now', async () => {
    const user = userEvent.setup();
    const { sim } = renderFaults();
    await user.click(screen.getByRole('button', { name: 'Reset counters' }));
    expect(await screen.findByText('The counters start again from now.')).toBeInTheDocument();
    expect(call(sim, 'POST', '/api/faults/effect/reset')).toBeDefined();
    expect(screen.getByText(/Counters read from ingest/)).toBeInTheDocument();
  });
});

describe('Faults: the link to the simulator is lost', () => {
  it('says so, disables everything that sends, and shows the last known state', () => {
    renderFaults({ state: busy(), link: 'lost' });
    expect(screen.getByText(/The link to the simulator is lost/)).toBeInTheDocument();
    expect(sw('Drop messages')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear all faults' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset counters' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send 1,000' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Selected' })).toBeDisabled();
    expect(
      within(screen.getByRole('group', { name: 'Drop messages' })).getByRole('slider'),
    ).toBeDisabled();
    expect(sw('Drop messages')).toBeChecked();
  });
});

describe('Faults while a benchmark runs', () => {
  it('turns the burst, link loss and Clear all faults off, and leaves the other faults and Reset counters open', () => {
    renderFaults({ benchmark: runningBenchmark() });
    expect(screen.getByRole('button', { name: 'Send 1,000' })).toBeDisabled();
    expect(sw('Link loss')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear all faults' })).toBeDisabled();

    expect(sw('Drop messages')).toBeEnabled();
    expect(sw('Delay and jitter')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset counters' })).toBeEnabled();
  });

  it('keeps them on when no benchmark runs', () => {
    renderFaults();
    expect(screen.getByRole('button', { name: 'Send 1,000' })).toBeEnabled();
    expect(sw('Link loss')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear all faults' })).toBeEnabled();
  });
});
