import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import type { Selection } from '../../lib/topology';
import { serializeTopologyQuery } from '../../lib/topologyQuery';
import { useStudio } from '../../state/studioContext';
import { Card } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { Pill } from '../../ui/Pill';
import { Segmented } from '../../ui/Segmented';
import { formatClockTime } from '../../lib/time';
import { TopologyGraph } from '../topology/TopologyGraph';
import topology from '../topology/topology.module.css';
import { useDownstreamPulses } from '../topology/useDownstreamPulses';
import { useTopologyModel } from '../topology/useTopologyModel';
import styles from './overview.module.css';
import type { OverviewQuery } from './useOverviewParams';

export interface OverviewTopologyProps {
  /** The page's clock, renewed each second. */
  now: number;
  query: OverviewQuery;
  onQuery: (patch: Partial<OverviewQuery>) => void;
}

/**
 * The live topology of the Overview (frame 11): the Topology page's own nodes, edges and model, in a shorter canvas
 * with no minimap and no detail row. Up to 12 devices every device is a node, above that a zone is one node with its
 * count and worst state that opens in place, and above 60 it shows counts only; _Problems only_ and the search reach one
 * device. A click chooses a node (a ring, kept here: the address holds the graph's filter, not a selection), and
 * **Open in Topology** carries the grouping, the filter and the selection to the page that shows the detail.
 */
export function OverviewTopology({ now, query, onQuery }: OverviewTopologyProps) {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const publishRate = useStudio((state) => state.publishRate);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  useDownstreamPulses();

  const model = useTopologyModel({
    view,
    link,
    lastAlertSink,
    publishRate,
    now,
    query: { q: query.gq, group: query.group, problems: query.problems, selection },
    expanded,
  });

  const onToggleZone = useCallback((code: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }, []);

  if (view === null || model === null) return null;

  const { topology: graph } = model;
  const zones = new Set(view.devices.map((device) => device.zoneCode)).size;
  const open = serializeTopologyQuery({
    q: query.gq,
    group: query.group,
    problems: query.problems,
    selection,
  }).toString();
  const fitKey = [graph.tier, graph.grouping, query.gq, query.problems, view.devices.length].join(
    '|',
  );

  return (
    <Card
      title="Live topology"
      aside={
        <>
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
          <Link
            className={styles.link}
            to={`/topology${open === '' ? '' : `?${open}`}`}
            title="Opens the Topology page with this grouping, filter and selection"
          >
            Open in Topology <Icon glyph={uiIcons.external} size="sm" />
          </Link>
        </>
      }
    >
      <div className={styles.graphBar} role="group" aria-label="Find and arrange the graph">
        <Segmented
          label="Grouping"
          value={graph.grouping}
          onChange={(value) => onQuery({ group: value === 'all' ? 'all' : 'zone' })}
          options={[
            { value: 'zone', label: 'Grouped by zone' },
            // Past 60 devices every device as a node is not a picture: the graph keeps to zones.
            { value: 'all', label: 'All devices', disabled: graph.tier === 'counts' },
          ]}
        />
        <button
          type="button"
          className={topology.problems}
          aria-pressed={query.problems}
          onClick={() => onQuery({ problems: !query.problems })}
        >
          Problems only <b>{graph.problems}</b>
        </button>
        <label className={topology.search}>
          <Icon glyph={uiIcons.search} size="sm" />
          <input
            type="search"
            aria-label="Find a device or zone"
            placeholder="Find a device or zone"
            value={query.gq}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQuery({ gq: event.target.value })}
          />
        </label>
        <span className={styles.graphSummary}>
          {view.devices.length} {view.devices.length === 1 ? 'device' : 'devices'} · {zones}{' '}
          {zones === 1 ? 'zone' : 'zones'} · groups automatically above 12 devices
        </span>
      </div>

      <ReactFlowProvider>
        <TopologyGraph
          compact
          nodes={model.nodes}
          edges={model.edges}
          onSelect={setSelection}
          onToggleZone={onToggleZone}
          fitKey={fitKey}
        />
      </ReactFlowProvider>

      {graph.matches === 0 && (query.gq.trim() !== '' || query.problems) ? (
        <p className={styles.hint} role="status">
          No device matches{query.gq.trim() !== '' ? ` “${query.gq.trim()}”` : ''}
          {query.problems ? ' among the devices that need a look' : ''}. The pipeline is still
          shown.
        </p>
      ) : null}
      <p className={styles.hint}>
        Click a zone to expand it; line width follows the devices behind it. Above 60 devices a zone
        shows counts and its worst state, never one node per device; use the search or{' '}
        <b>Problems only</b> to reach one.
      </p>
    </Card>
  );
}
