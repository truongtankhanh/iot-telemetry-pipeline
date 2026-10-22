import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { Anomaly, DeviceInfo, Expected, ExpectedAlert } from '../../api/types';
import { axeViolations } from '../../test-axe';
import { labFleet } from './labTestSupport';
import { TimelineDock, type TimelineDockProps } from './TimelineDock';

const rules = stateViewFixture.rules;

const device = (id: string, zoneCode = 'BLD-DC'): DeviceInfo => ({
  id,
  kind: 'server_room',
  zoneCode,
  metrics: ['temperature_c', 'humidity_pct'],
});

const anomaly = (change: Partial<Anomaly> = {}): Anomaly => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
  ...change,
});

const alert = (deviceId: string, opensAtS: number, clearsAtS: number): ExpectedAlert => ({
  ruleId: 'server-room-hot',
  title: 'Server room temperature high',
  severity: 'high',
  deviceId,
  metric: 'temperature_c',
  opensAtS,
  opensMargin: false,
  clearsAtS,
  clearsUncertain: false,
});

const expected = (alerts: ExpectedAlert[], deviceId = 'dc-env-01'): Expected => ({
  available: true,
  intervalS: 2,
  horizonS: 80,
  alerts,
  quiet: [],
  series: [
    {
      deviceId,
      metric: 'temperature_c',
      stepS: 2,
      points: Array.from({ length: 41 }, (_, i) => (i >= 10 && i < 40 ? 29.2 : 22.5)),
    },
  ],
});

function renderDock(props: Partial<TimelineDockProps> = {}) {
  const all: TimelineDockProps = {
    anomalies: [anomaly()],
    pending: [],
    expected: expected([alert('dc-env-01', 24, 80)]),
    devices: [device('dc-env-01')],
    rules,
    grouped: false,
    elapsedS: null,
    summary: '1 anomaly · 80 s',
    scenario: null,
    busy: false,
    onInject: () => {},
    onClear: () => {},
    ...props,
  };
  return render(
    <MemoryRouter>
      <TimelineDock {...all} />
    </MemoryRouter>,
  );
}

describe('TimelineDock: one fault', () => {
  it('draws the lane of the device, the value against the raise line, and the alert window from the simulator', () => {
    renderDock();
    const picture = screen.getByRole('img', {
      name: /Timeline of .* seconds: 1 anomaly on 1 device/,
    });
    expect(within(picture).getByText('dc-env-01')).toBeInTheDocument();
    expect(within(picture).getByText('temperature_c')).toBeInTheDocument();
    expect(within(picture).getByText('raise 27')).toBeInTheDocument();
    expect(within(picture).getByText('29.2 °C')).toBeInTheDocument();
    expect(within(picture).getByText('server-room-hot · high · raised ≈ 24 s')).toBeInTheDocument();
    expect(within(picture).getByText('Alerts')).toBeInTheDocument();
  });

  it('says the summary, and links to the editor', () => {
    renderDock();
    expect(screen.getByText('1 anomaly · 80 s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open timeline editor' })).toHaveAttribute(
      'href',
      '/lab/timeline',
    );
  });

  it('puts the playhead at the time it is given, with its pill', () => {
    renderDock({ elapsedS: 41 });
    expect(within(screen.getByRole('img')).getByText('41 s')).toBeInTheDocument();
  });

  it('draws the fault being configured as an outline', () => {
    const { container } = renderDock({ pending: [anomaly({ startAt: 100, duration: 20 })] });
    expect(container.querySelectorAll('rect[data-pending="true"]')).toHaveLength(1);
    expect(container.querySelector('title')?.textContent).toMatch(/dc-env-01 temperature_c/);
  });

  it('says it is working out the alerts while the simulator has not answered', () => {
    renderDock({ expected: null });
    expect(screen.getByRole('status')).toHaveTextContent('Working out the alerts…');
    expect(within(screen.getByRole('img')).queryByText('Alerts')).not.toBeInTheDocument();
  });

  it('says why there is no alerts lane when the rules cannot be used', () => {
    renderDock({ expected: { available: false, reason: 'cannot read rules.json (ENOENT)' } });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Expected alerts are not available: cannot read rules.json (ENOENT)',
    );
  });
});

describe('TimelineDock: the buttons', () => {
  it('injects or clears the timeline, and cannot while it is empty or busy', async () => {
    const onInject = vi.fn();
    const onClear = vi.fn();
    const { unmount } = renderDock({ onInject, onClear });
    await userEvent.click(screen.getByRole('button', { name: 'Inject timeline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onInject).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    unmount();

    renderDock({ anomalies: [], expected: null, summary: 'Nothing added yet' });
    expect(screen.getByRole('button', { name: 'Inject timeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByText(/Nothing on the timeline\./)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('is disabled while a send is going', () => {
    renderDock({ busy: true });
    expect(screen.getByRole('button', { name: 'Inject timeline' })).toBeDisabled();
  });

  it('shows a scenario read-only: no buttons to inject or clear, and its name in the header', () => {
    renderDock({ scenario: 'server-room-overheat', summary: '1 anomalies · 80 s' });
    expect(
      screen.getByText('Scenario server-room-overheat: 1 anomalies · 80 s'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inject timeline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});

describe('TimelineDock: 12 devices of 100, grouped by zone (frame 19)', () => {
  const fleet = labFleet(100, 20);
  // The first twelve server rooms: Z01 to Z12, one each, so make three zones of four by hand.
  const zones = ['Z01', 'Z02', 'Z03'];
  const devices = fleet.devices.map((d, i) =>
    i < 12 ? { ...d, zoneCode: zones[Math.floor(i / 4)] ?? d.zoneCode } : d,
  );
  const targets = devices.slice(0, 12);
  const anomalies = targets.map((d, i) =>
    anomaly({ deviceId: d.id, startAt: 20 + 2 * i, duration: 70 }),
  );
  const alerts = targets.map((d, i) => alert(d.id, 24 + 2 * i, 94 + 2 * i));

  it('draws one lane for each zone, a bar for each device, and one window for the alerts', () => {
    const { container } = renderDock({
      anomalies,
      devices,
      grouped: true,
      expected: { available: true, intervalS: 2, horizonS: 94, alerts, quiet: [], series: [] },
      summary: '12 anomalies · starts spread over 22 s',
    });
    const picture = screen.getByRole('img', { name: /12 anomalies on 12 devices in 3 groups/ });
    for (const zone of zones) expect(within(picture).getByText(zone)).toBeInTheDocument();
    expect(within(picture).getAllByText('4 devices · temperature_c')).toHaveLength(3);
    expect(
      container.querySelectorAll('rect:not([data-pending]):not([class*="rulerBg"])').length,
    ).toBeGreaterThan(12);
    expect(within(picture).getByText('up to 12 alerts · high')).toBeInTheDocument();
    expect(within(picture).getByText('raised 24–46 s · clear 94–116 s')).toBeInTheDocument();
    expect(screen.getByText('12 anomalies · starts spread over 22 s')).toBeInTheDocument();
  });
});

describe('TimelineDock: accessibility', () => {
  it('has no violation with a fault, a playhead, and when empty', async () => {
    const { container, unmount } = renderDock({ elapsedS: 30 });
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    const empty = renderDock({ anomalies: [], expected: null });
    expect(await axeViolations(empty.container)).toEqual([]);
  });
});
