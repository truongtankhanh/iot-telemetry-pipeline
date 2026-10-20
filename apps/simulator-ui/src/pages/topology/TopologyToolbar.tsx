import { useReactFlow, useStore } from '@xyflow/react';
import { formatClockTime } from '../../lib/time';
import type { Grouping, Tier } from '../../lib/topology';
import type { LinkState } from '../../state/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { Pill } from '../../ui/Pill';
import { Segmented } from '../../ui/Segmented';
import styles from './topology.module.css';

export interface TopologyToolbarProps {
  link: LinkState;
  lostSince: number | null;
  /** The grouping in force (`Topology.grouping`), which is the viewer's choice where the tier allows it. */
  grouping: Grouping;
  tier: Tier;
  search: string;
  problemsOnly: boolean;
  /** Devices that are not healthy. */
  problems: number;
  /** A zone the viewer opened, or every zone shown open: "Collapse all zones" has something to do. */
  canCollapse: boolean;
  onSearch: (q: string) => void;
  onGrouping: (grouping: Grouping) => void;
  onProblemsOnly: (on: boolean) => void;
  onCollapseAll: () => void;
}

const zoomOf = (state: { transform: [number, number, number] }) =>
  Math.round(state.transform[2] * 100);

/**
 * The bar above the graph (frame 04): the live state, the grouping, _Problems only_, a search, _Collapse all zones_,
 * zoom and fit. Everything the graph needs to be found and arranged is here, so nothing is drawn over the graph itself.
 * A group, not an ARIA toolbar: a toolbar promises arrow-key movement between its controls and a search field needs
 * the arrows (the Fleet's reason). It must be inside the page's `ReactFlowProvider`, because zoom and fit are the graph's.
 */
export function TopologyToolbar({
  link,
  lostSince,
  grouping,
  tier,
  search,
  problemsOnly,
  problems,
  canCollapse,
  onSearch,
  onGrouping,
  onProblemsOnly,
  onCollapseAll,
}: TopologyToolbarProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore(zoomOf);

  return (
    <div className={styles.toolbar} role="group" aria-label="Find and arrange the graph">
      {link === 'live' ? (
        <Pill label="Live" tone="ok" />
      ) : link === 'lost' ? (
        <Pill
          label="Lost"
          tone="bad"
          detail={lostSince === null ? null : `at ${formatClockTime(lostSince)}`}
        />
      ) : (
        <Pill label="Connecting" tone="unknown" />
      )}

      <Segmented
        label="Grouping"
        value={grouping}
        onChange={(value) => onGrouping(value === 'all' ? 'all' : 'zone')}
        options={[
          { value: 'zone', label: 'Grouped by zone' },
          // Past 60 devices every device as a node is not a picture: the graph keeps to zones.
          { value: 'all', label: 'All devices', disabled: tier === 'counts' },
        ]}
      />

      <button
        type="button"
        className={styles.problems}
        aria-pressed={problemsOnly}
        onClick={() => onProblemsOnly(!problemsOnly)}
      >
        Problems only <b>{problems}</b>
      </button>

      <label className={styles.search}>
        <Icon glyph={uiIcons.search} size="sm" />
        <input
          type="search"
          aria-label="Find a device or zone"
          placeholder="Find a device or zone"
          value={search}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>

      <Button variant="ghost" size="sm" disabled={!canCollapse} onClick={onCollapseAll}>
        Collapse all zones
      </Button>

      <div className={styles.zoom}>
        <Button
          variant="ghost"
          size="sm"
          icon={uiIcons.minus}
          aria-label="Zoom out"
          onClick={() => void zoomOut({ duration: 120 })}
        />
        <span className={styles.zoomValue}>{zoom}%</span>
        <Button
          variant="ghost"
          size="sm"
          icon={uiIcons.plus}
          aria-label="Zoom in"
          onClick={() => void zoomIn({ duration: 120 })}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={uiIcons.fit}
          aria-label="Fit to screen"
          onClick={() => void fitView({ padding: 0.06, duration: 120 })}
        />
      </div>
    </div>
  );
}
