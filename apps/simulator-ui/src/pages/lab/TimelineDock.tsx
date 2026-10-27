import { useId } from 'react';
import { Link } from 'react-router';
import type { Anomaly, DeviceInfo, Expected, RulesView } from '../../api/types';
import { buildDock } from '../../lib/labTimeline';
import { Button } from '../../ui/Button';
import { useElementWidth } from '../../ui/charts/useElementWidth';
import styles from './timelineDock.module.css';
import { TimelinePicture } from './TimelinePicture';

/** The width before the picture's own is known, and in a test, which has no `ResizeObserver`. */
const FALLBACK_WIDTH = 900;

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
  /** A benchmark is running: an injection may start devices, which the simulator refuses, so Inject timeline is off. */
  locked?: boolean;
  onInject: () => void;
  onClear: () => void;
  /** Called when the person follows the link to the timeline editor, before the page changes: the Lab hands its draft over. */
  onOpenEditor?: () => void;
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
  locked = false,
  onInject,
  onClear,
  onOpenEditor,
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
              disabled={anomalies.length === 0 || busy || locked}
              onClick={onInject}
            >
              Inject timeline
            </Button>
          </>
        ) : null}
        <Link className={styles.link} to="/lab/timeline" onClick={() => onOpenEditor?.()}>
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
          <TimelinePicture model={model} />
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
