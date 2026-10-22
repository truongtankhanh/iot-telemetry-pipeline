import type { StageNode } from '../../lib/pipeline';
import { stateBar, type ZoneRow, zoneLine } from '../../lib/labZones';
import { TOPOLOGY_WORDS } from '../../lib/topologyState';
import { Icon } from '../../ui/Icon';
import { stageGlyphs } from '../../ui/icons';
import { StateMark } from '../topology/StateMark';
import styles from './zoneList.module.css';

export interface ZoneListProps {
  /** The zones to list, worst first and already filtered. */
  zones: readonly ZoneRow[];
  /** All the zones and devices there are, for the header ("20 zones · 100 devices"). */
  totals: { zones: number; devices: number };
  selected: string | null;
  onSelect: (zone: string) => void;
}

/**
 * Above 60 devices (frame 19) the canvas is a list of zones, worst first, not one node for each device: each row has
 * the zone's code, its worst state as an icon and a word, how many devices it has and how many the fault is aimed at, and a
 * stacked bar of the states of its devices (the bar is a picture of the words, which are also in the row's name). A zone
 * the fault is aimed at has an accent outline. A zone is chosen, not expanded: the devices of the chosen zone are in the table
 * under the canvas. The list scrolls inside its own box; nothing else moves when it does.
 */
export function ZoneList({ zones, totals, selected, onSelect }: ZoneListProps) {
  return (
    <div className={styles.listBox}>
      <p className={styles.listHead}>
        {totals.zones} zones · {totals.devices} devices
      </p>
      {zones.length === 0 ? (
        <p className={styles.empty} role="status">
          No zone matches.
        </p>
      ) : (
        <ul className={styles.list} aria-label="Zones, worst first">
          {zones.map((zone) => (
            <li key={zone.zone}>
              <button
                type="button"
                className={styles.zone}
                data-state={zone.worst}
                data-targeted={zone.targeted > 0 ? 'true' : undefined}
                aria-pressed={selected === zone.zone}
                aria-label={`${zone.zone}, ${zoneLine(zone)}, ${TOPOLOGY_WORDS[zone.worst].toLowerCase()}`}
                onClick={() => onSelect(zone.zone)}
              >
                <span className={styles.zoneTop}>
                  <b className={styles.code}>{zone.zone}</b>
                  <StateMark state={zone.worst} word={TOPOLOGY_WORDS[zone.worst]} />
                </span>
                <span className={styles.line}>{zoneLine(zone)}</span>
                <span className={styles.stack} aria-hidden="true">
                  {stateBar(zone.counts).map((segment) => (
                    <i
                      key={segment.state}
                      data-state={segment.state}
                      style={{ width: `${(segment.share * 100).toFixed(1)}%` }}
                      title={`${segment.count} ${TOPOLOGY_WORDS[segment.state].toLowerCase()}`}
                    />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface PipelineStripProps {
  stages: readonly StageNode[];
}

/**
 * The pipeline, drawn once (frame 19): the same seven stages as the graph, each with its state as an icon and a word and
 * its one figure, in the order the data takes. It does not scroll with the zone list.
 */
export function PipelineStrip({ stages }: PipelineStripProps) {
  return (
    <ol className={styles.pipeline} aria-label="Pipeline">
      {stages.map((stage) => (
        <li
          key={stage.id}
          className={styles.stage}
          data-state={stage.state}
          data-dimmed={stage.dimmed ? 'true' : undefined}
        >
          <span className={styles.stageHead}>
            <Icon glyph={stageGlyphs[stage.id]} size="sm" />
            {stage.label}
          </span>
          <StateMark state={stage.state} word={stage.word} />
          {stage.headline ? <span className={styles.stageFigure}>{stage.headline}</span> : null}
        </li>
      ))}
    </ol>
  );
}
