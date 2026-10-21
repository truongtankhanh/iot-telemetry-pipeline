import { useStudio } from '../../state/studioContext';
import { type OverviewKpis, overviewKpis } from '../../lib/overviewKpis';
import { useFleetRows } from '../fleet/useFleetRows';
import { useIngestRates } from '../topology/useTopologyModel';

/**
 * The six figures of the Overview's first row, or `null` before the first message from the simulator. Every source is
 * the one its detail page reads: the Fleet's rows (`useFleetRows`), the stream's rate, the alerts feed of the store, and
 * the Topology's `useIngestRates` (two instances of it, the Topology model's and this one, compare the same pair of
 * metric reads, so they give the same lag). `now` is the page's clock, renewed each second: a device that says nothing
 * becomes silent by it, so the page passes the one it already has instead of starting another timer.
 */
export function useOverviewKpis(now: number): OverviewKpis | null {
  const view = useStudio((state) => state.view);
  const publishRate = useStudio((state) => state.publishRate);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const rows = useFleetRows(view, now);
  const rates = useIngestRates(view?.metrics);
  if (view === null) return null;
  return overviewKpis({ view, rows, publishRate, rates, lastAlertSink });
}
