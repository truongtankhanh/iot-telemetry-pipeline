import { useMemo, useState } from 'react';
import type { TwinLayout, TwinLayoutView, TwinPlacement, TwinZone } from '../../api/types';
import type { FleetRow } from '../../lib/fleetQuery';
import { storedReadings } from '../../lib/ingestRates';
import { Stable } from '../../lib/topologyStable';
import type { TopologyState } from '../../lib/topologyState';
import { type AlertMark, alertMarks } from '../../lib/twinAlerts';
import {
  type AssetGroup,
  assetGroups,
  campusAssets,
  type CatalogueBox,
  catalogueBoxes,
} from '../../lib/twinCatalogue';
import { faultVisuals, hubStatus } from '../../lib/twinFaults';
import { type HubModel, type TwinArc, type TwinFlow, twinFlow } from '../../lib/twinFlow';
import { type BuildingBounds, buildingBounds, footprintOf } from '../../lib/twinGeometry';
import { type HeatModel, twinHeat } from '../../lib/twinHeat';
import {
  buildingStates,
  deviceList,
  type TwinDeviceRow,
  type TwinPin,
  twinPins,
} from '../../lib/twinPins';
import {
  checkSelection,
  focusedZone,
  levelOf,
  type TwinSelection,
  type ViewLevel,
} from '../../lib/twinQuery';
import { useStudio } from '../../state/studioContext';
import { useNow } from '../../state/useNow';
import { useFleetRows } from '../fleet/useFleetRows';

const NO_MARKS: ReadonlyMap<string, AlertMark> = new Map();

/** The catalogue boxes the scene draws for the level the viewer is on, and the campus-level assets the layout lacks. */
export interface CatalogueModel {
  boxes: CatalogueBox[];
  /** Codes of the nine campus-level assets the layout does not have: reported, never dropped without a word. */
  missing: string[];
}

const NO_CATALOGUE: CatalogueModel = { boxes: [], missing: [] };

/** The building in focus: what the scene, the camera, the card and the text twin need to speak of it. */
export interface TwinFocus {
  code: string;
  zone: TwinZone;
  /** Its footprint united with its assets, and its height: what the _Building_ view fits. */
  bounds: BuildingBounds;
  /** What stands in it besides the simulated devices, one row per class. */
  groups: AssetGroup[];
}

export interface TwinModel {
  layout: TwinLayout;
  placement: TwinPlacement;
  /** One pin for every device the layout places; the same objects while their content is the same. */
  pins: TwinPin[];
  /** The look of every building: the worst of its pins, or `null` for a building with none. */
  buildings: Record<string, TopologyState | null>;
  /** The level of the Escape ladder the selection is on. */
  level: ViewLevel;
  /** The building in focus (a selected building, or the building of a selected device), or `null` at campus level. */
  focus: TwinFocus | null;
  catalogue: CatalogueModel;
  /**
   * The floor of the building in focus: its sensors, the colour of each square and the words that say it is interpolated; the
   * same object while its content is the same. `null` at campus level.
   */
  heat: HeatModel | null;
  /** The Pipeline hub and one arc for every pin: the same objects while their content is the same. */
  flow: TwinFlow;
  /** Alerts open on the placed devices (not the devices: a device can have several). */
  alertCount: number;
  /** One sentence for each fault that is on, for the text twin. */
  faultLines: string[];
  /** Every Fleet row, for the text twin. */
  list: TwinDeviceRow[];
  /** The Fleet's own rows (the device, its status and values): what the inspector charts. */
  rows: FleetRow[];
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
  const [heatCache] = useState(() => new Stable<HeatModel>());
  const [hubCache] = useState(() => new Stable<HubModel & { id: string }>());

  const layout = layoutView?.available === true ? layoutView.layout : null;
  const linkLost = link === 'lost';
  // `view.alerts` is replaced only when ingest's alerts are read again, so the marks are rebuilt only then.
  const feed = view?.alerts ?? null;
  const alerts = useMemo(() => (feed === null ? NO_MARKS : alertMarks(feed)), [feed]);
  // The model is rebuilt about once a second; `Stable` hands the scene the same pin objects while nothing about them
  // changed, so a quiet second asks the canvas for no frame.
  // The focus comes from the selection (the address) and is never stored: Escape climbs the selection, and the level follows.
  const focusedCode = layout === null ? null : focusedZone(selection, layout);
  const level = layout === null ? 'campus' : levelOf(selection, layout);
  const pins = pinCache.next(
    layout === null || view === null
      ? []
      : twinPins(layout, rows, { now, linkLost, alerts, focusedZone: focusedCode }),
  );
  const buildings = useMemo(
    () => (layout === null ? {} : buildingStates(pins, layout)),
    [pins, layout],
  );
  const catalogue = useMemo(
    (): CatalogueModel =>
      layout === null
        ? NO_CATALOGUE
        : { boxes: catalogueBoxes(layout, focusedCode), missing: campusAssets(layout).missing },
    [layout, focusedCode],
  );
  const focus = useMemo((): TwinFocus | null => {
    if (layout === null || focusedCode === null) return null;
    const zone = layout.zones.find((candidate) => candidate.code === focusedCode);
    const bounds = buildingBounds(layout, focusedCode);
    if (zone === undefined || bounds === null) return null;
    return { code: focusedCode, zone, bounds, groups: assetGroups(layout, focusedCode) };
  }, [layout, focusedCode]);
  // The floor is rebuilt about once a second like the pins; its values are rounded to a tenth of a degree and it goes through
  // `Stable`, so a second in which no square changed colour hands the scene the same object and asks for no frame.
  const heat =
    heatCache.next(
      focus === null ? [] : [twinHeat(pins, focus.code, footprintOf(focus.zone))],
    )[0] ?? null;

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
    level,
    focus,
    catalogue,
    heat,
    flow,
    alertCount: pins.reduce((total, pin) => total + (pin.alert?.count ?? 0), 0),
    faultLines: visuals?.lines ?? [],
    list: deviceList(layout, layoutView.placement, rows, alerts),
    rows,
    notice: checkSelection(selection, layout, layoutView.placement),
    stale: linkLost,
    lostSince,
    now,
  };
}
