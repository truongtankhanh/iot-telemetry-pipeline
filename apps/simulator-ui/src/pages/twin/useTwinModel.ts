import { useMemo, useState } from 'react';
import type { TwinLayout, TwinLayoutView, TwinPlacement } from '../../api/types';
import { storedReadings } from '../../lib/ingestRates';
import { Stable } from '../../lib/topologyStable';
import type { TopologyState } from '../../lib/topologyState';
import { type AlertMark, alertMarks } from '../../lib/twinAlerts';
import { type CampusAssets, campusAssets } from '../../lib/twinCatalogue';
import { faultVisuals, hubStatus } from '../../lib/twinFaults';
import { type HubModel, type TwinArc, type TwinFlow, twinFlow } from '../../lib/twinFlow';
import {
  buildingStates,
  deviceList,
  type TwinDeviceRow,
  type TwinPin,
  twinPins,
} from '../../lib/twinPins';
import { checkSelection, type TwinSelection } from '../../lib/twinQuery';
import { useStudio } from '../../state/studioContext';
import { useNow } from '../../state/useNow';
import { useFleetRows } from '../fleet/useFleetRows';

const NO_MARKS: ReadonlyMap<string, AlertMark> = new Map();

export interface TwinModel {
  layout: TwinLayout;
  placement: TwinPlacement;
  /** One pin for every device the layout places; the same objects while their content is the same. */
  pins: TwinPin[];
  /** The look of every building: the worst of its pins, or `null` for a building with none. */
  buildings: Record<string, TopologyState | null>;
  catalogue: CampusAssets;
  /** The Pipeline hub and one arc for every pin: the same objects while their content is the same. */
  flow: TwinFlow;
  /** Alerts open on the placed devices (not the devices: a device can have several). */
  alertCount: number;
  /** One sentence for each fault that is on, for the text twin. */
  faultLines: string[];
  /** Every Fleet row, for the text twin. */
  list: TwinDeviceRow[];
  /** Why the selection in the address cannot be shown, or `null`. */
  notice: string | null;
  /** The link to the simulator is lost: the data is the last it sent. */
  stale: boolean;
  lostSince: number | null;
  /** The page's clock, renewed each second. */
  now: number;
}

/**
 * What the twin page draws, from the layout it was given and the store: Fleet's own rows (`useFleetRows`, so a state is
 * the one Fleet and Topology show), turned into pins, building looks and the text list by the pure functions of
 * `lib/twinPins`. `null` before the first message from the simulator and for a layout that cannot be drawn; the page says
 * which. The twin reads nothing the Fleet does not.
 */
export function useTwinModel(
  layoutView: TwinLayoutView | null,
  selection: TwinSelection | null,
): TwinModel | null {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const now = useNow();
  const rows = useFleetRows(view, now);
  const [pinCache] = useState(() => new Stable<TwinPin>());
  const [arcCache] = useState(() => new Stable<TwinArc>());
  const [hubCache] = useState(() => new Stable<HubModel & { id: string }>());

  const layout = layoutView?.available === true ? layoutView.layout : null;
  const linkLost = link === 'lost';
  // `view.alerts` is replaced only when ingest's alerts are read again, so the marks are rebuilt only then.
  const feed = view?.alerts ?? null;
  const alerts = useMemo(() => (feed === null ? NO_MARKS : alertMarks(feed)), [feed]);
  // The model is rebuilt about once a second; `Stable` hands the scene the same pin objects while nothing about them
  // changed, so a quiet second asks the canvas for no frame.
  const pins = pinCache.next(
    layout === null || view === null ? [] : twinPins(layout, rows, { now, linkLost, alerts }),
  );
  const buildings = useMemo(
    () => (layout === null ? {} : buildingStates(pins, layout)),
    [pins, layout],
  );
  const catalogue = useMemo(
    () => (layout === null ? { drawn: [], missing: [] } : campusAssets(layout)),
    [layout],
  );

  // The faults are the engine's own state (`view.engine.faults`): switch one off and the next state view draws nothing for
  // it. Arcs and the hub go through `Stable` like the pins, so a second in which no fault, alert or state changed hands
  // the scene the same objects.
  const faults = view?.engine.faults ?? null;
  const stored = view === null ? null : storedReadings(view.metrics);
  const visuals = useMemo(
    () => (faults === null ? null : faultVisuals(faults, pins, { storedReadings: stored })),
    [faults, pins, stored],
  );
  const raw =
    layout === null || view === null || visuals === null
      ? null
      : twinFlow(
          layout,
          pins,
          hubStatus({
            faults: view.engine.faults,
            broker: view.broker,
            ingest: view.ingest,
            linkLost,
          }),
          visuals,
        );
  const arcs = arcCache.next(raw?.arcs ?? []);
  const hub = hubCache.next(raw === null ? [] : [{ id: 'hub', ...raw.hub }])[0] ?? null;
  const flow = useMemo((): TwinFlow | null => (hub === null ? null : { hub, arcs }), [hub, arcs]);

  if (layoutView === null || layout === null || view === null || flow === null) return null;
  return {
    layout,
    placement: layoutView.placement,
    pins,
    buildings,
    catalogue,
    flow,
    alertCount: pins.reduce((total, pin) => total + (pin.alert?.count ?? 0), 0),
    faultLines: visuals?.lines ?? [],
    list: deviceList(layout, layoutView.placement, rows, alerts),
    notice: checkSelection(selection, layout, layoutView.placement),
    stale: linkLost,
    lostSince,
    now,
  };
}
