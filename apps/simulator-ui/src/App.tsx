import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { AnimationBudget } from './lib/animationBudget';
import { CommandPalette } from './palette/CommandPalette';
import { readRailPinned, writeRailPinned } from './lib/preferences';
import { type AppRoute, appRoutes, findRoute } from './lib/routes';
import { createShortcuts } from './lib/shortcuts';
import { NotBuilt } from './pages/NotBuilt';
import { Overview } from './pages/Overview';
import { Header } from './shell/Header';
import { LinkBanner } from './shell/LinkBanner';
import { Navigation } from './shell/Navigation';
import { Shell } from './shell/Shell';
import { HistoryStore } from './state/history';
import { ObservationLog } from './state/observationLog';
import { PulseBus } from './state/pulses';
import { connectStream } from './state/stream';
import { createStudioStore } from './state/store';
import { StudioProvider } from './state/StudioProvider';
import { useStudio, useStudioStore } from './state/studioContext';
import { AnimationBudgetProvider } from './ui/AnimationBudget';
import { PageHeader } from './ui/PageHeader';
import { Card } from './ui/Card';
import pagesStyles from './pages/pages.module.css';

// `__FOUNDATIONS__` is a literal constant: with it false the bundler drops the import, and the page's code
// with it, from the packaged demo.
const Foundations = __FOUNDATIONS__
  ? lazy(() => import('./pages/Foundations').then((module) => ({ default: module.Foundations })))
  : null;

// The Fleet is its own chunk: it brings the charts, the table and the inspector, which no other page needs yet.
const Fleet = lazy(() =>
  import('./pages/fleet/Fleet').then((module) => ({ default: module.Fleet })),
);

// The Topology is its own chunk: it brings React Flow, which no other page needs.
const Topology = lazy(() =>
  import('./pages/topology/Topology').then((module) => ({ default: module.Topology })),
);

// The Alerts is its own chunk: it brings the list, the trail and the paging, which no other page needs.
const Alerts = lazy(() =>
  import('./pages/alerts/Alerts').then((module) => ({ default: module.Alerts })),
);

// The Scenarios is its own chunk: it brings the cards, the charts and the replace dialog, which no other page needs.
const Scenarios = lazy(() =>
  import('./pages/scenarios/Scenarios').then((module) => ({ default: module.Scenarios })),
);

// The Lab is its own chunk: it brings the target picker, the zone list, the timeline dock and the graph, which no other
// page needs together.
const Lab = lazy(() => import('./pages/lab/Lab').then((module) => ({ default: module.Lab })));

// The timeline editor is its own chunk: it brings the editor's canvas, inspector and hooks, which no other page needs.
const Timeline = lazy(() =>
  import('./pages/timeline/Timeline').then((module) => ({ default: module.Timeline })),
);

// The Faults page is its own chunk: it brings the fault rows, the scope picker and the effect panel, which no other page needs.
const Faults = lazy(() =>
  import('./pages/faults/Faults').then((module) => ({ default: module.Faults })),
);

const TITLE = 'Simulator Studio';

// One array for the life of the window: the shortcuts and the palette's items are derived from it.
const DEFAULT_ROUTES = appRoutes();

/** What a path that is no page, and no sub-path of a page, shows. */
function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" description="Studio has no page at this address." />
      <Card title="Nothing here">
        <p>
          <Link className={pagesStyles.link} to="/">
            Back to the Overview
          </Link>
        </p>
      </Card>
    </>
  );
}

/**
 * A path under a page that exists (`/alerts/7`): a page that is built has no sub-paths, so it goes to the page
 * itself; one that is not built shows its placeholder.
 */
function Fallback({ routes }: { routes: AppRoute[] }) {
  const { pathname } = useLocation();
  const route = findRoute(routes, pathname);
  if (route === undefined) return <NotFound />;
  if (route.built) return <Navigate to={route.path} replace />;
  return <NotBuilt route={route} />;
}

function Pages({ routes }: { routes: AppRoute[] }) {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/overview" element={<Navigate to="/" replace />} />
      <Route
        path="/fleet"
        element={
          <Suspense fallback={<p role="status">Loading…</p>}>
            <Fleet />
          </Suspense>
        }
      />
      <Route
        path="/topology"
        element={
          <Suspense fallback={<p role="status">Loading…</p>}>
            <Topology />
          </Suspense>
        }
      />
      <Route
        path="/alerts"
        element={
          <Suspense fallback={<p role="status">Loading…</p>}>
            <Alerts />
          </Suspense>
        }
      />
      <Route
        path="/lab"
        element={
          <Suspense fallback={<p role="status">Loading…</p>}>
            <Lab />
          </Suspense>
        }
      />
      <Route
        path="/lab/scenarios"
        element={
          <Suspense fallback={<p role="status">Loading…</p>}>
            <Scenarios />
          </Suspense>
        }
      />
      <Route
        path="/lab/timeline"
        element={
          <Suspense fallback={<p role="status">Loading…</p>}>
            <Timeline />
          </Suspense>
        }
      />
      <Route
        path="/lab/faults"
        element={
          <Suspense fallback={<p role="status">Loading…</p>}>
            <Faults />
          </Suspense>
        }
      />
      {Foundations !== null && routes.some((route) => route.path === '/foundations') ? (
        <Route
          path="/foundations"
          element={
            <Suspense fallback={<p role="status">Loading…</p>}>
              <Foundations />
            </Suspense>
          }
        />
      ) : null}
      {routes
        .filter((route) => !route.built)
        .map((route) => (
          <Route key={route.path} path={route.path} element={<NotBuilt route={route} />} />
        ))}
      <Route path="*" element={<Fallback routes={routes} />} />
    </Routes>
  );
}

/**
 * Everything inside the router and the store: the shell, the pages, the palette, and the things that
 * belong to the window as a whole (the keyboard, the title, where focus goes when the page changes).
 * Exported so a test can render it with its own store and router, without a stream.
 */
export function StudioFrame({ routes = DEFAULT_ROUTES }: { routes?: AppRoute[] }) {
  const store = useStudioStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const lastDataAt = useStudio((state) => state.lastDataAt);
  const railPinned = useStudio((state) => state.railPinned);
  const paletteOpen = useStudio((state) => state.paletteOpen);
  const modalOpen = useStudio((state) => state.modalCount > 0);
  const current = findRoute(routes, pathname);

  const openPalette = () => store.getState().setPaletteOpen(true);

  const togglePinned = () => {
    const next = !store.getState().railPinned;
    store.getState().setRailPinned(next);
    writeRailPinned(next);
  };

  const shortcuts = useMemo(() => createShortcuts(routes), [routes]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcuts(event);
      if (action === null) return;
      event.preventDefault();
      if (action.type === 'open-palette') store.getState().setPaletteOpen(true);
      else navigate(action.path);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, store, navigate]);

  useEffect(() => {
    document.title = current ? `${current.label} · ${TITLE}` : TITLE;
  }, [current]);

  // A new page starts at its top for the keyboard and for a screen reader: `main` takes focus. Not on the
  // first render (the page just loaded), and not while the palette is open (⌘ Enter keeps it open and its
  // field must keep focus).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (store.getState().paletteOpen) return;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname, store]);

  return (
    <>
      <Shell
        header={<Header onOpenPalette={openPalette} />}
        navigation={
          <Navigation
            routes={routes}
            currentPath={pathname}
            pinned={railPinned}
            onTogglePinned={togglePinned}
          />
        }
        banner={
          link === 'lost' && lostSince !== null ? (
            <LinkBanner lostSince={lostSince} lastDataAt={lastDataAt} />
          ) : null
        }
        pinned={railPinned}
        inert={paletteOpen || modalOpen}
      >
        <Pages routes={routes} />
      </Shell>
      <CommandPalette routes={routes} />
    </>
  );
}

/**
 * Studio: one store for this window, fed by the simulator's event stream, and the router. The stream
 * opens when the app mounts and closes when it unmounts; the browser reconnects it by itself.
 */
export function App() {
  const [store] = useState(() => createStudioStore({ railPinned: readRailPinned() }));
  const [history] = useState(() => new HistoryStore());
  // Told when a device publishes, for the dots on the topology's edges.
  const [pulses] = useState(() => new PulseBus());
  // What the simulator saw happen (the last 5,000 observations), for the Overview's timeline.
  const [observations] = useState(() => new ObservationLog());
  // One animation budget for the window (12 animated nodes, 24 glowing lines). Without a provider nothing animates.
  const [budget] = useState(() => new AnimationBudget());
  useEffect(() => {
    const connection = connectStream(store, { history, pulses, observations });
    return () => {
      connection.close();
      history.dispose();
      pulses.dispose();
      observations.dispose();
    };
  }, [store, history, pulses, observations]);

  return (
    <StudioProvider store={store} history={history} pulses={pulses} observations={observations}>
      <AnimationBudgetProvider budget={budget}>
        <BrowserRouter>
          <StudioFrame />
        </BrowserRouter>
      </AnimationBudgetProvider>
    </StudioProvider>
  );
}
