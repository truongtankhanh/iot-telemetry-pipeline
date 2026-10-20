import { type ReactNode, useId } from 'react';
import styles from './card.module.css';

export interface CardProps {
  title: string;
  /** Something at the end of the title line (a chip, a button). */
  aside?: ReactNode;
  children: ReactNode;
}

/** A panel with a heading: the unit of a page. The section is named by its heading. */
export function Card({ title, aside, children }: CardProps) {
  const id = useId();
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={styles.head}>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
