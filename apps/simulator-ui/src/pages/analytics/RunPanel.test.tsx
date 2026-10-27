import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { benchmarkFixture } from '../../api/fixtures/benchmarkFixtures';
import type { BenchmarkRunDetail } from '../../api/types';
import { axeViolations } from '../../test-axe';
import { RunPanel } from './RunPanel';

const going = benchmarkFixture.current as BenchmarkRunDetail;
const [completed, failed] = benchmarkFixture.runs as [BenchmarkRunDetail, BenchmarkRunDetail];

/** The tile with this label: its figure and its note. */
function tile(label: string) {
  const term = screen.getByText(label, { selector: 'dt' });
  return within(term.parentElement as HTMLElement);
}

describe('RunPanel', () => {
  it('shows a run that goes: each progress in its own unit against its own total, and what is in flight', () => {
    render(<RunPanel run={going} />);
    expect(screen.getByRole('heading', { name: 'Run 3' })).toBeInTheDocument();
    expect(screen.getByText('publishing')).toBeInTheDocument();

    expect(screen.getByRole('progressbar', { name: 'Published' })).toHaveAttribute(
      'aria-valuetext',
      '62,400 of 100,000 messages',
    );
    expect(screen.getByRole('progressbar', { name: 'Stored in PostgreSQL' })).toHaveAttribute(
      'aria-valuetext',
      '124,000 of 200,001 readings',
    );
    // 62,400 messages are 124,801 readings at the run's exact ratio.
    expect(screen.getByText('801 readings still in flight or buffered')).toBeInTheDocument();
  });

  it('shows what the last second did while the run goes, and names the queue delay as an estimate', () => {
    render(<RunPanel run={going} />);
    expect(tile('Publish rate').getByText('9,400')).toBeInTheDocument();
    expect(tile('Publish rate').getByText('elapsed 10.7 s')).toBeInTheDocument();
    expect(tile('Stored rate').getByText('18,700')).toBeInTheDocument();
    expect(tile('Stored rate').getByText('last second')).toBeInTheDocument();
    expect(tile('Queue delay (estimated)').getByText('0.14')).toBeInTheDocument();
    expect(tile('Flush time p95').getByText('18')).toBeInTheDocument();
    expect(
      tile('Flush time p95').getByText('telemetry_flush_duration_seconds'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ingest lag')).toBeNull();
  });

  it('shows the command line’s own numbers for a run that completed, and says it is complete', () => {
    render(<RunPanel run={completed} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(tile('Publish rate').getByText('5,669')).toBeInTheDocument();
    expect(tile('Publish rate').getByText('end to end, 17.6 s')).toBeInTheDocument();
    expect(tile('Stored rate').getByText('11,338')).toBeInTheDocument();
    expect(screen.getByText('Every reading was stored.')).toBeInTheDocument();
  });

  it('says why a run failed, and shows what it cannot know as unknown, not zero', () => {
    render(<RunPanel run={failed} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(
      screen.getByText('The benchmark process exited without a result (code 1)'),
    ).toBeInTheDocument();
    expect(screen.getByText('The stored count is not known.')).toBeInTheDocument();
    expect(tile('Stored rate').getByText('unknown')).toBeInTheDocument();
    expect(tile('Queue delay (estimated)').getByText('unknown')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Stored in PostgreSQL' })).toHaveAttribute(
      'aria-valuetext',
      'unknown of 200,001 readings',
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <>
        <RunPanel run={going} />
        <RunPanel run={failed} />
      </>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
