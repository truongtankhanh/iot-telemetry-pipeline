import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './api/fixtures/state-view.json';
import type { StateView } from './api/types';
import { StudioFrame } from './App';
import { appRoutes } from './lib/routes';
import { createStudioStore, type StudioStore } from './state/store';
import { StudioProvider } from './state/StudioProvider';
import { axeViolations } from './test-axe';

const base = fixture as StateView;
const NOW = Date.parse('2026-10-20T09:15:00.000Z');

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
}: {
  path?: string;
  store?: StudioStore;
  view?: StateView | null;
  routes?: ReturnType<typeof appRoutes>;
} = {}) {
  store.getState().setLink('live', NOW);
  if (view !== null) store.getState().setView(view, NOW);
  const result = render(
    <StudioProvider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <StudioFrame routes={routes} />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { store, ...result };
}

/** The header's dependency pills (the Overview draws the same pills again in its connection card). */
const pill = (name: string) => {
  const group = screen.getByRole('group', { name: 'Dependencies' });
  const element = within(group).getByText(name).closest('[data-tone]');
  if (element === null) throw new Error(`no pill named ${name}`);
  return element as HTMLElement;
};

afterEach(() => {
  vi.restoreAllMocks();
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
    renderStudio();
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('link', {
        name: /Fleet/,
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeInTheDocument();
    expect(screen.getByText('Coming with SIM-05')).toBeInTheDocument();
    expect(document.title).toBe('Fleet · Simulator Studio');
  });

  it('moves focus to the page when the route changes, and marks the current page', async () => {
    renderStudio();
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('link', { name: /Overview/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await userEvent.click(within(nav).getByRole('link', { name: /Alerts/ }));
    expect(document.getElementById('main')).toHaveFocus();
    expect(within(nav).getByRole('link', { name: /Alerts/ })).toHaveAttribute(
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

  it('treats a path under a page as that page, and an unknown path as not found', () => {
    const first = renderStudio({ path: '/fleet/dc-env-01' });
    expect(screen.getByText('Coming with SIM-05')).toBeInTheDocument();
    first.unmount();
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
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeInTheDocument();
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
    expect(screen.getByRole('combobox')).toHaveValue('gf');
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

describe('accessibility', () => {
  it('has no violations on the Overview, a placeholder and Foundations', async () => {
    const overview = renderStudio();
    expect(await axeViolations(overview.container)).toEqual([]);
    overview.unmount();

    const placeholder = renderStudio({ path: '/fleet' });
    expect(await axeViolations(placeholder.container)).toEqual([]);
    placeholder.unmount();

    const foundations = renderStudio({ path: '/foundations' });
    await screen.findByRole('heading', { level: 1, name: 'Foundations' });
    expect(await axeViolations(foundations.container)).toEqual([]);
  });
});
