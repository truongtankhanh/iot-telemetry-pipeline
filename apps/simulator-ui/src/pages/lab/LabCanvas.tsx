import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useMemo, useState } from 'react';
import { filterZones, type ZoneTab, zoneRows, zoneTable } from '../../lib/labZones';
import { formatClockTime } from '../../lib/time';
import type { Grouping, Selection } from '../../lib/topology';
import { useStudio } from '../../state/studioContext';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { Chip } from '../../ui/Chip';
import { Pill } from '../../ui/Pill';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { ViewSwitch } from '../../ui/ViewSwitch';
import topology from '../topology/topology.module.css';
import { TopologyGraph } from '../topology/TopologyGraph';
import { useDownstreamPulses } from '../topology/useDownstreamPulses';
import { useTopologyModel } from '../topology/useTopologyModel';
import styles from './labCanvas.module.css';
import { PipelineStrip, ZoneList } from './ZoneList';
import { ZoneTable } from './ZoneTable';

export interface LabCanvasProps {
  /** The page's clock, renewed each second. */
  now: number;
  /** The devices the fault is aimed at: ringed in the graph, and their zone is open. */
  targets: ReadonlySet<string>;
  /** Above 60 devices: the zone chosen in the list (the address's `zone`), its table's tab and page. */
  zone: string | null;
  tab: ZoneTab;
  page: number;
  onZone: (zone: string | null) => void;
  onTab: (tab: ZoneTab) => void;
  onPage: (page: number) => void;
}

const targetWords = (targets: ReadonlySet<string>): string | null =>
  targets.size === 0
    ? null
    : targets.size === 1
      ? `Target: ${[...targets][0]}`
      : `${targets.size} targets`;

/**
 * The simulation canvas (frames 12 and 19). Up to 60 devices it is the Topology's own graph, grouped by zone, with the
 * devices the fault is aimed at ringed and their zone open, and the pipeline drawn once on the right. A search and the
 * grouping sit in the header; a click chooses a node (kept here, it is not the address's). Above 60 devices it is a
 * scrolling list of zones, worst first, beside the pipeline drawn once, with the table of the zone chosen under them: the
 * list and the pipeline have a fixed height, so scrolling the list or the table moves neither. It adds no data of its
 * own: the nodes, stages and states are `useTopologyModel`'s, so they cannot disagree with the Topology page.
 */
export function LabCanvas({
  now,
  targets,
  zone,
  tab,
  page,
  onZone,
  onTab,
  onPage,
}: LabCanvasProps) {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const publishRate = useStudio((state) => state.publishRate);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Grouping | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  useDownstreamPulses();

  const model = useTopologyModel({
    view,
    link,
    lastAlertSink,
    publishRate,
    now,
    query: { q, group, problems: false, selection },
    expanded,
    targets,
  });

  const onToggleZone = useCallback((code: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }, []);

  const rows = model?.rows;
  const zoneList = useMemo(() => zoneRows(rows ?? [], targets), [rows, targets]);
  const shownZones = useMemo(
    () => filterZones(zoneList, { q, problemsOnly }),
    [zoneList, q, problemsOnly],
  );

  if (view === null || model === null) return null;
  const graph = model.topology;
  const scale = graph.tier === 'counts';
  const target = targetWords(targets);
  const fitKey = [graph.tier, graph.grouping, q, targets.size, view.devices.length].join('|');

  return (
    <section className={styles.canvasCard} aria-label="Simulation canvas">
      <div className={styles.canvasBar} role="group" aria-label="Find and arrange the graph">
        <h2 className={styles.canvasTitle}>Simulation canvas</h2>
        <label className={topology.search}>
          <Icon glyph={uiIcons.search} size="sm" />
          <input
            type="search"
            aria-label="Find a device or zone"
            placeholder="Find a device or zone"
            value={q}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
        <Segmented
          label="Grouping"
          value={graph.grouping}
          onChange={(value) => setGroup(value === 'all' ? 'all' : 'zone')}
          options={[
            { value: 'zone', label: 'Grouped by zone' },
            { value: 'all', label: 'All devices', disabled: graph.tier === 'counts' },
          ]}
        />
        <ViewSwitch current="topology" selection={selection} />
        {scale ? (
          <>
            <button
              type="button"
              className={topology.problems}
              aria-pressed={problemsOnly}
              onClick={() => setProblemsOnly((was) => !was)}
            >
              Problems only <b>{zoneList.filter((z) => z.problems > 0).length}</b>
            </button>
            <Button size="sm" variant="ghost" disabled={zone === null} onClick={() => onZone(null)}>
              Collapse all
            </Button>
          </>
        ) : null}
        {target === null ? null : (
          <Chip tone="warn" icon={uiIcons.target}>
            {target}
          </Chip>
        )}
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
      </div>

      {scale ? (
        <>
          <div className={styles.scaleBody}>
            <ZoneList
              zones={shownZones}
              totals={{ zones: zoneList.length, devices: model.rows.length }}
              selected={zone}
              onSelect={(code) => onZone(code === zone ? null : code)}
            />
            <PipelineStrip stages={model.stages} />
          </div>
          {zone === null ? (
            <p className={styles.hint}>
              Choose a zone in the list to see its devices, their faults and their alerts.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <ZoneTable
                zone={zone}
                tab={tab}
                page={page}
                table={zoneTable({
                  rows: model.rows,
                  zone,
                  tab,
                  targets,
                  engine: view.engine,
                  alerts: view.alerts.alerts,
                })}
                onTab={onTab}
                onPage={onPage}
              />
            </div>
          )}
        </>
      ) : (
        <div className={styles.graph}>
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
        </div>
      )}

      {!scale && graph.matches === 0 && q.trim() !== '' ? (
        <p className={styles.hint} role="status">
          No device matches “{q.trim()}”. The pipeline is still shown.
        </p>
      ) : null}
    </section>
  );
}
