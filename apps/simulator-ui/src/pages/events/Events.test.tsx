import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runningBenchmark } from '../../state/benchmarkTestSupport';
import { axeViolations } from '../../test-axe';
import {
  address,
  manyMessages,
  publishedMessage,
  renderEvents,
  samplingReport,
} from './eventsTestSupport';

afterEach(() => vi.unstubAllGlobals());

const table = () => screen.getByRole('table', { name: 'Published messages, newest first' });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');
const seqs = () => bodyRows().map((row) => cellsOf(row)[2]?.textContent);

/** The messages of the filter tests: two devices of Row A, a library sensor with CO₂, one unreadable payload. */
const FILTER_LIST = () => [
  publishedMessage(1),
  publishedMessage(2, { deviceId: 'dc-env-02' }),
  publishedMessage(3, {
    deviceId: 'lib-air-01',
    payload: JSON.stringify({ seq: 3, metrics: { co2_ppm: 700, temperature_c: 24.3 } }),
  }),
  publishedMessage(4),
  publishedMessage(5, { deviceId: 'dc-env-02', payload: 'not json', fault: 'malformed:json' }),
  publishedMessage(6, {
    deviceId: 'lib-air-01',
    payload: JSON.stringify({ seq: 6, metrics: { co2_ppm: 710 } }),
  }),
];

describe('the tail', () => {
  it('lists the messages newest first, with the columns of the frame', () => {
    renderEvents({ messages: manyMessages(3) });
    expect(screen.getByRole('heading', { level: 1, name: 'Event stream' })).toBeInTheDocument();
    expect(seqs()).toEqual(['3', '2', '1']);

    const cells = cellsOf(bodyRows()[0] as HTMLElement).map((cell) => cell.textContent);
    expect(cells[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(cells[1]).toBe('dc-env-01');
    expect(cells[2]).toBe('3');
    expect(cells[3]).toBe('temperature_c 22.5 · humidity_pct 45');
    expect(cells[4]).toMatch(/^\d+ B$/);
    expect(cells[5]).toBe('3.1 ms');
  });

  it('says how much is shown of how much was published, and at what rate', () => {
    renderEvents({ messages: manyMessages(3), total: 7612, publishRate: 2 });
    expect(screen.getByText(/Last 3 of 7,612 · 2\.0 msg\/s/)).toBeVisible();
  });

  it('marks a message that is not a plain one, and shows an unreadable payload as it was sent', () => {
    renderEvents({
      messages: [
        publishedMessage(1, { fault: 'republish' }),
        publishedMessage(2, { payload: 'not json', fault: 'malformed:json' }),
        publishedMessage(3, { fault: 'duplicate' }),
      ],
    });
    const [duplicate, malformed, republished] = bodyRows();
    expect(within(duplicate as HTMLElement).getByText('Duplicate')).toBeVisible();
    expect(within(malformed as HTMLElement).getByText('Malformed')).toBeVisible();
    expect(within(malformed as HTMLElement).getByText('not json')).toBeVisible();
    expect(within(republished as HTMLElement).getByText('Republished')).toBeVisible();
  });

  it('follows the stream: a new message shows without a page change', async () => {
    const { log } = renderEvents({ messages: manyMessages(3) });
    expect(screen.getByText('Following')).toBeVisible();
    act(() => log.record(publishedMessage(4)));
    await waitFor(() => expect(seqs()[0]).toBe('4'));
  });

  it('says so when nothing has been published', () => {
    renderEvents();
    expect(screen.getByText(/Nothing has been published yet/)).toBeVisible();
  });

  it('keeps a long list to one page of rows, however many messages arrive', async () => {
    const { log } = renderEvents({ messages: manyMessages(5) });
    act(() => {
      for (let id = 6; id <= 1005; id++) log.record(publishedMessage(id));
    });
    await screen.findByText(/Last 200 of 1,005/);
    expect(bodyRows()).toHaveLength(10);
    // The Seq column writes thousands with a comma, as the frame does (1,284).
    expect(seqs()[0]).toBe('1,005');
  });

  it('dims what it shows while the link to the simulator is lost', () => {
    const { container } = renderEvents({ messages: manyMessages(2), link: 'lost' });
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
  });
});

describe('the filters, which live in the address', () => {
  it('filters by text in the topic or the payload, and writes it in the address', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: FILTER_LIST() });
    await user.type(
      screen.getByRole('searchbox', { name: 'Filter by topic or payload' }),
      'lib-air',
    );
    expect(seqs()).toEqual(['6', '3']);
    expect(address()).toBe('/events?q=lib-air');

    await user.clear(screen.getByRole('searchbox', { name: 'Filter by topic or payload' }));
    await user.type(
      screen.getByRole('searchbox', { name: 'Filter by topic or payload' }),
      'not json',
    );
    expect(seqs()).toEqual(['5']);
  });

  it('filters by device', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: FILTER_LIST() });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Device' }), 'dc-env-02');
    expect(seqs()).toEqual(['5', '2']);
    expect(address()).toBe('/events?device=dc-env-02');
  });

  it('filters by metric, and never matches an unreadable payload', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: FILTER_LIST() });
    await user.click(screen.getByRole('radio', { name: 'co2_ppm' }));
    expect(seqs()).toEqual(['6', '3']);
    expect(address()).toBe('/events?metric=co2_ppm');

    await user.click(screen.getByRole('radio', { name: 'temperature_c' }));
    expect(seqs()).toEqual(['4', '3', '2', '1']);
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(seqs()).toHaveLength(6);
    expect(address()).toBe('/events');
  });

  it('reads the filters from the address', () => {
    renderEvents({
      messages: FILTER_LIST(),
      path: '/events?q=campus&device=dc-env-01&metric=temperature_c',
    });
    expect(screen.getByRole('searchbox', { name: 'Filter by topic or payload' })).toHaveValue(
      'campus',
    );
    expect(screen.getByRole('combobox', { name: 'Device' })).toHaveValue('dc-env-01');
    expect(screen.getByRole('radio', { name: 'temperature_c' })).toBeChecked();
    expect(seqs()).toEqual(['4', '1']);
  });

  it('says when nothing matches and clears the filters from there', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: FILTER_LIST(), path: '/events?device=dc-env-01&metric=co2_ppm' });
    expect(screen.getByText('No message matches the filters.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
    expect(address()).toBe('/events');
    expect(seqs()).toHaveLength(6);
  });

  it('reads the command palette’s ?topic= as the text filter and rewrites the address', async () => {
    const topic = 'campus/BLD-LIB/lib-air-01/telemetry';
    renderEvents({
      messages: FILTER_LIST(),
      path: `/events?topic=${encodeURIComponent(topic)}`,
    });
    expect(screen.getByRole('searchbox', { name: 'Filter by topic or payload' })).toHaveValue(
      topic,
    );
    expect(seqs()).toEqual(['6', '3']);
    await waitFor(() => expect(address()).toBe(`/events?q=${encodeURIComponent(topic)}`));
  });
});

describe('paging, pause and clear', () => {
  it('pages ten at a time and lets the size change', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: manyMessages(25) });
    const nav = screen.getByRole('navigation', { name: 'Message pages' });
    expect(nav).toHaveTextContent('Rows 1–10 of 25');
    expect(nav).toHaveTextContent('the last 200 are kept in memory');
    expect(seqs()[0]).toBe('25');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '25');
    expect(address()).toBe('/events?size=25');
    expect(bodyRows()).toHaveLength(25);
  });

  it('holds the tail when the page leaves 1, counts what arrives, and follows again on page 1', async () => {
    const user = userEvent.setup();
    const { log } = renderEvents({ messages: manyMessages(25) });

    await user.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(address()).toBe('/events?page=2');
    expect(seqs()).toEqual(['15', '14', '13', '12', '11', '10', '9', '8', '7', '6']);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeVisible();

    act(() => log.record(publishedMessage(26)));
    await screen.findByText('Paused · 1 new');
    expect(seqs()[0]).toBe('15');

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(address()).toBe('/events');
    expect(screen.getByText('Following')).toBeVisible();
    expect(seqs()[0]).toBe('26');
  });

  it('holds the tail on page 1 when paused, and Resume follows again', async () => {
    const user = userEvent.setup();
    const { log } = renderEvents({ messages: manyMessages(12) });

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => log.record(publishedMessage(13)));
    await screen.findByText('Paused · 1 new');
    expect(seqs()[0]).toBe('12');

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(seqs()[0]).toBe('13'));
  });

  it('rewrites a page past the end to the last page', async () => {
    renderEvents({ messages: manyMessages(5), path: '/events?page=9' });
    await waitFor(() => expect(address()).toBe('/events'));
    expect(seqs()).toEqual(['5', '4', '3', '2', '1']);
    expect(screen.getByText('Following')).toBeVisible();
  });

  it('clears the list but not the total, and shows what comes after', async () => {
    const user = userEvent.setup();
    const { log } = renderEvents({ messages: manyMessages(3), total: 50 });

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Cleared. New messages will show here.')).toBeVisible();
    expect(screen.getByText(/Last 0 of 50/)).toBeVisible();

    act(() => log.record(publishedMessage(4)));
    await waitFor(() => expect(seqs()).toEqual(['4']));
    expect(screen.getByText(/Last 1 of 51/)).toBeVisible();
  });
});

describe('the open message', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, index = 0) => {
    await user.click(bodyRows()[index] as HTMLElement);
  };

  it('says what to do before a message is chosen', () => {
    renderEvents({ messages: manyMessages(2) });
    expect(screen.getByText(/Select a message to see its topic and payload/)).toBeVisible();
  });

  it('shows the topic, the payload, the size, the PUBACK time and the command, and keeps the choice in the address', async () => {
    const user = userEvent.setup();
    const message = publishedMessage(3);
    renderEvents({ messages: [publishedMessage(1), publishedMessage(2), message] });
    await open(user);

    expect(screen.getByRole('heading', { name: 'dc-env-01 · seq 3' })).toBeVisible();
    expect(screen.getByText(/QoS 1 · retain off/)).toBeVisible();
    expect(screen.getByText('PUBACK 3.1 ms')).toBeVisible();
    expect(screen.getByText(message.topic, { selector: 'span' })).toBeVisible();
    expect(screen.getByText(`Payload · ${message.payload.length} B`)).toBeVisible();
    expect(screen.getByLabelText('Payload').textContent).toContain('"temperature_c": 22.5');
    const command = screen.getByLabelText('mosquitto_pub command').textContent ?? '';
    expect(command).toContain('mosquitto_pub -h localhost -p 1883 -q 1');
    expect(command).toContain(`-t ${message.topic}`);
    expect(command).toContain(`-m '${message.payload}'`);
    expect(address()).toBe('/events?message=3');
  });

  it('opens the message the address names', () => {
    renderEvents({ messages: manyMessages(3), path: '/events?message=2' });
    expect(screen.getByRole('heading', { name: 'dc-env-01 · seq 2' })).toBeVisible();
  });

  it('says so when the address names a message that is no longer in the log', () => {
    renderEvents({ messages: manyMessages(3), path: '/events?message=999' });
    expect(screen.getByText('Message 999 is no longer in the last 200 published.')).toBeVisible();
  });

  it('copies the topic, the raw payload and the command', async () => {
    const user = userEvent.setup();
    const message = publishedMessage(1);
    renderEvents({ messages: [message] });
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Copy the topic' }));
    await screen.findByText('Copied the topic');
    expect(await navigator.clipboard.readText()).toBe(message.topic);

    await user.click(screen.getByRole('button', { name: 'Copy the payload' }));
    await screen.findByText('Copied the payload');
    expect(await navigator.clipboard.readText()).toBe(message.payload);

    await user.click(screen.getByRole('button', { name: 'Copy the command' }));
    await screen.findByText('Copied the command');
    expect(await navigator.clipboard.readText()).toBe(
      screen.getByLabelText('mosquitto_pub command').textContent,
    );
  });

  it('shows a payload that cannot be read as it was sent, and says so', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: [publishedMessage(1, { payload: "it's not json" })] });
    await open(user);
    expect(screen.getByLabelText('Payload').textContent).toBe("it's not json");
    expect(screen.getByText(/shown as it was sent/)).toBeVisible();
    // The command quotes the quote so a shell reads the same bytes.
    expect(screen.getByLabelText('mosquitto_pub command').textContent).toContain(
      "-m 'it'\\''s not json'",
    );
  });

  it('cannot send a message again while a benchmark runs: it would add to the run being measured', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: manyMessages(3), benchmark: runningBenchmark() });
    await open(user, 2);
    expect(screen.getByRole('button', { name: 'Republish' })).toBeDisabled();
  });

  it('keeps the message on show after its row has left the log, and cannot send it again', async () => {
    const user = userEvent.setup();
    const { log } = renderEvents({ messages: manyMessages(3), capacity: 3 });
    await open(user, 2); // message 1
    expect(screen.getByRole('button', { name: 'Republish' })).toBeEnabled();

    act(() => log.record(publishedMessage(4)));
    await screen.findByText(
      /no longer in the last 200 published, so the simulator cannot send it again/,
    );
    expect(screen.getByRole('heading', { name: 'dc-env-01 · seq 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Republish' })).toBeDisabled();
  });

  it('has no accessibility violation with a message open', async () => {
    const user = userEvent.setup();
    const { container } = renderEvents({ messages: FILTER_LIST() });
    await open(user);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens a row from the keyboard', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: manyMessages(3) });
    (bodyRows()[1] as HTMLElement).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'dc-env-01 · seq 2' })).toBeVisible();
  });
});

describe('Republish', () => {
  it('sends the message again, says which message it became, and links to the Faults page', async () => {
    const user = userEvent.setup();
    const { simulator, store } = renderEvents({ messages: manyMessages(3) });
    await user.click(bodyRows()[0] as HTMLElement);

    await user.click(screen.getByRole('button', { name: 'Republish' }));

    await screen.findByText(/Sent again as message 99, with the same seq/);
    expect(simulator.calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/messages/3/republish' },
    ]);
    // The answer's state is in the store at once: the effect session it started is on the Faults page.
    expect(store.getState().view?.faultEffect).not.toBeNull();

    await user.click(screen.getByRole('link', { name: 'Faults page' }));
    expect(address()).toBe('/lab/faults');
    expect(screen.getByText('The Faults page')).toBeVisible();
  });

  it.each([
    [404, 'Message 3 is not in the publish log; only the last 200 are kept'],
    [409, 'The link to the broker is down; restore it first'],
    [502, 'The broker did not accept the message: not authorised'],
  ])('says what the simulator said when it answers %i', async (status, message) => {
    const user = userEvent.setup();
    const { simulator } = renderEvents({ messages: manyMessages(3) });
    simulator.failWith({ status, message });
    await user.click(bodyRows()[0] as HTMLElement);

    await user.click(screen.getByRole('button', { name: 'Republish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(`Not sent: ${message}`);
    expect(screen.queryByText(/Sent again/)).not.toBeInTheDocument();
  });

  it('shows the result of the open message only', async () => {
    const user = userEvent.setup();
    renderEvents({ messages: manyMessages(3) });
    await user.click(bodyRows()[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Republish' }));
    await screen.findByText(/Sent again as message 99/);

    await user.click(bodyRows()[1] as HTMLElement);
    expect(screen.queryByText(/Sent again/)).not.toBeInTheDocument();
  });
});

describe('sampling', () => {
  it('says the list is a sample while the simulator skips messages, and that the numbers are exact', () => {
    renderEvents({
      messages: manyMessages(3),
      total: 1000,
      sampling: { active: true, skipped: 750, budgetPerS: 250, windowMs: 1000 },
    });
    expect(
      screen.getByText(/Sampling: the simulator forwards up to 250 messages a second/),
    ).toBeVisible();
    expect(
      screen.getByText(/The total and the rate are exact; the list is a sample/),
    ).toBeVisible();
    expect(screen.getByText(/750 skipped in the last 1 s/)).toBeVisible();
  });

  it('stops saying so when the simulator’s closing report arrives', async () => {
    const { log } = renderEvents({
      messages: manyMessages(3),
      sampling: { active: true, skipped: 750, budgetPerS: 250, windowMs: 1000 },
    });
    act(() => log.applySampling(samplingReport({ total: 1200, skipped: 0, active: false })));
    await waitFor(() => expect(screen.queryByText(/Sampling:/)).not.toBeInTheDocument());
    expect(screen.queryByText(/skipped in the last/)).not.toBeInTheDocument();
    expect(screen.getByText(/of 1,200/)).toBeVisible();
  });

  it('shows no notice when the simulator is not sampling', () => {
    renderEvents({ messages: manyMessages(3) });
    expect(screen.queryByText(/Sampling:/)).not.toBeInTheDocument();
  });
});

describe('the page without a state', () => {
  it('still draws, with no devices to filter by', () => {
    renderEvents({ view: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Event stream' })).toBeVisible();
    expect(
      within(screen.getByRole('combobox', { name: 'Device' })).getAllByRole('option'),
    ).toHaveLength(1);
  });
});
