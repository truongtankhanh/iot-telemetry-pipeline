import { describe, expect, it } from 'vitest';
import { appRoutes, findRoute, normalizePath, routeByGoKey } from './routes';

const routes = appRoutes({ foundations: true });

describe('appRoutes', () => {
  it('has the pages of the brief, each path and each go-key once', () => {
    const paths = routes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      '/',
      '/fleet',
      '/topology',
      '/twin',
      '/events',
      '/alerts',
      '/lab',
      '/lab/scenarios',
      '/lab/timeline',
      '/lab/faults',
      '/demo',
      '/analytics',
      '/foundations',
    ]);
    const keys = routes.map((r) => r.goKey).filter((k) => k !== null);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('builds the Overview, the Fleet, the Topology, the Twin (a spike), the Events, the Alerts, the Lab with its scenarios, timeline and faults, the Demo, and Foundations only; every other page names the ticket that builds it', () => {
    expect(routes.filter((r) => r.built).map((r) => r.path)).toEqual([
      '/',
      '/fleet',
      '/topology',
      '/twin',
      '/events',
      '/alerts',
      '/lab',
      '/lab/scenarios',
      '/lab/timeline',
      '/lab/faults',
      '/demo',
      '/foundations',
    ]);
    for (const route of routes.filter((r) => !r.built)) {
      expect(route.ticket).toMatch(/^SIM-\d\d$/);
      expect(route.frames.length).toBeGreaterThan(0);
    }
  });

  it('leaves Foundations out when it is not enabled, and keeps everything else', () => {
    const packaged = appRoutes({ foundations: false });
    expect(packaged.some((r) => r.path === '/foundations')).toBe(false);
    expect(packaged).toHaveLength(routes.length - 1);
  });

  it('puts the Lab sub-pages under the Lab', () => {
    expect(routes.filter((r) => r.parent === '/lab').map((r) => r.path)).toEqual([
      '/lab/scenarios',
      '/lab/timeline',
      '/lab/faults',
    ]);
  });
});

describe('normalizePath', () => {
  it('treats /overview as the Overview and drops a trailing slash', () => {
    expect(normalizePath('/overview')).toBe('/');
    expect(normalizePath('/overview/')).toBe('/');
    expect(normalizePath('/fleet/')).toBe('/fleet');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});

describe('findRoute', () => {
  it('finds a page, and the page a deeper location belongs to', () => {
    expect(findRoute(routes, '/')?.path).toBe('/');
    expect(findRoute(routes, '/overview')?.path).toBe('/');
    expect(findRoute(routes, '/fleet')?.path).toBe('/fleet');
    expect(findRoute(routes, '/fleet/dc-env-01')?.path).toBe('/fleet');
  });

  it('prefers the longest match, so a Lab sub-page is not the Lab', () => {
    expect(findRoute(routes, '/lab')?.path).toBe('/lab');
    expect(findRoute(routes, '/lab/faults')?.path).toBe('/lab/faults');
    expect(findRoute(routes, '/lab/other')?.path).toBe('/lab');
  });

  it('finds nothing for a location that is no page', () => {
    expect(findRoute(routes, '/fleetwood')).toBeUndefined();
    expect(findRoute(routes, '/nothing')).toBeUndefined();
  });

  it('does not find Foundations when it is left out', () => {
    expect(findRoute(appRoutes({ foundations: false }), '/foundations')).toBeUndefined();
  });
});

describe('routeByGoKey', () => {
  it('maps the letters after g to pages, in either case', () => {
    expect(routeByGoKey(routes, 'o')?.path).toBe('/');
    expect(routeByGoKey(routes, 'F')?.path).toBe('/fleet');
    expect(routeByGoKey(routes, 'n')?.path).toBe('/analytics');
    expect(routeByGoKey(routes, 'x')).toBeUndefined();
  });
});
