import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromAnomalies } from '../../lib/timelineEditor';
import { EditorDrafts } from '../../state/editorDrafts';
import { axeViolations } from '../../test-axe';
import { renderTimeline } from './timelineTestSupport';

afterEach(() => vi.unstubAllGlobals());

const location = () => screen.getByTestId('location').textContent ?? '';
const button = (name: string | RegExp) => screen.getByRole('button', { name });

/** The blocks of `bad-afternoon`: three anomalies on three signals. */
const hot = /^dc-env-01 temperature_c 29\.2 °C from 30 s for 60 s/;
const blocks = () =>
  screen.queryAllByRole('button', { name: /from \d+(\.\d)? s for \d+(\.\d)? s/ });

const open = (options = {}) =>
  renderTimeline({ path: '/lab/timeline?scenario=bad-afternoon', ...options });

describe('Timeline: states', () => {
  it('waits for the first message from the simulator', () => {
    renderTimeline({ view: null });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waiting for the first message from the simulator…',
    );
  });

  it('says why the scenarios could not be read, and reads again on request', async () => {
    const user = userEvent.setup();
    const { simulator } = open({ libraryFailure: { status: 502, message: 'ingest is down' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('ingest is down');
    await user.click(button('Try again'));
    await waitFor(() =>
      expect(simulator.callsTo('GET', '/api/scenarios').length).toBeGreaterThan(1),
    );
  });

  it('opens a new scenario at once, empty, with a field for its name', async () => {
    renderTimeline();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'New scenario' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(
      screen.getByText('Nothing on the timeline yet. Choose Add anomaly, or press A.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(button('Save')).toBeDisabled();
    expect(button('Run now')).toBeDisabled();
  });

  it('says why a built-in is not opened for editing, and opens a new scenario', async () => {
    renderTimeline({ path: '/lab/timeline?scenario=server-room-overheat' });
    expect(
      await screen.findByText(/is a built-in scenario and cannot be changed/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'New scenario' })).toBeInTheDocument();
  });
});

describe('Timeline: building a scenario', () => {
  it('adds an anomaly, names the scenario, saves it, and the address points at it', async () => {
    const user = userEvent.setup();
    const { simulator } = renderTimeline();
    await user.click(await screen.findByRole('button', { name: 'Add anomaly' }));
    expect(
      await screen.findByRole('button', {
        name: /^dc-env-01 temperature_c 29\.2 °C from 0 s for 30 s/,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Anomaly 1' })).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'fresh');
    await user.click(button('Save'));

    expect(await screen.findByText('Saved fresh.')).toBeInTheDocument();
    const [put] = simulator.callsTo('PUT', '/api/scenarios/fresh');
    expect(put?.body).toEqual({
      name: 'fresh',
      description: '',
      anomalies: [
        { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 0, duration: 30 },
      ],
    });
    expect(location()).toBe('/lab/timeline?scenario=fresh');
    expect(screen.getByRole('heading', { level: 1, name: 'fresh' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('tells the expected alerts for what is on the timeline', async () => {
    const user = userEvent.setup();
    renderTimeline();
    await user.click(await screen.findByRole('button', { name: 'Add anomaly' }));
    const card = (await screen.findByRole('heading', { name: 'Expected alerts' })).closest(
      'section',
    )!;
    expect(await within(card).findByRole('table')).toBeInTheDocument();
    expect(within(card).getByText('server-room-hot')).toBeInTheDocument();
    expect(within(card).getByText('about 4 s')).toBeInTheDocument();
  });

  it('opens a copy of a built-in under a new name, unsaved, and saves it as a file', async () => {
    const user = userEvent.setup();
    const { simulator } = renderTimeline({
      path: '/lab/timeline?duplicate=server-room-overheat',
    });
    expect(await screen.findByLabelText('Name')).toHaveValue('server-room-overheat-copy');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(button('Save'));

    expect(await screen.findByText('Saved server-room-overheat-copy.')).toBeInTheDocument();
    expect(simulator.callsTo('PUT', '/api/scenarios/server-room-overheat-copy')).toHaveLength(1);
    expect(location()).toBe('/lab/timeline?scenario=server-room-overheat-copy');
  });

  it('keeps the work when the page is left and opened again', async () => {
    const user = userEvent.setup();
    const drafts = new EditorDrafts();
    const first = renderTimeline({ drafts });
    await user.click(await first.findByRole('button', { name: 'Add anomaly' }));
    await user.type(first.getByLabelText('Name'), 'later');
    first.unmount();

    renderTimeline({ drafts });
    expect(await screen.findByLabelText('Name')).toHaveValue('later');
    expect(blocks()).toHaveLength(1);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('opens what the Lab handed over, as an unnamed scenario that is not saved', async () => {
    const drafts = new EditorDrafts();
    drafts.set('new', {
      doc: fromAnomalies([
        { deviceId: 'dc-env-02', metric: 'temperature_c', value: 30, startAt: 5, duration: 20 },
      ]),
      base: null,
    });
    renderTimeline({ drafts });
    expect(await screen.findByLabelText('Name')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: /^dc-env-02 temperature_c 30 °C from 5 s for 20 s/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(button('Save')).toBeDisabled(); // it has no name yet
  });
});

describe('Timeline: a saved scenario', () => {
  it('shows it as it is saved, with nothing to save', async () => {
    open();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'bad-afternoon' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(button('Save')).toBeDisabled();
    expect(button('Discard')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toHaveValue(
      'Three things go wrong, one after another.',
    );
  });

  it('edits a value in the inspector, marks it changed, and saves it in place', async () => {
    const user = userEvent.setup();
    const { simulator } = open();
    await user.click(await screen.findByRole('button', { name: hot }));
    expect(await screen.findByRole('heading', { name: 'Anomaly 2' })).toBeInTheDocument();

    const value = screen.getByLabelText('Value');
    await user.clear(value);
    await user.type(value, '31');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(button('Save'));
    expect(await screen.findByText('Saved bad-afternoon.')).toBeInTheDocument();
    const [put] = simulator.callsTo('PUT', '/api/scenarios/bad-afternoon');
    expect((put?.body as { anomalies: { value: number }[] }).anomalies[1]?.value).toBe(31);
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('puts the scenario back as it was saved on Discard', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: hot }));
    await user.click(button('Remove anomaly 2'));
    expect(blocks()).toHaveLength(2);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(button('Discard'));
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('says what the simulator said when it refuses the save, and keeps the change', async () => {
    const user = userEvent.setup();
    const { simulator } = open();
    simulator.failSave({
      status: 500,
      message: 'cannot write bad-afternoon.json in the scenarios folder (EROFS)',
    });
    await user.click(await screen.findByRole('button', { name: hot }));
    await user.click(button('Remove anomaly 2'));

    await user.click(button('Save'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'cannot write bad-afternoon.json in the scenarios folder (EROFS)',
    );
    expect(blocks()).toHaveLength(2);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('runs it: saves the change first, then runs, and then offers Stop and no save', async () => {
    const user = userEvent.setup();
    const { simulator } = open();
    await user.click(await screen.findByRole('button', { name: hot }));
    await user.click(button('Remove anomaly 2'));

    await user.click(button('Run now'));

    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    const order = simulator.calls
      .filter((c) => c.method !== 'GET' && c.path !== '/api/expectations')
      .map((c) => `${c.method} ${c.path}`);
    expect(order.slice(0, 2)).toEqual([
      'PUT /api/scenarios/bad-afternoon',
      'POST /api/scenarios/bad-afternoon/run',
    ]);
    expect(button('Save')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeInTheDocument();
  });

  it('asks before it deletes, and goes back to a new scenario once it is deleted', async () => {
    const user = userEvent.setup();
    const { simulator } = open();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete bad-afternoon?' });
    expect(simulator.callsTo('DELETE', '/api/scenarios/bad-afternoon')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Deleted bad-afternoon.')).toBeInTheDocument();
    expect(simulator.callsTo('DELETE', '/api/scenarios/bad-afternoon')).toHaveLength(1);
    expect(location()).toBe('/lab/timeline');
    expect(screen.getByRole('heading', { level: 1, name: 'New scenario' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('changes nothing when the delete is cancelled', async () => {
    const user = userEvent.setup();
    const { simulator } = open();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(simulator.callsTo('DELETE', '/api/scenarios/bad-afternoon')).toEqual([]);
  });

  it('has no accessibility violation with a block selected', async () => {
    const user = userEvent.setup();
    const { container } = open();
    await user.click(await screen.findByRole('button', { name: hot }));
    await screen.findByRole('heading', { name: 'Anomaly 2' });
    expect(await axeViolations(container)).toEqual([]);
  });
});
