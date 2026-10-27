/**
 * Every glyph Studio draws, and the only module allowed to import the icon set (ESLint
 * `no-restricted-imports`), so swapping Lucide for another set changes this file alone. Each map is a
 * `Record` over its union: a value added to a union fails `typecheck` here until it has a glyph.
 */
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Boxes,
  Building2,
  Bug,
  Calendar,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  Clock,
  Cloud,
  Command,
  ChevronDown,
  Copy,
  CornerDownLeft,
  Crosshair,
  Cpu,
  Database,
  Download,
  Droplet,
  Droplets,
  ExternalLink,
  Filter,
  FlaskConical,
  Focus,
  Gauge,
  Inbox,
  Info,
  Layers,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  Minus,
  Network,
  OctagonAlert,
  PanelRightOpen,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  Presentation,
  Radio,
  RotateCcw,
  RotateCw,
  Scale,
  Search,
  Send,
  Server,
  Shuffle,
  Shield,
  Square,
  StepForward,
  Terminal,
  Thermometer,
  Trash2,
  TriangleAlert,
  Unlink,
  Unplug,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import type { Severity } from '../api/types';
import type { DeviceGlyph, MetricIconName } from '../lib/deviceIdentity';
import type { TrailGlyph } from '../lib/alertTrail';
import type { EventGlyph } from '../lib/eventRows';
import type { FaultTile } from '../lib/labFault';
import type { StageId } from '../lib/pipeline';
import type { NavIconName } from '../lib/routes';

/** A drawable glyph. Components take this type, never the icon set's own. */
export type Glyph = LucideIcon;

export type Tone = 'ok' | 'warn' | 'bad' | 'unknown';

export const navIcons: Record<NavIconName, Glyph> = {
  overview: LayoutDashboard,
  fleet: Boxes,
  topology: Network,
  twin: Building2,
  events: Terminal,
  alerts: Bell,
  lab: FlaskConical,
  demo: Presentation,
  analytics: ChartColumn,
  foundations: Layers,
};

export const deviceGlyphs: Record<DeviceGlyph, Glyph> = {
  rack: Server,
  airflow: Wind,
  bolt: Zap,
  chip: Cpu,
};

export const metricIcons: Record<MetricIconName, Glyph> = {
  temperature: Thermometer,
  humidity: Droplets,
  co2: Cloud,
  power: Zap,
  gauge: Gauge,
};

/** The icon of a status: with the word it carries, a state is never colour alone. */
export const toneIcons: Record<Tone, Glyph> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  bad: OctagonAlert,
  unknown: CircleQuestionMark,
};

export const severityIcons: Record<Severity, Glyph> = {
  critical: OctagonAlert,
  high: TriangleAlert,
  medium: CircleAlert,
  low: Info,
};

/** The glyph of each fault tile in the Lab (frame 12). */
export const faultGlyphs: Record<FaultTile, Glyph> = {
  breach: Thermometer,
  silent: Square,
  drop: Droplet,
  delay: Clock,
  burst: Send,
  malformed: Bug,
  duplicate: Copy,
  reorder: Shuffle,
  'link-loss': Unlink,
};

/** Generic interface glyphs. */
export const uiIcons = {
  search: Search,
  pin: Pin,
  pinOff: PinOff,
  close: X,
  check: Check,
  previous: ChevronLeft,
  next: ChevronRight,
  enter: CornerDownLeft,
  up: ArrowUp,
  down: ArrowDown,
  command: Command,
  disconnected: Unplug,
  play: Play,
  pause: Pause,
  stop: Square,
  copy: Copy,
  send: Send,
  trash: Trash2,
  reset: RotateCcw,
  step: StepForward,
  inspect: PanelRightOpen,
  plus: Plus,
  minus: Minus,
  fit: Focus,
  rotateLeft: RotateCcw,
  rotateRight: RotateCw,
  chevronDown: ChevronDown,
  external: ExternalLink,
  download: Download,
  calendar: Calendar,
  filter: Filter,
  target: Crosshair,
  info: Info,
  clock: Clock,
  lock: Lock,
} satisfies Record<string, Glyph>;

/** The glyph of each stage of the pipeline in the topology. */
export const stageGlyphs: Record<StageId, Glyph> = {
  broker: Server,
  ingest: Radio,
  database: Database,
  rules: Scale,
  alert: Bell,
  outbox: Inbox,
  commandCenter: Shield,
};

/** The mark of each step of an alert's trail (the Alerts page). */
export const trailGlyphs: Record<TrailGlyph, Glyph> = {
  reading: Thermometer,
  rule: Scale,
  alert: Bell,
  outbox: Inbox,
  incident: Shield,
  clear: CircleCheck,
};

/** The mark on the source chip of a row of the event timeline. */
export const eventGlyphs: Record<EventGlyph, Glyph> = {
  fleet: Boxes,
  scenario: FlaskConical,
  alert: Bell,
  outbox: Inbox,
  incident: Shield,
  ingest: Radio,
  engine: Cpu,
  other: Info,
};
