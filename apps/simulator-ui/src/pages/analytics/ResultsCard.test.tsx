import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { benchmarkFixture } from '../../api/fixtures/benchmarkFixtures';
import type { BenchmarkRunDetail } from '../../api/types';
import type { DownloadHost } from '../../lib/eventExport';
import { axeViolations } from '../../test-axe';
import { ResultsCard } from './ResultsCard';

const [completed, failed] = benchmarkFixture.runs as [BenchmarkRunDetail, BenchmarkRunDetail];

/** The text of a blob, read as the Overview's export test does (jsdom's `Blob` has no `text()`). */
const textOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

function fakeHost() {
  const blobs: Blob[] = [];
  const link = { href: '', download: '', click: vi.fn() };
  const host: DownloadHost = {
    createObjectURL: (blob) => {
      blobs.push(blob);
      return 'blob:run';
    },
    revokeObjectURL: vi.fn(),
    createLink: () => link,
  };
  return { host, blobs, link };
}

describe('ResultsCard', () => {
  it('says there is nothing yet, and for how long results are kept', () => {
    render(<ResultsCard runs={[]} database={null} shownId={null} onShow={() => {}} />);
    expect(screen.getByText(/No run has finished in this session yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Finished runs' })).toBeNull();
  });

  it('lists each run with its outcome in a word, its size, its rates and whether it can be compared', () => {
    render(
      <ResultsCard runs={[completed, failed]} database={null} shownId={null} onShow={() => {}} />,
    );
    const rows = within(screen.getByRole('list', { name: 'Finished runs' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText('Run 2')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Completed')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('comparable')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/100,000 messages · 17\.6 s/)).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText('5,669 messages/s · 11,338 readings/s end to end'),
    ).toBeInTheDocument();

    expect(within(rows[1]!).getByText('Failed')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('not comparable')).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText('The benchmark process exited without a result (code 1)'),
    ).toBeInTheDocument();
    expect(within(rows[1]!).queryByText(/readings\/s end to end/)).toBeNull();
  });

  it('puts a run on show, and goes back when the same one is pressed again', async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    const { rerender } = render(
      <ResultsCard runs={[completed]} database={null} shownId={null} onShow={onShow} />,
    );
    const button = screen.getByRole('button', { name: 'Show Run 2' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(onShow).toHaveBeenLastCalledWith(2);

    rerender(<ResultsCard runs={[completed]} database={null} shownId={2} onShow={onShow} />);
    const shown = screen.getByRole('button', { name: 'Show Run 2' });
    expect(shown).toHaveAttribute('aria-pressed', 'true');
    expect(shown).toHaveTextContent('Showing');
    await user.click(shown);
    expect(onShow).toHaveBeenLastCalledWith(null);
  });

  it('downloads a run as one JSON file with the command line’s result, the series and no credentials', async () => {
    const user = userEvent.setup();
    const { host, blobs, link } = fakeHost();
    render(
      <ResultsCard
        runs={[completed]}
        database="localhost:5433/telemetry"
        shownId={null}
        onShow={() => {}}
        host={host}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Download Run 2 as JSON' }));

    expect(link.download).toBe('studio-benchmark-2-20261027-0912.json');
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(blobs[0]?.type).toBe('application/json');
    const text = await textOf(blobs[0]!);
    const document = JSON.parse(text) as Record<string, unknown>;
    expect(document).toMatchObject({
      format: 'studio-benchmark-run',
      version: 1,
      database: 'localhost:5433/telemetry',
      result: { messagesPerSecond: 5669, readingsPerSecond: 11338 },
    });
    expect((document.series as unknown[]).length).toBe(completed.series.length);
    expect(text).not.toMatch(/password|postgres:/i);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <ResultsCard runs={[completed, failed]} database={null} shownId={2} onShow={() => {}} />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
