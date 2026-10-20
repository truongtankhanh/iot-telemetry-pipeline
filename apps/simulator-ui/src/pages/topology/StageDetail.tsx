import { formatClockTime } from '../../lib/time';
import type { StageId, StageNode } from '../../lib/pipeline';
import type { StageCheck } from '../../lib/topologyDetail';
import { TOPOLOGY_TONES } from '../../lib/topologyState';
import { Card } from '../../ui/Card';
import { Pill } from '../../ui/Pill';
import styles from './detail.module.css';

export interface StageDetailProps {
  stage: StageNode;
  /** What Studio asked the dependency this stage rests on, or `null` for none. */
  check: StageCheck | null;
  /** When Studio last asked ingest (ms), or `null`. */
  lastRunAt: number | null;
}

/** What each stage is, in a sentence Studio can stand behind. */
const WHAT: Record<StageId, string> = {
  broker: 'The MQTT broker the simulator publishes to.',
  ingest: 'The ingest service: it reads the broker, stores the readings and runs the rules.',
  database: 'The database ingest stores readings in, as ingest reports it.',
  rules:
    "Ingest's threshold rules. The count of readings in a row is Studio's own, from the readings it saw.",
  alert: 'The alerts the rules opened, as ingest lists them.',
  outbox: 'The outbox ingest delivers alerts from: delivered, pending, failed or skipped.',
  commandCenter:
    'The command center. Studio never reads it: an incident id from ingest is all it knows.',
};

/**
 * A stage of the pipeline in the first column (Q2 of the analysis): what it is, its state in a word, the figure Studio
 * has for it, and what Studio asked to know it. A stage whose truth is not known says when it last was, as frame 10
 * does; nothing here is a guess.
 */
export function StageDetail({ stage, check, lastRunAt }: StageDetailProps) {
  return (
    <Card
      title={stage.label}
      aside={<Pill label={stage.word} tone={TOPOLOGY_TONES[stage.state]} stale={stage.dimmed} />}
    >
      <p className={styles.muted}>{WHAT[stage.id]}</p>
      <table className={styles.facts}>
        <tbody>
          {stage.headline ? (
            <tr>
              <th scope="row">Now</th>
              <td>{stage.headline}</td>
            </tr>
          ) : null}
          {stage.detail ? (
            <tr>
              <th scope="row">Detail</th>
              <td>{stage.detail}</td>
            </tr>
          ) : null}
          {stage.asOf === null ? null : (
            <tr>
              <th scope="row">Last answer</th>
              <td>{formatClockTime(stage.asOf)}</td>
            </tr>
          )}
          {check ? (
            <tr>
              <th scope="row">Studio asked</th>
              <td>{check.text}</td>
            </tr>
          ) : null}
          {check && lastRunAt !== null ? (
            <tr>
              <th scope="row">Last check</th>
              <td>{formatClockTime(lastRunAt)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Card>
  );
}
