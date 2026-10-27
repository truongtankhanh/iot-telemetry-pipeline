import { useMemo } from 'react';
import type { BenchmarkRunDetail } from '../../api/types';
import { type ChartLine, phaseOverlays } from '../../lib/analyticsChart';
import { formatCount, formatSeconds } from '../../lib/benchmarkRows';
import { runFigures, steadyAverage, throughputOf } from '../../lib/benchmarkSeries';
import type { SessionPoint } from '../../lib/sessionMetrics';
import { Card } from '../../ui/Card';
import styles from './analytics.module.css';
import { SeriesChart } from './SeriesChart';

const count = (value: number) => formatCount(value);
const trimmed = (digits: number) => (value: number) => String(Number(value.toFixed(digits)));
const seconds = (value: number) => String(Math.round(value * 10) / 10);
const secondsAgo = (value: number) => (value === 0 ? 'now' : `−${formatSeconds(-value)}`);

/** How long ago the session began, in words: "3 minutes", "40 seconds". */
function spanWords(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 90) return `${s} seconds`;
  return `${Math.round(s / 60)} minutes`;
}

export interface ChartsSectionProps {
  /** The run going or the one chosen: the charts draw its series. `null` draws the session's own, from ingest's `/metrics`. */
  run: BenchmarkRunDetail | null;
  /** The session's points, oldest first (used when there is no run on show). */
  session: readonly SessionPoint[];
}

interface Series {
  throughput: { lines: ChartLine[]; xDomain?: readonly [number, number] };
  lag: ChartLine[];
  flush: ChartLine[];
  buffered: ChartLine[];
}

/**
 * The lines of a run: published (converted to readings by the run's exact readings per message, in `throughputOf`) and stored, both in
 * readings per second, then the other three charts of the points.
 */
function seriesOfRun(run: BenchmarkRunDetail): Series {
  const rates = throughputOf(run.series, run);
  return {
    throughput: {
      lines: [
        {
          id: 'published',
          label: 'published, as readings',
          points: rates.map((sample) => ({ x: sample.t, y: sample.publishedPerS })),
        },
        {
          id: 'stored',
          label: 'stored in PostgreSQL',
          secondary: true,
          points: rates.map((sample) => ({ x: sample.t, y: sample.storedPerS })),
        },
      ],
    },
    lag: [
      {
        id: 'queue-delay',
        label: 'queue delay (estimated)',
        points: run.series.map((point) => ({ x: point.t, y: point.queueDelayS })),
      },
    ],
    flush: [
      {
        id: 'flush',
        label: 'flush time p95',
        points: run.series.map((point) => ({
          x: point.t,
          y: point.flushP95S === null ? null : point.flushP95S * 1000,
        })),
      },
    ],
    buffered: [
      {
        id: 'buffered',
        label: 'buffered readings',
        points: run.series.map((point) => ({ x: point.t, y: point.buffered })),
      },
    ],
  };
}

/** The lines of the session: what ingest did in the last half hour, one point a second. */
function seriesOfSession(points: readonly SessionPoint[]): Series {
  const end = points.at(-1)?.at ?? 0;
  const at = (point: SessionPoint) => (point.at - end) / 1000;
  return {
    throughput: {
      lines: [
        {
          id: 'messages',
          label: 'messages received',
          unit: 'messages/s',
          points: points.map((point) => ({ x: at(point), y: point.messagesPerS })),
        },
        {
          id: 'stored',
          label: 'readings stored',
          unit: 'readings/s',
          secondary: true,
          points: points.map((point) => ({ x: at(point), y: point.storedPerS })),
        },
      ],
    },
    lag: [
      {
        id: 'lag',
        label: 'ingest lag, mean',
        points: points.map((point) => ({ x: at(point), y: point.lagMeanS })),
      },
    ],
    flush: [
      {
        id: 'flush',
        label: 'flush time p95',
        points: points.map((point) => ({
          x: at(point),
          y: point.flushP95S === null ? null : point.flushP95S * 1000,
        })),
      },
    ],
    buffered: [
      {
        id: 'buffered',
        label: 'buffered readings',
        points: points.map((point) => ({ x: at(point), y: point.buffered })),
      },
    ],
  };
}

function SmallChart({
  title,
  metric,
  yUnit,
  window,
  lines,
  formatY,
  formatX,
  xDomain,
}: {
  title: string;
  metric: string;
  yUnit: string;
  window: string;
  lines: ChartLine[];
  formatY: (value: number) => string;
  formatX: (value: number) => string;
  xDomain: readonly [number, number] | undefined;
}) {
  return (
    <Card title={title} aside={<span className={styles.metric}>{metric}</span>}>
      <SeriesChart
        title={title}
        yUnit={yUnit}
        window={window}
        lines={lines}
        formatY={formatY}
        formatX={formatX}
        height={200}
        {...(xDomain === undefined ? {} : { xDomain })}
      />
    </Card>
  );
}

/**
 * The four charts of the page (frame 09): throughput with published and stored on one axis, and ingest lag, flush time and buffered
 * readings under it. With a run on show they draw its series, in **readings** per second (published is converted by the run's exact
 * readings per message, so the two lines meet at the end and the gap between them is what is in flight) and the lag chart is the
 * estimated queue delay, named as one. With none they draw the session's: what ingest has done since this window opened, in its own
 * units (messages and readings are two lines in two units, each named). The window of time is written under every chart.
 */
export function ChartsSection({ run, session }: ChartsSectionProps) {
  const series = useMemo(
    () => (run === null ? seriesOfSession(session) : seriesOfRun(run)),
    [run, session],
  );
  const overlays = useMemo(() => {
    if (run === null) return null;
    const rates = throughputOf(run.series, run);
    const end = run.series.at(-1)?.t ?? 0;
    const phases = phaseOverlays(run.marks, 0, end);
    return { ...phases, average: steadyAverage(rates, run.marks) };
  }, [run]);

  const figures = run === null ? null : runFigures(run);
  const lastT = run?.series.at(-1)?.t ?? 0;
  const span = session.length > 1 ? (session.at(-1)?.at ?? 0) - (session[0]?.at ?? 0) : 0;
  const window =
    run === null
      ? session.length > 1
        ? `the last ${spanWords(span)} of this session`
        : 'this session so far'
      : run.phase === 'ended'
        ? `all ${formatSeconds(lastT)} of run ${run.id}`
        : `the first ${formatSeconds(lastT)} of run ${run.id}, so far`;
  const formatX = run === null ? secondsAgo : seconds;
  const xDomain = run === null && session.length > 1 ? ([-span / 1000, 0] as const) : undefined;

  const throughputCaption =
    run === null || figures === null ? (
      <span>Messages and readings are different units; each line says which.</span>
    ) : (
      <>
        {figures.inFlight === null ? null : (
          <span>
            The gap between the lines is what is still in flight:{' '}
            <b>{formatCount(figures.inFlight)} readings</b>.
          </span>
        )}
        {figures.remainingS === null ? null : (
          <span>
            Projected finish <b>≈ {formatSeconds(figures.remainingS)}</b> at the current rate (an
            estimate).
          </span>
        )}
        {run.phase !== 'ended' ? <span>The phases are marked when the run ends.</span> : null}
      </>
    );

  const lagTitle = run === null ? 'Ingest lag' : 'Queue delay (estimated)';
  const lagMetric =
    run === null ? 'telemetry_ingest_lag_seconds' : 'readings in flight ÷ stored rate';

  return (
    <div className={styles.charts}>
      <Card title="Throughput">
        <SeriesChart
          title="Throughput"
          yUnit={run === null ? 'messages/s and readings/s' : 'readings/s'}
          window={window}
          lines={series.throughput.lines}
          formatY={count}
          formatX={formatX}
          caption={throughputCaption}
          {...(xDomain === undefined ? {} : { xDomain })}
          {...(overlays === null ? {} : { bands: overlays.bands, marks: overlays.marks })}
          {...(overlays === null || overlays.average === null
            ? {}
            : {
                average: {
                  value: overlays.average,
                  label: `average ${formatCount(overlays.average)}`,
                },
              })}
        />
      </Card>
      <div className={styles.smallCharts}>
        <SmallChart
          title={lagTitle}
          metric={lagMetric}
          yUnit="seconds"
          window={window}
          lines={series.lag}
          formatY={trimmed(2)}
          formatX={formatX}
          xDomain={xDomain}
        />
        <SmallChart
          title="Flush time p95"
          metric="telemetry_flush_duration_seconds"
          yUnit="ms"
          window={window}
          lines={series.flush}
          formatY={trimmed(1)}
          formatX={formatX}
          xDomain={xDomain}
        />
        <SmallChart
          title="Buffered readings"
          metric="telemetry_buffered_readings"
          yUnit="readings"
          window={window}
          lines={series.buffered}
          formatY={count}
          formatX={formatX}
          xDomain={xDomain}
        />
      </div>
    </div>
  );
}
