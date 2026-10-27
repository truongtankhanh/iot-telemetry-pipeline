import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { benchmarkFixture } from '../api/fixtures/benchmarkFixtures';
import { stateViewFixture } from '../api/fixtures/stateView';
import type { BenchmarkRunDetail, BenchmarkRunSummary } from '../api/types';
import { BenchmarkStore } from '../state/benchmarkStore';
import { StudioProvider } from '../state/StudioProvider';
import { createStudioStore } from '../state/store';
import { axeViolations } from '../test-axe';
import { BenchmarkBanner } from './BenchmarkBanner';
import { BenchmarkPill } from './DependencyPills';
import { Header } from './Header';

const NOW = Date.parse('2026-10-27T09:30:00.000Z');
const going = benchmarkFixture.current as BenchmarkRunDetail;

function summaryOf(change: Partial<BenchmarkRunSummary> = {}): BenchmarkRunSummary {
  const summary: Partial<BenchmarkRunDetail> = structuredClone(going);
  delete summary.series;
  return { ...(summary as BenchmarkRunSummary), ...change };
}

function setup(ui: ReactNode, benchmark = new BenchmarkStore()) {
  const store = createStudioStore();
  store.getState().setLink('live', NOW);
  store.getState().setView(structuredClone(stateViewFixture), NOW);
  const result = render(
    <StudioProvider store={store} benchmark={benchmark}>
      <MemoryRouter>{ui}</MemoryRouter>
    </StudioProvider>,
  );
  return { benchmark, ...result };
}

describe('BenchmarkPill', () => {
  it('draws nothing while no benchmark runs', () => {
    const { container } = setup(<BenchmarkPill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a link to Analytics that names the run and its phase, in words', () => {
    const benchmark = new BenchmarkStore();
    benchmark.applyEvent({ run: summaryOf(), point: null });
    setup(<BenchmarkPill />, benchmark);
    const link = screen.getByRole('link', { name: /Benchmark running/ });
    expect(link).toHaveAttribute('href', '/analytics');
    expect(link).toHaveTextContent('run 3 · publishing');
    expect(link).toHaveTextContent('warning');
  });

  it('follows the phase, and goes when the run ends', () => {
    const benchmark = new BenchmarkStore();
    benchmark.applyEvent({ run: summaryOf(), point: null });
    setup(<BenchmarkPill />, benchmark);

    act(() =>
      benchmark.applyEvent({
        run: summaryOf({ phase: 'waiting', elapsedMs: 20_000 }),
        point: null,
      }),
    );
    expect(screen.getByRole('link')).toHaveTextContent('waiting for the readings to be stored');

    act(() =>
      benchmark.applyEvent({
        run: summaryOf({ phase: 'ended', outcome: 'completed', elapsedMs: 30_000 }),
        point: null,
      }),
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is in the header of every page, and has no accessibility violation there', async () => {
    const benchmark = new BenchmarkStore();
    benchmark.applyEvent({ run: summaryOf(), point: null });
    const { container } = setup(<Header onOpenPalette={() => {}} />, benchmark);
    expect(screen.getByRole('link', { name: /Benchmark running/ })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('BenchmarkBanner', () => {
  it('draws nothing while no benchmark runs', () => {
    const { container } = setup(<BenchmarkBanner onAnalytics={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says why the controls that publish are locked, and links to the page that stops the run', () => {
    const benchmark = new BenchmarkStore();
    benchmark.applyEvent({ run: summaryOf(), point: null });
    setup(<BenchmarkBanner onAnalytics={false} />, benchmark);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      'A benchmark is running (run 3, publishing): the controls that publish are locked until it ends.',
    );
    expect(screen.getByRole('link', { name: 'Follow it or stop it on Analytics' })).toHaveAttribute(
      'href',
      '/analytics',
    );
  });

  it('is not repeated on the Analytics page, which says it itself', () => {
    const benchmark = new BenchmarkStore();
    benchmark.applyEvent({ run: summaryOf(), point: null });
    const { container } = setup(<BenchmarkBanner onAnalytics />, benchmark);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violation', async () => {
    const benchmark = new BenchmarkStore();
    benchmark.applyEvent({ run: summaryOf(), point: null });
    const { container } = setup(<BenchmarkBanner onAnalytics={false} />, benchmark);
    expect(await axeViolations(container)).toEqual([]);
  });
});
