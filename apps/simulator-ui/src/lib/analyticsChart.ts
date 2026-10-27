import { linearScale, niceTicks } from './chartMath';

/**
 * The geometry of the Analytics charts (frame 09), kept out of the component as `scenarioChart.ts` is: where a value and a time
 * fall on the picture, which labels fit, and the sentence that says the same to a screen reader. Pure functions of what the page
 * hands in; `pages/analytics/SeriesChart.tsx` only draws what comes back. One or two lines over a shared time axis, with optional
 * phase bands, a vertical mark, an average line and a tag on the last point of each line.
 *
 * The picture is drawn at its true pixel width so its text stays 13 px or more, which is why a label that would not fit, or
 * would run into another, is left off: the sentence and the figures beside the chart carry the same numbers.
 */

/** About the width of one character of 13 px text, to decide whether a label fits. */
const CHAR_PX = 7.4;
const MARGIN = { left: 60, right: 18, top: 26, bottom: 38 };
const TAG_HEIGHT = 24;
const TAG_PAD = 16;
const TAG_GAP = 4;
const TAG_OFFSET = 9;
const X_TICKS = 6;
const Y_TICKS = 4;

/** A point of a line; a `null` value is a gap in the line (unknown, never zero). */
export interface ChartPoint {
  x: number;
  y: number | null;
}

export interface ChartLine {
  id: string;
  label: string;
  /** The unit of this line when it is not the axis's (a chart of messages per second beside readings per second). */
  unit?: string;
  /** The second line of a chart is dashed and violet: a dash is not colour alone. */
  secondary?: boolean;
  points: readonly ChartPoint[];
}

/** A stretch of the time axis with a name: ramp-up, steady state. */
export interface ChartBand {
  from: number;
  to: number;
  label: string;
}

/** A moment on the time axis with a name: where publishing ended. */
export interface ChartMark {
  x: number;
  label: string;
}

export interface AnalyticsChartInput {
  width: number;
  height: number;
  /** What the picture is of: "Throughput". */
  title: string;
  /** The unit of the vertical axis, in words: "readings/s". */
  yUnit: string;
  /** The window of time the picture shows, in words, always written: "the last 18 seconds". */
  window: string;
  lines: readonly ChartLine[];
  formatY: (value: number) => string;
  formatX: (value: number) => string;
  /** The vertical extent is `0` to the highest value (or this, when higher), rounded up to a round number. */
  yFloor?: number;
  /** A fixed time extent; otherwise the extent of the points. */
  xDomain?: readonly [number, number];
  bands?: readonly ChartBand[];
  marks?: readonly ChartMark[];
  /** A dashed horizontal line with a name: "average 5,700". */
  average?: { value: number; label: string } | null;
}

export interface PlotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AxisTick {
  value: number;
  /** The pixel along the axis: `y` for a vertical axis, `x` for the time axis. */
  at: number;
  label: string;
}

export interface LineTag {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface LineModel {
  id: string;
  label: string;
  unit: string;
  secondary: boolean;
  /** `x,y x,y …` for each unbroken stretch: the polyline `points` of each, so a gap is a break and not a line to nowhere. */
  segments: string[];
  /** The last value and where it is, or `null` when the line has no value at all. */
  last: { x: number; y: number; value: number } | null;
  tag: LineTag | null;
}

export interface BandModel {
  x: number;
  width: number;
  label: string;
  /** False when the name does not fit in the band; the sentence names it. */
  showLabel: boolean;
}

export interface AnalyticsChartModel {
  width: number;
  height: number;
  plot: PlotBox;
  yTicks: AxisTick[];
  xTicks: AxisTick[];
  lines: LineModel[];
  bands: BandModel[];
  marks: { x: number; label: string; showLabel: boolean }[];
  average: { y: number; label: string } | null;
  /** No line has a value: the picture is drawn without lines and the page says so. */
  empty: boolean;
  /** The sentence for `role="img"`, with the numbers in it. */
  description: string;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** The top of the vertical axis: the highest value, rounded up to the step of the ticks. */
function yTop(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const ticks = niceTicks(0, max, Y_TICKS);
  const step = ticks.length > 1 ? (ticks[1] as number) - (ticks[0] as number) : max;
  const top = Math.max(ticks.at(-1) ?? 0, Math.ceil(max / step) * step);
  return { top, ticks: niceTicks(0, top, Y_TICKS) };
}

/** A tag per line, beside its last point and clear of the others: above its point, below when that would touch another. */
function placeTags(lines: LineModel[], plot: PlotBox, formatY: (value: number) => string): void {
  const placed: LineTag[] = [];
  const byHeight = [...lines]
    .filter((line) => line.last !== null)
    .sort((a, b) => (a.last as { y: number }).y - (b.last as { y: number }).y);
  for (const line of byHeight) {
    const last = line.last as { x: number; y: number; value: number };
    const text = formatY(last.value);
    const width = Math.round(text.length * CHAR_PX + TAG_PAD);
    // Left of the point, so the tag stays inside the picture at the right edge; right of it when there is no room on the left.
    const x =
      last.x - TAG_OFFSET - width >= plot.left ? last.x - TAG_OFFSET - width : last.x + TAG_OFFSET;
    let y = last.y - TAG_OFFSET - TAG_HEIGHT;
    if (y < plot.top - 4) y = last.y + TAG_OFFSET;
    const clash = (candidate: number) =>
      placed.some(
        (other) =>
          candidate < other.y + other.height + TAG_GAP &&
          candidate + TAG_HEIGHT + TAG_GAP > other.y &&
          x < other.x + other.width &&
          x + width > other.x,
      );
    if (clash(y)) y = last.y + TAG_OFFSET;
    while (clash(y) && y < plot.bottom) y += TAG_HEIGHT + TAG_GAP;
    const tag = { x: round(x), y: round(y), width, height: TAG_HEIGHT, text };
    placed.push(tag);
    line.tag = tag;
  }
}

export function buildAnalyticsChart(input: AnalyticsChartInput): AnalyticsChartModel {
  const width = Math.max(input.width, 240);
  const height = input.height;
  const plot: PlotBox = {
    left: MARGIN.left,
    right: width - MARGIN.right,
    top: MARGIN.top,
    bottom: height - MARGIN.bottom,
  };

  const values = input.lines.flatMap((line) =>
    line.points
      .map((point) => point.y)
      .filter((y): y is number => y !== null && Number.isFinite(y)),
  );
  const max = Math.max(input.yFloor ?? 0, input.average?.value ?? 0, ...values);
  const { top, ticks } = yTop(max);
  const y = linearScale(0, top, plot.bottom, plot.top);

  const xs = input.lines.flatMap((line) => line.points.map((point) => point.x));
  const [x0, x1] =
    input.xDomain ?? (xs.length > 0 ? [Math.min(...xs), Math.max(...xs)] : ([0, 1] as const));
  const span: readonly [number, number] = x1 > x0 ? [x0, x1] : [x0, x0 + 1];
  const x = linearScale(span[0], span[1], plot.left, plot.right);
  const clampX = (value: number) => x(Math.min(Math.max(value, span[0]), span[1]));

  const lines: LineModel[] = input.lines.map((line) => {
    const segments: string[] = [];
    let current: string[] = [];
    let last: LineModel['last'] = null;
    for (const point of line.points) {
      if (point.y === null || !Number.isFinite(point.y)) {
        if (current.length > 0) segments.push(current.join(' '));
        current = [];
        continue;
      }
      const px = round(x(point.x));
      const py = round(y(point.y));
      current.push(`${px},${py}`);
      last = { x: px, y: py, value: point.y };
    }
    if (current.length > 0) segments.push(current.join(' '));
    return {
      id: line.id,
      label: line.label,
      unit: line.unit ?? input.yUnit,
      secondary: line.secondary === true,
      segments,
      last,
      tag: null,
    };
  });
  placeTags(lines, plot, input.formatY);

  const bands: BandModel[] = (input.bands ?? [])
    .filter((band) => band.to > span[0] && band.from < span[1])
    .map((band) => {
      const left = clampX(band.from);
      const right = clampX(band.to);
      return {
        x: round(left),
        width: round(right - left),
        label: band.label,
        showLabel: right - left >= band.label.length * CHAR_PX + 12,
      };
    });
  const marks = (input.marks ?? [])
    .filter((mark) => mark.x >= span[0] && mark.x <= span[1])
    .map((mark) => ({
      x: round(x(mark.x)),
      label: mark.label,
      showLabel: x(mark.x) + mark.label.length * CHAR_PX + 8 <= plot.right,
    }));

  const empty = values.length === 0;
  const average =
    input.average === null || input.average === undefined
      ? null
      : { y: round(y(input.average.value)), label: input.average.label };

  const figures = lines.map((line) =>
    line.last === null
      ? `${line.label} has no value yet`
      : `${line.label} ${input.formatY(line.last.value)} ${line.unit} at the end`,
  );
  const description = [
    `${input.title}, ${input.window}, in ${input.yUnit}.`,
    ...figures.map((figure) => `${figure}.`),
    ...(input.average ? [`${input.average.label}.`] : []),
  ].join(' ');

  return {
    width,
    height,
    plot,
    yTicks: ticks.map((value) => ({ value, at: round(y(value)), label: input.formatY(value) })),
    xTicks: niceTicks(span[0], span[1], X_TICKS)
      .filter((value) => value >= span[0] && value <= span[1])
      .map((value) => ({ value, at: round(x(value)), label: input.formatX(value) })),
    lines,
    bands,
    marks,
    average,
    empty,
    description,
  };
}

/**
 * The names of the two stretches of a finished run: the ramp-up, until the publish rate settles, then the steady state until publishing
 * ended. Nothing while the simulator has not named the ramp-up's end (it does so when a run completes or is incomplete). `end` is
 * the end of the time axis, for a run whose publishing end is not known.
 */
export function phaseOverlays(
  marks: { rampUpEndS: number | null; publishEndedS: number | null },
  start: number,
  end: number,
): { bands: ChartBand[]; marks: ChartMark[] } {
  const { rampUpEndS, publishEndedS } = marks;
  const bands: ChartBand[] = [];
  if (rampUpEndS !== null) {
    bands.push({ from: start, to: rampUpEndS, label: 'ramp-up' });
    bands.push({ from: rampUpEndS, to: publishEndedS ?? end, label: 'steady state' });
  }
  return {
    bands,
    marks: publishEndedS === null ? [] : [{ x: publishEndedS, label: 'publishing ended' }],
  };
}
