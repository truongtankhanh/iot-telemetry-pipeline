import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkFixture } from '../../api/fixtures/benchmarkFixtures';
import { expectedReadingsFor } from '../../lib/benchmarkStart';
import { BenchmarkStore } from '../../state/benchmarkStore';
import { axeViolations } from '../../test-axe';
import {
  benchmarkView,
  failingCheck,
  fakeBenchmarkSimulator,
  GOING,
  renderAnalytics,
  summaryOf,
} from './analyticsTestSupport';

afterEach(() => vi.unstubAllGlobals());

const preflightReads = (fetchMock: { mock: { calls: unknown[][] } }) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/benchmark/preflight')).length;

/** A benchmark with a run going (run 3) and two finished ones, as a window that has been open since the run began would hold. */
function runningBenchmark() {
  const benchmark = new BenchmarkStore();
  benchmark.seedDetail(benchmarkFixture);
  return benchmark;
}

/** A benchmark with only finished runs. */
function finishedBenchmark() {
  const benchmark = new BenchmarkStore();
  benchmark.seedDetail({ ...benchmarkFixture, running: false, current: null });
  return benchmark;
}

const startButton = () => screen.findByRole('button', { name: 'Start benchmark…' });

describe('Analytics before there is anything to show', () => {
  it('waits for the first message of the simulator', () => {
    renderAnalytics({ view: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the simulator…');
  });
});

describe('Analytics when no run is going', () => {
  it('shows the settings, the checks and the session’s charts, and no run', async () => {
    renderAnalytics();
    expect(screen.getByRole('textbox', { name: 'Messages' })).toHaveValue('100000');
    expect(screen.getByText('6, from devices.json')).toBeInTheDocument();
    expect(screen.getByText('localhost:5433/telemetry')).toBeInTheDocument();

    // The list is there from the start and fills when the simulator answers; Start turns on with the last check.
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());
    const checks = screen.getByRole('list', { name: 'Checks before start' });
    expect(
      within(checks)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Ingest ready: passes', 'Database reachable: passes', 'Fleet paused: passes']);
    expect(screen.getByRole('heading', { name: 'Throughput' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ingest lag' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop run' })).toBeNull();
    expect(screen.getByText(/The fleet must be paused to start one/)).toBeInTheDocument();
    expect(screen.getByText(/No run has finished in this session yet/)).toBeInTheDocument();
  });

  it('turns Start off with the reason when a check fails, and says where to pause the fleet', async () => {
    const simulator = fakeBenchmarkSimulator();
    simulator.checks = [
      ...simulator.checks.slice(0, 2),
      failingCheck('fleet', 'dc-env-01 is running'),
    ];
    renderAnalytics({ simulator });
    const button = await startButton();
    expect(
      await screen.findByText(/Start is off\. Fleet paused fails: dc-env-01 is running\./),
    ).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Pause the fleet on the Overview' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(button).toHaveAccessibleDescription(/Fleet paused fails/);
  });

  it('reads the checks again when what they depend on changes, and on Check again', async () => {
    const user = userEvent.setup();
    const simulator = fakeBenchmarkSimulator();
    const { store } = renderAnalytics({ simulator });
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());
    expect(preflightReads(simulator.fetch)).toBe(1);

    // Something the checks depend on changed elsewhere (every device paused, ingest not answering): the list is read again.
    act(() => {
      const view = benchmarkView((v) => {
        v.engine.devices = v.engine.devices.map((device) => ({ ...device, state: 'paused' }));
        v.ingest.status = 'unreachable';
      });
      store.getState().setView(view, Date.now());
    });
    await waitFor(() => expect(preflightReads(simulator.fetch)).toBe(2));

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(preflightReads(simulator.fetch)).toBe(3));
  });

  it('turns Start off for a size the simulator would refuse, and names the range', async () => {
    const user = userEvent.setup();
    renderAnalytics();
    const field = screen.getByRole('textbox', { name: 'Messages' });
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());

    await user.clear(field);
    await user.type(field, '0');
    expect(
      screen.getAllByText(/Enter a whole number of messages from 1 to 250,000\./).length,
    ).toBeGreaterThan(0);
    expect(button).toBeDisabled();

    await user.clear(field);
    await user.type(field, '250001');
    expect(button).toBeDisabled();

    await user.clear(field);
    await user.type(field, '2000');
    expect(button).toBeEnabled();
  });
});

describe('starting a run', () => {
  it('asks first, says what the run costs, and sends nothing until the person confirms', async () => {
    const user = userEvent.setup();
    const { simulator } = renderAnalytics();
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Start a heavy run?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(within(dialog).getByText(/It publishes 100,000 messages/)).toBeInTheDocument();
    const readings = expectedReadingsFor(100_000, benchmarkView().devices).toLocaleString('en-US');
    expect(
      within(dialog).getByText(
        `It writes about ${readings} readings to localhost:5433/telemetry. Nothing deletes them afterwards.`,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/the controls that publish are locked/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/What was already published stays published/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Start 100,000 messages' }),
    ).toBeInTheDocument();
    expect(simulator.sent).toEqual([]);
  });

  it('closes on Cancel and on Escape without sending anything, and gives the focus back to Start', async () => {
    const user = userEvent.setup();
    const { simulator } = renderAnalytics();
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());

    await user.click(button);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();

    await user.click(button);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(simulator.sent).toEqual([]);
  });

  it('sends the size with the confirmation, and then shows the run with Stop and the lock', async () => {
    const user = userEvent.setup();
    const { simulator, benchmark } = renderAnalytics();
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Start 100,000 messages',
      }),
    );

    await screen.findByRole('button', { name: 'Stop run' });
    expect(simulator.sent).toEqual([
      { method: 'POST', path: '/api/benchmark', body: { messages: 100_000, confirm: true } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(benchmark.get().status).toEqual({ id: 4, phase: 'starting' });
    expect(screen.getByRole('heading', { name: 'Run 4' })).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Messages' })).toBeDisabled();
    expect(screen.getByText(/Heavy run\./)).toBeInTheDocument();
    // Start is still there, off, and says why.
    expect(screen.getByRole('button', { name: 'Start benchmark…' })).toBeDisabled();
    expect(screen.getByText(/Start is off\. A run is going\./)).toBeInTheDocument();
  });

  it('says why a start was refused, and shows the checks it named', async () => {
    const user = userEvent.setup();
    const simulator = fakeBenchmarkSimulator();
    renderAnalytics({ simulator });
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());

    // The fleet was running after all by the time the simulator checked again.
    simulator.refuse = {
      status: 409,
      message: 'The benchmark cannot start: 1 check fails',
      extra: { checks: [failingCheck('fleet', 'dc-env-01 is running')] },
    };
    await user.click(button);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Start 100,000 messages',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The benchmark cannot start: 1 check fails',
    );
    expect(screen.getByText(/dc-env-01 is running/, { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop run' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await startButton()).toBeDisabled();
  });
});

describe('a run that is going', () => {
  it('is shown, with Stop, by a page opened in the middle of it: the run belongs to the simulator, not to a tab', () => {
    const { simulator } = renderAnalytics({ benchmark: runningBenchmark() });
    expect(screen.getByRole('heading', { name: 'Run 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeEnabled();
    expect(screen.getByRole('progressbar', { name: 'Published' })).toBeInTheDocument();
    expect(screen.getByText(/Heavy run\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Queue delay (estimated)' })).toBeInTheDocument();
    expect(preflightReads(simulator.fetch)).toBe(0);
  });

  it('stops the run, says "Stopping…" until the simulator answers, and keeps Stop for the next press', async () => {
    const user = userEvent.setup();
    const simulator = fakeBenchmarkSimulator();
    simulator.holdStop = true;
    renderAnalytics({ benchmark: runningBenchmark(), simulator });

    await user.click(screen.getByRole('button', { name: 'Stop run' }));
    const stopping = await screen.findByRole('button', { name: 'Stopping…' });
    expect(stopping).toBeDisabled();
    expect(simulator.sent).toEqual([
      { method: 'POST', path: '/api/benchmark/stop', body: undefined },
    ]);

    await act(async () => simulator.releaseStop());
    expect(await screen.findByRole('button', { name: 'Stop run' })).toBeEnabled();
  });

  it('follows the stream: a new point moves the numbers, and the end gives the page back to the settings', async () => {
    const { emit } = renderAnalytics({ benchmark: runningBenchmark() });
    emit(
      { ...summaryOf(GOING), elapsedMs: 11_700, published: 70_000, stored: 139_000 },
      {
        t: 11,
        published: 70_000,
        stored: 139_000,
        buffered: 600,
        flushP95S: 0.02,
        queueDelayS: 0.1,
      },
    );
    expect(screen.getByRole('progressbar', { name: 'Published' })).toHaveAttribute(
      'aria-valuetext',
      '70,000 of 100,000 messages',
    );

    emit({
      ...summaryOf(GOING),
      phase: 'ended',
      outcome: 'completed',
      comparable: true,
      elapsedMs: 18_000,
    });
    expect(await startButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop run' })).toBeNull();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });

  it('says the run goes on when the link to the simulator is lost', () => {
    renderAnalytics({ benchmark: runningBenchmark(), link: 'lost' });
    expect(
      screen.getByText(/The link to the simulator is lost\. The run goes on/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
  });
});

describe('the results of the session', () => {
  it('lists the finished runs, and shows one with its numbers and charts, then goes back', async () => {
    const user = userEvent.setup();
    renderAnalytics({ benchmark: finishedBenchmark() });
    expect(screen.getByRole('list', { name: 'Finished runs' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Run 2' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show Run 2' }));
    expect(screen.getByRole('heading', { name: 'Run 2' })).toBeInTheDocument();
    expect(
      screen.getByText(/Showing run 2 from this session, not the live charts\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Queue delay (estimated)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show the session' }));
    expect(screen.queryByRole('heading', { name: 'Run 2' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ingest lag' })).toBeInTheDocument();
  });
});

describe('a simulator that cannot run a benchmark', () => {
  it('says so with the reason, offers no Start, and keeps the session’s charts', () => {
    const view = benchmarkView((v) => {
      v.benchmark.available = false;
      v.benchmark.reason = 'not configured';
    });
    renderAnalytics({ view });
    expect(screen.getByText(/The benchmark is not available: not configured/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start benchmark…' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Messages' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Throughput' })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations when idle, with the confirmation open, and with a run going', async () => {
    const user = userEvent.setup();
    const idle = renderAnalytics();
    const button = await startButton();
    await waitFor(() => expect(button).toBeEnabled());
    expect(await axeViolations(idle.container)).toEqual([]);

    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(await axeViolations(dialog)).toEqual([]);
    idle.unmount();

    const running = renderAnalytics({ benchmark: runningBenchmark() });
    expect(await axeViolations(running.container)).toEqual([]);
  });
});
