import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { PagedAlert, RulesView } from '../../api/types';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { axeViolations } from '../../test-axe';
import { AlertDetail } from './AlertDetail';
import { alertRow, fixtureAlerts } from './alertsTestSupport';

interface Options {
  rules?: RulesView;
  consoleUrl?: string | null;
  notOnPage?: boolean;
}

function renderDetail(alert: PagedAlert, options: Options = {}) {
  return render(
    <StudioProvider store={createStudioStore()}>
      <MemoryRouter>
        <AlertDetail
          alert={alert}
          rules={options.rules ?? stateViewFixture.rules}
          consoleUrl={options.consoleUrl ?? null}
          notOnPage={options.notOnPage ?? false}
        />
      </MemoryRouter>
    </StudioProvider>,
  );
}

const trail = () => within(screen.getByRole('list', { name: 'Delivery trail' }));
const stepTitles = () =>
  trail()
    .getAllByRole('listitem')
    .map((item) => item.querySelector('span')?.nextElementSibling?.firstElementChild?.textContent);

/** An alert whose opening was delivered, with an incident, as Studio saw it. */
const delivered = (overrides: Partial<PagedAlert> = {}) =>
  alertRow({
    deliveryStatus: 'delivered',
    deliveryAttempts: 1,
    externalRef: 'c3a1f0d2-5b7e',
    preexisting: false,
    observed: {
      openedAt: '2026-10-20T08:00:27.100Z',
      clearedAt: null,
      delivered: { opened: '2026-10-20T08:00:28.300Z', cleared: null },
      incident: '2026-10-20T08:00:28.300Z',
    },
    ...overrides,
  });

describe('why the alert was raised', () => {
  it('says the rule’s line and what ingest stored when Studio did not record the readings', () => {
    renderDetail(alertRow());
    expect(
      screen.getByText(/dc-env-01 temperature_c was above 27 °C for 3 readings in a row/),
    ).toBeVisible();
    expect(screen.getByText(/It opened at 29.3 °C/)).toBeVisible();
  });

  it('names the scenario Studio started when the simulator says one caused the alert', () => {
    renderDetail(
      alertRow({
        cause: { scenario: 'server-room-overheat', startedAt: '2026-10-20T08:00:00.000Z' },
      }),
    );
    expect(
      screen.getByText('Injected by the scenario server-room-overheat started in Studio.'),
    ).toBeVisible();
  });

  it('says nothing about a scenario for an alert raised by anything else', () => {
    renderDetail(alertRow({ cause: null }));
    expect(screen.queryByText(/scenario/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Injected/)).not.toBeInTheDocument();
  });

  it('still explains an alert whose rule Studio does not have', () => {
    renderDetail(alertRow({ ruleId: 'ghost-rule' }));
    expect(screen.getByText(/Rule ghost-rule raised it on dc-env-01/)).toBeVisible();
  });

  it('says its row is not on the page shown only when it is not', () => {
    const { unmount } = renderDetail(alertRow(), { notOnPage: true });
    expect(screen.getByText(/not on the page shown/)).toBeVisible();
    unmount();
    renderDetail(alertRow(), { notOnPage: false });
    expect(screen.queryByText(/not on the page shown/)).not.toBeInTheDocument();
  });
});

describe('the delivery trail', () => {
  it('goes from the rule to the incident for a delivered alert, with whose clock each time is', () => {
    renderDetail(delivered());
    expect(stepTitles()).toEqual([
      'Rule raised',
      'Alert opened',
      'Outbox delivered',
      'Incident in Command Center',
    ]);
    const items = trail().getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('ingest');
    expect(items[2]).toHaveTextContent('observed');
    expect(items[3]).toHaveTextContent('c3a1f0d2-5b7e');
    expect(within(items[2]!).getByText(/\d{2}:\d{2}:\d{2}/).tagName).toBe('TIME');
  });

  it('says what the times mean, and why the first breaching reading is missing', () => {
    renderDetail(delivered());
    expect(screen.getByText(/first saw the state change.*no delivery timestamp/)).toBeVisible();
    expect(screen.getByText(/first breaching reading is not shown/)).toBeVisible();
  });

  it('shows pending as a warning with no incident', () => {
    renderDetail(alertRow({ deliveryStatus: 'pending', deliveryAttempts: 2 }));
    expect(stepTitles()).toContain('Outbox pending');
    expect(stepTitles()).not.toContain('Incident in Command Center');
    expect(trail().getByText(/2 attempts · not delivered yet/)).toBeVisible();
  });

  it('shows a failed delivery with ingest’s error as text, and no incident', () => {
    renderDetail(
      alertRow({
        deliveryStatus: 'failed',
        deliveryAttempts: 5,
        deliveryError: 'HTTP 502 <b>x</b>',
      }),
    );
    expect(stepTitles()).toContain('Outbox delivery failed');
    // Text, never markup: an error that looks like HTML is shown as it is.
    expect(trail().getByText('5 attempts · HTTP 502 <b>x</b>')).toBeVisible();
    expect(stepTitles()).not.toContain('Incident in Command Center');
  });

  it('shows skipped, naming the setting, and an unknown status as unknown, never as delivered', () => {
    const { unmount } = renderDetail(alertRow({ deliveryStatus: 'skipped', deliveryAttempts: 0 }));
    expect(stepTitles()).toContain('Delivery skipped');
    expect(trail().getByText(/OCC_API_URL unset on ingest/)).toBeVisible();
    unmount();

    renderDetail(alertRow({ deliveryStatus: 'quarantined' }));
    expect(stepTitles()).toContain('Delivery unknown');
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument();
  });

  it('adds the clearing and its delivery to a cleared alert, and says what the list’s chip means', () => {
    const [cleared] = fixtureAlerts();
    renderDetail(cleared!);
    expect(stepTitles()).toEqual([
      'Rule raised',
      'Alert opened',
      'Outbox delivered',
      'Incident in Command Center',
      'Alert cleared',
      'Clear delivered',
    ]);
    expect(
      screen.getByText(/latest outbox event, which for a cleared alert is the clearing/),
    ).toBeVisible();
    expect(screen.getByText('Cleared')).toBeVisible();
  });
});

describe('the incident', () => {
  it('links to the console when one is set, opening a new tab, and names the incident by its id', () => {
    renderDetail(delivered(), { consoleUrl: 'http://localhost:5173' });
    const link = screen.getByRole('link', { name: /Open command center/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('localhost:5173'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(link).toHaveAccessibleName(/opens in a new tab/);
    expect(screen.getAllByText('c3a1f0d2-5b7e').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Copy the incident id' })).toBeVisible();
  });

  it('is the plain id, with no link, when no console is set', () => {
    renderDetail(delivered(), { consoleUrl: null });
    expect(screen.queryByRole('link', { name: /Open command center/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('c3a1f0d2-5b7e').length).toBeGreaterThan(0);
  });

  it('never puts a console URL that is not http or https in a link', () => {
    renderDetail(delivered(), { consoleUrl: 'javascript:alert(1)' });
    expect(screen.queryByRole('link', { name: /Open command center/ })).not.toBeInTheDocument();
  });

  it('has no incident, id or link for an alert that has none', () => {
    renderDetail(alertRow({ externalRef: null }), { consoleUrl: 'http://localhost:5173' });
    expect(screen.queryByRole('link', { name: /Open command center/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Incident /)).not.toBeInTheDocument();
  });
});

describe('what can be done with an alert', () => {
  it('shows it in the topology, with the device id encoded', () => {
    renderDetail(alertRow({ deviceId: 'a b/c' }));
    expect(screen.getByRole('link', { name: 'Show in topology' })).toHaveAttribute(
      'href',
      '/topology?device=a%20b%2Fc',
    );
  });

  it('copies the alert as ingest returned it, and nothing Studio added', async () => {
    const user = userEvent.setup();
    renderDetail(delivered({ cause: { scenario: 'x', startedAt: '2026-10-20T08:00:00.000Z' } }));

    await user.click(screen.getByRole('button', { name: 'Copy as JSON' }));

    const copied = JSON.parse(await navigator.clipboard.readText()) as Record<string, unknown>;
    expect(copied.id).toBe('1');
    expect(copied.externalRef).toBe('c3a1f0d2-5b7e');
    expect(Object.keys(copied)).not.toContain('observed');
    expect(Object.keys(copied)).not.toContain('preexisting');
    expect(Object.keys(copied)).not.toContain('cause');
    expect(screen.getByText('Copied the alert as JSON')).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violation for a delivered alert with an incident and a console', async () => {
    const { container } = renderDetail(delivered(), { consoleUrl: 'http://localhost:5173' });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('has no violation for a failed one', async () => {
    const { container } = renderDetail(
      alertRow({ deliveryStatus: 'failed', deliveryAttempts: 1, deliveryError: 'boom' }),
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
