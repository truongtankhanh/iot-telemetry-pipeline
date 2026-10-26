import { readFileSync, statSync } from 'node:fs';
import type { DeviceSpec } from './signals.ts';

/**
 * The layout of Studio's digital twin: where the campus stands and where each simulated device is
 * (`config/twin-layout.json`, docs/design/simulator/digital-twin.md). Positions are metres [east, north]
 * from `siteCenter`, the command center's convention.
 */

/** Whether a device's position was placed by hand inside its zone or measured. */
export type Placement = 'illustrative' | 'surveyed';

export interface TwinSource {
  repository: string;
  commit: string;
  files: string[];
  /** The day the copy was compared with the source, `YYYY-MM-DD`. */
  checkedOn: string;
}

/** The site boundary: a rounded rectangle, edges in metres from the centre. */
export interface TwinBoundary {
  west: number;
  east: number;
  south: number;
  north: number;
  radius: number;
}

/** A zone as the command center's seed describes it. `kind` is an open string: that repository owns the list. */
export interface TwinZone {
  code: string;
  name: string;
  kind: string;
  /** Buildings only. */
  use?: string;
  /** Metres above ground of a building's shell; buildings only. */
  heightM?: number;
  at: [number, number];
  size: [number, number];
}

/** A device of Studio's registry and where it stands. */
export interface TwinDevice {
  id: string;
  zone: string;
  at: [number, number];
  elevationM: number;
  placement: Placement;
}

/** An asset of the command center's catalogue, drawn as not simulated. */
export interface TwinAsset {
  code: string;
  name: string;
  class: string;
  zone: string;
  at: [number, number];
  elevationM: number;
  simulated: false;
}

export interface TwinLayout {
  source: TwinSource;
  /** [longitude, latitude] of the origin of every position. */
  siteCenter: [number, number];
  boundary: TwinBoundary;
  zones: TwinZone[];
  devices: TwinDevice[];
  catalogue: TwinAsset[];
}

/**
 * Which devices of the registry the layout places. `placed` and `unplaced` together are the registry, in its
 * order: a device the layout does not place is named with the reason, never left out.
 */
export interface TwinPlacement {
  placed: string[];
  unplaced: { id: string; reason: string }[];
  /** Devices the layout places that the registry does not have. */
  orphans: string[];
}

/** What `GET /api/twin-layout` answers: the layout, or why there is none, and the placement either way. */
export interface TwinLayoutView {
  available: boolean;
  /** Why the layout is not available, in words; `null` when it is. */
  reason: string | null;
  layout: TwinLayout | null;
  placement: TwinPlacement;
}

/** Largest layout file read. The real one is about 12 KB; a wrong path must not load something huge. */
export const MAX_LAYOUT_BYTES = 256 * 1024;
/** A building's footprint is its zone inset by this much on every side (ADR-0017, the command center's drawing rule). */
export const FOOTPRINT_INSET_M = 8;

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function requiredText(rec: Rec, key: string, where: string): string {
  const value = rec[key];
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${where}.${key} is required`);
  return value;
}

function pairOf(value: unknown, where: string, positive = false): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((n) => isFiniteNumber(n) && (!positive || n > 0))
  ) {
    throw new Error(`${where} must be two ${positive ? 'positive' : 'finite'} numbers`);
  }
  return [value[0] as number, value[1] as number];
}

/** Names a record of a list for an error: `zones[3] (BLD-DC)`. */
function labelOf(list: string, index: number, raw: unknown, key: string): string {
  const id = isRecord(raw) ? raw[key] : undefined;
  return `${list}[${index}]${typeof id === 'string' && id ? ` (${id})` : ''}`;
}

function listOf(input: Rec, key: string): unknown[] {
  const list = input[key];
  if (!Array.isArray(list)) throw new Error(`"${key}" must be an array`);
  return list;
}

/** The zone inset by `FOOTPRINT_INSET_M`, or the zone itself when a side is too short to inset. */
export function footprintOf(zone: Pick<TwinZone, 'at' | 'size'>): {
  west: number;
  east: number;
  south: number;
  north: number;
} {
  const [east, north] = zone.at;
  const [width, depth] = zone.size;
  const inset =
    width > 2 * FOOTPRINT_INSET_M && depth > 2 * FOOTPRINT_INSET_M ? FOOTPRINT_INSET_M : 0;
  const halfWidth = width / 2 - inset;
  const halfDepth = depth / 2 - inset;
  return {
    west: east - halfWidth,
    east: east + halfWidth,
    south: north - halfDepth,
    north: north + halfDepth,
  };
}

function parseSource(input: unknown): TwinSource {
  if (!isRecord(input)) throw new Error('"source" must be an object');
  const files = input.files;
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    !files.every((file) => typeof file === 'string' && file !== '')
  ) {
    throw new Error('source.files must be a non-empty list of paths');
  }
  return {
    repository: requiredText(input, 'repository', 'source'),
    commit: requiredText(input, 'commit', 'source'),
    files: files as string[],
    checkedOn: requiredText(input, 'checkedOn', 'source'),
  };
}

function parseBoundary(input: unknown): TwinBoundary {
  if (!isRecord(input)) throw new Error('"boundary" must be an object');
  const edge = (key: 'west' | 'east' | 'south' | 'north' | 'radius'): number => {
    const value = input[key];
    if (!isFiniteNumber(value)) throw new Error(`boundary.${key} must be a finite number`);
    return value;
  };
  const boundary = {
    west: edge('west'),
    east: edge('east'),
    south: edge('south'),
    north: edge('north'),
    radius: edge('radius'),
  };
  if (boundary.west >= boundary.east) throw new Error('boundary: west must be less than east');
  if (boundary.south >= boundary.north) throw new Error('boundary: south must be less than north');
  if (boundary.radius < 0) throw new Error('boundary.radius must not be negative');
  return boundary;
}

function parseZone(raw: unknown, index: number, seen: Set<string>): TwinZone {
  const where = labelOf('zones', index, raw, 'code');
  if (!isRecord(raw)) throw new Error(`${where} must be an object`);
  const code = requiredText(raw, 'code', where);
  if (seen.has(code)) throw new Error(`${where}: duplicate code`);
  seen.add(code);
  const zone: TwinZone = {
    code,
    name: requiredText(raw, 'name', where),
    kind: requiredText(raw, 'kind', where),
    at: pairOf(raw.at, `${where}.at`),
    size: pairOf(raw.size, `${where}.size`, true),
  };
  if (zone.kind === 'building') {
    zone.use = requiredText(raw, 'use', where);
    if (!isFiniteNumber(raw.heightM) || raw.heightM <= 0) {
      throw new Error(`${where}.heightM must be a positive number for a building`);
    }
    zone.heightM = raw.heightM;
  } else if (raw.use !== undefined || raw.heightM !== undefined) {
    throw new Error(`${where}: only a building has use and heightM`);
  }
  return zone;
}

function parseDevice(
  raw: unknown,
  index: number,
  zones: Map<string, TwinZone>,
  seen: Set<string>,
): TwinDevice {
  const where = labelOf('devices', index, raw, 'id');
  if (!isRecord(raw)) throw new Error(`${where} must be an object`);
  const id = requiredText(raw, 'id', where);
  if (seen.has(id)) throw new Error(`${where}: duplicate id`);
  seen.add(id);
  const zoneCode = requiredText(raw, 'zone', where);
  const zone = zones.get(zoneCode);
  if (!zone) throw new Error(`${where}: zone ${zoneCode} is not in "zones"`);
  const at = pairOf(raw.at, `${where}.at`);
  if (!isFiniteNumber(raw.elevationM) || raw.elevationM < 0) {
    throw new Error(`${where}.elevationM must be a number, 0 or more`);
  }
  if (raw.placement !== 'illustrative' && raw.placement !== 'surveyed') {
    throw new Error(`${where}.placement must be illustrative or surveyed`);
  }
  if (zone.kind === 'building') {
    const footprint = footprintOf(zone);
    const inside =
      at[0] >= footprint.west &&
      at[0] <= footprint.east &&
      at[1] >= footprint.south &&
      at[1] <= footprint.north;
    if (!inside) throw new Error(`${where}.at is outside the footprint of ${zoneCode}`);
    if (zone.heightM !== undefined && raw.elevationM > zone.heightM) {
      throw new Error(`${where}.elevationM is above the roof of ${zoneCode}`);
    }
  }
  return { id, zone: zoneCode, at, elevationM: raw.elevationM, placement: raw.placement };
}

function parseAsset(
  raw: unknown,
  index: number,
  zones: Map<string, TwinZone>,
  seen: Set<string>,
): TwinAsset {
  const where = labelOf('catalogue', index, raw, 'code');
  if (!isRecord(raw)) throw new Error(`${where} must be an object`);
  const code = requiredText(raw, 'code', where);
  if (seen.has(code)) throw new Error(`${where}: duplicate code`);
  seen.add(code);
  const zoneCode = requiredText(raw, 'zone', where);
  if (!zones.has(zoneCode)) throw new Error(`${where}: zone ${zoneCode} is not in "zones"`);
  if (!isFiniteNumber(raw.elevationM) || raw.elevationM < 0) {
    throw new Error(`${where}.elevationM must be a number, 0 or more`);
  }
  // Until V2-T05 maps the catalogue to the simulator's devices, no asset is simulated; a file edit must not claim one is.
  if (raw.simulated !== false) throw new Error(`${where}.simulated must be false`);
  return {
    code,
    name: requiredText(raw, 'name', where),
    class: requiredText(raw, 'class', where),
    zone: zoneCode,
    at: pairOf(raw.at, `${where}.at`),
    elevationM: raw.elevationM,
    simulated: false,
  };
}

/**
 * Validates the content of `twin-layout.json` and returns it with only the keys Studio reads (`$comment` is
 * dropped). Throws an `Error` that names the record and the field. A mismatch with the registry is not an error
 * here: `placementOf` reports it.
 */
export function parseTwinLayout(input: unknown): TwinLayout {
  if (!isRecord(input)) throw new Error('the layout must be a JSON object');

  const centre = pairOf(input.siteCenter, 'siteCenter');
  if (Math.abs(centre[0]) > 180 || Math.abs(centre[1]) > 90) {
    throw new Error('siteCenter must be [longitude, latitude]');
  }
  const source = parseSource(input.source);
  const boundary = parseBoundary(input.boundary);

  const zoneCodes = new Set<string>();
  const zones = listOf(input, 'zones').map((raw, index) => parseZone(raw, index, zoneCodes));
  const byCode = new Map(zones.map((zone) => [zone.code, zone]));

  const deviceIds = new Set<string>();
  const devices = listOf(input, 'devices').map((raw, index) =>
    parseDevice(raw, index, byCode, deviceIds),
  );
  const assetCodes = new Set<string>();
  const catalogue = listOf(input, 'catalogue').map((raw, index) =>
    parseAsset(raw, index, byCode, assetCodes),
  );

  return { source, siteCenter: centre, boundary, zones, devices, catalogue };
}

/**
 * Which devices of the registry the layout places, and why not the others. A device is `unplaced` when its zone
 * is not in the layout, when the layout has no position for it, or when the layout puts it in another zone than
 * the registry does (in that order of precedence).
 */
export function placementOf(
  layout: TwinLayout,
  devices: Pick<DeviceSpec, 'id' | 'zoneCode'>[],
): TwinPlacement {
  const zones = new Set(layout.zones.map((zone) => zone.code));
  const positions = new Map(layout.devices.map((device) => [device.id, device]));
  const registry = new Set(devices.map((device) => device.id));

  const placed: string[] = [];
  const unplaced: TwinPlacement['unplaced'] = [];
  for (const device of devices) {
    const position = positions.get(device.id);
    if (!zones.has(device.zoneCode)) {
      unplaced.push({ id: device.id, reason: `zone ${device.zoneCode} is not in the layout` });
    } else if (!position) {
      unplaced.push({ id: device.id, reason: 'no position in the layout' });
    } else if (position.zone !== device.zoneCode) {
      unplaced.push({
        id: device.id,
        reason: `the layout puts it in ${position.zone}, the registry in ${device.zoneCode}`,
      });
    } else {
      placed.push(device.id);
    }
  }
  const orphans = layout.devices.filter((device) => !registry.has(device.id)).map((d) => d.id);
  return { placed, unplaced, orphans };
}

/** The answer when there is no layout to show: every device of the registry is unplaced, with the reason. */
export function twinLayoutUnavailable(
  reason: string,
  devices: Pick<DeviceSpec, 'id' | 'zoneCode'>[],
): TwinLayoutView {
  return {
    available: false,
    reason,
    layout: null,
    placement: {
      placed: [],
      unplaced: devices.map((device) => ({
        id: device.id,
        reason: 'the twin layout is not available',
      })),
      orphans: [],
    },
  };
}

/**
 * Reads and validates a layout file and places the registry's devices. It never throws: a missing, oversized or
 * invalid file is a state Studio reports (it then shows Topology only), not a reason to stop publishing.
 */
export function loadTwinLayout(
  path: string,
  devices: Pick<DeviceSpec, 'id' | 'zoneCode'>[],
): TwinLayoutView {
  let text: string;
  try {
    const { size } = statSync(path);
    if (size > MAX_LAYOUT_BYTES) {
      return twinLayoutUnavailable(
        `${path} is too large (${size} bytes, at most ${MAX_LAYOUT_BYTES})`,
        devices,
      );
    }
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return twinLayoutUnavailable(`cannot read ${path}${code ? ` (${code})` : ''}`, devices);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return twinLayoutUnavailable(`${path} is not valid JSON`, devices);
  }
  try {
    const layout = parseTwinLayout(json);
    return { available: true, reason: null, layout, placement: placementOf(layout, devices) };
  } catch (error) {
    return twinLayoutUnavailable(
      `${path} is not usable: ${error instanceof Error ? error.message : String(error)}`,
      devices,
    );
  }
}
