import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SVGProps,
} from 'react';
import type {
  AlertRowModel,
  AlertsLane,
  DockBlock,
  DockLane,
  DockModel,
} from '../../lib/labTimeline';
import { useAnimationSlot } from '../../ui/animationBudgetContext';
import styles from './timelineDock.module.css';

const PILL_WIDTH = 56;
const PILL_HEIGHT = 22;
const GRIP_WIDTH = 8;

type Grab = 'move' | 'start' | 'end';

/** What the editor adds to the picture: the selection, the pointer and keyboard handlers, the controls of a grouped timeline. */
export interface PictureEditing {
  /** The id of the selected fault, or `null`. */
  selectedId: string | null;
  /** The id of the fault being dragged, or `null`. */
  dragging: string | null;
  onSelect(id: string | null): void;
  /** Pointer handlers for the element that is grabbed: the body of a block moves it, a grip resizes it. */
  bind(id: string, mode: Grab): SVGProps<SVGRectElement>;
  /** Keys on a block that has the focus (arrows, Delete, Escape). */
  onKeyDown(event: KeyboardEvent<SVGGElement>, id: string): void;
  /** Open or close a zone of a grouped timeline. */
  onToggleZone(zone: string): void;
  /** A double click on an empty part of a device lane: add an anomaly there. */
  onLaneAdd(lane: DockLane, event: ReactMouseEvent<SVGRectElement>): void;
  /** Props for an invisible strip over the ruler, where the playhead is scrubbed. */
  ruler?: SVGProps<SVGRectElement>;
}

export interface TimelinePictureProps {
  model: DockModel;
  /** Without it the picture is a still image with a description; with it, a group of blocks that can be selected and edited. */
  editing?: PictureEditing;
}

/** The path of a polyline given as `x,y x,y …`. */
const pathOf = (points: string) => `M${points.split(' ').join(' L')}`;

/**
 * A spark that runs along the curve of the selected lane. It exists only while the screen's animation budget allows (the
 * Topology's lines share it), and the style sheet switches it off under `prefers-reduced-motion`.
 */
function Spark({ points }: { points: string }) {
  const granted = useAnimationSlot('line');
  if (!granted) return null;
  return (
    <circle
      className={styles.spark}
      r={3.2}
      style={{ offsetPath: `path('${pathOf(points)}')` }}
      aria-hidden="true"
    />
  );
}

function Curve({ lane, model, spark }: { lane: DockLane; model: DockModel; spark: boolean }) {
  const curve = lane.curve;
  if (curve === null) return null;
  const neon = curve.inside !== undefined;
  return (
    <>
      {curve.raiseY === null ? null : (
        <>
          <line
            className={styles.raise}
            x1={model.axis.left}
            x2={model.axis.right}
            y1={curve.raiseY}
            y2={curve.raiseY}
          />
          <text
            className={styles.raiseLabel}
            x={model.axis.right - 4}
            y={curve.raiseY - 4}
            textAnchor="end"
          >
            {curve.raiseLabel}
          </text>
        </>
      )}
      {neon ? (
        <>
          <polyline className={styles.curveHalo} points={curve.points} />
          <polyline className={styles.curveGlow} points={curve.points} />
        </>
      ) : null}
      <polyline className={styles.curve} points={curve.points} />
      {curve.inside?.map((points) => (
        <g key={points}>
          <polyline className={styles.insideHalo} points={points} />
          <polyline className={styles.insideGlow} points={points} />
          <polyline className={styles.inside} points={points} />
        </g>
      ))}
      {spark ? <Spark points={curve.points} /> : null}
    </>
  );
}

function Block({
  block,
  lane,
  editing,
  tabStop,
}: {
  block: DockBlock;
  lane: DockLane;
  editing: PictureEditing | undefined;
  tabStop: boolean;
}) {
  const y = lane.y + 6;
  const height = lane.height - 12;
  const label =
    block.label === null ? null : (
      <text className={styles.blockLabel} x={block.x + 8} y={lane.y + 22}>
        {block.label}
      </text>
    );

  // A block with no id (the fault being configured) is a still shape, in the dock and in the editor.
  if (editing === undefined || block.id === undefined) {
    return (
      <g>
        <title>{block.title}</title>
        <rect
          className={styles.block}
          data-pending={block.pending ? 'true' : undefined}
          x={block.x}
          width={block.width}
          y={y}
          height={height}
          rx={7}
        />
        {label}
      </g>
    );
  }

  const { id } = block;
  const body = editing.bind(id, 'move');
  const focusBlock = (event: ReactPointerEvent<SVGRectElement>) => {
    body.onPointerDown?.(event);
    event.currentTarget.parentElement?.focus({ preventScroll: true });
  };
  return (
    <g
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={block.title}
      aria-pressed={block.selected === true}
      data-block-id={id}
      className={styles.editable}
      data-selected={block.selected ? 'true' : undefined}
      data-dragging={editing.dragging === id ? 'true' : undefined}
      onFocus={() => editing.onSelect(id)}
      onKeyDown={(event) => editing.onKeyDown(event, id)}
    >
      <rect
        {...body}
        onPointerDown={focusBlock}
        className={styles.block}
        data-selected={block.selected ? 'true' : undefined}
        x={block.x}
        width={block.width}
        y={y}
        height={height}
        rx={7}
      />
      {label}
      {block.selected ? (
        <>
          <rect
            {...editing.bind(id, 'start')}
            className={styles.grip}
            x={block.x - GRIP_WIDTH / 2}
            y={y + 4}
            width={GRIP_WIDTH}
            height={height - 8}
            rx={3}
          >
            <title>Drag to change when it starts</title>
          </rect>
          <rect
            {...editing.bind(id, 'end')}
            className={styles.grip}
            x={block.x + block.width - GRIP_WIDTH / 2}
            y={y + 4}
            width={GRIP_WIDTH}
            height={height - 8}
            rx={3}
          >
            <title>Drag to change when it ends</title>
          </rect>
        </>
      ) : null}
    </g>
  );
}

function ZoneToggle({ lane, editing }: { lane: DockLane; editing: PictureEditing | undefined }) {
  if (editing === undefined || lane.kind !== 'group' || !lane.expandable) return null;
  const zone = lane.zone ?? lane.label;
  const open = lane.expanded === true;
  const toggle = () => editing.onToggleZone(zone);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${open ? 'Close' : 'Open'} zone ${zone} ${open ? 'to one lane' : 'into its devices'}`}
      className={styles.zoneToggle}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <rect x={0} y={lane.y} width={170} height={lane.height} className={styles.zoneHit} />
      <path
        className={styles.chevron}
        d={open ? `M150 ${lane.y + 14} l5 6 l5 -6` : `M152 ${lane.y + 11} l6 5 l-6 5`}
      />
    </g>
  );
}

function Lane({
  lane,
  model,
  editing,
  tabStopId,
  sparkLane,
}: {
  lane: DockLane;
  model: DockModel;
  editing: PictureEditing | undefined;
  tabStopId: string | null;
  sparkLane: boolean;
}) {
  const mid = lane.y + lane.height / 2;
  const nested = lane.kind === 'device' && lane.zone !== undefined;
  return (
    <g>
      <line className={styles.laneLine} x1={0} x2={model.width} y1={lane.y} y2={lane.y} />
      <text className={styles.laneName} x={nested ? 28 : 14} y={mid - 2}>
        {lane.label}
      </text>
      <text className={styles.laneSub} x={nested ? 28 : 14} y={mid + 15}>
        {lane.sub}
      </text>
      {editing !== undefined && lane.kind === 'device' ? (
        <rect
          className={styles.laneHit}
          x={model.axis.left}
          y={lane.y}
          width={Math.max(0, model.axis.right - model.axis.left)}
          height={lane.height}
          onDoubleClick={(event) => editing.onLaneAdd(lane, event)}
        />
      ) : null}
      <Curve lane={lane} model={model} spark={sparkLane} />
      {lane.blocks.map((block) => (
        <Block
          // An editable block keeps its key while it moves and resizes, or the element is made again and loses the focus
          // and the pointer capture in the middle of the keystroke or the drag.
          key={block.id ?? `${block.startAt}-${block.endAt}-${block.pending}`}
          block={block}
          lane={lane}
          editing={editing}
          tabStop={block.id !== undefined && block.id === tabStopId}
        />
      ))}
      {lane.bars.map((bar, index) => (
        <rect
          key={index}
          className={styles.bar}
          data-pending={bar.pending ? 'true' : undefined}
          data-selected={bar.selected ? 'true' : undefined}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={bar.height / 2}
        >
          <title>{bar.title}</title>
        </rect>
      ))}
      {lane.span === null ? null : (
        <text className={styles.laneSub} x={lane.span.x} y={mid + 5}>
          {lane.span.text}
        </text>
      )}
      <ZoneToggle lane={lane} editing={editing} />
    </g>
  );
}

function AlertRow({ row, model }: { row: AlertRowModel; model: DockModel }) {
  const mid = row.y + 12;
  const right = model.axis.right;
  const barEnd = row.openToEnd ? right : (row.clearX ?? right);
  return (
    <g>
      <title>
        {`${row.title} (${row.severity}) on ${row.deviceId}: raised about ${row.raiseText}${row.clearText === null ? '' : `, clears about ${row.clearText}`}`}
      </title>
      <text className={styles.alertRule} x={14} y={mid - 2}>
        {row.ruleId}
      </text>
      <text className={styles.laneSub} x={14} y={mid + 13}>
        {row.severity}
      </text>
      {row.beyond ? null : (
        <>
          <rect
            className={styles.alertBar}
            data-open={row.openToEnd ? 'true' : undefined}
            x={row.raiseX}
            y={mid - 5}
            width={Math.max(2, barEnd - row.raiseX)}
            height={10}
            rx={5}
          />
          <circle className={styles.dot} data-kind="raise" cx={row.raiseX} cy={mid} r={5} />
          {row.clearX === null ? (
            <path className={styles.openArrow} d={`M${right - 10} ${mid - 5} l8 5 l-8 5`} />
          ) : (
            <circle className={styles.dot} data-kind="clear" cx={row.clearX} cy={mid} r={5} />
          )}
          <text className={styles.dotTime} x={row.raiseX} y={mid - 9} textAnchor="middle">
            {row.raiseText}
          </text>
          {row.clearX === null || row.clearText === null ? null : (
            <text className={styles.dotTime} x={row.clearX} y={mid - 9} textAnchor="middle">
              {row.clearText}
            </text>
          )}
        </>
      )}
      {row.beyond ? (
        <text className={styles.laneSub} x={right} y={mid + 4} textAnchor="end">
          {`raised about ${row.raiseText}, after the picture`}
        </text>
      ) : null}
    </g>
  );
}

function Alerts({ alerts, model }: { alerts: AlertsLane; model: DockModel }) {
  return (
    <g>
      <line className={styles.laneLine} x1={0} x2={model.width} y1={alerts.y} y2={alerts.y} />
      <text className={styles.laneName} x={14} y={alerts.y + 22}>
        Alerts
      </text>
      <text className={styles.laneSub} x={14} y={alerts.y + 40}>
        from the rules
      </text>
      {alerts.rows === undefined ? (
        <>
          <rect
            className={styles.window}
            x={alerts.window.x}
            y={alerts.y + 8}
            width={alerts.window.width}
            height={18}
            rx={9}
          />
          {alerts.dots.map((dot, index) => (
            <circle
              key={index}
              className={styles.dot}
              data-kind={dot.kind}
              cx={dot.x}
              cy={alerts.y + 17}
              r={5}
            />
          ))}
          <text className={styles.windowLabel} x={alerts.window.x + 14} y={alerts.y + 22}>
            {alerts.label}
          </text>
          {alerts.summary === null ? null : (
            <text className={styles.laneSub} x={alerts.window.x} y={alerts.y + 44}>
              {alerts.summary}
            </text>
          )}
        </>
      ) : (
        alerts.rows.map((row) => <AlertRow key={row.key} row={row} model={model} />)
      )}
    </g>
  );
}

/**
 * The picture of a timeline (the Lab's dock and the timeline editor): a ruler of seconds, a lane for each device (or zone),
 * the faults as blocks with the value the simulator expects drawn against the rule's raise line, the alerts lane and the
 * playhead, at the width the model was built for so that its text stays 13 px or more. Without `editing` it is a still image
 * with a description. With it, the blocks are buttons (one tab stop among them, the selected block or the first), the selected
 * one has grips, the pointer and keyboard handlers are the editor's, and a grouped timeline's zones can be opened. Everything
 * on it is designed from the rules, not observed.
 */
export function TimelinePicture({ model, editing }: TimelinePictureProps) {
  const alerts = model.alerts;
  const firstId = model.lanes
    .flatMap((lane) => lane.blocks)
    .find((block) => block.id !== undefined)?.id;
  const tabStopId = editing === undefined ? null : (editing.selectedId ?? firstId ?? null);
  const sparkLaneKey =
    editing === undefined
      ? null
      : (model.lanes.find((lane) => lane.blocks.some((block) => block.selected))?.key ?? null);

  return (
    <svg
      className={styles.svg}
      width={model.width}
      height={model.height}
      viewBox={`0 0 ${model.width} ${model.height}`}
      role={editing === undefined ? 'img' : 'group'}
      aria-label={model.description}
    >
      <g aria-hidden={editing === undefined ? true : undefined}>
        <rect className={styles.rulerBg} x={0} y={0} width={model.width} height={model.axis.top} />
        {editing === undefined ? null : (
          <rect
            className={styles.canvasHit}
            x={0}
            y={model.axis.top}
            width={model.width}
            height={Math.max(0, model.height - model.axis.top)}
            onPointerDown={() => editing.onSelect(null)}
          />
        )}
        {model.ticks.map((tick) =>
          tick.label === null ? (
            <line
              key={tick.x}
              className={styles.gridMinor}
              x1={tick.x}
              x2={tick.x}
              y1={model.axis.top - 5}
              y2={model.axis.top}
            />
          ) : (
            <g key={tick.x}>
              <line
                className={styles.gridMajor}
                x1={tick.x}
                x2={tick.x}
                y1={model.axis.top - 10}
                y2={model.height}
              />
              <text
                className={styles.tickLabel}
                x={tick.x}
                y={model.axis.top - 12}
                textAnchor={tick.anchor}
              >
                {tick.label}
              </text>
            </g>
          ),
        )}
        {model.lanes.map((lane) => (
          <Lane
            key={lane.key}
            lane={lane}
            model={model}
            editing={editing}
            tabStopId={tabStopId}
            sparkLane={sparkLaneKey === lane.key}
          />
        ))}
        {alerts === null ? null : <Alerts alerts={alerts} model={model} />}
        {model.playhead === null ? null : (
          <g aria-hidden={editing === undefined ? undefined : true}>
            <rect
              className={styles.played}
              x={model.axis.left}
              y={model.axis.top}
              width={model.playhead.playedWidth}
              height={model.height - model.axis.top}
            />
            <line
              className={styles.playhead}
              x1={model.playhead.x}
              x2={model.playhead.x}
              y1={model.axis.top - 4}
              y2={model.height}
            />
            <rect
              className={styles.pill}
              x={model.playhead.x - PILL_WIDTH / 2}
              y={2}
              width={PILL_WIDTH}
              height={PILL_HEIGHT}
              rx={6}
            />
            <text
              className={styles.pillText}
              x={model.playhead.x}
              y={2 + PILL_HEIGHT - 6}
              textAnchor="middle"
            >
              {model.playhead.label}
            </text>
          </g>
        )}
        {editing?.ruler === undefined ? null : (
          <rect
            {...editing.ruler}
            className={styles.rulerHit}
            x={model.axis.left}
            y={0}
            width={Math.max(0, model.axis.right - model.axis.left)}
            height={model.axis.top}
          />
        )}
      </g>
    </svg>
  );
}
