import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatEventClock, fromInputValue, toInputValue } from '../../lib/eventTime';
import { axeViolations } from '../../test-axe';
import { installReactFlowStubs } from '../topology/topologyTestSupport';
import { address, observations, renderOverview } from './overviewTestSupport';

let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** `count` events a minute apart, the newest 30 s ago: 60 of 75 are inside the last hour, 5 inside five minutes. */
const recent = (count: number) => observations(count, Date.now() - 30_000);

const card = () => screen.getByRole('region', { name: 'Event timeline' });
const table = () => within(card()).getByRole('table', { name: 'Events' });
const bodyRows = () => within(table().querySelector('tbody') as HTMLElement).getAllByRole('row');
const bottomPager = () => within(card()).getByRole('navigation', { name: 'Events pages' });
const topPager = () => within(card()).getByRole('navigation', { name: 'Events pages (top)' });

describe('the table', () => {
  it('lists the newest events first, ten to a page, with the range and the total in words', () => {
    renderOverview({ events: recent(75) });
    expect(within(card()).getByText('60 events · last hour')).toBeInTheDocument();
    expect(bottomPager()).toHaveTextContent('Events 1–10 of 60, newest first');
    expect(bodyRows()).toHaveLength(10);
    // The newest event of the 75 is an alert that opened; the ten rows run down from it.
    expect(bodyRows()[0]).toHaveTextContent('#7 opened');
  });

  it('says what each event is: its time, its source with a word, and its message', () => {
    renderOverview({ events: recent(6) });
    const first = bodyRows()[0] as HTMLElement;
    expect(within(first).getByText('Alert')).toBeInTheDocument();
    expect(within(first).getByText('#7 cleared')).toBeInTheDocument();
    expect(first.querySelector('time')).toHaveAttribute('datetime');
    const last = bodyRows().at(-1) as HTMLElement;
    expect(within(last).getByText('Fleet')).toBeInTheDocument();
    expect(within(last).getByText('stu-air-01')).toBeInTheDocument();
  });

  it('washes a row for a few seconds after Studio saw it, and not the older ones', () => {
    renderOverview({ events: observations(3, Date.now()) });
    const rows = bodyRows();
    expect(rows[0]).toHaveAttribute('data-fresh', 'true');
    expect(rows[1]).not.toHaveAttribute('data-fresh');
  });

  it('opens a row to its fields, and closes it', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    const toggle = screen.getByRole('button', { name: 'Expand event 75' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Collapse event 75');
    const details = document.getElementById(toggle.getAttribute('aria-controls') as string);
    expect(details).not.toBeNull();
    // "Alert" is both a label and the value of "Source": read the labels, not the text.
    const labels = [...(details as HTMLElement).querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels).toEqual(['Source', 'Alert', 'Title', 'Rule', 'Device', 'Seen by Studio']);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(toggle.getAttribute('aria-controls') as string)).toBeNull();
  });
});

describe('the pages', () => {
  it('turn at the top and at the bottom, and the address keeps the place', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    await user.click(within(bottomPager()).getByRole('button', { name: 'Page 2' }));
    expect(address()).toBe('/?page=2');
    expect(bottomPager()).toHaveTextContent('Events 11–20 of 60');

    await user.click(within(topPager()).getByRole('button', { name: 'Next page' }));
    expect(address()).toBe('/?page=3');
    expect(bottomPager()).toHaveTextContent('Events 21–30 of 60');
    expect(within(topPager()).getByRole('button', { name: 'Page 3' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('are only the numbers at the top: the range and the size are at the bottom', () => {
    renderOverview({ events: recent(75) });
    expect(topPager()).not.toHaveTextContent(/Events 1–10/);
    expect(within(topPager()).queryByLabelText('Rows per page')).not.toBeInTheDocument();
    expect(within(bottomPager()).getByLabelText('Rows per page')).toBeInTheDocument();
  });

  it('change in size, back to the first page', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75), path: '/?page=3' });
    await user.selectOptions(within(bottomPager()).getByLabelText('Rows per page'), '25');
    expect(address()).toBe('/?size=25');
    expect(bodyRows()).toHaveLength(25);
    expect(bottomPager()).toHaveTextContent('Events 1–25 of 60');
  });

  it('announce the range politely', () => {
    renderOverview({ events: recent(75) });
    const range = within(bottomPager()).getByRole('status');
    expect(range).toHaveAttribute('aria-live', 'polite');
    expect(range).toHaveTextContent('Events 1–10 of 60, newest first');
  });

  it('show the last page for a page past the end', () => {
    renderOverview({ events: recent(75), path: '/?page=99' });
    expect(bottomPager()).toHaveTextContent('Events 51–60 of 60');
  });
});

describe('the range', () => {
  it('has the five relative ones and Custom, the hour first', () => {
    renderOverview({ events: recent(75) });
    const group = within(card()).getByRole('radiogroup', { name: 'Range' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.parentElement?.textContent),
    ).toEqual(['5m', '30m', '1h', '3h', '12h', 'Custom']);
    expect(within(group).getByRole('radio', { name: '1h' })).toBeChecked();
  });

  it('narrows to the last five minutes and widens to three hours, from the first page', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75), path: '/?page=4' });
    await user.click(within(card()).getByRole('radio', { name: '5m' }));
    expect(address()).toBe('/?range=5m');
    expect(within(card()).getByText('5 events · last 5 minutes')).toBeInTheDocument();

    await user.click(within(card()).getByRole('radio', { name: '3h' }));
    expect(within(card()).getByText('75 events · last 3 hours')).toBeInTheDocument();
  });

  it('is a pair of fields for Custom, which start at the range that was on show', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    await user.click(within(card()).getByRole('radio', { name: 'Custom' }));

    const params = new URLSearchParams(address().split('?')[1]);
    expect(params.get('range')).toBe('custom');
    expect(Number.isFinite(Date.parse(params.get('from') as string))).toBe(true);
    expect(Number.isFinite(Date.parse(params.get('to') as string))).toBe(true);
    const group = within(card()).getByRole('group', { name: 'Custom range' });
    const fields = group.querySelectorAll('input');
    expect(fields).toHaveLength(2);
    expect(within(card()).getByText('60 events · custom range')).toBeInTheDocument();
  });

  it('changes by the fields, and refuses two bounds that are not in order', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    await user.click(within(card()).getByRole('radio', { name: 'Custom' }));
    const group = within(card()).getByRole('group', { name: 'Custom range' });
    const [from, to] = [...group.querySelectorAll('input')] as HTMLInputElement[];

    const start = fromInputValue(from!.value, 'local') as number;
    fireEvent.change(from!, { target: { value: toInputValue(start + 30 * 60_000, 'local') } });
    const params = new URLSearchParams(address().split('?')[1]);
    expect(Date.parse(params.get('from') as string)).toBe(start + 30 * 60_000);

    // A start after the end is not a range: the address does not change.
    const before = address();
    fireEvent.change(from!, { target: { value: toInputValue(Date.now() + 60 * 60_000, 'local') } });
    expect(address()).toBe(before);
    expect(to!.value).not.toBe('');
  });

  it('is read from a link, bounds and all', () => {
    const from = new Date(Date.now() - 20 * 60_000).toISOString();
    const to = new Date(Date.now() - 10 * 60_000).toISOString();
    renderOverview({
      events: recent(75),
      path: `/?range=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    // Events a minute apart, thirty seconds off the minute: ten of them fall in the ten minutes.
    expect(within(card()).getByText(/^10 events · custom range$/)).toBeInTheDocument();
  });
});

describe('the filter and the source', () => {
  const alertIds = (events: ReturnType<typeof recent>) =>
    events.slice(-60).filter((e) => e.kind === 'alert-opened' || e.kind === 'alert-cleared');

  it('keep what a key:value term names, and write the filter into the address', async () => {
    const user = userEvent.setup();
    const events = recent(75);
    renderOverview({ events });
    await user.type(within(card()).getByRole('textbox', { name: 'Filter events' }), 'source:alert');
    expect(address()).toBe('/?q=source%3Aalert');
    expect(
      within(card()).getByText(`${alertIds(events).length} events · last hour`),
    ).toBeInTheDocument();
    for (const row of bodyRows()) expect(within(row).getByText('Alert')).toBeInTheDocument();
  });

  it('search a word in the message, and need every term to match', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    const field = within(card()).getByRole('textbox', { name: 'Filter events' });
    await user.type(field, 'cleared');
    const cleared = within(card()).getByText(/events · last hour$/).textContent;
    await user.type(field, ' source:outbox');
    expect(within(card()).getByText('0 events · last hour')).toBeInTheDocument();
    expect(cleared).not.toBe('0 events · last hour');
  });

  it('say that a key it does not know is searched as text', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    await user.type(within(card()).getByRole('textbox', { name: 'Filter events' }), 'foo:bar');
    expect(
      within(card()).getByText(/foo: is not a filter key, so it is searched as text/),
    ).toBeInTheDocument();
    expect(
      within(card()).getByText(/Keys: source, device, rule, alert, scenario/),
    ).toBeInTheDocument();
  });

  it('choose a source', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    await user.selectOptions(within(card()).getByLabelText('Source'), 'Outbox');
    expect(address()).toBe('/?source=Outbox');
    for (const row of bodyRows()) expect(within(row).getByText('Outbox')).toBeInTheDocument();
  });

  it('say so when nothing passes, and clear the filter and the source in one click', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75), path: '/?q=zzz&source=Alert&page=2' });
    expect(
      within(card()).getByText('No event matches the filter in this range.'),
    ).toBeInTheDocument();
    await user.click(within(card()).getByRole('button', { name: 'Clear the filter' }));
    expect(address()).toBe('/');
    expect(bodyRows()).toHaveLength(10);
  });
});

describe('Local and UTC', () => {
  it('write the times of the rows in the zone chosen, and remember the choice', async () => {
    const user = userEvent.setup();
    const events = recent(75);
    const { unmount } = renderOverview({ events });
    const newest = Date.parse(events.at(-1)!.at);
    const row = () => bodyRows()[0] as HTMLElement;
    expect(row().querySelector('time')).toHaveTextContent(formatEventClock(newest, 'local'));

    await user.click(within(card()).getByRole('radio', { name: 'UTC' }));
    expect(row().querySelector('time')).toHaveTextContent(formatEventClock(newest, 'utc'));
    expect(within(table()).getByRole('columnheader', { name: 'Time (UTC)' })).toBeInTheDocument();
    expect(localStorage.getItem('studio.timeZone')).toBe('utc');
    // The zone is a habit of the viewer, not part of the address.
    expect(address()).toBe('/');

    unmount();
    renderOverview({ events });
    expect(within(card()).getByRole('radio', { name: 'UTC' })).toBeChecked();
  });
});

describe('the strip of events per minute', () => {
  it('is a picture named by what it shows, with the busiest minute', () => {
    renderOverview({ events: recent(75) });
    const strip = within(card()).getByRole('img', {
      name: /^Events per minute from \d\d:\d\d to \d\d:\d\d;/,
    });
    expect(strip).toHaveAccessibleName(/the whole range is selected\. Busiest minute: 1 event\.$/);
  });

  it('has two handles at the ends, that a keyboard can reach and that tell their time', () => {
    renderOverview({ events: recent(75) });
    const start = within(card()).getByRole('slider', { name: 'Start of the range' });
    const end = within(card()).getByRole('slider', { name: 'End of the range' });
    expect(start).toHaveAttribute('tabindex', '0');
    expect(Number(start.getAttribute('aria-valuenow'))).toBe(
      Number(start.getAttribute('aria-valuemin')),
    );
    expect(Number(end.getAttribute('aria-valuenow'))).toBe(
      Number(end.getAttribute('aria-valuemax')),
    );
    expect(start.getAttribute('aria-valuetext')).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it('narrows the range when a handle is moved by the arrow keys and released', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    const start = within(card()).getByRole('slider', { name: 'Start of the range' });
    start.focus();
    await user.keyboard('{ArrowRight}');

    const params = new URLSearchParams(address().split('?')[1]);
    expect(params.get('range')).toBe('custom');
    expect(params.get('page')).toBeNull();
    const span = Date.parse(params.get('to') as string) - Date.parse(params.get('from') as string);
    // The hour, a minute narrower (the page's clock may have moved a second or two meanwhile).
    expect(span).toBeGreaterThan(58 * 60_000);
    expect(span).toBeLessThanOrEqual(59 * 60_000 + 2000);
  });

  it('does not widen the range: the left handle at the start has nowhere to go to the left', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    within(card()).getByRole('slider', { name: 'Start of the range' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(address()).toBe('/');
  });

  it('moves the right handle by ten minutes with Shift', async () => {
    const user = userEvent.setup();
    renderOverview({ events: recent(75) });
    within(card()).getByRole('slider', { name: 'End of the range' }).focus();
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    const first = new URLSearchParams(address().split('?')[1]);
    const span = Date.parse(first.get('to') as string) - Date.parse(first.get('from') as string);
    expect(span).toBeGreaterThan(49 * 60_000);
    expect(span).toBeLessThanOrEqual(50 * 60_000 + 2000);
  });
});

describe('the export', () => {
  function spyOnDownload() {
    const names: string[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:studio/1';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return { names, blobs };
  }
  const textOf = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });

  it('hands over every event that passes the filter as CSV, not only the page', async () => {
    const user = userEvent.setup();
    const { names, blobs } = spyOnDownload();
    renderOverview({ events: recent(75) });
    await user.click(within(card()).getByRole('button', { name: 'Export' }));

    expect(names).toEqual(['studio-events-1h.csv']);
    const lines = (await textOf(blobs[0] as Blob)).split('\r\n');
    expect(lines[0]).toBe('id,time (UTC),source,kind,message,device,rule,alert,scenario');
    expect(lines).toHaveLength(60 + 2);
    expect(lines[1]).toMatch(/^75,\d{4}-\d\d-\d\dT[\d:.]+Z,Alert,alert-opened,/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:studio/1');
  });

  it('exports what the filter keeps, in UTC whichever zone the table shows', async () => {
    const user = userEvent.setup();
    const { blobs } = spyOnDownload();
    renderOverview({ events: recent(75), path: '/?source=Outbox&range=3h' });
    await user.click(within(card()).getByRole('radio', { name: 'UTC' }));
    await user.click(within(card()).getByRole('button', { name: 'Export' }));
    const lines = (await textOf(blobs[0] as Blob)).split('\r\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) expect(line).toContain(',Outbox,delivery,');
  });

  it('is off when there is nothing to export', () => {
    renderOverview({ events: recent(75), path: '/?q=zzz' });
    expect(within(card()).getByRole('button', { name: 'Export' })).toBeDisabled();
  });
});

describe('before there is anything to show', () => {
  it('says the log is being read, and how far it has got', () => {
    const { log } = renderOverview({ events: [] });
    act(() => log.setLoading(1500));
    expect(within(card()).getByText('Loading events… 1,500 so far.')).toBeInTheDocument();
  });

  it('says no event has been seen yet', () => {
    renderOverview({ events: [] });
    expect(within(card()).getByText(/^No event has been seen yet/)).toBeInTheDocument();
    expect(within(card()).getByText('0 events · last hour')).toBeInTheDocument();
  });

  it('says no event is in a range that holds none, while the log has some', () => {
    const old = observations(5, Date.now() - 5 * 3_600_000);
    renderOverview({ events: old });
    expect(within(card()).getByText('No event in this range.')).toBeInTheDocument();
  });

  it('follows the stream: an event that arrives is in the table within the log’s interval', async () => {
    const { log } = renderOverview({ events: recent(6) });
    expect(bodyRows()).toHaveLength(6);
    act(() => {
      log.record({
        id: 7,
        at: new Date().toISOString(),
        kind: 'scenario-run',
        data: { name: 'server-room-overheat', runId: 'r1', anomalyIds: [], anomalies: [] },
      });
    });
    await waitFor(() => expect(bodyRows()).toHaveLength(7), { timeout: 2500 });
    expect(bodyRows()[0]).toHaveTextContent('server-room-overheat started');
  });
});

describe('accessibility', () => {
  it('has no violations with events, an opened row and a custom range', async () => {
    const user = userEvent.setup();
    const { container } = renderOverview({ events: recent(75) });
    await user.click(screen.getByRole('button', { name: 'Expand event 75' }));
    await user.click(within(card()).getByRole('radio', { name: 'Custom' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
