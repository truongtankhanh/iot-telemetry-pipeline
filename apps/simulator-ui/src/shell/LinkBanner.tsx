import { formatClockTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { uiIcons } from '../ui/icons';
import styles from './linkBanner.module.css';

export interface LinkBannerProps {
  /** When the link to the simulator was lost (ms since the epoch). */
  lostSince: number;
  /** When data last arrived, or `null` if none ever did. */
  lastDataAt: number | null;
}

/**
 * Shown above the page while the link to the simulator is lost. Everything on the page is the last thing
 * it said, so the banner says so, with the time: Studio never looks healthy when it does not know. The
 * browser reconnects by itself, and the first message of a new connection brings the page up to date.
 */
export function LinkBanner({ lostSince, lastDataAt }: LinkBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <Icon glyph={uiIcons.disconnected} />
      <span>
        <strong>Lost the simulator at {formatClockTime(lostSince)}.</strong>{' '}
        {lastDataAt === null
          ? 'No data has arrived yet.'
          : `What is shown is the last data, from ${formatClockTime(lastDataAt)}.`}{' '}
        Retrying.
      </span>
    </div>
  );
}
