import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { EditorDoc } from '../../lib/timelineEditor';
import type { ChartAxis } from '../../lib/scenarioChart';
import { deltaS, moveTarget } from '../../lib/timelineGeometry';

export type DragMode = 'move' | 'start' | 'end';

export interface PointerEditOptions {
  /** The picture's scales, or `null` before there is a picture. */
  axis: Pick<ChartAxis, 'left' | 'right' | 'maxS'> | null;
  /** The picture's width in its own units: the pointer moves in pixels of the screen, which may not be one for one (zoom). */
  widthUnits: number;
  /** The copy as it is now, read at the start of a drag. */
  getDoc(): EditorDoc;
  select(id: string): void;
  move(id: string, startAt: number): void;
  resize(id: string, edge: 'start' | 'end', time: number): void;
  /** Puts the copy back as it was when the drag began (a drag that is cancelled). */
  restore(doc: EditorDoc): void;
}

interface Drag {
  id: string;
  mode: DragMode;
  pointerId: number;
  startX: number;
  startAt: number;
  endAt: number;
  durationS: number;
  /** Picture units for one pixel of the screen. */
  unitsPerPx: number;
  before: EditorDoc;
  stopListening: () => void;
}

/**
 * Moving and resizing a block with the pointer (frame 05). `bind(id, mode)` gives the props for the element that is grabbed:
 * the body of a block moves it, its two grips resize it. Pointer capture keeps the events coming when the pointer leaves the
 * element. Each move is written straight into the working copy (the copy is small and the picture is drawn from it), and
 * `Escape` or a cancelled pointer puts the copy back as it was when the drag began. A drag stops at the edge of the window:
 * the window is widened with the Length control, not by dragging (it would rescale the picture under the pointer).
 *
 * Keyboard editing does not come through here; it is the canvas's key handler, with the same functions.
 */
export function usePointerEdit(options: PointerEditOptions) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // The handlers read the options of the latest render, not of the one that made them.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(
    () => () => {
      drag.current?.stopListening();
    },
    [],
  );

  const end = useCallback((restore: boolean) => {
    const current = drag.current;
    if (current === null) return;
    drag.current = null;
    current.stopListening();
    setDragging(null);
    if (restore) latest.current.restore(current.before);
  }, []);

  const bind = useCallback(
    (id: string, mode: DragMode) => ({
      onPointerDown: (event: ReactPointerEvent<Element>) => {
        const { axis, getDoc, select, widthUnits } = latest.current;
        if (event.button !== 0 || axis === null || drag.current !== null) return;
        const before = getDoc();
        const entry = before.entries.find((candidate) => candidate.id === id);
        if (entry === undefined) return;
        select(id);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const svg = (event.currentTarget as SVGElement).ownerSVGElement;
        const rect = svg?.getBoundingClientRect();
        const unitsPerPx =
          rect !== undefined && rect.width > 0 && widthUnits > 0 ? widthUnits / rect.width : 1;
        const onKey = (key: KeyboardEvent) => {
          if (key.key === 'Escape') end(true);
        };
        window.addEventListener('keydown', onKey);
        drag.current = {
          id,
          mode,
          pointerId: event.pointerId,
          startX: event.clientX,
          startAt: entry.anomaly.startAt,
          endAt: entry.anomaly.startAt + entry.anomaly.duration,
          durationS: entry.anomaly.duration,
          unitsPerPx,
          before,
          stopListening: () => window.removeEventListener('keydown', onKey),
        };
        setDragging(id);
      },
      onPointerMove: (event: ReactPointerEvent<Element>) => {
        const current = drag.current;
        const { axis } = latest.current;
        if (current === null || axis === null || event.pointerId !== current.pointerId) return;
        const dx = (event.clientX - current.startX) * current.unitsPerPx;
        if (current.mode === 'move') {
          latest.current.move(current.id, moveTarget(axis, current.startAt, dx, current.durationS));
        } else if (current.mode === 'end') {
          latest.current.resize(
            current.id,
            'end',
            Math.min(axis.maxS, current.endAt + deltaS(axis, dx)),
          );
        } else {
          latest.current.resize(
            current.id,
            'start',
            Math.max(0, current.startAt + deltaS(axis, dx)),
          );
        }
      },
      onPointerUp: (event: ReactPointerEvent<Element>) => {
        if (drag.current === null || event.pointerId !== drag.current.pointerId) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        end(false);
      },
      onPointerCancel: (event: ReactPointerEvent<Element>) => {
        if (drag.current === null || event.pointerId !== drag.current.pointerId) return;
        end(true);
      },
    }),
    [end],
  );

  return { bind, dragging };
}
