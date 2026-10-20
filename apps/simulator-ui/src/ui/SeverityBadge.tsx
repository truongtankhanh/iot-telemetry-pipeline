import type { Severity } from '../api/types';
import { Icon } from './Icon';
import { severityIcons } from './icons';
import styles from './status.module.css';

/** The severity of an alert: its icon, its word and an edge in its hue. The word stays primary text. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={styles.severity} data-severity={severity}>
      <span className={styles.severityIcon}>
        <Icon glyph={severityIcons[severity]} size="sm" />
      </span>
      {severity}
    </span>
  );
}
