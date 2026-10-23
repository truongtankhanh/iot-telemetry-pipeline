/** The glyph of a page in the navigation; `ui/icons.ts` maps each name to an icon. */
export type NavIconName =
  | 'overview'
  | 'fleet'
  | 'topology'
  | 'twin'
  | 'events'
  | 'alerts'
  | 'lab'
  | 'demo'
  | 'analytics'
  | 'foundations';

export interface AppRoute {
  path: string;
  label: string;
  icon: NavIconName;
  /** What the page is for, in a sentence (the brief's page table). */
  description: string;
  /** The ticket that builds the page, or finishes it for a page that is built in part. */
  ticket: string;
  /** Frames of docs/design/simulator/mockups that the page implements. */
  frames: string[];
  /** The letter after `g` that goes to the page; `null` for a page with none. */
  goKey: string | null;
  /** False while the page is the shared "not built yet" placeholder. */
  built: boolean;
  /** The path of the page this one is a sub-page of (the Lab's), or `null`. */
  parent: string | null;
  /** Not for the audience of a demo: left out of navigation and search in a packaged build. */
  internal: boolean;
}

const page = (
  path: string,
  label: string,
  icon: NavIconName,
  description: string,
  ticket: string,
  frames: string[],
  goKey: string | null,
  extra: Partial<Pick<AppRoute, 'built' | 'parent' | 'internal'>> = {},
): AppRoute => ({
  path,
  label,
  icon,
  description,
  ticket,
  frames,
  goKey,
  built: extra.built ?? false,
  parent: extra.parent ?? null,
  internal: extra.internal ?? false,
});

/**
 * The pages of the brief. Built so far: the Overview shell and Foundations (SIM-04), the Fleet (SIM-05), the Topology (SIM-06), the Alerts (SIM-07), the Lab's Scenarios (SIM-08), the Lab's workspace (SIM-10), the Lab's timeline editor (SIM-11), the Lab's faults (SIM-12), the Event stream (SIM-13) and the Guided demo (SIM-14); every other route
 * opens the shared placeholder that names the ticket which builds it, so nothing in the navigation or
 * the palette is a dead link.
 */
const ROUTES: AppRoute[] = [
  page(
    '/',
    'Overview',
    'overview',
    'Health of the simulated campus: KPIs, live topology, alerts, controls and the event timeline',
    'SIM-09',
    ['11'],
    'o',
    { built: true },
  ),
  page(
    '/fleet',
    'Fleet',
    'fleet',
    'Every device, its live values and per-device control',
    'SIM-05',
    ['01', '02', '18'],
    'f',
    { built: true },
  ),
  page(
    '/topology',
    'Topology',
    'topology',
    'Components, the direction of data and the state of each link',
    'SIM-06',
    ['04', '10'],
    't',
    { built: true },
  ),
  page(
    '/twin',
    'Twin',
    'twin',
    'The campus in 3D: buildings, device pins, data arcs and alert beacons',
    'SIM-18',
    ['14', '15', '16'],
    'w',
  ),
  page(
    '/events',
    'Events',
    'events',
    'What crosses the broker, newest first, with payloads',
    'SIM-13',
    ['06'],
    'e',
    { built: true },
  ),
  page(
    '/alerts',
    'Alerts',
    'alerts',
    'What the rules raised, why, and where each alert went',
    'SIM-07',
    ['13'],
    'a',
    { built: true },
  ),
  page(
    '/lab',
    'Lab',
    'lab',
    'Configure and inject a fault, and watch what it does',
    'SIM-10',
    ['12', '19'],
    'l',
    { built: true },
  ),
  page(
    '/lab/scenarios',
    'Scenarios',
    'lab',
    'Built-in and custom scenarios with the alerts they should raise',
    'SIM-08',
    ['03'],
    null,
    { parent: '/lab', built: true },
  ),
  page(
    '/lab/timeline',
    'Timeline',
    'lab',
    'Lanes per device, anomaly blocks and a preview against the thresholds',
    'SIM-11',
    ['05'],
    null,
    { parent: '/lab', built: true },
  ),
  page(
    '/lab/faults',
    'Faults',
    'lab',
    'Drop, duplicate, malformed, delay, reorder and burst',
    'SIM-12',
    ['07'],
    null,
    { parent: '/lab', built: true },
  ),
  page(
    '/demo',
    'Demo',
    'demo',
    'A scripted walk-through in presenter mode',
    'SIM-14',
    ['08'],
    'd',
    {
      built: true,
    },
  ),
  page(
    '/analytics',
    'Analytics',
    'analytics',
    'Session throughput, lag and rejections, and the benchmark',
    'SIM-15',
    ['09'],
    'n',
  ),
  page(
    '/foundations',
    'Foundations',
    'foundations',
    'Tokens, status language, motion and controls (internal)',
    'SIM-04',
    ['00'],
    null,
    { built: true, internal: true },
  ),
];

/**
 * `/foundations` is for the people who build Studio: it exists in development and in tests, and is left
 * out of a production build unless `VITE_STUDIO_FOUNDATIONS=true` is set at build time, so the packaged
 * demo has neither the route nor its code. (`__FOUNDATIONS__` is a constant `vite.config.ts` defines.)
 */
export const FOUNDATIONS_ENABLED: boolean = __FOUNDATIONS__;

export function appRoutes(options: { foundations?: boolean } = {}): AppRoute[] {
  const foundations = options.foundations ?? FOUNDATIONS_ENABLED;
  return ROUTES.filter((route) => foundations || !route.internal);
}

/** `/overview` is the Overview too (the brief names both); a trailing slash is not part of a path. */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return trimmed === '/overview' || trimmed === '' ? '/' : trimmed;
}

/**
 * The route a location belongs to: the longest route path that is the location or a parent of it at a
 * segment boundary, so `/fleet/dc-env-01` is the Fleet and `/fleetwood` is nothing.
 */
export function findRoute(routes: AppRoute[], pathname: string): AppRoute | undefined {
  const path = normalizePath(pathname);
  let best: AppRoute | undefined;
  for (const route of routes) {
    const matches =
      route.path === '/' ? path === '/' : path === route.path || path.startsWith(`${route.path}/`);
    if (matches && (best === undefined || route.path.length > best.path.length)) best = route;
  }
  return best;
}

export const routeByGoKey = (routes: AppRoute[], key: string): AppRoute | undefined =>
  routes.find((route) => route.goKey === key.toLowerCase());
