import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { toneIcons, uiIcons } from './icons';
import styles from './banner.module.css';

export interface BannerProps {
  /** `warn` asks for attention (faults are on); `info` explains. */
  tone: 'warn' | 'info';
  children: ReactNode;
}

/**
 * A sentence the page wants read, with an icon: a warning says it in amber and a dashed border, an explanation in the
 * neutral colours. It is a polite live region, so a change in its words (the count of faults) is announced without taking
 * focus. The icon and the border are not the only signal: the words are.
 */
export function Banner({ tone, children }: BannerProps) {
  return (
    <div className={styles.banner} data-tone={tone} role="status">
      <Icon glyph={tone === 'warn' ? toneIcons.warn : uiIcons.info} />
      <span>{children}</span>
    </div>
  );
}
