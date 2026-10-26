import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { type FallbackReason, fallbackNotice } from '../../lib/twinStatus';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import pagesStyles from '../pages.module.css';
import styles from './twin.module.css';

// The Topology is already its own chunk (the router loads the same one); it is requested here only when the twin cannot
// be drawn, so a device that can draw the scene never downloads React Flow on this page.
const Topology = lazy(() =>
  import('../topology/Topology').then((module) => ({ default: module.Topology })),
);

export interface TwinFallbackProps {
  reason: FallbackReason;
  /** Asks the layout again; offered only for a reason that a second try can help. */
  onRetry?: () => void;
}

/**
 * What `/twin` shows when the twin is not drawn (frame 16): the reason, in words that say what Studio shows instead, and
 * the Topology itself, in place and without its own heading, on the same selection (the address keys are the same). Never
 * an empty canvas. A failed read of the layout can be tried again.
 */
export function TwinFallback({ reason, onRetry }: TwinFallbackProps) {
  const notice = fallbackNotice(reason);
  return (
    <>
      <Banner tone={notice.tone}>
        <b>{notice.title}</b> {notice.message}
      </Banner>
      <div className={styles.actions}>
        {notice.retry && onRetry !== undefined ? (
          <Button onClick={onRetry}>Try again</Button>
        ) : null}
        <Link className={pagesStyles.link} to="/topology">
          Open topology
        </Link>
      </div>
      <Suspense
        fallback={
          <p role="status" className={styles.status}>
            Loading the topology…
          </p>
        }
      >
        <Topology showHeader={false} />
      </Suspense>
    </>
  );
}
