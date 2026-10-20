import type { ReactNode } from 'react';
import styles from './kbd.module.css';

/** A key cap: the shortcut shown beside the thing it triggers. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
