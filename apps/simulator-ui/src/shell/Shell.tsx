import type { ReactNode } from 'react';
import styles from './shell.module.css';

export interface ShellProps {
  header: ReactNode;
  navigation: ReactNode;
  /** A notice above the page (the simulator was lost). */
  banner?: ReactNode;
  /** Whether the navigation is pinned open on a wide screen; the CSS widens the first column. */
  pinned: boolean;
  /** Takes the whole shell out of the tab order and the reading order, while a dialog is above it. */
  inert?: boolean;
  children: ReactNode;
}

/**
 * The frame of every page: the header across the top, the navigation on the left (labelled below 1600 px,
 * an icon rail from 1600 px) and the page. It has no maximum width: a stage page takes all that the side
 * panels leave. On a wall (2560 px and up) the whole UI is scaled. The skip link is the first stop of the
 * keyboard, and `main` takes focus when the route changes.
 */
export function Shell({ header, navigation, banner, pinned, inert, children }: ShellProps) {
  return (
    <div className={styles.app} data-pinned={pinned ? 'true' : 'false'} inert={inert}>
      <a className={styles.skip} href="#main">
        Skip to the page
      </a>
      <header className={styles.header}>{header}</header>
      <div className={styles.nav}>{navigation}</div>
      <main id="main" className={styles.main} tabIndex={-1}>
        {banner}
        {children}
      </main>
    </div>
  );
}
