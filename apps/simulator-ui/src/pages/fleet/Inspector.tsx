import { type MetricName, telemetryTopic } from '@itp/telemetry-contract';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EngineSnapshot, StateView } from '../../api/types';
import { MAX_INTERVAL_MS, parseIntervalMs } from '../../lib/hold';
import { kindLabel, type FleetRow } from '../../lib/fleetQuery';
import { formatClockTime } from '../../lib/time';
import { useDeviceLatest } from '../../state/historyContext';
import { useStudioStore } from '../../state/studioContext';
import { useBenchmarkLock } from '../../state/useBenchmarkLock';
import { Button } from '../../ui/Button';
import { DeviceBadge } from '../../ui/DeviceBadge';
import { uiIcons } from '../../ui/icons';
import { Pill } from '../../ui/Pill';
import { Segmented } from '../../ui/Segmented';
import { useFocusTrap } from '../../ui/useFocusTrap';
import { STATUS_TONES } from '../../lib/deviceStatus';
import { CopyButton } from './CopyButton';
import styles from './inspector.module.css';
import { MetricPanel } from './MetricPanel';
import type { DeviceCommands } from './useDeviceCommands';

export interface InspectorProps {
  row: FleetRow;
  engineDevice: EngineSnapshot['devices'][number] | undefined;
  view: StateView;
  now: number;
  commands: DeviceCommands;
  onClose: () => void;
}

/** The payload as the broker carries it, laid out to be read; text that is not JSON is shown as it is. */
function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

/**
 * The inspector (frame 02): a 680 px sheet over the page for one device. It is modal: the page behind is inert, Tab
 * stays inside, Esc and a click on the dim part close it, and focus goes back to what opened it. The page behind
 * does not move, and the card or row it belongs to keeps its mark. It shows the topic and the last payload (each
 * with a copy button), whether the device simulates or holds values, its interval, and a panel per metric.
 */
export function Inspector({ row, engineDevice, view, now, commands, onClose }: InspectorProps) {
  const store = useStudioStore();
  const { device, status } = row;
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const titleId = useId();
  const intervalId = useId();
  const latest = useDeviceLatest(device.id);
  const holds = engineDevice?.holds ?? {};
  const heldMetrics = Object.keys(holds);
  const intervalMs = engineDevice?.intervalMs ?? view.config.intervalMs;
  const state = engineDevice?.state ?? 'stopped';
  const busy = commands.isBusy(device.id);
  // A benchmark is running: the simulator refuses to start a device (Pause, Stop and holds stay open); the banner says why.
  const lock = useBenchmarkLock();
  const error = commands.errorOf(device.id);

  const [wantsHold, setWantsHold] = useState(false);
  const mode = heldMetrics.length > 0 || wantsHold ? 'hold' : 'simulated';
  const [intervalText, setIntervalText] = useState(String(intervalMs));
  const interval = parseIntervalMs(intervalText);
  const intervalError = intervalText.trim() !== '' && !interval.ok ? interval.message : null;

  useFocusTrap(sheet);

  useEffect(() => {
    store.getState().pushModal();
    sheet.current?.focus();
    const returnTo = opener.current;
    return () => {
      store.getState().popModal();
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [store]);

  const releaseAll = async () => {
    for (const metric of heldMetrics) await commands.release(device.id, metric);
  };

  const onModeChange = (next: string) => {
    if (next === 'hold') {
      setWantsHold(true);
    } else {
      setWantsHold(false);
      void releaseAll();
    }
  };

  const applyInterval = () => {
    if (interval.ok) void commands.setInterval(device.id, interval.value);
  };

  const topic = telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id });
  const payload = latest.last ? prettyPayload(latest.last.payload) : null;
  const sameAsDefault = intervalMs === view.config.intervalMs;

  return createPortal(
    <div className={styles.scrim} onMouseDown={onClose}>
      <div
        ref={sheet}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className={styles.head}>
          <DeviceBadge kind={device.kind} code={row.code} state={status.node} size="lg" />
          <div className={styles.who}>
            <h2 id={titleId} className={styles.title}>
              {row.name}
            </h2>
            <span className={styles.sub}>
              {device.id} · {device.zoneCode} · {kindLabel(device.kind)}
            </span>
          </div>
          <Pill
            label={status.word}
            tone={STATUS_TONES[status.kind]}
            detail={
              status.since !== null && status.kind !== 'running' && status.kind !== 'anomaly'
                ? `since ${formatClockTime(status.since)}`
                : null
            }
          />
          <Button
            variant="ghost"
            size="sm"
            icon={uiIcons.close}
            aria-label={`Close details of ${device.id}`}
            onClick={onClose}
          />
        </header>

        <div className={styles.body}>
          {status.reason ? <p className={styles.reason}>{status.reason}</p> : null}

          <div className={styles.line}>
            <span className={styles.key}>Topic</span>
            <code className={styles.topic}>{topic}</code>
            <CopyButton text={topic} label="topic" />
          </div>

          <div className={styles.settings}>
            <div className={styles.setting}>
              <span className={styles.key}>Publish</span>
              <Segmented
                label={`Publish mode of ${device.id}`}
                value={mode}
                onChange={onModeChange}
                options={[
                  { value: 'simulated', label: 'Simulated' },
                  { value: 'hold', label: 'Hold value' },
                ]}
              />
            </div>

            <form
              className={styles.setting}
              onSubmit={(event) => {
                event.preventDefault();
                applyInterval();
              }}
            >
              <label className={styles.key} htmlFor={intervalId}>
                Interval
              </label>
              <div className={styles.intervalRow}>
                <input
                  id={intervalId}
                  className={styles.number}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={intervalText}
                  aria-invalid={intervalError ? true : undefined}
                  aria-describedby={`${intervalId}-hint`}
                  onChange={(event) => setIntervalText(event.target.value)}
                />
                <span className={styles.unit}>ms</span>
                <Button
                  size="sm"
                  variant="outline"
                  type="submit"
                  disabled={!interval.ok || busy || interval.value === intervalMs}
                >
                  Set
                </Button>
                {!sameAsDefault ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setIntervalText(String(view.config.intervalMs));
                      void commands.setInterval(device.id, null);
                    }}
                  >
                    Use the default ({view.config.intervalMs} ms)
                  </Button>
                ) : null}
              </div>
              <p
                id={`${intervalId}-hint`}
                className={styles.hint}
                data-error={intervalError ? 'true' : undefined}
                role={intervalError ? 'alert' : undefined}
              >
                {intervalError ?? `1 to ${MAX_INTERVAL_MS.toLocaleString('en-US')} ms`}
              </p>
            </form>
          </div>

          {device.metrics.map((metric) => (
            <MetricPanel
              key={metric}
              device={device}
              metric={metric}
              rules={view.rules}
              profile={view.profiles[device.id]?.[metric as MetricName] ?? null}
              now={now}
              status={status}
              intervalMs={intervalMs}
              held={holds[metric as MetricName] ?? null}
              holdMode={mode === 'hold'}
              commands={commands}
            />
          ))}

          <section className={styles.payload} aria-labelledby={`${titleId}-payload`}>
            <div className={styles.line}>
              <h3 id={`${titleId}-payload`} className={styles.key}>
                Last payload{latest.last ? ` · seq ${latest.last.seq.toLocaleString('en-US')}` : ''}
              </h3>
              {payload ? <CopyButton text={payload} label="last payload" /> : null}
            </div>
            {payload ? (
              <pre className={styles.pre} tabIndex={0} aria-label="Last payload">
                {payload}
              </pre>
            ) : (
              <p className={styles.hint}>
                No message from this device has been seen since the page opened.
              </p>
            )}
          </section>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
              <Button size="sm" variant="ghost" onClick={() => commands.clearError(device.id)}>
                Dismiss
              </Button>
            </p>
          ) : null}
        </div>

        <footer className={styles.foot}>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.pause}
            disabled={state !== 'running' || busy}
            aria-label={`Pause ${device.id}`}
            onClick={() => void commands.pause(device.id)}
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.play}
            disabled={state === 'running' || busy || lock.locked}
            aria-label={`Start ${device.id}`}
            onClick={() => void commands.start(device.id)}
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.stop}
            disabled={state === 'stopped' || busy}
            aria-label={`Go silent: stop ${device.id}`}
            onClick={() => void commands.stop(device.id)}
          >
            Go silent
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.reset}
            disabled={heldMetrics.length === 0 || busy}
            aria-label={`Reset to baseline: release every held value of ${device.id}`}
            onClick={() => void releaseAll()}
          >
            Reset to baseline
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
