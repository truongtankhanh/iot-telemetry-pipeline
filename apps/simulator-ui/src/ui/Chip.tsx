import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { Glyph } from './icons';
import styles from './status.module.css';

export interface ChipProps {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';
  /** A glyph before the words: a state is never colour alone. */
  icon?: Glyph;
  children: ReactNode;
}

/** A small label on a 12 % tint: the state of a thing in a table or a card. */
export function Chip({ tone = 'neutral', icon, children }: ChipProps) {
  return (
    <span className={styles.chip} data-tone={tone}>
      {icon ? <Icon glyph={icon} size="sm" /> : null}
      {children}
    </span>
  );
}
