import { useEffect, useState } from 'react';

/**
 * The current time in ms, renewed every `everyMs` (one second by default). A chart needs it for a device that
 * says nothing: no message arrives to make it render again, and its gap and its "silent since" still grow.
 * One timer per caller, cleared on unmount.
 */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
