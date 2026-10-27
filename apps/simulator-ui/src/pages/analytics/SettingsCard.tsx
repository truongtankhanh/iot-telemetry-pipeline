import { Link } from 'react-router';
import type { BenchmarkCheck, BenchmarkSummary } from '../../api/types';
import { checkMessages } from '../../lib/benchmarkStart';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { toneIcons, uiIcons } from '../../ui/icons';
import { NumberField } from '../../ui/NumberField';
import styles from './analytics.module.css';

export interface SettingsCardProps {
  summary: BenchmarkSummary;
  /** How many devices the run publishes to (`devices.json`). */
  deviceCount: number;
  /** A run is going: the settings are locked and there is nothing to check. */
  running: boolean;
  messages: number | null;
  onMessages: (value: number | null) => void;
  checks: {
    items: readonly BenchmarkCheck[];
    loading: boolean;
    error: string | null;
    onRefresh: () => void;
  };
  /** The start is on its way. */
  starting: boolean;
  /** Opens the confirmation. Nothing is sent from here. */
  onStart: () => void;
}

/** Why Start is off, in a sentence, or `null` when it is on. The simulator checks again when a start arrives. */
function startBlock(props: SettingsCardProps): string | null {
  const { running, messages, summary, checks } = props;
  if (running) return 'A run is going.';
  const size = checkMessages(messages, summary.maxMessages);
  if (!size.ok) return size.reason;
  if (checks.error !== null) return `The checks could not be read: ${checks.error}`;
  if (checks.loading && checks.items.length === 0) return 'Checking before start…';
  const failed = checks.items.find((check) => !check.ok);
  if (failed) return `${failed.label} fails${failed.reason ? `: ${failed.reason}` : ''}.`;
  if (checks.items.length === 0) return 'The checks have not been read yet.';
  return null;
}

/**
 * The settings of a run, the three checks before it, and Start (frame 09). The size is the only setting the simulator takes; the
 * devices, QoS 1 and "waits until stored" are what a run is, said as facts and not drawn as controls that would do nothing. A failing
 * check names its reason, and the fleet's says where to pause it. Start opens the confirmation: it never starts a run by itself, and
 * it says why it is off.
 */
export function SettingsCard(props: SettingsCardProps) {
  const { summary, deviceCount, running, messages, onMessages, checks, starting, onStart } = props;
  const size = checkMessages(messages, summary.maxMessages);
  const block = startBlock(props);

  return (
    <Card
      title="Run settings"
      aside={
        running ? (
          <Chip icon={uiIcons.lock} tone="warn">
            Locked
          </Chip>
        ) : null
      }
    >
      <NumberField
        label="Messages"
        value={messages}
        onChange={onMessages}
        unit="messages"
        disabled={running}
        error={size.ok ? undefined : size.reason}
      />
      <dl className={styles.facts}>
        <div>
          <dt>Devices</dt>
          <dd>{deviceCount}, from devices.json</dd>
        </div>
        <div>
          <dt>QoS</dt>
          <dd>1</dd>
        </div>
        <div>
          <dt>Waits until stored</dt>
          <dd>Yes, in PostgreSQL</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd className={styles.metric}>{summary.database ?? 'unknown'}</dd>
        </div>
      </dl>

      <hr className={styles.rule} />
      <div className={styles.checks}>
        <span className={styles.checksTitle}>Checks before start</span>
        {running ? (
          <p className={styles.hint}>Not needed while a run is going.</p>
        ) : (
          <>
            <ul className={styles.checkList} aria-label="Checks before start">
              {checks.items.map((check) => (
                <li key={check.id} className={styles.check} data-ok={check.ok ? 'true' : 'false'}>
                  <Icon glyph={toneIcons[check.ok ? 'ok' : 'bad']} size="sm" />
                  <span>
                    {check.label}
                    {check.ok ? <span className="visually-hidden">: passes</span> : null}
                    {check.reason ? (
                      <span className={styles.reasonText}>: {check.reason}</span>
                    ) : null}
                    {check.id === 'fleet' && !check.ok ? (
                      <>
                        {' '}
                        <Link className={styles.link} to="/">
                          Pause the fleet on the Overview
                        </Link>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {checks.loading ? (
              <p className={styles.hint} role="status">
                Checking…
              </p>
            ) : null}
            {checks.error !== null ? (
              <p className={styles.hint} role="alert">
                {checks.error}
              </p>
            ) : null}
            <Button variant="outline" size="sm" icon={uiIcons.reset} onClick={checks.onRefresh}>
              Check again
            </Button>
          </>
        )}
      </div>

      <Button
        variant="primary"
        icon={uiIcons.play}
        disabled={block !== null || starting}
        aria-busy={starting || undefined}
        aria-describedby={block === null ? undefined : 'benchmark-start-hint'}
        onClick={onStart}
      >
        {starting ? 'Starting…' : 'Start benchmark…'}
      </Button>
      {block === null ? null : (
        <p id="benchmark-start-hint" className={styles.hint}>
          Start is off. {block}
        </p>
      )}
    </Card>
  );
}
