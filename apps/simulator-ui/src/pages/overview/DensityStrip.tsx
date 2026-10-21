import { useRef, useState } from 'react';
import {
  axisTimes,
  bucketWord,
  type Density,
  type Handle,
  handleKey,
  keyMoveHandle,
  moveHandle,
  timeAtX,
  xAtTime,
} from '../../lib/eventDensity';
import type { TimeWindow } from '../../lib/eventRows';
import { formatEventClock, formatEventMinute } from '../../lib/eventTime';
import type { TimeZoneChoice } from '../../lib/preferences';
import { useElementWidth } from '../../ui/charts/useElementWidth';
import styles from './overview.module.css';

const HEIGHT = 84;
const TOP = 6;
const BASELINE = 62;
/** Room at each end for the handles, which are wider than the bars. */
const PAD = 10;
/** The width before the strip's own width is known, and in a test, which has no `ResizeObserver`. */
const FALLBACK_WIDTH = 720;
const LABELS: Record<Handle, string> = { from: 'Start of the range', to: 'End of the range' };

export interface DensityStripProps {
  density: Density;
  /** The window the strip covers; the handles rest at its ends. */
  window: TimeWindow;
  zone: TimeZoneChoice;
  /** The range the handles were left at, once they are released inside the window. */
  onRange: (from: number, to: number) => void;
}

/**
 * Events per stretch of the window (frame 11), as bars drawn at the strip's true pixel width so that its text is 13 px,
 * with two handles that narrow the range: drag one inward, or focus it and use the arrow keys (a minute, ten with Shift),
 * Home and End. The range is changed when the handle is released, not while it moves, so the table is not rebuilt for
 * each pixel; while it moves, the strip shows the part that will be kept. The strip covers the window, so it cannot widen
 * the range: the buttons of the toolbar do that.
 */
export function DensityStrip({ density, window, zone, onRange }: DensityStripProps) {
  const [ref, measured] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const width = Math.max(measured, 2 * PAD + 40);
  const plot = width - 2 * PAD;
  // The window and the selection while a handle is held: the window slides each second on a relative range, and a handle
  // under the pointer must not slide with it.
  const [held, setHeld] = useState<{ window: TimeWindow; selection: TimeWindow } | null>(null);
  const holding = useRef<Handle | null>(null);

  const frame = held?.window ?? window;
  const selection = held?.selection ?? window;
  const barWidth = plot / density.counts.length;
  const unit = bucketWord(density.bucketMs);
  const x = (time: number) => PAD + xAtTime(time, plot, frame);

  const begin = (handle: Handle) => {
    holding.current = handle;
    setHeld((was) => was ?? { window, selection: window });
  };

  const moveTo = (handle: Handle, clientX: number, element: HTMLElement) => {
    const box = element.parentElement?.getBoundingClientRect();
    if (!box || held === null) return;
    const time = timeAtX(clientX - box.left - PAD, plot, held.window);
    setHeld({ ...held, selection: moveHandle(held.window, held.selection, handle, time) });
  };

  const release = () => {
    holding.current = null;
    if (
      held !== null &&
      (held.selection.from !== held.window.from || held.selection.to !== held.window.to)
    ) {
      onRange(Math.round(held.selection.from), Math.round(held.selection.to));
    }
    setHeld(null);
  };

  const label =
    `Events per ${unit} from ${formatEventMinute(window.from, zone)} to ${formatEventMinute(window.to, zone)}; ` +
    `the whole range is selected. Busiest ${unit}: ${density.busiest} ${density.busiest === 1 ? 'event' : 'events'}.`;

  return (
    <div className={styles.strip} ref={ref}>
      <svg className={styles.stripSvg} width={width} height={HEIGHT} role="img" aria-label={label}>
        <line className={styles.stripBase} x1={PAD} x2={width - PAD} y1={BASELINE} y2={BASELINE} />
        <text className={styles.stripText} x={0} y={TOP + 10}>
          {density.busiest}
        </text>
        <text className={styles.stripText} x={0} y={BASELINE}>
          0
        </text>
        {density.counts.map((count, index) =>
          count === 0 ? null : (
            <rect
              key={index}
              className={styles.stripBar}
              x={PAD + index * barWidth + barWidth * 0.12}
              width={Math.max(1, barWidth * 0.76)}
              y={BASELINE - ((BASELINE - TOP) * count) / density.busiest}
              height={((BASELINE - TOP) * count) / density.busiest}
              rx={2}
            />
          ),
        )}
        <rect
          className={styles.stripSelection}
          x={x(selection.from)}
          width={Math.max(0, x(selection.to) - x(selection.from))}
          y={TOP - 2}
          height={BASELINE - TOP + 4}
          rx={6}
        />
        {axisTimes(frame).map(({ time, at }, index, all) => (
          <text
            key={index}
            className={styles.stripText}
            x={PAD + at * plot}
            y={HEIGHT - 4}
            textAnchor={index === 0 ? 'start' : index === all.length - 1 ? 'end' : 'middle'}
          >
            {formatEventMinute(time, zone)}
          </text>
        ))}
      </svg>
      {(['from', 'to'] as const).map((handle) => (
        <div
          key={handle}
          role="slider"
          tabIndex={0}
          className={styles.stripHandle}
          style={{ left: `${x(selection[handle])}px` }}
          aria-label={LABELS[handle]}
          aria-orientation="horizontal"
          aria-valuemin={Math.round(frame.from)}
          aria-valuemax={Math.round(frame.to)}
          aria-valuenow={Math.round(selection[handle])}
          aria-valuetext={`${formatEventClock(selection[handle], zone)}${zone === 'utc' ? ' UTC' : ''}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            begin(handle);
          }}
          onPointerMove={(event) => {
            if (holding.current === handle) moveTo(handle, event.clientX, event.currentTarget);
          }}
          onPointerUp={release}
          onPointerCancel={() => {
            holding.current = null;
            setHeld(null);
          }}
          onKeyDown={(event) => {
            const move = handleKey(event.key, event.shiftKey);
            if (move === null) return;
            event.preventDefault();
            const base = held ?? { window, selection: window };
            setHeld({
              ...base,
              selection: keyMoveHandle(base.window, base.selection, handle, move),
            });
          }}
          onKeyUp={(event) => {
            if (handleKey(event.key, event.shiftKey) !== null) release();
          }}
          onBlur={() => {
            if (holding.current === null) setHeld(null);
          }}
        />
      ))}
    </div>
  );
}
