import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';
import { Icon } from './Icon';
import type { Glyph } from './icons';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: Glyph;
  /**
   * Shows a state without a pointer (the Foundations page lists them side by side). Never used by a
   * page: a real control gets its states from the pointer and the keyboard.
   */
  demoState?: 'hover' | 'pressed' | 'focus';
  /** A button with only an icon has no text: it needs an `aria-label`. */
  children?: ReactNode;
}

/**
 * A control that acts. It lights up when it can (an indigo edge for the primary action, cyan on hover and
 * focus, red for danger) and has no light when disabled. Every state answers within 120 ms, a press drops
 * it by a pixel, a disabled one shows `not-allowed`.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  demoState,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-demo={demoState}
      data-icon-only={icon && children === undefined ? 'true' : undefined}
      {...rest}
    >
      {icon ? (
        <Icon glyph={icon} size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md'} />
      ) : null}
      {children}
    </button>
  );
}
