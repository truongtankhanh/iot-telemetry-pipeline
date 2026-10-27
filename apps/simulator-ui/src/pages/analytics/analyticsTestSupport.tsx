/**
 * What the tests of the Analytics page share: a fake simulator behind `fetch` that answers the four benchmark routes (the checks, a start,
 * a stop, the detail) and records what was sent, builders for runs, and a harness that renders the page with its own store, benchmark
 * and session metrics. Not a `*.test.tsx`, so Vitest does not run it as a test file.
 */
import { act, render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { benchmarkFixture, benchmarkPreflightFixture } from '../../api/fixtures/benchmarkFixtures';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type {
  BenchmarkCheck,
  BenchmarkRunDetail,
  BenchmarkRunSummary,
  StateView,
} from '../../api/types';
import { BenchmarkStore } from '../../state/benchmarkStore';
import { SessionMetricsStore } from '../../state/sessionMetricsStore';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { Analytics } from './Analytics';

export const NOW = Date.parse('2026-10-27T09:30:00.000Z');

/** The run going in the benchmark fixture, and its summary (what an event and a snapshot carry). */
export const GOING = benchmarkFixture.current as BenchmarkRunDetail;
export const FINISHED = benchmarkFixture.runs as [BenchmarkRunDetail, BenchmarkRunDetail];

export function summaryOf(run: BenchmarkRunDetail): BenchmarkRunSummary {
  const summary: Partial<BenchmarkRunDetail> = structuredClone(run);
  delete summary.series;
  return summary as BenchmarkRunSummary;
}

/** The state view of a healthy stack on which a benchmark can run. */
export function benchmarkView(change: (view: StateView) => void = () => {}): StateView {
  const view = structuredClone(stateViewFixture);
  change(view);
  return view;
}

export const failingCheck = (id: BenchmarkCheck['id'], reason: string): BenchmarkCheck => ({
  id,
  label: { ingest: 'Ingest ready', database: 'Database reachable', fleet: 'Fleet paused' }[id],
  ok: false,
  reason,
});

export interface Sent {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeBenchmarkSimulator {
  fetch: ReturnType<typeof vi.fn>;
  /** Everything but the reads of the checks, in order. */
  sent: Sent[];
  /** The checks `GET /api/benchmark/preflight` answers; change it between reads. */
  checks: BenchmarkCheck[];
  /** When set, a start is refused with this status, sentence and extra fields of the body. */
  refuse: { status: number; message: string; extra?: object } | null;
  /** When set, a stop waits until `releaseStop()`; a stop that is not held answers at once. */
  holdStop: boolean;
  releaseStop(): void;
}

export function fakeBenchmarkSimulator(view: StateView = benchmarkView()): FakeBenchmarkSimulator {
  const sent: Sent[] = [];
  const stops: (() => void)[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const simulator: FakeBenchmarkSimulator = {
    fetch: vi.fn(),
    sent,
    checks: structuredClone(benchmarkPreflightFixture.checks),
    refuse: null,
    holdStop: false,
    releaseStop: () => stops.splice(0).forEach((release) => release()),
  };

  simulator.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname;
    const method = init?.method ?? 'GET';
    if (path === '/api/benchmark/preflight') return json({ checks: simulator.checks });
    if (path === '/api/benchmark' && method === 'GET') return json({ benchmark: benchmarkFixture });

    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    sent.push({ method, path, body });

    if (path === '/api/benchmark' && method === 'POST') {
      const refusal = simulator.refuse;
      if (refusal !== null) {
        return json(
          {
            statusCode: refusal.status,
            error: 'Refused',
            message: refusal.message,
            ...refusal.extra,
          },
          refusal.status,
        );
      }
      const messages = (body as { messages: number }).messages;
      const run: BenchmarkRunSummary = {
        ...summaryOf(GOING),
        id: 4,
        phase: 'starting',
        elapsedMs: 0,
        published: 0,
        stored: 0,
        settings: { ...GOING.settings, messages },
      };
      return json({ ...view, run });
    }
    if (path === '/api/benchmark/stop' && method === 'POST') {
      if (simulator.holdStop) {
        await new Promise<void>((resolve) => stops.push(resolve));
      }
      return json(view);
    }
    return json({ statusCode: 404, error: 'Not Found', message: path }, 404);
  });
  return simulator;
}

export interface RenderedAnalytics extends RenderResult {
  store: StudioStore;
  benchmark: BenchmarkStore;
  sessionMetrics: SessionMetricsStore;
  simulator: FakeBenchmarkSimulator;
  /** Gives the benchmark an event, as the stream does. */
  emit(run: BenchmarkRunSummary, point?: BenchmarkRunDetail['series'][number]): void;
}

/** Renders the page against a fake simulator. `view: null` is the moment before the first message. */
export function renderAnalytics(
  options: {
    view?: StateView | null;
    link?: LinkState;
    benchmark?: BenchmarkStore;
    simulator?: FakeBenchmarkSimulator;
  } = {},
): RenderedAnalytics {
  const view = options.view === undefined ? benchmarkView() : options.view;
  const simulator = options.simulator ?? fakeBenchmarkSimulator(view ?? benchmarkView());
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(options.link ?? 'live', NOW);
  if (view !== null) store.getState().setView(view, NOW);
  const benchmark = options.benchmark ?? new BenchmarkStore();
  const sessionMetrics = new SessionMetricsStore();

  const result = render(
    <StudioProvider store={store} benchmark={benchmark} sessionMetrics={sessionMetrics}>
      <MemoryRouter initialEntries={['/analytics']}>
        <Analytics />
      </MemoryRouter>
    </StudioProvider>,
  );
  return {
    ...result,
    store,
    benchmark,
    sessionMetrics,
    simulator,
    emit: (run, point) => act(() => benchmark.applyEvent({ run, point: point ?? null })),
  };
}
