import { useId } from 'react';
import { Link } from 'react-router';
import type { Anomaly, DeviceInfo, Expected, RulesView } from '../../api/types';
import { buildDock, type DockLane, type DockModel } from '../../lib/labTimeline';
import { Button } from '../../ui/Button';
import { useElementWidth } from '../../ui/charts/useElementWidth';
import styles from './timelineDock.module.css';

/** The width before the picture's own is known, and in a test, which has no `ResizeObserver`. */
const FALLBACK_WIDTH = 900;
const PILL_WIDTH = 56;
const PILL_HEIGHT = 22;

export interface TimelineDockProps {
  /** The timeline's faults, seconds from its start. */
  anomalies: readonly Anomaly[];
  /** The fault being configured, drawn as an outline. */
  pending: readonly Anomaly[];
  /** What the simulator says the rules do with all of them; `null` while it is being asked. */
  expected: Expected | null;
  devices: readonly DeviceInfo[];
  rules: RulesView;
  /** One lane for each zone instead of each device (above 60 devices). */
  grouped: boolean;
  /** Seconds into the timeline for the playhead, or `null`. */
  elapsedS: number | null;
  /** "1 anomaly · 80 s". */
  summary: string;
  /** The name of the scenario on show (read-only); `null` for the page's own timeline. */
  scenario: string | null;
  busy: boolean;
  onInject: () => void;
  onClear: () => void;
}

function Lane({ lane, model }: { lane: DockLane; model: DockModel }) {
  const mid = lane.y + lane.height / 2;
  return (
    <g>
      <line className={styles.laneLine} x1={0} x2={model.width} y1={lane.y} y2={lane.y} />
      <text className={styles.laneName} x={14} y={mid - 2}>
        {lane.label}
      </text>
      <text className={styles.laneSub} x={14} y={mid + 15}>
        {lane.sub}
      </text>
      {lane.curve === null ? null : (
        <>
          {lane.curve.raiseY === null ? null : (
            <>
              <line
                className={styles.raise}
                x1={model.axis.left}
                x2={model.axis.right}
                y1={lane.curve.raiseY}
                y2={lane.curve.raiseY}
              />
              <text
                className={styles.raiseLabel}
                x={model.axis.right - 4}
                y={lane.curve.raiseY - 4}
                textAnchor="end"
              >
                {lane.curve.raiseLabel}
              </text>
            </>
          )}
          <polyline className={styles.curve} points={lane.curve.points} />
        </>
      )}
      {lane.blocks.map((block) => (
        <g key={`${block.startAt}-${block.endAt}-${block.pending}`}>
          <title>{block.title}</title>
          <rect
            className={styles.block}
            data-pending={block.pending ? 'true' : undefined}
            x={block.x}
            width={block.width}
            y={lane.y + 6}
            height={lane.height - 12}
            rx={7}
          />
          {block.label === null ? null : (
            <text className={styles.blockLabel} x={block.x + 8} y={lane.y + 22}>
              {block.label}
            </text>
          )}
        </g>
      ))}
      {lane.bars.map((bar, index) => (
        <rect
          key={index}
          className={styles.bar}
          data-pending={bar.pending ? 'true' : undefined}
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
    </g>
  );
}

/**
 * The timeline dock (frames 12 and 19): the faults of the page's timeline, or of the scenario picked in the bar,
 * on a ruler of seconds from the start. Up to 60 devices there is a lane for each, with the value the simulator
 * expects drawn against the rule's raise line; above that a lane for each zone with a thin bar for each device. The
 * alerts lane is the window in which the simulator expects the alerts to be open, with a dot for each raise and clear. The
 * playhead follows what is playing. The picture is drawn at its true pixel width so its text is 13 px or more, and it
 * scrolls inside the dock when there are many lanes. Everything on it is designed from the rules, not observed, and the
 * header says so.
 */
export function TimelineDock({
  anomalies,
  pending,
  expected,
  devices,
  rules,
  grouped,
  elapsedS,
  summary,
  scenario,
  busy,
  onInject,
  onClear,
}: TimelineDockProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const titleId = useId();
  const model = buildDock({
    anomalies,
    pending,
    expected,
    devices,
    rules,
    width,
    grouped,
    elapsedS,
  });
  const alerts = model.alerts;
  const empty = anomalies.length === 0 && pending.length === 0;

  return (
    <section className={styles.dock} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          Timeline
        </h2>
        <span className={styles.summary}>
          {scenario === null ? summary : `Scenario ${scenario}: ${summary}`}
        </span>
        <span className={styles.spacer} />
        {scenario === null ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={anomalies.length === 0 || busy}
              onClick={onClear}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={anomalies.length === 0 || busy}
              onClick={onInject}
            >
              Inject timeline
            </Button>
          </>
        ) : null}
        <Link className={styles.link} to="/lab/timeline">
          Open timeline editor
        </Link>
      </div>

      <div className={styles.scroll} ref={ref}>
        {empty ? (
          <p className={styles.empty}>
            Nothing on the timeline. Configure a fault and choose Add to timeline; the faults are
            kept while you stay on this page.
          </p>
        ) : (
          <svg
            className={styles.svg}
            width={model.width}
            height={model.height}
            viewBox={`0 0 ${model.width} ${model.height}`}
            role="img"
            aria-label={model.description}
          >
            <g aria-hidden="true">
              <rect
                className={styles.rulerBg}
                x={0}
                y={0}
                width={model.width}
                height={model.axis.top}
              />
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
                <Lane key={lane.key} lane={lane} model={model} />
              ))}
              {alerts === null ? null : (
                <g>
                  <line
                    className={styles.laneLine}
                    x1={0}
                    x2={model.width}
                    y1={alerts.y}
                    y2={alerts.y}
                  />
                  <text className={styles.laneName} x={14} y={alerts.y + 22}>
                    Alerts
                  </text>
                  <text className={styles.laneSub} x={14} y={alerts.y + 40}>
                    from the rules
                  </text>
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
                </g>
              )}
              {model.playhead === null ? null : (
                <g>
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
            </g>
          </svg>
        )}
        {model.alertsNote !== null && !empty ? (
          <p className={styles.note} role="status">
            {model.alertsNote}
          </p>
        ) : null}
      </div>
    </section>
  );
}
