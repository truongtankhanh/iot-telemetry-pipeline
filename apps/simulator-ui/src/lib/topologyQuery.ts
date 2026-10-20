import { STAGE_ORDER, type StageId } from './pipeline';
import type { Grouping, Selection } from './topology';

/**
 * What the address says about the topology page: the search, the grouping, _Problems only_ and the selected node.
 * The address is the state, as on the Fleet: a link opens the page as it was, and Back and Forward move through it.
 */
export interface TopologyQuery {
  q: string;
  /** `null` is automatic: every device up to 12, zones above. */
  group: Grouping | null;
  problems: boolean;
  /** One thing at a time: a device, a zone or a stage of the pipeline. */
  selection: Selection | null;
}

export const DEFAULT_TOPOLOGY_QUERY: TopologyQuery = {
  q: '',
  group: null,
  problems: false,
  selection: null,
};

const GROUPINGS: readonly Grouping[] = ['zone', 'all'];

const isStage = (value: string): value is StageId =>
  (STAGE_ORDER as readonly string[]).includes(value);

/**
 * Reads the address. A value that is not one of the allowed ones falls back to the default instead of failing: a link
 * shared with an old or hand-edited address still opens the page. If several selections are present the device wins,
 * then the stage, then the zone. (`?zone=` is what the palette links to for a zone.)
 */
export function parseTopologyQuery(params: URLSearchParams): TopologyQuery {
  const group = params.get('group');
  const device = params.get('device');
  const node = params.get('node');
  const zone = params.get('zone');
  let selection: Selection | null = null;
  if (device) selection = { type: 'device', id: device };
  else if (node && isStage(node)) selection = { type: 'stage', id: node };
  else if (zone) selection = { type: 'zone', id: zone };
  return {
    q: (params.get('q') ?? '').slice(0, 100),
    group: GROUPINGS.includes(group as Grouping) ? (group as Grouping) : null,
    problems: params.get('problems') === '1',
    selection,
  };
}

/** Writes the address with only what differs from the default, so the plain page has a plain address. */
export function serializeTopologyQuery(query: TopologyQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.group !== null) params.set('group', query.group);
  if (query.problems) params.set('problems', '1');
  if (query.selection !== null) {
    const key = { device: 'device', stage: 'node', zone: 'zone' }[query.selection.type];
    params.set(key, query.selection.id);
  }
  return params;
}
