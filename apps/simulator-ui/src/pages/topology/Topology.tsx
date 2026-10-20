import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { dependencyNotes } from '../../lib/dependencyNotes';
import type { Selection } from '../../lib/topology';
import { useNow } from '../../state/useNow';
import { useStudio } from '../../state/studioContext';
import { Card } from '../../ui/Card';
import { PageHeader } from '../../ui/PageHeader';
import { DependencyBanners } from './DependencyBanners';
import { DetailRow } from './DetailRow';
import styles from './topology.module.css';
import { TopologyGraph } from './TopologyGraph';
import { TopologyLegend } from './TopologyLegend';
import { TopologyToolbar } from './TopologyToolbar';
import { useDownstreamPulses } from './useDownstreamPulses';
import { useTopologyModel } from './useTopologyModel';
import { useTopologyParams } from './useTopologyParams';

const DESCRIPTION =
  'Every component between a device and an incident. A line is lit only while something crosses it.';

/** A selection in the address that names a device or a zone the registry does not have. */
function unknownSelection(selection: Selection | null, deviceIds: Set<string>, zones: Set<string>) {
  if (selection?.type === 'device' && !deviceIds.has(selection.id)) {
    return `No device called ${selection.id} is registered.`;
  }
  if (selection?.type === 'zone' && !zones.has(selection.id)) {
    return `No zone called ${selection.id} has a device.`;
  }
  return null;
}

/**
 * The topology (frames 04 and 10): the banners for what is wrong, the toolbar, the graph, its key and the row under it. The address is the state (search, grouping,
 * _Problems only_, the selected node); the zones the viewer opened are this page's own. It reads the store and the
 * history and keeps no copy of either. Before the first message there is a loading line, with no registered device
 * a card says so, and with the link to the simulator lost the graph keeps the last data, dimmed.
 */
export function Topology() {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const publishRate = useStudio((state) => state.publishRate);
  const now = useNow();
  const [query, update] = useTopologyParams();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const model = useTopologyModel({ view, link, lastAlertSink, publishRate, now, query, expanded });
  useDownstreamPulses();

  const onSelect = useCallback((selection: Selection | null) => update({ selection }), [update]);
  const onToggleZone = useCallback((code: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }, []);

  if (view === null || model === null) {
    return (
      <>
        <PageHeader title="Topology" description={DESCRIPTION} />
        <Card title="System topology">
          <p role="status">
            {link === 'lost'
              ? 'The simulator has not answered yet.'
              : 'Waiting for the first message from the simulator…'}
          </p>
        </Card>
      </>
    );
  }

  if (view.devices.length === 0) {
    return (
      <>
        <PageHeader title="Topology" description={DESCRIPTION} />
        <Card title="No devices">
          <p>The simulator plays no device, so there is nothing to follow to an incident.</p>
        </Card>
      </>
    );
  }

  const { topology } = model;
  const notes = dependencyNotes(view, lastAlertSink);
  const running = view.engine.devices.filter((d) => d.state === 'running').map((d) => d.id);
  const notice = unknownSelection(
    query.selection,
    new Set(view.devices.map((device) => device.id)),
    new Set(view.devices.map((device) => device.zoneCode)),
  );
  const fitKey = [
    topology.tier,
    topology.grouping,
    query.q,
    query.problems,
    view.devices.length,
  ].join('|');

  return (
    <div className={styles.page} data-stale={link === 'lost' ? 'true' : undefined}>
      <PageHeader title="Topology" description={DESCRIPTION} />
      <DependencyBanners notes={notes} runningDevices={running} />
      {notice === null ? null : (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <ReactFlowProvider>
        <TopologyToolbar
          link={link}
          lostSince={lostSince}
          grouping={topology.grouping}
          tier={topology.tier}
          search={query.q}
          problemsOnly={query.problems}
          problems={topology.problems}
          canCollapse={
            expanded.size > 0 || (topology.grouping === 'all' && topology.tier !== 'counts')
          }
          onSearch={(q) => update({ q })}
          onGrouping={(group) => update({ group })}
          onProblemsOnly={(problems) => update({ problems })}
          onCollapseAll={() => {
            setExpanded(new Set());
            update({ group: 'zone' });
          }}
        />
        <div className={styles.canvasWrap}>
          <TopologyGraph
            nodes={model.nodes}
            edges={model.edges}
            onSelect={onSelect}
            onToggleZone={onToggleZone}
            fitKey={fitKey}
          />
        </div>
      </ReactFlowProvider>
      {topology.matches === 0 && (query.q.trim() !== '' || query.problems) ? (
        <p role="status" className={styles.notice}>
          No device matches{query.q.trim() !== '' ? ` “${query.q.trim()}”` : ''}
          {query.problems ? ' among the devices that need a look' : ''}. The pipeline is still
          shown.
        </p>
      ) : null}
      <TopologyLegend summary={topology.summary} />
      <DetailRow
        view={view}
        rows={model.rows}
        stages={model.stages}
        selection={query.selection}
        lastAlertSink={lastAlertSink}
        now={now}
        onSelect={onSelect}
      />
    </div>
  );
}
