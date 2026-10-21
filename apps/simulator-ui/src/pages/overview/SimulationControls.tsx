import { useEffect, useRef } from 'react';
import { useStudio } from '../../state/studioContext';
import type { ObservedAlert, ScenarioItem, ScenarioRunView } from '../../api/types';
import { runFor } from '../../lib/runClock';
import { scenarioPhases } from '../../lib/scenarioPhases';
import { bannerText, startBanner } from '../../lib/scenarioStart';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { uiIcons } from '../../ui/icons';
import { SelectField } from '../../ui/SelectField';
import { BulkStatus } from '../fleet/BulkStatus';
import { ReplaceDialog } from '../scenarios/ReplaceDialog';
import type { CommandNotice } from '../scenarios/useScenarioCommands';
import { useRunElapsed } from '../scenarios/useRunElapsed';
import { PhaseBar } from './PhaseBar';
import { pickScenario } from './pickScenario';
import styles from './overview.module.css';
import type { FocusTarget } from './useOverviewParams';
import type { SimulationControls as Controls } from './useSimulationControls';

const NO_ALERTS: readonly ObservedAlert[] = [];

/** The bar for a scenario, with the playhead and the flags that have happened, from the run and the alerts. */
function Progress({
  item,
  run,
  elapsedS,
}: {
  item: ScenarioItem;
  run: ScenarioRunView | undefined;
  elapsedS: number | null;
}) {
  const alerts = useStudio((state) => state.view?.alerts.alerts) ?? NO_ALERTS;
  const model = scenarioPhases({ item, run, elapsedS, alerts });
  if (!model.available) {
    return (
      <p className={styles.hint} role="status">
        Expected alerts are not available: {model.reason}
      </p>
    );
  }
  return <PhaseBar model={model} />;
}

/**
 * Its own component because it owns the one-second timer of `useRunElapsed`: only the bar of a scenario that is
 * playing has one.
 */
function RunningProgress({ item, run }: { item: ScenarioItem; run: ScenarioRunView }) {
  const elapsedS = useRunElapsed(item.name, item.lengthS);
  return <Progress item={item} run={run} elapsedS={elapsedS} />;
}

function Notice({ notice, onDismiss }: { notice: CommandNotice; onDismiss: () => void }) {
  return (
    <div
      className={styles.status}
      data-tone={notice.tone}
      role={notice.tone === 'bad' ? 'alert' : 'status'}
    >
      <span className={styles.statusText}>{notice.text}</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

export interface SimulationControlsProps {
  controls: Controls;
  /** `?scenario=` of the address. */
  scenario: string | null;
  onScenario: (name: string) => void;
  /** A control to put focus on, once (`?focus=`); `onFocused` takes it out of the address. */
  focus?: FocusTarget | null;
  onFocused?: () => void;
}

/**
 * The controls of the simulation (frame 11), next to what they change: the scenario picker, Run and Stop (a run over
 * something that is already playing asks first), the progress of the scenario in three named phases, Pause and
 * Resume for the devices, Step on a stepped clock, and Reset. Pausing stops the devices, not the scenario's clock, and
 * the control says so; Step is drawn only where it can work (the brief: absent, not disabled).
 */
export function SimulationControls({
  controls,
  scenario,
  onScenario,
  focus = null,
  onFocused,
}: SimulationControlsProps) {
  const { library, commands, devices, clock } = controls;
  const buttons = useRef<Record<FocusTarget, HTMLButtonElement | null>>({
    pause: null,
    step: null,
    reset: null,
  });
  // The command palette sent the person here for one control: it takes focus once the page has settled (a page change
  // moves focus to `main` in an effect of the shell, which would win over an effect of this component), and the
  // parameter leaves the address. A control that is absent (Step on the wall clock) or off (nothing to pause) is not
  // focused; the person is on the page that has it.
  useEffect(() => {
    if (focus === null) return;
    const timer = setTimeout(() => {
      const button = buttons.current[focus];
      if (button !== null && !button.disabled) button.focus();
      onFocused?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [focus, onFocused]);
  const runs = useStudio((state) => state.view?.runs);
  const intervalMs = useStudio((state) => state.view?.config.intervalMs ?? 0);
  const items = library.library?.scenarios ?? [];
  const picked = pickScenario(items, runs ?? [], scenario);
  const run = picked === null ? undefined : runFor(runs ?? [], picked.name);
  const anyRunning = (runs ?? []).length > 0;
  const unknownName = scenario !== null && !items.some((item) => item.name === scenario);
  const banner = picked === null ? null : startBanner(picked.needsStart);
  const refusal = picked === null ? null : commands.errorOf(picked.name);
  const stepLabel = `Step +${intervalMs / 1000} s`;

  return (
    <Card
      title="Simulation controls"
      aside={
        anyRunning ? (
          <Chip tone="warn" icon={uiIcons.play}>
            Running
          </Chip>
        ) : (
          <Chip>Idle</Chip>
        )
      }
    >
      {library.library === null ? (
        library.status === 'error' ? (
          <div className={styles.status} data-tone="bad" role="alert">
            <span className={styles.statusText}>
              The scenarios could not be read: {library.error}
            </span>
            <Button size="sm" variant="outline" onClick={library.refresh}>
              Try again
            </Button>
          </div>
        ) : (
          <p role="status">Loading scenarios…</p>
        )
      ) : picked === null ? (
        <p className={styles.hint} role="status">
          The library is empty: no scenario could be read.
        </p>
      ) : (
        <>
          <SelectField
            label="Scenario"
            value={picked.name}
            options={items.map((item) => ({ value: item.name, label: item.name }))}
            onChange={onScenario}
          />
          {unknownName ? (
            <p className={styles.hint} role="status">
              No scenario is named <span className={styles.mono}>{scenario}</span>.
            </p>
          ) : null}

          {run === undefined ? (
            <Progress item={picked} run={undefined} elapsedS={null} />
          ) : (
            <RunningProgress item={picked} run={run} />
          )}

          {banner === null || run !== undefined ? null : (
            <p className={styles.hint}>{bannerText(banner)}</p>
          )}
          {refusal === null ? null : (
            <div className={styles.status} data-tone="bad" role="alert">
              <span className={styles.statusText}>{refusal}</span>
            </div>
          )}
        </>
      )}

      <div className={styles.buttons}>
        {picked === null ? null : run === undefined ? (
          <Button
            variant="primary"
            icon={uiIcons.play}
            aria-label={`Run ${picked.name}`}
            disabled={commands.isBusy(picked.name, 'run')}
            onClick={() => void commands.run(picked.name)}
          >
            Run
          </Button>
        ) : (
          <Button
            variant="danger"
            icon={uiIcons.stop}
            aria-label={`Stop ${picked.name}`}
            disabled={commands.isBusy(picked.name, 'stop')}
            onClick={() => void commands.stop(picked.name)}
          >
            Stop
          </Button>
        )}
        {devices.canPause ? (
          <>
            <Button
              ref={(element) => {
                buttons.current.pause = element;
              }}
              icon={uiIcons.pause}
              disabled={devices.pausable === 0 || devices.state.running}
              onClick={devices.pause}
            >
              Pause{devices.pausable > 0 ? ` ${devices.pausable}` : ''}
            </Button>
            {devices.resumable > 0 ? (
              <Button icon={uiIcons.play} disabled={devices.state.running} onClick={devices.resume}>
                Resume {devices.resumable} paused
              </Button>
            ) : null}
          </>
        ) : null}
        {clock.simulated ? (
          <Button
            ref={(element) => {
              buttons.current.step = element;
            }}
            icon={uiIcons.step}
            disabled={clock.busy !== null}
            onClick={() => void clock.step()}
          >
            {stepLabel}
          </Button>
        ) : null}
        <Button
          ref={(element) => {
            buttons.current.reset = element;
          }}
          variant="ghost"
          icon={uiIcons.reset}
          disabled={clock.busy !== null}
          onClick={() => void clock.reset()}
        >
          Reset
        </Button>
      </div>

      <BulkStatus
        pending={devices.pending}
        onConfirm={devices.confirm}
        onCancelConfirm={devices.cancelConfirm}
        state={devices.state}
        onCancelRun={devices.cancelRun}
        onDismiss={devices.dismiss}
      />
      {clock.notice === null ? null : (
        <Notice notice={clock.notice} onDismiss={clock.dismissNotice} />
      )}
      {commands.notice === null ? null : (
        <Notice notice={commands.notice} onDismiss={commands.dismissNotice} />
      )}

      <p className={styles.hint}>
        {clock.simulated
          ? `The clock is stepped: nothing is published until you step it. Step moves simulated time forward by one publish interval (${intervalMs / 1000} s) and sends that tick. `
          : 'Pause stops the devices; a scenario that is running keeps counting. '}
        Reset clears anomalies and returns devices to baseline.
      </p>

      {commands.pending === null ? null : (
        <ReplaceDialog
          pending={commands.pending}
          busy={commands.isBusy(commands.pending.name, 'run')}
          onConfirm={() => void commands.confirmReplace()}
          onCancel={commands.cancelReplace}
        />
      )}
    </Card>
  );
}
