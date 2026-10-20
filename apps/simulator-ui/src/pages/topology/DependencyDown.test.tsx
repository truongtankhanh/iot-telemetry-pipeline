import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { IngestState, StateView } from '../../api/types';
import { deviceCalls, fakeSimulator, viewWithDevices } from '../fleet/fleetTestSupport';
import { Topology } from './Topology';
import { graphNode, installReactFlowStubs, renderTopology } from './topologyTestSupport';

let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Ingest does not answer: frame 10. */
const unreachable = (base: StateView = stateViewFixture): StateView => {
  const view = structuredClone(base);
  view.ingest = {
    ...view.ingest,
    status: 'unreachable',
    database: null,
    broker: null,
    alertSink: null,
    detail: 'ECONNREFUSED',
    since: '2026-10-20T09:21:07.000Z',
  };
  return view;
};

const page = (view: StateView, path = '/topology') => renderTopology(<Topology />, { view, path });
const stage = (id: string) => graphNode(`stage:${id}`) as HTMLElement;
const READY: IngestState = {
  status: 'ready',
  database: 'up',
  broker: 'up',
  alertSink: 'ops-command-center',
  detail: null,
  since: '2026-10-20T09:23:41.000Z',
  lastCheckedAt: '2026-10-20T09:23:41.000Z',
};

describe('ingest is unreachable (frame 10)', () => {
  it('says so in a banner, with where, why, and how often Studio asks again', () => {
    page(unreachable());
    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/Ingest is unreachable/)).toBeInTheDocument();
    expect(within(banner).getByText(/http:\/\/localhost:3100/)).toBeInTheDocument();
    expect(within(banner).getByText(/ECONNREFUSED/)).toBeInTheDocument();
    expect(within(banner).getByText(/Retrying every 1 s/)).toBeInTheDocument();
  });

  it('has no "Retry now": ingest is asked again every second whatever is pressed', () => {
    page(unreachable());
    expect(screen.queryByRole('button', { name: /Retry now/ })).toBeNull();
  });

  it('draws ingest down and every stage after it unknown, dated and dimmed', async () => {
    page(unreachable());
    await waitFor(() => expect(graphNode('stage:ingest')).not.toBeNull());
    // the word and the figure both say it
    expect(within(stage('ingest')).getAllByText('Unreachable').length).toBeGreaterThan(0);
    for (const id of ['database', 'rules', 'alert', 'outbox'] as const) {
      const node = stage(id);
      expect(within(node).getByText('Unknown')).toBeInTheDocument();
      expect(node.querySelector('[data-dimmed="true"]')).not.toBeNull();
      expect(node.querySelector('[data-state="stale"]')).not.toBeNull();
    }
    // the broker is still known: devices still publish to it
    expect(within(stage('broker')).getByText('Connected')).toBeInTheDocument();
  });

  it('shows the checks, and the last alerts dimmed with the time of the last answer', () => {
    page(unreachable());
    expect(screen.getByRole('heading', { level: 2, name: 'Checks' })).toBeInTheDocument();
    expect(screen.getByText('GET /api/ready failed: ECONNREFUSED')).toBeInTheDocument();
    // Studio has not been told a sink yet, so the check says that, not a guess
    expect(
      screen.getByText('Ingest has not said whether it has an alert sink.'),
    ).toBeInTheDocument();
    const alerts = screen
      .getByRole('heading', { level: 2, name: 'Alerts' })
      .closest('section') as HTMLElement;
    expect(within(alerts).getByText(/As of/)).toBeInTheDocument();
    expect(alerts.querySelector('[data-dimmed="true"]')).not.toBeNull();
  });

  it('keeps saying "not configured" from the last sink ingest reported', async () => {
    const view = unreachable();
    const { store } = page(view);
    act(() => {
      // the store remembers what ingest last said about its sink
      const answering = structuredClone(stateViewFixture);
      answering.ingest.alertSink = 'none';
      store.getState().setView(answering, Date.now());
      store.getState().setView(unreachable(answering), Date.now());
    });
    await waitFor(() =>
      expect(within(stage('commandCenter')).getByText('Not configured')).toBeInTheDocument(),
    );
  });

  it('pauses the devices that are publishing, one after another, with "Pause publishing"', async () => {
    const user = userEvent.setup();
    const view = unreachable();
    const simulator = fakeSimulator(view);
    vi.stubGlobal('fetch', simulator.fetch);
    page(view);
    await user.click(screen.getByRole('button', { name: 'Pause publishing' }));
    // five of the six devices are running; the sixth is already paused
    await waitFor(() => expect(deviceCalls(simulator, 'POST', 'pause')).toHaveLength(5));
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && el.textContent === 'Pausing: 5 of 5 done.',
      ),
    ).toBeInTheDocument();
  });

  it('asks first above ten devices', async () => {
    const user = userEvent.setup();
    const view = unreachable(viewWithDevices(12));
    const simulator = fakeSimulator(view);
    vi.stubGlobal('fetch', simulator.fetch);
    page(view);
    await user.click(screen.getByRole('button', { name: 'Pause publishing' }));
    expect(screen.getByRole('group', { name: 'Confirm' })).toBeInTheDocument();
    expect(deviceCalls(simulator, 'POST', 'pause')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm' })).toBeNull();
  });

  it('has nothing to pause when no device is publishing', () => {
    const view = unreachable();
    for (const device of view.engine.devices) device.state = 'paused';
    page(view);
    expect(screen.getByRole('button', { name: 'Pause publishing' })).toBeDisabled();
  });

  it('recovers when ingest answers again, without a reload', async () => {
    const { store } = page(unreachable());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      store.getState().patchSlice('ingest', READY, Date.now());
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(within(stage('ingest')).getByText('Ready')).toBeInTheDocument();
    expect(within(stage('database')).getByText('Up')).toBeInTheDocument();
    expect(stage('alert').querySelector('[data-dimmed="true"]')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Checks' })).toBeNull();
  });
});

describe('ingest is not ready', () => {
  it('says which of its dependencies is down for it, as a limitation and not a stop', () => {
    const view = structuredClone(stateViewFixture);
    view.ingest.status = 'not-ready';
    view.ingest.database = 'down';
    page(view);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/the database is down for it/)).toBeInTheDocument();
  });
});

describe('no alert sink', () => {
  it('says the command center is not configured, and that alerts are skipped', async () => {
    const view = structuredClone(stateViewFixture);
    view.ingest.alertSink = 'none';
    page(view);
    expect(screen.getByText(/No alert sink/)).toBeInTheDocument();
    await waitFor(() => expect(graphNode('stage:commandCenter')).not.toBeNull());
    expect(within(stage('commandCenter')).getByText('not configured')).toBeInTheDocument();
    expect(within(stage('outbox')).getByText('No sink')).toBeInTheDocument();
  });

  it('is a limitation, not an alert', () => {
    const view = structuredClone(stateViewFixture);
    view.ingest.alertSink = 'none';
    page(view);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the broker is disconnected (drawn in this ticket, with no frame)', () => {
  it('draws the broker down, says so in a banner, and shows the check in red', async () => {
    const view = structuredClone(stateViewFixture);
    view.broker.connected = false;
    page(view);
    expect(screen.getByRole('alert')).toHaveTextContent(/not connected to the broker/i);
    await waitFor(() => expect(graphNode('stage:broker')).not.toBeNull());
    expect(within(stage('broker')).getByText('Disconnected')).toBeInTheDocument();
    expect(stage('broker').querySelector('[data-state="down"]')).not.toBeNull();
  });

  it('draws the links of the devices dark: nothing reaches the broker', async () => {
    const view = structuredClone(stateViewFixture);
    view.broker.connected = false;
    page(view);
    await waitFor(() =>
      expect(document.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(0),
    );
    const edge = document.querySelector(
      '.react-flow__edge[data-id="device:dc-env-02>broker"] [data-state]',
    );
    expect(edge?.getAttribute('data-state')).toBe('off');
  });
});

describe('delivery to the command center is failing', () => {
  it('says so, and draws the outbox and the command center down', async () => {
    const view = structuredClone(stateViewFixture);
    const alert = view.alerts.alerts[0];
    if (alert === undefined) throw new Error('the fixture has an alert');
    Object.assign(alert, {
      deliveryStatus: 'failed',
      deliveryError: 'HTTP 502',
      externalRef: null,
    });
    page(view);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Delivery to the Command Center is failing/,
    );
    await waitFor(() => expect(graphNode('stage:outbox')).not.toBeNull());
    expect(within(stage('outbox')).getByText('Failed')).toBeInTheDocument();
    expect(within(stage('commandCenter')).getByText('Failing')).toBeInTheDocument();
  });
});
