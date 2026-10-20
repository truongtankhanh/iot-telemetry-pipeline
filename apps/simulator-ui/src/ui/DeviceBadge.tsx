import { kindIdentity } from '../lib/deviceIdentity';
import { type NodeStateName, nodeStateWord } from '../lib/nodeState';
import styles from './deviceBadge.module.css';
import { Icon } from './Icon';
import { deviceGlyphs } from './icons';

export interface DeviceBadgeProps {
  /** The `kind` of the device in the registry: it picks the shape and the glyph. */
  kind: string;
  /** The short code of the device (`DC·1`), from `deviceCode`. */
  code: string;
  /** The state, as an edge light and as words for a screen reader. */
  state?: NodeStateName;
  size?: 'md' | 'lg';
}

/**
 * A device recognisable without its name: a shape and a glyph for its kind and a code for the device.
 * The shape is the kind and the edge light is the state; colour and light are never identity.
 */
export function DeviceBadge({ kind, code, state, size = 'md' }: DeviceBadgeProps) {
  const identity = kindIdentity(kind);
  const label = `${identity.label} ${code}${state ? `, ${nodeStateWord(state).toLowerCase()}` : ''}`;
  return (
    <span className={styles.badge} data-size={size} role="img" aria-label={label}>
      <span className={styles.glyph} data-state={state}>
        <span className={styles.face} data-shape={identity.shape} data-state={state}>
          <Icon glyph={deviceGlyphs[identity.glyph]} size={size === 'lg' ? 'lg' : 'md'} />
        </span>
      </span>
      <span className={styles.code} aria-hidden="true">
        {code}
      </span>
    </span>
  );
}
