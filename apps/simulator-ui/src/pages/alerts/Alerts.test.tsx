import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { StateView } from '../../api/types';
import { axeViolations } from '../../test-axe';
import {
  address,
  alertRow,
  manyAlerts,
  renderAlerts,
  type AlertsHarness,
} from './alertsTestSupport';

afterEach(() => vi.unstubAllGlobals());

const table = () => screen.findByRole('table', { name: 'Alerts, newest first' });
const bodyRows = (list: HTMLElement) => within(list).getAllByRole('row').slice(1);
const titles = (list: HTMLElement) =>
  bodyRows(list).map((row) => within(row).getAllByRole('cell')[2]?.textContent);

function viewWith(change: (view: StateView) => void): StateView {
  const view = structuredClone(stateViewFixture);
  change(view);
  return view;
}

/** A state whose live feed holds no alert, for the tests that give ingest a list of their own. */
const quiet = () =>
  viewWith((view) => {
    view.alerts.alerts = [];
  });
const firstTitle = () => titles(screen.getByRole('table'))[0];

/** Tell the store about a new alert, as the stream's `alerts` event would. */
const hearOfNewAlert = (harness: AlertsHarness, id = '99') =>
  act(() => {
    const feed = harness.store.getState().view!.alerts;
    harness.store
      .getState()
      .patchSlice('alerts', { ...feed, alerts: [{ ...feed.alerts[0]!, id }, ...feed.alerts] }, 1);
  });

describe('the page before there is a list', () => {
  it('waits for the first message of the simulator', () => {
    renderAlerts({ view: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for the first message from the simulator…')).toBeVisible();
  });

  it('says the simulator has not answered when the link is already lost', () => {
    renderAlerts({ view: null, link: 'lost' });
    expect(screen.getByText('The simulator has not answered yet.')).toBeVisible();
  });

  it('shows that it is loading until the first page arrives', async () => {
    renderAlerts();
    expect(screen.getByText('Loading alerts…')).toBeVisible();
    await table();
    expect(screen.queryByText('Loading alerts…')).not.toBeInTheDocument();
  });
});

describe('the list', () => {
  it('asks for the newest 25 and shows each alert’s severity, status and delivery in words', async () => {
    const { simulator } = renderAlerts();
    const list = await table();

    expect(simulator.alertCalls()).toEqual(['/api/alerts?limit=25']);
    const [first, second] = bodyRows(list);
    expect(within(first!).getByText('high')).toBeVisible();
    expect(within(first!).getByText('Server room temperature high')).toBeVisible();
    expect(within(first!).getByText('dc-env-01')).toBeVisible();
    expect(within(first!).getByText('Cleared')).toBeVisible();
    expect(within(first!).getByText(/Delivered · 1 attempt/)).toBeVisible();
    expect(within(second!).getByText('medium')).toBeVisible();
    expect(within(second!).getByText('Open')).toBeVisible();
    expect(within(second!).getByText('Skipped')).toBeVisible();
  });

  it('says so when no alert has been raised, and when none is open', async () => {
    const first = renderAlerts({ alerts: [] });
    await screen.findByText('No alert has been raised.');
    first.unmount();

    renderAlerts({ alerts: [], path: '/alerts?status=open' });
    await screen.findByText('No alert is open.');
    expect(screen.getByText('There is no alert to show.')).toBeVisible();
  });

  it('draws an alert of another day with its date, so it is not read as today’s', async () => {
    const old = alertRow({ id: '3', openedAt: '2026-01-02T03:04:05.000Z' });
    renderAlerts({ alerts: [old] });
    const list = await table();
    expect(within(list).getByText(/^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)).toBeVisible();
  });

  it('has no accessibility violation once it is loaded', async () => {
    const { container } = renderAlerts();
    await table();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the filters, which live in the address', () => {
  it('reads status, severity and size from the address', async () => {
    renderAlerts({
      view: quiet(),
      path: '/alerts?status=open&severity=high&size=10',
      alerts: manyAlerts(3),
    });
    await table();
    expect(screen.getByRole('radio', { name: 'Open' })).toBeChecked();
    expect(screen.getByLabelText('Severity')).toHaveValue('high');
    expect(screen.getByLabelText('Alerts per page')).toHaveValue('10');
  });

  it('asks ingest for open alerts only when Open is chosen, and writes it in the address', async () => {
    const user = userEvent.setup();
    const { simulator } = renderAlerts();
    await table();

    await user.click(screen.getByRole('radio', { name: 'Open' }));

    await waitFor(() =>
      expect(simulator.alertCalls().at(-1)).toBe('/api/alerts?status=open&limit=25'),
    );
    expect(address()).toBe('/alerts?status=open');
  });

  it('changes the page size and asks again for that many', async () => {
    const user = userEvent.setup();
    const { simulator } = renderAlerts({ view: quiet(), alerts: manyAlerts(30) });
    await table();

    await user.selectOptions(screen.getByLabelText('Alerts per page'), '10');

    await waitFor(() => expect(simulator.alertCalls().at(-1)).toBe('/api/alerts?limit=10'));
    expect(address()).toBe('/alerts?size=10');
  });

  it('hides the rows that miss the severity and says how many it hides, since ingest cannot filter', async () => {
    const { simulator } = renderAlerts({
      view: quiet(),
      path: '/alerts?severity=high',
      alerts: manyAlerts(6),
    });
    const list = await table();

    expect(titles(list)).toEqual(['Alert number 6', 'Alert number 2']);
    expect(screen.getByText('Filtering this page: 2 of 6 shown.')).toBeVisible();
    // The request is the same: ingest has no severity parameter.
    expect(simulator.alertCalls()).toEqual(['/api/alerts?limit=25']);
  });

  it('offers a way out when the severity hides every row of the page', async () => {
    const user = userEvent.setup();
    renderAlerts({
      view: quiet(),
      path: '/alerts?severity=critical',
      alerts: [alertRow({ severity: 'low' })],
    });
    await screen.findByText('No alert on this page has the severity critical.');

    await user.click(screen.getByRole('button', { name: 'Show all severities' }));

    expect(address()).toBe('/alerts');
    expect(await table()).toBeInTheDocument();
  });
});

describe('paging by cursor', () => {
  const pageOf5 = { view: quiet(), path: '/alerts?size=5', alerts: manyAlerts(12) };

  it('goes older with the cursor ingest gave, and newer back, with no page numbers', async () => {
    const user = userEvent.setup();
    const { simulator } = renderAlerts(pageOf5);
    const list = await table();

    expect(titles(list)).toEqual(['12', '11', '10', '9', '8'].map((n) => `Alert number ${n}`));
    expect(screen.getByText('Showing 5 alerts · newest first')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() =>
      expect(titles(screen.getByRole('table'))).toEqual(
        ['7', '6', '5', '4', '3'].map((n) => `Alert number ${n}`),
      ),
    );
    // The cursor in the request is the one the fake ingest issued; it refuses any other.
    expect(simulator.alertCalls()).toEqual([
      '/api/alerts?limit=5',
      '/api/alerts?limit=5&before=cur-all-5',
    ]);
    expect(screen.getByText('Showing 5 alerts · older alerts, newest first')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Newer' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Newer' }));
    await waitFor(() => expect(titles(screen.getByRole('table'))[0]).toBe('Alert number 12'));
    expect(screen.queryByText(/page \d|of \d+ pages/i)).not.toBeInTheDocument();
  });

  it('has no Older on the last page', async () => {
    const user = userEvent.setup();
    renderAlerts(pageOf5);
    await table();
    await user.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(firstTitle()).toBe('Alert number 7'));
    await user.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(firstTitle()).toBe('Alert number 2'));
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();
    expect(screen.getByText('Showing 2 alerts · older alerts, newest first')).toBeVisible();
  });

  it('keeps the cursor out of the address: a reload opens the newest alerts', async () => {
    const user = userEvent.setup();
    renderAlerts(pageOf5);
    await table();
    await user.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(firstTitle()).toBe('Alert number 7'));
    expect(address()).toBe('/alerts?size=5');
  });

  it('starts again at the newest alerts when the filter changes', async () => {
    const user = userEvent.setup();
    const { simulator } = renderAlerts(pageOf5);
    await table();
    await user.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(firstTitle()).toBe('Alert number 7'));

    await user.click(screen.getByRole('radio', { name: 'Open' }));

    await waitFor(() =>
      expect(simulator.alertCalls().at(-1)).toBe('/api/alerts?status=open&limit=5'),
    );
  });
});

describe('the chosen alert', () => {
  it('shows the newest alert’s detail until another is chosen, and does not write that in the address', async () => {
    renderAlerts();
    await table();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Server room temperature high' }),
    ).toBeVisible();
    expect(address()).toBe('/alerts');
  });

  it('opens the alert of a row from the keyboard and writes it in the address', async () => {
    const user = userEvent.setup();
    renderAlerts();
    const list = await table();
    const row = bodyRows(list)[1]!;

    row.focus();
    await user.keyboard('{Enter}');

    expect(address()).toBe('/alerts?alert=6');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Poor air quality (CO₂)' }),
    ).toBeVisible();
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('opens the alert named in the address, as the palette links it', async () => {
    renderAlerts({ path: '/alerts?alert=6' });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Poor air quality (CO₂)' }),
    ).toBeVisible();
  });

  it('says so, and offers to dismiss, when no alert has the id in the address', async () => {
    const user = userEvent.setup();
    renderAlerts({ path: '/alerts?alert=999' });
    await screen.findByText(/No alert/);
    expect(screen.getByText(/#999/)).toBeVisible();
    expect(
      screen.getByText('Choose an alert in the list to see why it was raised and where it went.'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(address()).toBe('/alerts');
  });

  it('draws an alert that is only in the live feed from there, saying its row is not on this page', async () => {
    const feed = viewWith((view) => {
      view.alerts.alerts = [{ ...view.alerts.alerts[0]!, id: '2', title: 'Only in the feed' }];
    });
    renderAlerts({ view: feed, path: '/alerts?size=5&alert=2', alerts: manyAlerts(12) });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Only in the feed' }),
    ).toBeVisible();
    expect(screen.getByText(/not on the page shown/)).toBeVisible();
    expect(screen.queryByText(/Injected by the scenario/)).not.toBeInTheDocument();
  });

  it('leaves the chosen alert behind when the page is turned, and shows the newest one on the new page', async () => {
    const user = userEvent.setup();
    renderAlerts({ view: quiet(), path: '/alerts?size=5&alert=10', alerts: manyAlerts(12) });
    await table();
    await user.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(firstTitle()).toBe('Alert number 7'));
    expect(address()).toBe('/alerts?size=5');
    expect(screen.getByRole('heading', { level: 2, name: 'Alert number 7' })).toBeVisible();
  });
});

describe('what the store hears after the page was fetched', () => {
  it('puts a delivery that happened after the page was fetched onto its row', async () => {
    const harness = renderAlerts({ view: quiet(), alerts: manyAlerts(3) });
    const list = await table();
    expect(within(bodyRows(list)[0]!).getByText(/^Pending/)).toBeVisible();

    act(() => {
      const feed = harness.store.getState().view!.alerts;
      const seen = '2026-10-20T08:00:30.000Z';
      harness.store.getState().patchSlice(
        'alerts',
        {
          ...feed,
          alerts: [
            {
              ...alertRow({
                id: '3',
                preexisting: false,
                deliveryStatus: 'delivered',
                deliveryAttempts: 1,
                externalRef: 'inc-3',
                observed: {
                  openedAt: seen,
                  clearedAt: null,
                  delivered: { opened: seen, cleared: null },
                  incident: seen,
                },
              }),
            },
          ],
        },
        2,
      );
    });

    await waitFor(() =>
      expect(
        within(bodyRows(screen.getByRole('table'))[0]!).getByText(/Delivered · 1 attempt/),
      ).toBeVisible(),
    );
  });

  it('asks for the newest page again when a new alert arrives', async () => {
    const harness = renderAlerts();
    await table();
    expect(harness.simulator.alertCalls()).toHaveLength(1);
    hearOfNewAlert(harness);
    await waitFor(() => expect(harness.simulator.alertCalls()).toHaveLength(2));
  });
});

describe('when something is wrong', () => {
  it('keeps the list on show, says why it could not be read, and asks again on request', async () => {
    const user = userEvent.setup();
    const harness = renderAlerts();
    await table();

    harness.simulator.failWith({ status: 502, message: 'ECONNREFUSED' });
    hearOfNewAlert(harness);
    const failure = await screen.findByRole('alert');
    expect(failure).toHaveTextContent('The alerts could not be read.');
    expect(failure).toHaveTextContent('ECONNREFUSED');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);

    harness.simulator.failWith(null);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument());
  });

  it('offers the way back to the newest alerts when a cursor is refused', async () => {
    const user = userEvent.setup();
    const harness = renderAlerts({ view: quiet(), path: '/alerts?size=5', alerts: manyAlerts(12) });
    await table();

    harness.simulator.failWith({ status: 400, message: 'bad cursor' });
    await user.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('bad cursor');

    harness.simulator.failWith(null);
    await user.click(screen.getByRole('button', { name: 'Back to the newest alerts' }));
    await waitFor(() => expect(titles(screen.getByRole('table'))[0]).toBe('Alert number 12'));
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
  });

  it('says ingest is unreachable and dims the list, which is the last thing it said', async () => {
    const view = viewWith((v) => {
      v.ingest = { ...v.ingest, status: 'unreachable', detail: 'ECONNREFUSED' };
    });
    const { container } = renderAlerts({ view });
    await table();
    expect(screen.getByRole('alert')).toHaveTextContent('Ingest is unreachable');
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
    expect(screen.getByText(/^As of /)).toBeVisible();
  });

  it('says there is no alert sink, so a Skipped delivery is explained', async () => {
    const view = viewWith((v) => {
      v.ingest = { ...v.ingest, alertSink: 'none' };
    });
    renderAlerts({ view });
    await table();
    expect(screen.getByText(/No alert sink\./)).toBeVisible();
  });

  it('dims the list and says when the link was lost', async () => {
    const { container } = renderAlerts({ link: 'lost' });
    await table();
    expect(screen.getByText(/^Lost at /)).toBeVisible();
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
  });
});
