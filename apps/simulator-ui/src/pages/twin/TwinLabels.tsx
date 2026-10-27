import { type Ref, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { chipText } from '../../lib/twinAlerts';
import { type CatalogueBox, labelAnchor } from '../../lib/twinCatalogue';
import type { HubModel, Point3 } from '../../lib/twinFlow';
import { chooseLabels, type TwinPin } from '../../lib/twinPins';
import type { TwinSelection } from '../../lib/twinQuery';
import { type LabelBox, placeLabel, projectToScreen, visibleLabels } from '../../lib/twinProject';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { deviceGlyphs, severityIcons } from '../../ui/icons';
import styles from './twinStage.module.css';

/** The key of the hub's label among the pins' ids; a device id never contains `:` (the telemetry contract's `SEGMENT`). */
const HUB_LABEL_ID = 'hub:pipeline';
/** A catalogue asset's label is keyed `asset:` and its code, which cannot meet a device id for the same reason. */
const assetLabelId = (box: Pick<CatalogueBox, 'code'>) => `asset:${box.code}`;

interface LabelEntry {
  id: string;
  anchor: Point3;
}

const entryOf = (pin: TwinPin): LabelEntry => ({ id: pin.id, anchor: pin.anchor });

/** What the scene tells the labels each time the camera moves or the canvas is resized. */
export interface TwinLabelsHandle {
  update: (matrix: ArrayLike<number>, size: { width: number; height: number }) => void;
}

export interface TwinLabelsProps {
  pins: readonly TwinPin[];
  selection: TwinSelection | null;
  hoveredId: string | null;
  /** The logical Pipeline hub, labelled like a pin; `null` hides its label (the Data flow layer is off). */
  hub: HubModel | null;
  /** The Alerts layer is on: a pin with an open alert shows its chip. */
  alerts: boolean;
  /**
   * The catalogue boxes of the building in focus that get a label (the code only, in a dashed, dim label): none at campus
   * level. They are placed after the pins and the hub, so a crowd of them cannot hide a device.
   */
  assets?: readonly CatalogueBox[];
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
 * then the hovered one, then those that need a look — and the rest are in the tooltip and the text list. The Pipeline hub
 * has a label of its own (what it stands for, its state when that is not fine, and a chip for each fault that shows there);
 * it is placed right after the selected pin, so a crowd of pin labels cannot hide it. A pin with an open alert carries the
 * alert's chip (icon, severity and number) on its label. With a building in focus its catalogue assets get a dim, dashed label
 * with the code only, placed after everything else. A label that would
 * cover one already shown (`visibleLabels`) is hidden, so at campus distance a few are named and zooming in names more.
 *
 * A label follows its pin without a React render per frame: the scene calls `update` when the camera moves, and each label's
 * position is written to its element's `transform`. A label whose pin is behind the camera or outside the view is hidden.
 * The labels are `aria-hidden` — the visually hidden device list carries the same words — and let the pointer through.
 */
export function TwinLabels({
  pins,
  selection,
  hoveredId,
  hub,
  alerts,
  assets = [],
  ref,
}: TwinLabelsProps) {
  const ids = chooseLabels(pins, { selection, hoveredId });
  const shown = ids.flatMap((id) => pins.find((pin) => pin.id === id) ?? []);
  // The placement order is the order of importance: the selected pin, the hub, then the rest (`visibleLabels` hides what
  // would cover a label placed before it).
  const isSelected = (pin: TwinPin) => selection?.type === 'device' && selection.id === pin.id;
  const entries: LabelEntry[] = [
    ...shown.filter(isSelected).map(entryOf),
    ...(hub === null ? [] : [{ id: HUB_LABEL_ID, anchor: hub.anchor }]),
    ...shown.filter((pin) => !isSelected(pin)).map(entryOf),
    ...assets.map((box) => ({ id: assetLabelId(box), anchor: labelAnchor(box) })),
  ];

  const [elements] = useState(() => new Map<string, HTMLElement>());
  const [sizes] = useState(() => new Map<string, { width: number; height: number }>());
  const view = useRef<View | null>(null);
  const current = useRef<readonly LabelEntry[]>(entries);

  const place = () => {
    const camera = view.current;
    if (camera === null) return;
    // In order of importance (the selected pin first), so that when labels would cover each other the ones that matter stay.
    const boxes: { id: string; box: LabelBox }[] = [];
    for (const entry of current.current) {
      const element = elements.get(entry.id);
      if (element === undefined) continue;
      const point = projectToScreen(camera.matrix, entry.anchor, camera.width, camera.height);
      if (!point.visible) {
        element.dataset.placed = 'false';
        continue;
      }
      const size = sizes.get(entry.id) ?? { width: 0, height: 0 };
      const spot = placeLabel(point, size, camera);
      element.style.transform = `translate(${Math.round(spot.left)}px, ${Math.round(spot.top)}px)`;
      boxes.push({ id: entry.id, box: { left: spot.left, top: spot.top, ...size } });
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
    current.current = entries;
    sizes.clear();
    for (const entry of entries) {
      const element = elements.get(entry.id);
      if (element !== undefined) {
        sizes.set(entry.id, { width: element.offsetWidth, height: element.offsetHeight });
      }
    }
    place();
  });

  // A label registers its element under its key; the cleanup runs when the label goes or its key changes.
  const register = (id: string) => (element: HTMLElement | null) => {
    if (element === null) return;
    elements.set(id, element);
    return () => {
      elements.delete(id);
    };
  };

  return (
    <div className={styles.labels} aria-hidden="true">
      {hub === null ? null : (
        <div
          key={HUB_LABEL_ID}
          className={`${styles.label} ${styles.hubLabel}`}
          data-hub-state={hub.status.state}
          ref={register(HUB_LABEL_ID)}
        >
          <b>Pipeline</b>
          <span>broker, ingest · logical</span>
          {hub.status.state === 'ok' ? null : (
            <span>
              {hub.status.subject}: {hub.status.word}
            </span>
          )}
          {hub.chips.length === 0 ? null : (
            <div className={styles.labelChips}>
              {hub.chips.map((chip) => (
                <Chip key={chip.id} tone={chip.tone === 'info' ? 'neutral' : chip.tone}>
                  {chip.text}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
      {assets.map((box) => (
        <div
          key={assetLabelId(box)}
          className={`${styles.label} ${styles.assetLabel}`}
          ref={register(assetLabelId(box))}
        >
          <b>{box.code}</b>
        </div>
      ))}
      {shown.map((pin) => (
        <div
          key={pin.id}
          className={styles.label}
          data-state={pin.state}
          data-selected={
            selection?.type === 'device' && selection.id === pin.id ? 'true' : undefined
          }
          ref={register(pin.id)}
        >
          <b>
            <Icon glyph={deviceGlyphs[pin.glyph]} size="sm" />
            {pin.name}
          </b>
          <span>{pin.detail}</span>
          {alerts && pin.alert !== null ? (
            <em
              className={styles.alertChip}
              data-severity={pin.alert.severity}
              data-stale={pin.alert.stale ? 'true' : undefined}
            >
              <Icon glyph={severityIcons[pin.alert.severity]} size="sm" />
              {chipText(pin.alert)}
            </em>
          ) : null}
        </div>
      ))}
    </div>
  );
}
