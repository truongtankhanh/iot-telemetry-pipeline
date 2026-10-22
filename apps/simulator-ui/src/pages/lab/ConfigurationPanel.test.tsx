import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Anomaly, ExpectedAlert, StateView } from '../../api/types';
import { buildFleetRows } from '../../lib/fleetRows';
import { resolveTargets, type TargetScope } from '../../lib/labTargets';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import { ConfigurationPanel } from './ConfigurationPanel';
import { labFleet } from './labTestSupport';
import { useLabFault } from './useLabFault';

const NOW = Date.parse('2026-10-21T09:15:00.000Z');

interface HarnessProps {
  view: StateView;
  targets?: string[];
  busy?: boolean;
  expectedAlerts?: ExpectedAlert[] | null;
  onAdd?: (anomalies: Anomaly[]) => void;
  onInject?: (anomalies: Anomaly[]) => void;
}

/** The panel with the hook that feeds it, as the Lab holds them. */
function Harness({
  view,
  targets: initial = [],
  busy = false,
  expectedAlerts = null,
  onAdd = () => {},
  onInject = () => {},
}: HarnessProps) {
  const [scope, setScope] = useState<TargetScope>('device');
  const [targets, setTargets] = useState<string[]>(initial);
  const rows = useMemo(
    () => buildFleetRows({ view, now: NOW, seriesOf: () => [], lastSeenOf: () => null }),
    [view],
  );
  const reached = useMemo(
    () =>
      resolveTargets(
        rows.map((row) => row.device),
        scope,
        targets,
      ),
    [rows, scope, targets],
  );
  const { draft, patch, plan } = useLabFault(reached);
  return (
    <ConfigurationPanel
      rows={rows}
      scope={scope}
      targets={targets}
      reached={reached}
      onScope={(next) => {
        setScope(next);
        setTargets([]);
      }}
      onTargets={setTargets}
      draft={draft}
      plan={plan}
      onDraft={patch}
      expectedAlerts={expectedAlerts}
      busy={busy}
      onAdd={() => onAdd(plan.anomalies)}
      onInject={() => onInject(plan.anomalies)}
    />
  );
}

function renderPanel(props: HarnessProps) {
  const store = createStudioStore();
  store.getState().setView(structuredClone(props.view), 1);
  return render(
    <StudioProvider store={store}>
      <Harness {...props} />
    </StudioProvider>,
  );
}

const button = (name: string) => screen.getByRole('button', { name });

describe('ConfigurationPanel: nothing chosen', () => {
  it('cannot send, and says why', () => {
    renderPanel({ view: labFleet(6) });
    expect(button('Inject now')).toBeDisabled();
    expect(button('Add to timeline')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Choose at least one target');
    expect(screen.getByText('Choose a target to set the value.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Metric' })).not.toBeInTheDocument();
  });
});

describe('ConfigurationPanel: a device chosen', () => {
  it('starts from a value beyond the rule, shows the rule’s lines, and can send', async () => {
    const onInject = vi.fn();
    const onAdd = vi.fn();
    renderPanel({ view: labFleet(6), targets: ['d001'], onInject, onAdd });

    expect(screen.getByLabelText(/^Value in force/)).toHaveTextContent('29.2°C');
    expect(screen.getByText('raise 27 · clear 25.5')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Metric' })).toHaveValue('temperature_c');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(button('Inject now')).toBeEnabled();

    await userEvent.click(button('Inject now'));
    expect(onInject).toHaveBeenCalledWith([
      { deviceId: 'd001', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
    ]);
    await userEvent.click(button('Add to timeline'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('draws the nine tiles, lets only a breach be chosen, and says why on screen', () => {
    renderPanel({ view: labFleet(6), targets: ['d001'] });
    const tiles = within(screen.getByRole('radiogroup', { name: 'Fault type' })).getAllByRole(
      'radio',
    );
    expect(tiles).toHaveLength(9);
    expect(tiles.filter((tile) => !(tile as HTMLInputElement).disabled)).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Breach' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Drop' })).toBeDisabled();
    expect(screen.getByText(/The other faults come with SIM-12/)).toBeInTheDocument();
  });

  it('changes the value from the field and from the slider, and the shape', async () => {
    const onInject = vi.fn();
    renderPanel({ view: labFleet(6), targets: ['d001'], onInject });

    await userEvent.clear(screen.getByLabelText('Value'));
    await userEvent.type(screen.getByLabelText('Value'), '31.5');
    await userEvent.tab();
    expect(screen.getByLabelText(/^Value in force/)).toHaveTextContent('31.5°C');
    expect(screen.getByRole('slider', { name: 'Value slider' })).toHaveValue('31.5');

    fireEvent.change(screen.getByRole('slider', { name: 'Value slider' }), {
      target: { value: '33' },
    });
    expect(screen.getByLabelText(/^Value in force/)).toHaveTextContent('33.0°C');

    await userEvent.click(screen.getByRole('radio', { name: 'Ramp' }));
    await userEvent.click(button('Inject now'));
    expect(onInject.mock.calls[0]![0][0]).toMatchObject({ value: 33, shape: 'ramp' });
  });

  it('refuses a value outside the range at the field, in words, and does not let it be sent', async () => {
    renderPanel({ view: labFleet(6), targets: ['d001'] });
    await userEvent.clear(screen.getByLabelText('Value'));
    await userEvent.type(screen.getByLabelText('Value'), '99');

    expect(screen.getByLabelText('Value')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a value from -40 to 85 °C');
    expect(button('Inject now')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Enter a value from -40 to 85 °C');
  });

  it('refuses a duration of 0, and for a manual stop replaces it with the words that it lasts until removed', async () => {
    const onInject = vi.fn();
    renderPanel({ view: labFleet(6), targets: ['d001'], onInject });
    await userEvent.clear(screen.getByLabelText('Duration'));
    await userEvent.type(screen.getByLabelText('Duration'), '0');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Duration must be above 0 s and at most 3600 s',
    );
    expect(button('Inject now')).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument();
    expect(screen.getByText('Lasts until you remove it.')).toBeInTheDocument();
    await userEvent.click(button('Inject now'));
    expect(onInject.mock.calls[0]![0][0].duration).toBe(3600);
  });

  it('draws Alert clears but cannot be chosen, and says why', () => {
    renderPanel({ view: labFleet(6), targets: ['d001'] });
    expect(screen.getByRole('radio', { name: 'Alert clears' })).toBeDisabled();
    expect(
      screen.getByText(/Alert clears: An alert clears only after the fault has ended/),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Timed' })).toBeChecked();
  });

  it('is busy while a fault is being sent', () => {
    renderPanel({ view: labFleet(6), targets: ['d001'], busy: true });
    expect(button('Inject now')).toBeDisabled();
    expect(button('Add to timeline')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sending…');
  });
});

describe('ConfigurationPanel: several devices', () => {
  it('has a stagger only for more than one device, and says when the first and the last start', async () => {
    const onInject = vi.fn();
    const { unmount } = renderPanel({ view: labFleet(6), targets: ['d001'] });
    expect(screen.queryByLabelText('Stagger starts')).not.toBeInTheDocument();
    unmount();

    renderPanel({ view: labFleet(6), targets: ['d001', 'd002'], onInject });
    expect(screen.getByLabelText('Stagger starts')).toHaveValue('2');
    expect(screen.getByText('First device at 20 s, the last of 2 at 22 s.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Stagger starts'));
    await userEvent.type(screen.getByLabelText('Stagger starts'), '5');
    expect(screen.getByText('First device at 20 s, the last of 2 at 25 s.')).toBeInTheDocument();
    await userEvent.click(button('Inject now'));
    expect(onInject.mock.calls[0]![0].map((a: Anomaly) => a.startAt)).toEqual([20, 25]);
  });

  it('adds the simulator’s own times for the alerts when it has said', () => {
    const alert = (deviceId: string, opensAtS: number): ExpectedAlert => ({
      ruleId: 'server-room-hot',
      title: 't',
      severity: 'high',
      deviceId,
      metric: 'temperature_c',
      opensAtS,
      opensMargin: false,
      clearsAtS: 80,
      clearsUncertain: false,
    });
    renderPanel({
      view: labFleet(6),
      targets: ['d001', 'd002'],
      expectedAlerts: [alert('d001', 24), alert('d002', 26)],
    });
    expect(
      screen.getByText(
        'First device at 20 s, the last of 2 at 22 s. Alerts are expected from 24 s to 26 s.',
      ),
    ).toBeInTheDocument();
  });

  it('leaves out a device that does not report the metric, and says so', () => {
    renderPanel({ view: labFleet(10), targets: ['d001', 'd010'] });
    expect(
      screen.getByText(/d010 does not report temperature_c and is left out\./),
    ).toBeInTheDocument();
    expect(button('Inject now')).toBeEnabled();
  });

  it('is blocked by a fault already on the engine, and names the device', () => {
    const view = labFleet(6);
    view.engine.anomalies = [
      {
        id: 'a1',
        anomaly: { deviceId: 'd002', metric: 'temperature_c', value: 29, startAt: 5, duration: 60 },
      },
    ];
    renderPanel({ view, targets: ['d001', 'd002'] });
    expect(button('Inject now')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'd002 already has a fault on temperature_c until 55 s from now',
    );
  });
});

describe('ConfigurationPanel: accessibility', () => {
  it('has no violation, with a fault ready and with an error showing', async () => {
    const { container } = renderPanel({ view: labFleet(6), targets: ['d001', 'd002'] });
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.clear(screen.getByLabelText('Value'));
    await userEvent.type(screen.getByLabelText('Value'), '99');
    expect(await axeViolations(container)).toEqual([]);
  });
});
