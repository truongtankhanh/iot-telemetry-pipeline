import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { benchmarkFixture } from '../../api/fixtures/benchmarkFixtures';
import type { BenchmarkRunDetail } from '../../api/types';
import type { SessionPoint } from '../../lib/sessionMetrics';
import { axeViolations } from '../../test-axe';
import { ChartsSection } from './ChartsSection';

const going = benchmarkFixture.current as BenchmarkRunDetail;
const [completed] = benchmarkFixture.runs as [BenchmarkRunDetail];

const T0 = Date.parse('2026-10-27T09:00:00.000Z');
const point = (second: number, change: Partial<SessionPoint> = {}): SessionPoint => ({
  at: T0 + second * 1000,
  messagesPerS: 120,
  storedPerS: 240,
  lagMeanS: 0.31,
  flushP95S: 0.018,
  buffered: 40,
  ...change,
});

describe('ChartsSection with a run on show', () => {
  it('draws published and stored in readings per second, and writes the window and the gap', () => {
    render(<ChartsSection run={going} session={[]} />);
    const throughput = screen.getByRole('img', {
      name: /^Throughput, the first 10 s of run 3, so far, in readings\/s\./,
    });
    expect(throughput).toHaveAccessibleName(/published, as readings .* readings\/s at the end/);
    expect(throughput).toHaveAccessibleName(/stored in PostgreSQL .* readings\/s at the end/);
    expect(screen.getAllByText('The first 10 s of run 3, so far.').length).toBe(4);
    expect(
      screen.getByText(/The gap between the lines is what is still in flight:/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Projected finish/)).toBeInTheDocument();
    expect(screen.getByText('The phases are marked when the run ends.')).toBeInTheDocument();
  });

  it('calls the lag of a run what it is: an estimated queue delay, not ingest’s lag', () => {
    render(<ChartsSection run={going} session={[]} />);
    expect(screen.getByRole('heading', { name: 'Queue delay (estimated)' })).toBeInTheDocument();
    expect(screen.getByText('readings in flight ÷ stored rate')).toBeInTheDocument();
    expect(screen.queryByText('telemetry_ingest_lag_seconds')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Flush time p95' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Buffered readings' })).toBeInTheDocument();
  });

  it('marks the phases of a run that ended, and has no projected finish for it', () => {
    render(<ChartsSection run={completed} session={[]} />);
    expect(screen.getByText('steady state')).toBeInTheDocument();
    expect(screen.queryByText(/Projected finish/)).toBeNull();
    expect(screen.queryByText('The phases are marked when the run ends.')).toBeNull();
    expect(screen.getAllByText('All 17.6 s of run 2.').length).toBe(4);
  });
});

describe('ChartsSection with no run on show', () => {
  it('draws the session’s own, in its own units, with the metric of the lag', () => {
    const session = [point(0), point(60), point(120)];
    render(<ChartsSection run={null} session={session} />);
    const throughput = screen.getByRole('img', {
      name: /^Throughput, the last 2 minutes of this session, in messages\/s and readings\/s\./,
    });
    expect(throughput).toHaveAccessibleName(/messages received 120 messages\/s at the end/);
    expect(throughput).toHaveAccessibleName(/readings stored 240 readings\/s at the end/);
    expect(screen.getByRole('heading', { name: 'Ingest lag' })).toBeInTheDocument();
    expect(screen.getByText('telemetry_ingest_lag_seconds')).toBeInTheDocument();
    expect(
      screen.getByText('Messages and readings are different units; each line says which.'),
    ).toBeInTheDocument();
  });

  it('says there is no data yet before ingest has been read twice', () => {
    render(<ChartsSection run={null} session={[]} />);
    expect(screen.getAllByText('No data yet').length).toBe(4);
    expect(screen.getAllByText('This session so far.').length).toBe(4);
  });

  it('breaks a line where ingest could not be read, not to zero', () => {
    const session = [point(0), point(1, { messagesPerS: null }), point(2)];
    const { container } = render(<ChartsSection run={null} session={session} />);
    expect(container.querySelectorAll('[data-line="messages"] polyline')).toHaveLength(2);
  });

  it('has no accessibility violations', async () => {
    // One section at a time: two on a page would repeat the names of their cards, which a page never does.
    const withRun = render(<ChartsSection run={going} session={[]} />);
    expect(await axeViolations(withRun.container)).toEqual([]);
    withRun.unmount();

    const session = render(<ChartsSection run={null} session={[point(0), point(1)]} />);
    expect(await axeViolations(session.container)).toEqual([]);
  });
});
