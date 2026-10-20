import { useEffect } from 'react';
import { advancedHops, type HopSnapshot, snapshotOf } from '../../lib/downstreamHops';
import { usePulseBus } from '../../state/pulseContext';
import { hopKey } from '../../state/pulses';
import { useStudioStore } from '../../state/studioContext';

/**
 * Tells the pulse bus when something moved past the broker, so the edges after it can draw a dot: stored readings
 * grew, an alert appeared, a delivery became `delivered` (`lib/downstreamHops.ts` decides what counts). It listens to
 * the store directly instead of rendering: the metrics arrive every second and the page must not render for a dot.
 * One call for the page; the edges subscribe to their hop on the same bus as the devices' pulses.
 */
export function useDownstreamPulses(): void {
  const store = useStudioStore();
  const bus = usePulseBus();

  useEffect(() => {
    const first = store.getState().view;
    let previous: HopSnapshot | null = first === null ? null : snapshotOf(first);
    return store.subscribe((state, before) => {
      const view = state.view;
      if (view === null) return;
      // Only a new read of the metrics or of the alerts can have moved anything.
      if (view.metrics === before.view?.metrics && view.alerts === before.view?.alerts) return;
      const next = snapshotOf(view);
      const hops = advancedHops(previous, next);
      previous = next;
      const at = Date.now();
      for (const hop of hops) bus.emit(hopKey(hop), at);
    });
  }, [store, bus]);
}
