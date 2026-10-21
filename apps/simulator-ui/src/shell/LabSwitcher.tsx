import { NavLink } from 'react-router';
import { type AppRoute, appRoutes } from '../lib/routes';
import styles from './labSwitcher.module.css';

// One array for the life of the window, as `App` keeps its own: the routes do not change while it runs.
const DEFAULT_ROUTES = appRoutes();

/** The Lab's own page is the workspace; its sub-pages keep their names. */
const labelOf = (route: AppRoute) => (route.parent === null ? 'Workspace' : route.label);

export interface LabSwitcherProps {
  /** The routes of the app. Defaults to the ones the window uses; a test passes its own. */
  routes?: readonly AppRoute[];
}

/**
 * The switch between the Simulation lab's pages (Workspace, Scenarios, Timeline, Faults), drawn like the frame's
 * segmented control but made of links: choosing a page is going to it, and the address says where you are. It is built from
 * the children of `/lab` in the routes, so a Lab page that is built later joins it without touching this file; a page that
 * is not built yet is still a link, to its placeholder. The current page is marked with `aria-current`.
 */
export function LabSwitcher({ routes = DEFAULT_ROUTES }: LabSwitcherProps) {
  const lab = routes.find((route) => route.path === '/lab');
  if (lab === undefined) return null;
  const pages = [lab, ...routes.filter((route) => route.parent === lab.path)];

  return (
    <nav className={styles.switcher} aria-label="Simulation lab">
      {pages.map((page) => (
        <NavLink key={page.path} to={page.path} end className={styles.link}>
          {labelOf(page)}
        </NavLink>
      ))}
    </nav>
  );
}
