import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TooltipContent } from '../../lib/twinPins';
import type { TwinSelection } from '../../lib/twinQuery';
import styles from './twinStage.module.css';

/** How long the pointer rests on a building or a pin before the tooltip appears (frame 14, the command center's rule). */
export const TOOLTIP_DELAY_MS = 150;
/** The tooltip sits a little down and to the right of the pointer, and inside the stage. */
const OFFSET_PX = 14;

const keyOf = (target: TwinSelection | null): string | null =>
  target === null ? null : `${target.type}:${target.id}`;

export interface TwinTooltipProps {
  /** The element the pointer moves over; the tooltip is placed in it. */
  stage: RefObject<HTMLElement | null>;
  /** What the pointer is over. */
  target: TwinSelection | null;
  /** What to say about it; `null` when there is nothing to say. */
  content: TooltipContent | null;
}

/**
 * The hover tooltip: it appears 150 ms after the pointer has rested on the same building or pin, follows the pointer while
 * it is there, and goes the moment the target changes. It is a pointer-only extra — everything it says is also in the
 * selection card and the text list — so it is hidden from assistive technology and never holds focus. Text nodes only.
 */
export function TwinTooltip({ stage, target, content }: TwinTooltipProps) {
  const key = keyOf(target);
  // The target the timer has let through. Reset while rendering when the target changes (React's pattern for "this prop
  // changed"), so a target that comes back starts its 150 ms again.
  const [armed, setArmed] = useState<string | null>(null);
  if (armed !== null && armed !== key) setArmed(null);

  useEffect(() => {
    if (key === null) return;
    const timer = setTimeout(() => setArmed(key), TOOLTIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const element = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const move = () => {
    const tooltip = element.current;
    const box = stage.current;
    if (tooltip === null || box === null) return;
    const x = Math.min(
      pointer.current.x + OFFSET_PX,
      Math.max(0, box.clientWidth - tooltip.offsetWidth),
    );
    const y = Math.min(
      pointer.current.y + OFFSET_PX,
      Math.max(0, box.clientHeight - tooltip.offsetHeight),
    );
    tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  // The pointer's place is a thing outside React: one listener on the stage, written to a ref, with no render.
  useEffect(() => {
    const box = stage.current;
    if (box === null) return;
    const onMove = (event: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      move();
    };
    box.addEventListener('pointermove', onMove);
    return () => box.removeEventListener('pointermove', onMove);
  });

  const visible = key !== null && armed === key && content !== null;
  useLayoutEffect(() => {
    if (visible) move();
  });

  if (!visible) return null;
  return (
    <div ref={element} className={styles.tooltip} aria-hidden="true">
      <b>{content.title}</b>
      {content.lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </div>
  );
}
