import type { ReactNode } from 'react';
import styles from './pageHeader.module.css';

/** The title of a page and one sentence on what it is for; `children` sits at the end (a status, a button). */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {children ? <div className={styles.end}>{children}</div> : null}
    </div>
  );
}
