import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { ObservationEvent, ObservedAlert, StateView } from '../../api/types';
import type { LabCommand, LogFilter } from '../../lib/labLog';
import { ObservationLog } from '../../state/observationLog';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import { Inspector } from './Inspector';
import { labFleet } from './labTestSupport';

const at = (second: number) => new Date(Date.UTC(2026, 9, 21, 9, 14, second)).toISOString();

const alertOpened = (id: number, alertId: number, second: number): ObservationEvent => ({
  id,
  at: at(second),
  kind: 'alert-opened',
  data: {
    alertId: String(alertId),
    deviceId: `d00${(alertId % 3) + 1}`,
    ruleId: 'server-room-hot',
    severity: 'high',
    title: 'Hot',
  },
});

const command = (
  id: string,
  second: number,
  text = 'Injected a breach on 3 devices',
): LabCommand => ({
  id,
  at: Date.parse(at(second)),
  kind: 'inject',
  text,
  devices: ['d001'],
});

/** The fixture's open alert, moved onto `d001`, the first server room of the fleet. */
const alertOn = (deviceId: string): ObservedAlert => ({
  ...structuredClone(stateViewFixture.alerts.alerts[0]!),
  deviceId,
  metric: 'temperature_c',
  ruleId: 'server-room-hot',
});

interface HarnessProps {
  view?: StateView;
  events?: ObservationEvent[];
  commands?: LabCommand[];
  targetIds?: string[];
  startPage?: number;
}

function Harness({ commands = [], targetIds = [], startPage = 1 }: HarnessProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [page, setPage] = useState(startPage);
  return (
    <Inspector
      commands={commands}
      logFilter={filter}
      logPage={page}
      onLogFilter={(next) => {
        setFilter(next);
        setPage(1);
      }}
      onLogPage={setPage}
      targetIds={targetIds}
    />
  );
}

function renderInspector(props: HarnessProps = {}) {
  const store = createStudioStore();
  store.getState().setView(structuredClone(props.view ?? labFleet(6)), 1);
  const observations = new ObservationLog({ notifyEveryMs: 0 });
  observations.seed(props.events ?? []);
  return render(
    <StudioProvider store={store} observations={observations}>
      <Harness {...props} />
    </StudioProvider>,
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Inspector: the log', () => {
  it('says nothing has happened yet', () => {
    renderInspector();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing has happened yet. Inject a fault, and what it does appears here.',
    );
    expect(tab('Log')).toHaveAttribute('aria-selected', 'true');
  });

  it('lists what the simulator saw and what this page sent, newest first, with the time', () => {
    renderInspector({
      events: [alertOpened(1, 7, 10), alertOpened(2, 8, 20)],
      commands: [command('c1', 15)],
    });
    const rows = within(screen.getByRole('list', { name: 'Execution log' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('#8 opened · high'),
      expect.stringContaining('Injected a breach on 3 devices'),
      expect.stringContaining('#7 opened · high'),
    ]);
    expect(within(rows[0]!).getByText(/^\d\d:\d\d:\d\d$/)).toBeInTheDocument();
  });

  it('counts All, Alerts and Faults, and filters', async () => {
    renderInspector({ events: [alertOpened(1, 7, 10)], commands: [command('c1', 15)] });
    expect(screen.getByRole('radio', { name: 'All 2' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Alerts 1' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Faults 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Alerts 1' }));
    const list = screen.getByRole('list', { name: 'Execution log' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).queryByText(/Injected a breach/)).not.toBeInTheDocument();
  });

  it('folds a long run of alerts, and opens it', async () => {
    const events = Array.from({ length: 9 }, (_, i) => alertOpened(i + 1, i + 7, i + 1));
    renderInspector({ events });
    const fold = screen.getByRole('button', { name: '7 more alerts, #7 to #13 · Show' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    await userEvent.click(fold);
    expect(screen.queryByRole('button', { name: /more alerts/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(3);
  });

  it('pages the log and says which rows are on show', async () => {
    // Alerts and commands alternate, so no run of alike rows folds.
    const events = [11, 13, 15, 17].map((second, i) => alertOpened(i + 1, i + 7, second));
    const commands = [10, 12, 14, 16].map((second) =>
      command(`c${second}`, second, `Command ${second}`),
    );
    renderInspector({ events, commands });
    expect(screen.getByText('Log 1–5 of 8')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Log pages' })).getByRole('button', {
        name: /2/,
      }),
    );
    expect(screen.getByText('Log 6–8 of 8')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('Inspector: one target at a time', () => {
  it('asks for a target in the Rules and the Trace tabs while none is chosen', async () => {
    renderInspector();
    await userEvent.click(tab('Rules'));
    expect(screen.getByText('No target chosen')).toBeInTheDocument();
    expect(
      screen.getByText('Choose a target to see the rule that watches it.'),
    ).toBeInTheDocument();
    await userEvent.click(tab('Trace'));
    expect(screen.getByText('Choose a target to follow its alert.')).toBeInTheDocument();
  });

  it('names the target and its place, and steps through them with the arrows, stopping at the ends', async () => {
    renderInspector({ targetIds: ['d001', 'd002', 'd003'] });
    await userEvent.click(tab('Rules'));
    const stepper = screen.getByRole('group', { name: 'Target' });
    expect(within(stepper).getByText('d001')).toBeInTheDocument();
    expect(within(stepper).getByText('1 of 3')).toBeInTheDocument();
    expect(within(stepper).getByRole('button', { name: 'Previous target' })).toBeDisabled();

    await userEvent.click(within(stepper).getByRole('button', { name: 'Next target' }));
    expect(within(stepper).getByText('d002')).toBeInTheDocument();
    expect(within(stepper).getByText('2 of 3')).toBeInTheDocument();
    await userEvent.click(within(stepper).getByRole('button', { name: 'Next target' }));
    expect(within(stepper).getByText('3 of 3')).toBeInTheDocument();
    expect(within(stepper).getByRole('button', { name: 'Next target' })).toBeDisabled();
  });

  it('shows the rule that watches the target and what it did', async () => {
    renderInspector({ targetIds: ['d001'] });
    await userEvent.click(tab('Rules'));
    const card = screen.getByRole('region', { name: 'Rule evaluation' });
    expect(within(card).getByText('server-room-hot')).toBeInTheDocument();
    expect(within(card).getByText('not raised')).toBeInTheDocument();
  });

  it('says no rule watches a device when the rules cannot be used', async () => {
    const view = labFleet(6);
    view.rules = { available: false, reason: 'cannot read rules.json', items: [] };
    renderInspector({ view, targetIds: ['d001'] });
    await userEvent.click(tab('Rules'));
    expect(screen.getByText('No rule watches this device.')).toBeInTheDocument();
  });

  it('follows the alert of the target in the Trace tab, and says when there is none', async () => {
    const view = labFleet(6);
    view.alerts = { ...view.alerts, alerts: [alertOn('d001')] };
    renderInspector({ view, targetIds: ['d001', 'd002'] });
    await userEvent.click(tab('Trace'));
    expect(screen.getByText(/Alert #7/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Delivery trail' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next target' }));
    expect(
      screen.getByText('No alert has opened on d002 yet. The trace appears when one does.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Delivery trail' })).not.toBeInTheDocument();
  });

  it('has no step that Studio cannot time as a duration: a delivery says when it was seen, or that it is not known', async () => {
    const view = labFleet(6);
    view.alerts = { ...view.alerts, alerts: [alertOn('d001')] };
    renderInspector({ view, targetIds: ['d001'] });
    await userEvent.click(tab('Trace'));
    const trail = screen.getByRole('list', { name: 'Delivery trail' });
    expect(within(trail).queryByText(/Broker ack/)).not.toBeInTheDocument();
    expect(within(trail).queryByText(/\d+ ms/)).not.toBeInTheDocument();
  });
});

describe('Inspector: accessibility', () => {
  it('has no violation on any tab', async () => {
    const view = labFleet(6);
    view.alerts = { ...view.alerts, alerts: [alertOn('d001')] };
    const { container } = renderInspector({
      view,
      events: [alertOpened(1, 7, 10)],
      commands: [command('c1', 15)],
      targetIds: ['d001', 'd002'],
    });
    expect(await axeViolations(container)).toEqual([]);
    for (const name of ['Rules', 'Trace']) {
      await userEvent.click(tab(name));
      expect(await axeViolations(container)).toEqual([]);
    }
  });
});
