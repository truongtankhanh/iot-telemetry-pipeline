/**
 * From a point of the scene to a pixel of the canvas, for the labels and the tooltip that are drawn in the DOM above the
 * canvas. Pure: it takes the camera's view-projection matrix as numbers (three keeps it column-major, 16 of them), so the
 * scene hands over `camera.projectionMatrix × camera.matrixWorldInverse` and nothing here imports three.js.
 */

export interface ScreenPoint {
  /** Pixels from the left and from the top of the canvas. */
  x: number;
  y: number;
  /** False behind the camera or outside the view; then `x` and `y` are not to be trusted. */
  visible: boolean;
}

/** The point through a column-major 4 × 4 view-projection matrix, as a position in a canvas of `width` × `height`. */
export function projectToScreen(
  matrix: ArrayLike<number>,
  point: readonly [number, number, number],
  width: number,
  height: number,
): ScreenPoint {
  const [px, py, pz] = point;
  const at = (index: number) => matrix[index] ?? 0;
  const x = at(0) * px + at(4) * py + at(8) * pz + at(12);
  const y = at(1) * px + at(5) * py + at(9) * pz + at(13);
  const z = at(2) * px + at(6) * py + at(10) * pz + at(14);
  const w = at(3) * px + at(7) * py + at(11) * pz + at(15);
  // A point at or behind the camera has no place on the screen.
  if (w <= 0) return { x: 0, y: 0, visible: false };
  const ndcX = x / w;
  const ndcY = y / w;
  const ndcZ = z / w;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1 && ndcZ >= -1 && ndcZ <= 1,
  };
}

export interface Size {
  width: number;
  height: number;
}

export interface LabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The space kept free round a label that is shown, in pixels. */
export const LABEL_SEPARATION_PX = 4;

const overlap = (a: LabelBox, b: LabelBox, gap: number) =>
  a.left < b.left + b.width + gap &&
  b.left < a.left + a.width + gap &&
  a.top < b.top + b.height + gap &&
  b.top < a.top + a.height + gap;

/**
 * Which labels are shown when some would cover each other: they are taken in the order given (the most important first:
 * the selected pin, the hovered one, those that need a look) and a label is kept only if it overlaps none already kept.
 * Zooming in spreads the pins out, so more of them are named; at campus distance a few are, and the rest are in the tooltip
 * and the text list. Pure: it works on boxes in pixels.
 */
export function visibleLabels(
  boxes: readonly { id: string; box: LabelBox }[],
  gap: number = LABEL_SEPARATION_PX,
): Set<string> {
  const kept: LabelBox[] = [];
  const shown = new Set<string>();
  for (const { id, box } of boxes) {
    if (kept.some((other) => overlap(box, other, gap))) continue;
    kept.push(box);
    shown.add(id);
  }
  return shown;
}

export interface LabelPlace {
  /** Top-left corner of the label, in pixels of the canvas. */
  left: number;
  top: number;
  /** True when there was no room above the pin and the label sits under it. */
  below: boolean;
}

/** The gap between a pin and its label, and the margin a label keeps from the edge of the canvas. */
export const LABEL_GAP_PX = 10;
export const LABEL_MARGIN_PX = 4;

/**
 * Where a label of `size` goes for a pin at `point`: centred above it, or under it when the top of the canvas is too
 * close, and always inside the canvas (a label wider than the canvas starts at the margin).
 */
export function placeLabel(
  point: { x: number; y: number },
  size: Size,
  canvas: Size,
  gap: number = LABEL_GAP_PX,
  margin: number = LABEL_MARGIN_PX,
): LabelPlace {
  const above = point.y - gap - size.height;
  const below = above < margin;
  const top = below ? point.y + gap : above;
  const maxLeft = Math.max(margin, canvas.width - size.width - margin);
  const left = Math.min(maxLeft, Math.max(margin, point.x - size.width / 2));
  const maxTop = Math.max(margin, canvas.height - size.height - margin);
  return { left, top: Math.min(maxTop, Math.max(margin, top)), below };
}
