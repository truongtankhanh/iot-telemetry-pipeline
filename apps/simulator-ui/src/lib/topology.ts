import { STATUS_ORDER } from './deviceStatus';
import { type FleetRow, matchesSearch } from './fleetQuery';
import { type StageId, type StageNode, STAGE_ORDER } from './pipeline';
import { primaryReading } from './topologyDetail';
import {
  type Box,
  boundsOf,
  DEVICE_H,
  DEVICE_W,
  devicePosition,
  layoutZones,
  STAGE_BOXES,
  type ZoneMode,
  type ZoneSlot,
} from './topologyLayout';
import { deviceTopologyState, TOPOLOGY_WORDS, type TopologyState, worstOf } from './topologyState';
import type { LinkState } from '../state/store';

/** Up to this many devices every device is a node (the brief's scale rules). */
export const DEVICE_NODE_LIMIT = 12;
/** Up to this many a zone is one node that opens in place; above it a zone shows counts only. */
export const ZONE_NODE_LIMIT = 60;
/** A zone opened in place past 12 devices shows this many at once, worst first, and "+ n more". */
export const ZONE_PREVIEW = 6;

export type Tier = 'devices' | 'zones' | 'counts';

export const tierOf = (deviceCount: number): Tier =>
  deviceCount <= DEVICE_NODE_LIMIT
    ? 'devices'
    : deviceCount <= ZONE_NODE_LIMIT
      ? 'zones'
      : 'counts';

/** What is selected in the graph, and shown in the row under it. */
export type Selection =
  { type: 'device'; id: string } | { type: 'zone'; id: string } | { type: 'stage'; id: StageId };

export type Grouping = 'zone' | 'all';

/** A node needs attention when it is anything but healthy: an anomaly, or dark (paused, stopped, silent). */
export const isProblem = (state: TopologyState): boolean => state !== 'healthy';

export interface DeviceNodeData {
  kind: 'device';
  deviceId: string;
  name: string;
  code: string;
  /** The registry's class (`server_room`): it decides the shape of the badge. */
  deviceKind: string;
  zone: string;
  state: TopologyState;
  /** The device's own word: "Running", "Anomaly", "Paused", "Silent"… */
  word: string;
  metric: string | null;
  /** "29.3 °C"; `null` when nothing was heard. */
  reading: string | null;
  /** For an anomaly: what is beyond which line. */
  reason: string | null;
  selected: boolean;
  dimmed: boolean;
  ariaLabel: string;
}

export interface ZoneNodeData {
  kind: 'zone';
  code: string;
  count: number;
  worst: TopologyState;
  mode: ZoneMode;
  /** How many devices are in each look, for the bar of a zone that shows counts only. */
  counts: Record<TopologyState, number>;
  /** Devices that match the filters but are not drawn: "+ n more". */
  more: number;
  selected: boolean;
  dimmed: boolean;
  ariaLabel: string;
}

export interface StageNodeData {
  kind: 'stage';
  stage: StageNode;
  selected: boolean;
  ariaLabel: string;
}

export type TopoNodeData = DeviceNodeData | ZoneNodeData | StageNodeData;

export interface TopoNode {
  /** `device:<id>`, `zone:<code>` or `stage:<id>`. */
  id: string;
  type: TopoNodeData['kind'];
  /** The zone a device is drawn inside. */
  parentId?: string;
  /** Relative to the parent when there is one. */
  position: { x: number; y: number };
  width: number;
  height: number;
  data: TopoNodeData;
}

/** How an edge is drawn: `off` is a dim dashed wire with no light, `bad` a red dashed one, the rest carry light. */
export type EdgeState = 'flowing' | 'warn' | 'ok' | 'off' | 'bad';

export interface TopoEdge {
  id: string;
  source: string;
  sourceHandle: 'right' | 'bottom';
  target: string;
  targetHandle: 'left' | 'top';
  state: EdgeState;
  /** How many devices are behind the edge: the line is thicker for a zone than for a device. */
  weight: number;
  /** The devices whose published messages draw dots on this edge; none for a pipeline edge. */
  devices: string[];
  /** The hop of a pipeline edge (`broker>ingest`), for the dots that something downstream advanced; `null` for a device edge. */
  hop: string | null;
}

export interface TopologyInput {
  rows: readonly FleetRow[];
  stages: readonly StageNode[];
  search: string;
  /** `null` is automatic: every device up to 12, zones above. */
  group: Grouping | null;
  problemsOnly: boolean;
  /** The zones the viewer opened. */
  expanded: ReadonlySet<string>;
  selection: Selection | null;
  link: LinkState;
}

export interface Topology {
  tier: Tier;
  /** The grouping in force: the viewer's choice where the tier allows it, else the tier's own. */
  grouping: Grouping;
  nodes: TopoNode[];
  edges: TopoEdge[];
  /** "6 devices · 5 zones · 3 problems". */
  summary: string;
  /** Devices that are not healthy. */
  problems: number;
  /** Devices that pass the search and _Problems only_. */
  matches: number;
  bounds: Box;
}

const zoneCodes = (rows: readonly FleetRow[]): string[] => [
  ...new Set(rows.map((row) => row.device.zoneCode)),
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const rankOf = (row: FleetRow) => STATUS_ORDER.indexOf(row.status.kind);

const zeroCounts = (): Record<TopologyState, number> => ({
  healthy: 0,
  anomaly: 0,
  down: 0,
  stale: 0,
});

function deviceEdgeState(row: FleetRow, brokerDown: boolean): EdgeState {
  if (brokerDown) return 'off';
  switch (row.status.kind) {
    case 'running':
      return 'flowing';
    case 'anomaly':
      return 'warn';
    default:
      return 'off';
  }
}

function zoneEdgeState(members: readonly FleetRow[], brokerDown: boolean): EdgeState {
  if (brokerDown) return 'off';
  if (members.some((row) => row.status.kind === 'anomaly')) return 'warn';
  return members.some((row) => row.status.kind === 'running') ? 'flowing' : 'off';
}

const publishing = (rows: readonly FleetRow[]) =>
  rows.some((row) => row.status.kind === 'running' || row.status.kind === 'anomaly');

/**
 * The six edges of the pipeline. Light means energy is moving, so an edge is lit only while something crosses it:
 * readings from the broker onward while devices publish and ingest answers, the alert chain while an alert is open.
 * An edge into a stage that is down is red and dashed; into one whose truth is unknown, dim.
 */
function pipelineEdges(stages: readonly StageNode[], rows: readonly FleetRow[]): TopoEdge[] {
  const stage = (id: StageId) => stages.find((s) => s.id === id);
  const broker = stage('broker');
  const ingest = stage('ingest');
  const database = stage('database');
  const rules = stage('rules');
  const alert = stage('alert');
  const outbox = stage('outbox');
  const commandCenter = stage('commandCenter');
  const answering = ingest?.state === 'healthy' || ingest?.state === 'anomaly';
  const reading = answering && broker?.state !== 'down' && publishing(rows);
  const alertOpen = alert?.state === 'anomaly';

  const states: [StageId, StageId, EdgeState, 'right' | 'bottom', 'left' | 'top'][] = [
    [
      'broker',
      'ingest',
      ingest?.state === 'down'
        ? 'bad'
        : !reading
          ? 'off'
          : ingest?.state === 'anomaly'
            ? 'warn'
            : 'flowing',
      'right',
      'left',
    ],
    ['ingest', 'rules', reading ? 'flowing' : 'off', 'right', 'left'],
    [
      'ingest',
      'database',
      database?.state === 'down' && answering ? 'bad' : reading ? 'flowing' : 'off',
      'bottom',
      'top',
    ],
    ['rules', 'alert', rules?.state === 'anomaly' || alertOpen ? 'warn' : 'off', 'right', 'left'],
    [
      'alert',
      'outbox',
      outbox?.state === 'down' ? 'bad' : alertOpen ? 'warn' : 'off',
      'bottom',
      'top',
    ],
    [
      'outbox',
      'commandCenter',
      outbox?.state === 'down'
        ? 'bad'
        : alertOpen && outbox?.state === 'healthy' && commandCenter?.state === 'healthy'
          ? 'ok'
          : 'off',
      'right',
      'left',
    ],
  ];
  return states.map(([from, to, state, sourceHandle, targetHandle]) => ({
    id: `${from}>${to}`,
    source: `stage:${from}`,
    sourceHandle,
    target: `stage:${to}`,
    targetHandle,
    state,
    weight: 1,
    devices: [],
    hop: `${from}>${to}`,
  }));
}

// The graph gives its glow to the first edges drawn when more ask than the budget allows, so the ones that matter come first.
const EDGE_ORDER: Record<EdgeState, number> = { warn: 0, bad: 1, ok: 2, flowing: 3, off: 4 };

/**
 * The topology as data: which nodes there are, where, in what state, and which edges join them. Nothing here draws.
 *
 * Scale (the brief): up to 12 devices every device is a node inside its zone; up to 60 a zone is one node with its
 * count and worst state, opened in place to show up to 6 devices and "+ n more"; above 60 a zone shows counts only,
 * and a device appears only when the search or _Problems only_ asks for it. The worst state of a group is the worst of
 * its devices, so a problem is never hidden by grouping. The seven stages are always drawn.
 */
export function buildTopology(input: TopologyInput): Topology {
  const { rows, stages, search, problemsOnly, expanded, selection, link } = input;
  const tier = tierOf(rows.length);
  const grouping: Grouping =
    tier === 'counts' ? 'zone' : (input.group ?? (tier === 'devices' ? 'all' : 'zone'));
  const filterActive = search.trim() !== '' || problemsOnly;
  const dimmed = link === 'lost';
  const brokerDown = stages.find((s) => s.id === 'broker')?.state === 'down';

  const passes = (row: FleetRow) =>
    matchesSearch(row, search) &&
    (!problemsOnly || isProblem(deviceTopologyState(row.status.kind)));
  const matching = rows.filter(passes);
  const problems = rows.filter((row) => isProblem(deviceTopologyState(row.status.kind))).length;

  let codes = zoneCodes(rows);
  const membersOf = (code: string) => rows.filter((row) => row.device.zoneCode === code);
  const worstOfZone = (code: string): TopologyState =>
    worstOf(membersOf(code).map((row) => deviceTopologyState(row.status.kind))) ?? 'healthy';
  // Past 60 the zone list is a list of what needs attention first, as the Lab's is (frame 19).
  if (tier === 'counts') {
    const severity: Record<TopologyState, number> = { down: 3, anomaly: 2, stale: 1, healthy: 0 };
    codes = [...codes].sort(
      (a, b) => severity[worstOfZone(b)] - severity[worstOfZone(a)] || a.localeCompare(b),
    );
  }

  interface Placed {
    code: string;
    mode: ZoneMode;
    shown: FleetRow[];
    more: number;
    members: FleetRow[];
  }
  const placed: Placed[] = [];
  for (const code of codes) {
    const members = membersOf(code);
    const inZone = matching.filter((row) => row.device.zoneCode === code);
    const selectedHere =
      selection !== null &&
      ((selection.type === 'zone' && selection.id === code) ||
        (selection.type === 'device' && members.some((row) => row.device.id === selection.id)));
    // A filter hides the zones it leaves empty; a selection keeps its own zone in view.
    if (filterActive && inZone.length === 0 && !selectedHere) continue;

    const open =
      (grouping === 'all' && tier !== 'counts') ||
      expanded.has(code) ||
      (filterActive && inZone.length > 0) ||
      selectedHere;
    if (!open) {
      placed.push({
        code,
        mode: tier === 'counts' ? 'counts' : 'closed',
        shown: [],
        more: 0,
        members,
      });
      continue;
    }
    // Every device when the tier or the viewer asked for them all; otherwise the worst first, and the rest as a count.
    const showAll = tier === 'devices' || grouping === 'all';
    let shown = inZone;
    if (!showAll && inZone.length > ZONE_PREVIEW) {
      shown = [...inZone].sort((a, b) => rankOf(a) - rankOf(b)).slice(0, ZONE_PREVIEW);
      const wanted =
        selection?.type === 'device' ? inZone.find((r) => r.device.id === selection.id) : undefined;
      if (wanted !== undefined && !shown.includes(wanted)) shown = [...shown, wanted];
    }
    placed.push({ code, mode: 'open', shown, more: inZone.length - shown.length, members });
  }

  const slots: ZoneSlot[] = placed.map((p) => ({
    code: p.code,
    mode: p.mode,
    shown: p.shown.length,
    more: p.more > 0,
  }));
  const boxes = layoutZones(slots);

  const nodes: TopoNode[] = [];
  const edges: TopoEdge[] = [];

  placed.forEach((p, i) => {
    const box = boxes[i];
    if (box === undefined) return;
    const states = p.members.map((row) => deviceTopologyState(row.status.kind));
    const worst = worstOf(states) ?? 'healthy';
    const counts = zeroCounts();
    for (const state of states) counts[state] += 1;
    const selectedZone = selection?.type === 'zone' && selection.id === p.code;
    nodes.push({
      id: `zone:${p.code}`,
      type: 'zone',
      position: { x: box.x, y: box.y },
      width: box.w,
      height: box.h,
      data: {
        kind: 'zone',
        code: p.code,
        count: p.members.length,
        worst,
        mode: p.mode,
        counts,
        more: p.more,
        selected: selectedZone,
        dimmed,
        ariaLabel: `${p.code}, ${plural(p.members.length, 'device')}, ${TOPOLOGY_WORDS[worst].toLowerCase()}`,
      },
    });
    // A zone that is not open is the one node that stands for its devices, so it carries their edge.
    if (p.mode !== 'open') {
      const live = p.members.filter(
        (row) => row.status.kind === 'running' || row.status.kind === 'anomaly',
      );
      edges.push({
        id: `zone:${p.code}>broker`,
        source: `zone:${p.code}`,
        sourceHandle: 'right',
        target: 'stage:broker',
        targetHandle: 'left',
        state: zoneEdgeState(p.members, brokerDown),
        weight: p.members.length,
        devices: live.map((row) => row.device.id),
        hop: null,
      });
    }
  });

  placed.forEach((p) => {
    p.shown.forEach((row, index) => {
      const state = deviceTopologyState(row.status.kind);
      const reading = primaryReading(row);
      const selected = selection?.type === 'device' && selection.id === row.device.id;
      nodes.push({
        id: `device:${row.device.id}`,
        type: 'device',
        parentId: `zone:${p.code}`,
        position: devicePosition(index),
        width: DEVICE_W,
        height: DEVICE_H,
        data: {
          kind: 'device',
          deviceId: row.device.id,
          name: row.name,
          code: row.code,
          deviceKind: row.device.kind,
          zone: row.device.zoneCode,
          state,
          word: row.status.word,
          metric: reading?.metric ?? row.device.metrics[0] ?? null,
          reading: reading?.text ?? null,
          reason: row.status.reason,
          selected,
          dimmed,
          ariaLabel: `${row.name}, ${reading ? `${reading.metric} ${reading.text}` : 'no reading'}, ${row.status.word.toLowerCase()}`,
        },
      });
      edges.push({
        id: `device:${row.device.id}>broker`,
        source: `device:${row.device.id}`,
        sourceHandle: 'right',
        target: 'stage:broker',
        targetHandle: 'left',
        state: deviceEdgeState(row, brokerDown),
        weight: 1,
        devices: [row.device.id],
        hop: null,
      });
    });
  });

  for (const id of STAGE_ORDER) {
    const stage = stages.find((s) => s.id === id);
    const box = STAGE_BOXES[id];
    if (stage === undefined) continue;
    const selected = selection?.type === 'stage' && selection.id === id;
    nodes.push({
      id: `stage:${id}`,
      type: 'stage',
      position: { x: box.x, y: box.y },
      width: box.w,
      height: box.h,
      data: {
        kind: 'stage',
        stage,
        selected,
        ariaLabel: `${stage.label}, ${stage.word.toLowerCase()}${stage.headline ? `, ${stage.headline}` : ''}`,
      },
    });
  }
  edges.push(...pipelineEdges(stages, rows));

  // A child must come after its parent for React Flow; zones were pushed first, then devices, then stages.
  const absolute: Box[] = [...boxes, ...STAGE_ORDER.map((id) => STAGE_BOXES[id])];
  return {
    tier,
    grouping,
    nodes,
    edges: [...edges].sort((a, b) => EDGE_ORDER[a.state] - EDGE_ORDER[b.state]),
    summary: `${plural(rows.length, 'device')} · ${plural(zoneCodes(rows).length, 'zone')} · ${plural(problems, 'problem')}`,
    problems,
    matches: matching.length,
    bounds: boundsOf(absolute),
  };
}
