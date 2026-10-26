import { type Ref, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { chooseLabels, type TwinPin } from '../../lib/twinPins';
import type { TwinSelection } from '../../lib/twinQuery';
import { type LabelBox, placeLabel, projectToScreen, visibleLabels } from '../../lib/twinProject';
import { Icon } from '../../ui/Icon';
import { deviceGlyphs } from '../../ui/icons';
import styles from './twinStage.module.css';

/** What the scene tells the labels each time the camera moves or the canvas is resized. */
export interface TwinLabelsHandle {
  update: (matrix: ArrayLike<number>, size: { width: number; height: number }) => void;
}

export interface TwinLabelsProps {
  pins: readonly TwinPin[];
  selection: TwinSelection | null;
  hoveredId: string | null;
  ref?: Ref<TwinLabelsHandle>;
}

interface View {
  matrix: ArrayLike<number>;
  width: number;
  height: number;
}

/**
 * The labels of the pins, drawn in the DOM above the canvas (frame 14: fixed 13 px text, the kind's glyph, the device,
 * the building and the value, or the state when there is no value). At most `LABEL_CAP` show — the selected pin first,
 * then the hovered one, then those that need a look — and the rest are in the tooltip and the text list. A label that would
 * cover one already shown (`visibleLabels`) is hidden, so at campus distance a few are named and zooming in names more.
 *
 * A label follows its pin without a React render per frame: the scene calls `update` when the camera moves, and each label's
 * position is written to its element's `transform`. A label whose pin is behind the camera or outside the view is hidden.
 * The labels are `aria-hidden` — the visually hidden device list carries the same words — and let the pointer through.
 */
export function TwinLabels({ pins, selection, hoveredId, ref }: TwinLabelsProps) {
  const ids = chooseLabels(pins, { selection, hoveredId });
  const shown = ids.flatMap((id) => pins.find((pin) => pin.id === id) ?? []);

  const [elements] = useState(() => new Map<string, HTMLElement>());
  const [sizes] = useState(() => new Map<string, { width: number; height: number }>());
  const view = useRef<View | null>(null);
  const current = useRef<readonly TwinPin[]>(shown);

  const place = () => {
    const camera = view.current;
    if (camera === null) return;
    // In order of importance (the selected pin first), so that when labels would cover each other the ones that matter stay.
    const boxes: { id: string; box: LabelBox }[] = [];
    for (const pin of current.current) {
      const element = elements.get(pin.id);
      if (element === undefined) continue;
      const point = projectToScreen(camera.matrix, pin.anchor, camera.width, camera.height);
      if (!point.visible) {
        element.dataset.placed = 'false';
        continue;
      }
      const size = sizes.get(pin.id) ?? { width: 0, height: 0 };
      const spot = placeLabel(point, size, camera);
      element.style.transform = `translate(${Math.round(spot.left)}px, ${Math.round(spot.top)}px)`;
      boxes.push({ id: pin.id, box: { left: spot.left, top: spot.top, ...size } });
    }
    const shown = visibleLabels(boxes);
    for (const { id } of boxes) {
      const element = elements.get(id);
      if (element !== undefined) element.dataset.placed = shown.has(id) ? 'true' : 'false';
    }
  };

  useImperativeHandle(ref, () => ({
    update(matrix, size) {
      view.current = { matrix, width: size.width, height: size.height };
      place();
    },
  }));

  // After every render, which may have changed which labels there are and how wide they are: measure, then place.
  useLayoutEffect(() => {
    current.current = shown;
    sizes.clear();
    for (const pin of shown) {
      const element = elements.get(pin.id);
      if (element !== undefined) {
        sizes.set(pin.id, { width: element.offsetWidth, height: element.offsetHeight });
      }
    }
    place();
  });

  return (
    <div className={styles.labels} aria-hidden="true">
      {shown.map((pin) => (
        <div
          key={pin.id}
          className={styles.label}
          data-state={pin.state}
          data-selected={
            selection?.type === 'device' && selection.id === pin.id ? 'true' : undefined
          }
          ref={(element) => {
            if (element === null) return;
            elements.set(pin.id, element);
            return () => {
              elements.delete(pin.id);
            };
          }}
        >
          <b>
            <Icon glyph={deviceGlyphs[pin.glyph]} size="sm" />
            {pin.name}
          </b>
          <span>{pin.detail}</span>
        </div>
      ))}
    </div>
  );
}
