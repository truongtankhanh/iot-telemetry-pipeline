import { parseTwinSelection, type TwinSelection, writeTwinSelection } from './twinQuery';

/** The two views of the same campus: the graph of components, and the campus in 3D. */
export type ViewName = 'topology' | 'twin';

const PATHS: Record<ViewName, string> = { topology: '/topology', twin: '/twin' };

/**
 * A selection held by a page in its own state (the Overview's and the Lab's graph keep theirs there), as the twin can
 * take it: a device or a zone. A stage of the pipeline is not on the campus, so it is not carried.
 */
export function asTwinSelection(
  selection: { type: string; id: string } | null | undefined,
): TwinSelection | null {
  if (selection === null || selection === undefined) return null;
  return selection.type === 'device' || selection.type === 'zone'
    ? { type: selection.type, id: selection.id }
    : null;
}

/**
 * What the switch carries from the page it is on: the selection the page holds in its own state if it has one, else the
 * one in the address (`device`, `zone`: the Topology and the Twin share those keys). Nothing else is carried — the
 * Topology's search and grouping, the Twin's layers and camera, the Lab's targets belong to the page they were set on.
 */
export function carriedSelection(
  search: string,
  local?: { type: string; id: string } | null,
): TwinSelection | null {
  return asTwinSelection(local) ?? parseTwinSelection(new URLSearchParams(search));
}

/** The path and query of the other view, on the same selection. */
export function viewSwitchTarget(to: ViewName, selection: TwinSelection | null): string {
  const search = writeTwinSelection(new URLSearchParams(), selection).toString();
  return search === '' ? PATHS[to] : `${PATHS[to]}?${search}`;
}
