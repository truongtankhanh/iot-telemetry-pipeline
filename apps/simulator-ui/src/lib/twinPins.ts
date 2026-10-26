import type { TwinLayout, TwinPlacement } from '../api/types';
import {
  type DeviceGlyph,
  type DeviceShape,
  kindIdentity,
  metricLabel,
  metricUnit,
} from './deviceIdentity';
import type { FleetRow } from './fleetQuery';
import { formatValue } from './rules';
import { formatAgo } from './time';
import { deviceTopologyState, TOPOLOGY_WORDS, type TopologyState, worstOf } from './topologyState';
import { DEFAULT_BUILDING_HEIGHT_M, sceneOf } from './twinGeometry';
import type { TwinSelection } from './twinQuery';

/**
 * What the twin shows of the devices, derived from the layout and the Fleet's own rows, never from a second reading of
 * the state: a pin, a building's rim and a line of the text list say what Fleet and Topology say, with the same words
 * (`deviceStatus` decides, `deviceTopologyState` gives the look). Nothing here imports three.js or React.
 */

/** How far above its building's roof a pin floats, in metres: a pin must be seen over the roof line, not in it. */
export const PIN_LIFT_M = 6;

/** The most labels drawn at once (the animation budget's node cap, frame 00). The rest are in the tooltip and the list. */
export const LABEL_CAP = 12;

export interface TwinReading {
  metric: string;
  /** `Temp`, `CO₂`: the name Fleet uses. */
  label: string;
  /** `29.3 °C`, or `—` when no value is known (as Fleet writes it). */
  text: string;
}

export interface TwinPin {
  /** The device's id. */
  id: string;
  /** Fleet's short code (`DC·1`). */
  code: string;
  name: string;
  /** The zone (building) code and name. */
  zone: string;
  zoneName: string;
  kind: string;
  kindLabel: string;
  shape: DeviceShape;
  glyph: DeviceGlyph;
  /** The look: healthy, anomaly or stale (paused, stopped or silent, or any state while the link to the simulator is lost). */
  state: TopologyState;
  /** Fleet's word for the state (`Running`, `Anomaly`, `Silent`…): the look never says it alone. */
  word: string;
  /** For an anomaly: what is beyond which line. */
  reason: string | null;
  /** When the device was last heard from (ms since the epoch), or `null`. */
  lastSeen: number | null;
  placement: 'illustrative' | 'surveyed';
  /** Where the pin floats, in scene metres. */
  anchor: [number, number, number];
  /** Where its stem meets the roof, in scene metres. */
  stemBase: [number, number, number];
  readings: TwinReading[];
  /** The second line of the label: the building and the latest value, or the state when there is no value to show. */
  detail: string;
}

export interface PinOptions {
  now: number;
  /**
   * The link to the simulator is lost: the twin stays, every pin goes dashed and a value says how old it is (frame 16:
   * "ingest unreachable").
   */
  linkLost: boolean;
}

/** `29.3 °C`, `702 ppm`, or `—` for no value. */
export function readingText(metric: string, value: number | null): string {
  if (value === null) return '—';
  const unit = metricUnit(metric);
  return unit === '' ? formatValue(metric, value) : `${formatValue(metric, value)} ${unit}`;
}

function detailOf(
  zoneName: string,
  row: FleetRow,
  state: TopologyState,
  { now, linkLost }: PinOptions,
): string {
  if (linkLost) {
    return `${zoneName} · ${row.lastSeen === null ? 'no value yet' : `last value ${formatAgo(row.lastSeen, now)}`}`;
  }
  const first = row.readings[0];
  if ((state === 'healthy' || state === 'anomaly') && first !== undefined && first.value !== null) {
    return `${zoneName} · ${readingText(first.metric, first.value)}`;
  }
  return `${zoneName} · ${row.status.word.toLowerCase()}`;
}

/**
 * One pin for every device the layout places, in the registry's order. A device the layout has no position for has no
 * pin here (`placementSummary` and the text list name it); a position for a device the registry lacks has none either.
 */
export function twinPins(
  layout: TwinLayout,
  rows: readonly FleetRow[],
  options: PinOptions,
): TwinPin[] {
  const zones = new Map(layout.zones.map((zone) => [zone.code, zone]));
  const positions = new Map(layout.devices.map((device) => [device.id, device]));
  const pins: TwinPin[] = [];
  for (const row of rows) {
    const position = positions.get(row.device.id);
    if (position === undefined) continue;
    const zone = zones.get(position.zone);
    const roof = zone?.kind === 'building' ? (zone.heightM ?? DEFAULT_BUILDING_HEIGHT_M) : 0;
    const [east, north] = position.at;
    const state: TopologyState = options.linkLost ? 'stale' : deviceTopologyState(row.status.kind);
    const identity = kindIdentity(row.device.kind);
    const zoneName = zone?.name ?? position.zone;
    pins.push({
      id: row.device.id,
      code: row.code,
      name: row.name,
      zone: position.zone,
      zoneName,
      kind: row.device.kind,
      kindLabel: identity.label,
      shape: identity.shape,
      glyph: identity.glyph,
      state,
      word: row.status.word,
      reason: row.status.reason,
      lastSeen: row.lastSeen,
      placement: position.placement,
      anchor: sceneOf(east, north, roof + PIN_LIFT_M),
      stemBase: sceneOf(east, north, roof),
      readings: row.readings.map(({ metric, value }) => ({
        metric,
        label: metricLabel(metric),
        text: readingText(metric, value),
      })),
      detail: detailOf(zoneName, row, state, options),
    });
  }
  return pins;
}

/**
 * The look of every building: the worst of its pins (down, anomaly, paused or silent, healthy), so a problem is never
 * hidden by a healthy neighbour; `null` for a building with no pin, which the scene leaves neutral.
 */
export function buildingStates(
  pins: readonly TwinPin[],
  layout: Pick<TwinLayout, 'zones'>,
): Record<string, TopologyState | null> {
  const states: Record<string, TopologyState | null> = {};
  for (const zone of layout.zones) {
    if (zone.kind !== 'building') continue;
    states[zone.code] = worstOf(
      pins.filter((pin) => pin.zone === zone.code).map((pin) => pin.state),
    );
  }
  return states;
}

export interface LabelChoice {
  selection: TwinSelection | null;
  /** The pin under the pointer, if any. */
  hoveredId: string | null;
  cap?: number;
}

/**
 * Which pins get a label: at most `cap`, the selected device (or every device of the selected building) first, then the
 * hovered one, then those that need a look, then the rest in the registry's order. Returns ids in that order.
 */
export function chooseLabels(
  pins: readonly TwinPin[],
  { selection, hoveredId, cap = LABEL_CAP }: LabelChoice,
): string[] {
  const rank = (pin: TwinPin): number => {
    if (
      (selection?.type === 'device' && selection.id === pin.id) ||
      (selection?.type === 'zone' && selection.id === pin.zone)
    ) {
      return 0;
    }
    if (pin.id === hoveredId) return 1;
    return pin.state === 'healthy' ? 3 : 2;
  };
  return pins
    .map((pin, index) => ({ id: pin.id, rank: rank(pin), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, Math.max(0, cap))
    .map((entry) => entry.id);
}

/** A line of the text twin: everything Fleet says of a device, and whether and how the twin places it. */
export interface TwinDeviceRow {
  id: string;
  name: string;
  zone: string;
  zoneName: string;
  kindLabel: string;
  /** Fleet's word for the state. */
  stateWord: string;
  /** For an anomaly, what is beyond which line. */
  reason: string | null;
  /** When the device was last heard from (ms since the epoch), or `null`. */
  lastSeen: number | null;
  readings: TwinReading[];
  /** `illustrative` or `surveyed` for a device the layout places; `null` for one it does not. */
  placement: 'illustrative' | 'surveyed' | null;
  /** Why the layout has no position for it, for an unplaced device. */
  notPlacedReason: string | null;
}

/**
 * The visually hidden list that follows the scene: one row for every row of Fleet, placed or not, with Fleet's name and
 * state word, so nothing is discoverable only in 3D.
 */
export function deviceList(
  layout: Pick<TwinLayout, 'zones' | 'devices'>,
  placement: TwinPlacement,
  rows: readonly FleetRow[],
): TwinDeviceRow[] {
  const zones = new Map(layout.zones.map((zone) => [zone.code, zone.name]));
  const positions = new Map(layout.devices.map((device) => [device.id, device]));
  const reasons = new Map(placement.unplaced.map((device) => [device.id, device.reason]));
  return rows.map((row) => {
    const position = positions.get(row.device.id);
    return {
      id: row.device.id,
      name: row.name,
      zone: row.device.zoneCode,
      zoneName: zones.get(row.device.zoneCode) ?? row.device.zoneCode,
      kindLabel: kindIdentity(row.device.kind).label,
      stateWord: row.status.word,
      reason: row.status.reason,
      lastSeen: row.lastSeen,
      readings: row.readings.map(({ metric, value }) => ({
        metric,
        label: metricLabel(metric),
        text: readingText(metric, value),
      })),
      placement: position?.placement ?? null,
      notPlacedReason:
        position === undefined ? (reasons.get(row.device.id) ?? 'no position in the layout') : null,
    };
  });
}

export interface TooltipContent {
  title: string;
  /** One line each; text only, never markup. */
  lines: string[];
}

/**
 * What the tooltip says about what the pointer is over (frame 14, after 150 ms): a building's name, code, use, height, and
 * how many devices it has with its worst state; a pin's kind, building, state and reason, its readings, and whether its
 * position is a guess. `null` for a target the layout does not know.
 */
export function tooltipOf(
  target: TwinSelection | null,
  layout: Pick<TwinLayout, 'zones'>,
  pins: readonly TwinPin[],
  states: Readonly<Record<string, TopologyState | null>>,
): TooltipContent | null {
  if (target === null) return null;
  if (target.type === 'device') {
    const pin = pins.find((candidate) => candidate.id === target.id);
    if (pin === undefined) return null;
    return {
      title: pin.name,
      lines: [
        `${pin.kindLabel} · ${pin.zoneName}`,
        pin.reason === null ? pin.word : `${pin.word}: ${pin.reason}`,
        ...pin.readings.map((reading) => `${reading.label} ${reading.text}`),
        pin.placement === 'illustrative'
          ? 'Position: illustrative (placed by hand)'
          : 'Position: surveyed',
      ],
    };
  }
  const zone = layout.zones.find((candidate) => candidate.code === target.id);
  if (zone === undefined) return null;
  const inside = pins.filter((pin) => pin.zone === zone.code).length;
  const worst = states[zone.code] ?? null;
  const facts = [zone.code, zone.use, zone.heightM === undefined ? undefined : `${zone.heightM} m`];
  return {
    title: zone.name,
    lines: [
      facts.filter((fact) => fact !== undefined).join(' · '),
      inside === 0
        ? 'No device placed here'
        : `${inside} ${inside === 1 ? 'device' : 'devices'} · ${worst === null ? 'no state' : TOPOLOGY_WORDS[worst]}`,
    ],
  };
}
