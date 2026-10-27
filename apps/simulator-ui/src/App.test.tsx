import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { benchmarkFixture } from './api/fixtures/benchmarkFixtures';
import scenariosFixture from './api/fixtures/scenarios.json';
import { stateViewFixture as fixture } from './api/fixtures/stateView';
import type { BenchmarkRunDetail, BenchmarkRunSummary, StateView } from './api/types';
import { StudioFrame } from './App';
import { type AppRoute, appRoutes } from './lib/routes';
import { BenchmarkStore } from './state/benchmarkStore';
import { DemoSessionStore } from './state/demoSessionStore';
import { createStudioStore, type StudioStore } from './state/store';
import { StudioProvider } from './state/StudioProvider';
import { installReactFlowStubs } from './pages/topology/topologyTestSupport';
import { axeViolations } from './test-axe';

const base = fixture;
const NOW = Date.parse('2026-10-20T09:15:00.000Z');

/**
 * Every page of the brief is built, so the placeholder of a page that is not is exercised with a route that is declared not
 * built: it has no `<Route>` of its own, and so opens `NotBuilt`.
 */
const later: AppRoute = {
  path: '/later',
  label: 'Later',
  icon: 'analytics',
  description: 'A page that a later ticket builds',
  ticket: 'SIM-99',
  frames: ['99'],
  goKey: null,
  built: false,
  parent: null,
  internal: false,
};
const routesWithLater = [...appRoutes({ foundations: true }), later];

const viewWith = (change: (view: StateView) => void = () => {}) => {
  const view = structuredClone(base);
  change(view);
  return view;
};

function renderStudio({
  path = '/',
  store = createStudioStore(),
  view = base as StateView | null,
  routes = appRoutes({ foundations: true }),
  demo,
  benchmark,
}: {
  path?: string;
  store?: StudioStore;
  view?: StateView | null;
  routes?: ReturnType<typeof appRoutes>;
  /** The guided demo's session; a test that presents a demo passes one that has started. */
  demo?: DemoSessionStore;
  /** The benchmark of the window; a test that has a run going passes one with it. */
  benchmark?: BenchmarkStore;
} = {}) {
  store.getState().setLink('live', NOW);
  if (view !== null) store.getState().setView(view, NOW);
  const result = render(
    <StudioProvider store={store} demo={demo} benchmark={benchmark}>
      <MemoryRouter initialEntries={[path]}>
        <StudioFrame routes={routes} />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { store, ...result };
}

/** The header's dependency pills. */
const pill = (name: string) => {
  const group = screen.getByRole('group', { name: 'Dependencies' });
  const element = within(group).getByText(name).closest('[data-tone]');
  if (element === null) throw new Error(`no pill named ${name}`);
  return element as HTMLElement;
};

// The Overview draws the topology, which needs the stand-ins React Flow asks of a browser.
let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());

// The Overview reads the scenario library when it opens: a simulator that answers it, and nothing else.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new URL(url, 'http://localhost').pathname === '/api/scenarios'
        ? new Response(JSON.stringify(scenariosFixture), { status: 200 })
        : new Response(JSON.stringify({ statusCode: 404, error: 'Not Found', message: url }), {
            status: 404,
          }),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the header pills (the acceptance criteria of SIM-04)', () => {
  it('shows the broker, ingest and the command center as ready when the pipeline is', () => {
    renderStudio();
    expect(pill('Broker')).toHaveAttribute('data-tone', 'ok');
    expect(pill('Broker')).toHaveTextContent(':1883');
    expect(pill('Ingest')).toHaveAttribute('data-tone', 'ok');
    expect(pill('Command Center')).toHaveAttribute('data-tone', 'ok');
    expect(pill('Command Center')).not.toHaveAttribute('data-stale');
  });

  it('says "unreachable" for ingest when it does not answer, and dims what it knew of the command center', () => {
    const { store } = renderStudio();
    act(() => {
      store.getState().setView(
        viewWith((view) => {
          view.ingest.status = 'unreachable';
          view.ingest.alertSink = null;
        }),
        NOW,
      );
    });
    expect(pill('Ingest')).toHaveAttribute('data-tone', 'bad');
    expect(pill('Ingest')).toHaveTextContent('unreachable');
    expect(pill('Command Center')).toHaveAttribute('data-stale', 'true');
  });

  it('says "not configured" when ingest has no alert sink, so a no-op sink is never silent', () => {
    renderStudio({ view: viewWith((view) => void (view.ingest.alertSink = 'none')) });
    expect(pill('Command Center')).toHaveAttribute('data-tone', 'warn');
    expect(pill('Command Center')).toHaveTextContent('not configured');
  });

  it('shows every pill as unknown before the first message', () => {
    renderStudio({ view: null });
    for (const name of ['Broker', 'Ingest', 'Command Center']) {
      expect(pill(name)).toHaveAttribute('data-tone', 'unknown');
    }
  });

  it('puts up a banner and dims every pill when the link to the simulator is lost', () => {
    const { store } = renderStudio();
    expect(screen.queryByText(/Lost the simulator/)).not.toBeInTheDocument();
    act(() => store.getState().setLink('lost', NOW + 5000));
    expect(screen.getByText(/Lost the simulator at/)).toBeInTheDocument();
    for (const name of ['Broker', 'Ingest', 'Command Center']) {
      expect(pill(name)).toHaveAttribute('data-stale', 'true');
    }
  });
});

describe('navigation', () => {
  it('opens a page that is not built yet on the placeholder that names its ticket', async () => {
    renderStudio({ routes: routesWithLater });
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('link', {
        name: /Later/,
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Later' })).toBeInTheDocument();
    expect(screen.getByText('Coming with SIM-99')).toBeInTheDocument();
    expect(document.title).toBe('Later · Simulator Studio');
  });

  it('moves focus to the page when the route changes, and marks the current page', async () => {
    renderStudio({ routes: routesWithLater });
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('link', { name: /Overview/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await userEvent.click(within(nav).getByRole('link', { name: /Later/ }));
    expect(document.getElementById('main')).toHaveFocus();
    expect(within(nav).getByRole('link', { name: /Later/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the sub-pages of the Lab only on the Lab, each a link', () => {
    renderStudio({ path: '/lab/faults' });
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('link', { name: /Faults/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: /Scenarios/ })).toBeInTheDocument();
  });

  it('opens the Faults page from the Lab, and a path under it goes to the page, not to a placeholder', async () => {
    const first = renderStudio({ path: '/lab/faults' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Faults' })).toBeInTheDocument();
    expect(screen.queryByText(/Coming with SIM-12/)).not.toBeInTheDocument();
    first.unmount();
    renderStudio({ path: '/lab/faults/drop' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Faults' })).toBeInTheDocument();
  });

  it('treats a path under a page that is not built as that page, one under a built page as the page, and an unknown path as not found', async () => {
    const first = renderStudio({ path: '/later/7', routes: routesWithLater });
    expect(screen.getByText('Coming with SIM-99')).toBeInTheDocument();
    first.unmount();
    const built = renderStudio({ path: '/fleet/dc-env-01' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Device fleet' }),
    ).toBeInTheDocument();
    built.unmount();
    renderStudio({ path: '/nowhere' });
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('sends /overview to the Overview', () => {
    renderStudio({ path: '/overview' });
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });
});

describe('Foundations', () => {
  it('is registered in development and in tests', async () => {
    renderStudio({ path: '/foundations' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Foundations' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Foundations/ })).toBeInTheDocument();
  });

  it('is left out, route and link, when the build does not enable it', () => {
    renderStudio({ path: '/foundations', routes: appRoutes({ foundations: false }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Foundations/ })).not.toBeInTheDocument();
  });
});

describe('the rail pin', () => {
  const pinButton = () => screen.getByRole('button', { name: /the rail/i });

  it('is remembered for the next visit', async () => {
    renderStudio();
    expect(pinButton()).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(pinButton());
    expect(pinButton()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('studio.railPinned')).toBe('true');
  });

  it('still works for this visit when storage refuses to write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    renderStudio();
    await userEvent.click(pinButton());
    expect(pinButton()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the keyboard', () => {
  it('goes to a page with g then its letter', async () => {
    renderStudio();
    await userEvent.keyboard('gf');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Device fleet' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('go');
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });

  it('opens the palette with ⌘ K, Ctrl K and /', async () => {
    renderStudio();
    for (const keys of ['{Meta>}k{/Meta}', '{Control>}k{/Control}', '/']) {
      await userEvent.keyboard(keys);
      expect(screen.getByRole('dialog', { name: 'Search and go to' })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  });

  it('keeps a letter typed in a field a letter', async () => {
    renderStudio();
    await userEvent.click(screen.getByRole('button', { name: /Search devices/ }));
    await userEvent.keyboard('gf');
    expect(screen.getByRole('combobox', { name: /Search devices/ })).toHaveValue('gf');
    // The page is inert while the palette is open, which a role query may or may not see through.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Overview', hidden: true }),
    ).toBeInTheDocument();
  });

  it('takes the page out of the tab order while the palette is open', async () => {
    renderStudio();
    await userEvent.keyboard('/');
    await waitFor(() => expect(document.querySelector('[inert]')).not.toBeNull());
  });
});

describe('the palette’s actions', () => {
  it('open the Overview with the scenario picked, and run nothing', async () => {
    renderStudio({ path: '/later', routes: routesWithLater });
    await userEvent.keyboard('/');
    await userEvent.keyboard('>run crowded');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Scenario' })).toHaveValue(
      'crowded-lecture',
    );
    const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(calls.some((url) => url.includes('/run'))).toBe(false);
  });

  it('open the Overview with the control focused, after the page has moved focus to itself', async () => {
    renderStudio({ path: '/later', routes: routesWithLater });
    await userEvent.keyboard('/');
    await userEvent.keyboard('>reset');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus());
  });
});

describe('the guided demo', () => {
  const presenting = () => {
    const demo = new DemoSessionStore();
    demo.dispatch({ type: 'start', scriptId: 'overheat-to-incident', stepCount: 6, now: NOW });
    return demo;
  };

  it('opens the Demo page and not the placeholder, with the navigation, until a demo is presented', async () => {
    renderStudio({ path: '/demo' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Guided demo' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Coming with SIM-14/)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start presenter' })).toBeInTheDocument();
    expect(document.title).toBe('Demo · Simulator Studio');
  });

  it('goes to the Demo with g then d', async () => {
    renderStudio({ path: '/fleet' });
    await userEvent.keyboard('gd');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Guided demo' }),
    ).toBeInTheDocument();
  });

  it('drops the navigation and swaps the header while a demo is presented, and brings them back on Esc, without stopping anything', async () => {
    const demo = presenting();
    renderStudio({ path: '/demo', demo });
    expect(await screen.findByRole('button', { name: /Exit presenter/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
    expect(screen.getByText('Step 1 of 6', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Demo steps' })).toBeInTheDocument();

    const writes = () =>
      vi.mocked(fetch).mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET').length;
    const before = writes();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Exit presenter/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resume at step 1' })).toBeInTheDocument();
    expect(demo.get().status).toBe('paused-for-exit');
    expect(writes()).toBe(before);
  });

  it('exits from the header’s button too', async () => {
    const demo = presenting();
    renderStudio({ path: '/demo', demo });
    await userEvent.click(await screen.findByRole('button', { name: /Exit presenter/ }));
    expect(demo.get().status).toBe('paused-for-exit');
    expect(await screen.findByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
  });

  it('is presenter mode on the Demo page only: the same session on another page has the ordinary shell', async () => {
    renderStudio({ path: '/fleet', demo: presenting() });
    expect(await screen.findByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Exit presenter/ })).toBeNull();
  });
});

describe('Analytics and the benchmark (SIM-15)', () => {
  const going = benchmarkFixture.current as BenchmarkRunDetail;
  const summary = (): BenchmarkRunSummary => {
    const run: Partial<BenchmarkRunDetail> = structuredClone(going);
    delete run.series;
    return run as BenchmarkRunSummary;
  };
  const runningBenchmark = () => {
    const benchmark = new BenchmarkStore();
    benchmark.applyEvent({ run: summary(), point: null });
    return benchmark;
  };

  it('opens the Analytics page and not the placeholder, and goes to it with g then n', async () => {
    renderStudio({ path: '/fleet' });
    await userEvent.keyboard('gn');
    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(screen.queryByText(/Coming with SIM-15/)).not.toBeInTheDocument();
    expect(document.title).toBe('Analytics · Simulator Studio');
  });

  it('sends a path under the page to the page', async () => {
    renderStudio({ path: '/analytics/7' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
  });

  it('says on every other page that a benchmark runs, in the header and above the page', async () => {
    renderStudio({ path: '/fleet', benchmark: runningBenchmark() });
    expect(await screen.findByRole('link', { name: /Benchmark running/ })).toHaveAttribute(
      'href',
      '/analytics',
    );
    expect(
      screen.getByText(/the controls that publish are locked until it ends/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Follow it or stop it on Analytics' }),
    ).toBeInTheDocument();
  });

  it('does not repeat the banner on Analytics, which says it itself, and keeps the pill', async () => {
    renderStudio({ path: '/analytics', benchmark: runningBenchmark() });
    expect(await screen.findByRole('button', { name: 'Stop run' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Follow it or stop it on Analytics' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Benchmark running/ })).toBeInTheDocument();
  });

  it('shows the pill in the presenter’s header too', async () => {
    const demo = new DemoSessionStore();
    demo.dispatch({ type: 'start', scriptId: 'overheat-to-incident', stepCount: 6, now: NOW });
    renderStudio({ path: '/demo', demo, benchmark: runningBenchmark() });
    expect(await screen.findByRole('button', { name: /Exit presenter/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Benchmark running/ })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations on the Overview, a placeholder and Foundations', async () => {
    const overview = renderStudio();
    expect(await axeViolations(overview.container)).toEqual([]);
    overview.unmount();

    const placeholder = renderStudio({ path: '/later', routes: routesWithLater });
    expect(await axeViolations(placeholder.container)).toEqual([]);
    placeholder.unmount();

    const foundations = renderStudio({ path: '/foundations' });
    await screen.findByRole('heading', { level: 1, name: 'Foundations' });
    expect(await axeViolations(foundations.container)).toEqual([]);
  });
});
