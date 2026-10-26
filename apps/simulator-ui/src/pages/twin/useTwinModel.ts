import { useMemo, useState } from 'react';
import type { TwinLayout, TwinLayoutView, TwinPlacement } from '../../api/types';
import { Stable } from '../../lib/topologyStable';
import type { TopologyState } from '../../lib/topologyState';
import { type CampusAssets, campusAssets } from '../../lib/twinCatalogue';
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

export interface TwinModel {
  layout: TwinLayout;
  placement: TwinPlacement;
  /** One pin for every device the layout places; the same objects while their content is the same. */
  pins: TwinPin[];
  /** The look of every building: the worst of its pins, or `null` for a building with none. */
  buildings: Record<string, TopologyState | null>;
  catalogue: CampusAssets;
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

  const layout = layoutView?.available === true ? layoutView.layout : null;
  const linkLost = link === 'lost';
  // The model is rebuilt about once a second; `Stable` hands the scene the same pin objects while nothing about them
  // changed, so a quiet second asks the canvas for no frame.
  const pins = pinCache.next(
    layout === null || view === null ? [] : twinPins(layout, rows, { now, linkLost }),
  );
  const buildings = useMemo(
    () => (layout === null ? {} : buildingStates(pins, layout)),
    [pins, layout],
  );
  const catalogue = useMemo(
    () => (layout === null ? { drawn: [], missing: [] } : campusAssets(layout)),
    [layout],
  );

  if (layoutView === null || layout === null || view === null) return null;
  return {
    layout,
    placement: layoutView.placement,
    pins,
    buildings,
    catalogue,
    list: deviceList(layout, layoutView.placement, rows),
    notice: checkSelection(selection, layout, layoutView.placement),
    stale: linkLost,
    lostSince,
    now,
  };
}
