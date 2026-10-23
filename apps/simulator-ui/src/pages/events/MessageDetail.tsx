import { Link } from 'react-router';
import { mosquittoPubCommand } from '../../lib/shellCommand';
import type { MessageRow } from '../../lib/messageRows';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { toneIcons, uiIcons } from '../../ui/icons';
import { CopyButton } from '../fleet/CopyButton';
import styles from './events.module.css';
import type { Republish } from './useRepublish';

export interface MessageDetailProps {
  /** The message that is open: held by the page, so it stays on show after its row has left the log. */
  row: MessageRow | null;
  /** The id the address names, for the words when there is no row for it. */
  selectedId: number | null;
  /** The message is still in the log, so the simulator can send it again. */
  inLog: boolean;
  /** The broker's port as the state says it (the command always names `localhost`). */
  port: number | null;
  republish: Republish;
}

/**
 * One message: what was published (topic and payload, each with a copy button), the same message as a `mosquitto_pub` command,
 * and Republish, which sends it again with the same `seq` so ingest stores it once. Text is rendered as text: a payload is
 * whatever a device (or the malformed fault) sent. What the republish came to is said under the button in words, with the
 * simulator's own reason when it refused.
 */
export function MessageDetail({ row, selectedId, inLog, port, republish }: MessageDetailProps) {
  if (row === null) {
    return (
      <Card title="Message detail">
        <p className={styles.help} role="status">
          {selectedId === null
            ? 'Select a message to see its topic and payload, and the command that sends it.'
            : `Message ${selectedId} is no longer in the last 200 published.`}
        </p>
      </Card>
    );
  }

  const command = mosquittoPubCommand({ topic: row.topic, payload: row.payload, port });
  const last = republish.result;
  const result = last !== null && last.of === row.id ? last : null;

  return (
    <Card
      title={`${row.deviceId} · seq ${row.seq.toLocaleString('en-US')}`}
      aside={
        row.ackMs === null ? null : (
          <Chip tone="ok" icon={toneIcons.ok}>
            PUBACK {row.ackMs} ms
          </Chip>
        )
      }
    >
      <div className={styles.detail}>
        <p className={styles.when}>
          {row.time} · QoS 1 · retain off · payload time{' '}
          <span className={styles.mono}>{row.ts}</span>
        </p>

        <div className={styles.field}>
          <span className={styles.label}>Topic</span>
          <div className={styles.valueRow}>
            <span className={styles.topic}>{row.topic}</span>
            <CopyButton text={row.topic} label="topic" />
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Payload · {row.sizeBytes.toLocaleString('en-US')} B</span>
          <pre className={styles.pre} tabIndex={0} aria-label="Payload">
            {row.pretty ?? row.payload}
          </pre>
          <div className={styles.copyRow}>
            <CopyButton text={row.payload} label="payload" />
          </div>
          {row.readable ? null : (
            <p className={styles.notice}>
              This payload has no readings the contract would accept. It is shown as it was sent.
            </p>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.label}>
            Same message from a shell{' '}
            <span className={styles.sub}>(on the machine that runs the broker)</span>
          </span>
          <pre className={styles.pre} tabIndex={0} aria-label="mosquitto_pub command">
            {command}
          </pre>
          <div className={styles.copyRow}>
            <CopyButton text={command} label="command" />
          </div>
        </div>

        <div className={styles.actions}>
          <Button
            variant="outline"
            size="sm"
            icon={uiIcons.send}
            disabled={republish.busy || !inLog}
            onClick={() => void republish.republish(row.id)}
          >
            Republish
          </Button>
        </div>
        {inLog ? null : (
          <p className={styles.notice} role="status">
            This message is no longer in the last 200 published, so the simulator cannot send it
            again.
          </p>
        )}
        {result === null ? null : result.kind === 'sent' ? (
          <p className={styles.result} data-tone="ok" role="status">
            Sent again as message {result.message.id}, with the same seq. Ingest stores it once: see
            what it counted on the{' '}
            <Link className={styles.link} to="/lab/faults">
              Faults page
            </Link>
            .
          </p>
        ) : (
          <p className={styles.result} data-tone="bad" role="alert">
            Not sent: {result.text}
          </p>
        )}
        <p className={styles.help}>
          Republish sends the same <span className={styles.mono}>seq</span> again, so ingest stores
          it once (an idempotent insert). Use it to show duplicates are harmless.
        </p>
      </div>
    </Card>
  );
}
