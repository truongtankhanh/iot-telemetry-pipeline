import { Link } from 'react-router';
import { type AppRoute, findRoute } from '../lib/routes';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { navIcons, uiIcons } from '../ui/icons';
import styles from './navigation.module.css';

export interface NavigationProps {
  routes: AppRoute[];
  /** The path of the page on show. */
  currentPath: string;
  /** Whether the rail is pinned open (from 1600 px). */
  pinned: boolean;
  onTogglePinned: () => void;
}

/**
 * The pages, as links. Below 1600 px each has its label; from 1600 px they are icons that show their
 * labels on hover and on keyboard focus, or all the time when pinned. The label is always in the text of
 * the link, only clipped on the rail, so a screen reader reads the same list either way. A page that is
 * not built yet is a link like any other: it opens the placeholder, and says so.
 */
export function Navigation({ routes, currentPath, pinned, onTogglePinned }: NavigationProps) {
  const active = findRoute(routes, currentPath)?.path;
  const top = routes.filter((route) => route.parent === null && !route.internal);
  const internal = routes.filter((route) => route.internal);

  const item = (route: AppRoute, child = false) => (
    <Link
      to={route.path}
      className={styles.item}
      aria-current={route.path === active ? 'page' : undefined}
      data-built={route.built ? 'true' : 'false'}
      data-child={child ? 'true' : undefined}
      data-ancestor={active?.startsWith(`${route.path}/`) ? 'true' : undefined}
      title={route.built ? route.description : `Not built yet · ${route.ticket}`}
    >
      <Icon glyph={navIcons[route.icon]} />
      <span className={styles.label}>{route.label}</span>
      {route.built ? null : <span className="visually-hidden"> (not built yet)</span>}
    </Link>
  );

  return (
    <nav className={styles.nav} aria-label="Pages" data-pinned={pinned ? 'true' : 'false'}>
      <div className={styles.panel}>
        <ul className={styles.list}>
          {top.map((route) => {
            const children = routes.filter((r) => r.parent === route.path);
            const open = active === route.path || active?.startsWith(`${route.path}/`);
            return (
              <li key={route.path}>
                {item(route)}
                {children.length > 0 && open ? (
                  <ul className={styles.sub}>
                    {children.map((child) => (
                      <li key={child.path}>{item(child, true)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {internal.length > 0 ? (
          <>
            <p className={styles.heading}>Internal</p>
            <ul className={styles.list}>
              {internal.map((route) => (
                <li key={route.path}>{item(route)}</li>
              ))}
            </ul>
          </>
        ) : null}
        <div className={styles.foot}>
          <Button
            variant="ghost"
            size="sm"
            icon={pinned ? uiIcons.pinOff : uiIcons.pin}
            aria-pressed={pinned}
            onClick={onTogglePinned}
          >
            <span className={styles.label}>{pinned ? 'Unpin the rail' : 'Pin the rail open'}</span>
          </Button>
        </div>
      </div>
    </nav>
  );
}
