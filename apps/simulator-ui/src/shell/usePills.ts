import { useMemo } from 'react';
import { derivePills, type Pill } from '../lib/pills';
import { useStudio } from '../state/studioContext';

/** The header's four pills, derived from the store; they change only when something they show changes. */
export function usePills(): Pill[] {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const publishRate = useStudio((state) => state.publishRate);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  return useMemo(
    () => derivePills({ view, link, publishRate, lastAlertSink }),
    [view, link, publishRate, lastAlertSink],
  );
}
