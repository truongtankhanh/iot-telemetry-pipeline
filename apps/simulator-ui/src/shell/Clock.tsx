import { useEffect, useState } from 'react';
import { formatClockTime, isoTime } from '../lib/time';
import { useStudio } from '../state/studioContext';
import styles from './header.module.css';

/**
 * The time of the viewer's clock, to the second. With a simulated engine its own time follows, labelled
 * "sim": it moves only when stepped, and a viewer should not take it for the wall clock.
 */
export function Clock({ now = Date.now }: { now?: () => number }) {
  const [time, setTime] = useState(() => now());
  useEffect(() => {
    const timer = setInterval(() => setTime(now()), 1000);
    return () => clearInterval(timer);
  }, [now]);
  const simulated = useStudio((state) => state.view?.config.simulated ?? false);
  const engineNow = useStudio((state) => state.view?.engine.nowMs ?? null);

  return (
    <span className={styles.clock}>
      <time dateTime={isoTime(time)}>{formatClockTime(time)}</time>
      {simulated && engineNow !== null ? (
        <span className={styles.sim} title="Time of the simulated engine">
          sim <time dateTime={isoTime(engineNow)}>{formatClockTime(engineNow)}</time>
        </span>
      ) : null}
    </span>
  );
}
