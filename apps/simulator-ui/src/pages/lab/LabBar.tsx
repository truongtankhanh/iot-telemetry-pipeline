import { Link } from 'react-router';
import type { ReactNode } from 'react';
import type { ScenarioItem } from '../../api/types';
import { type BarProgress, CUSTOM_PICK } from '../../lib/labTimeline';
import { seconds } from '../../lib/scenarioExpectation';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { uiIcons } from '../../ui/icons';
import { SelectField } from '../../ui/SelectField';
import { BulkStatus } from '../fleet/BulkStatus';
import type { SimulationControls } from '../overview/useSimulationControls';
import { ReplaceDialog } from '../scenarios/ReplaceDialog';
import styles from './labBar.module.css';

export interface LabBarProps {
  controls: SimulationControls;
  /** `custom` (the timeline of the page) or the name of a scenario of the library. */
  pick: string;
  onPick: (pick: string) => void;
  progress: BarProgress;
  /** Something is playing: a scenario run, or a fault that is on the engine and has not ended. */
  playing: boolean;
  /** The status of the link to the simulator, drawn after the title. */
  status: ReactNode;
  intervalMs: number;
}

/** "Elapsed 41 s / 80 s" while something plays; why nothing does ("Not running · 80 s long") when it does not. */
function elapsedText(progress: BarProgress): string {
  const whole = (value: number) => seconds(Math.round(value));
  if (progress.elapsedS !== null) {
    return `Elapsed ${whole(progress.elapsedS)} / ${whole(progress.totalS ?? 0)}`;
  }
  if (progress.totalS === null) return 'Nothing is playing';
  return `${progress.note ?? 'Not playing'} · ${whole(progress.totalS)} long`;
}

const percent = (fraction: number) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;

/**
 * The bar of the Lab (frames 12 and 19): the title, the scenario picker ("Custom fault" is the page's timeline, the others
 * are the library's), what is playing, and the controls of the simulation. Run and Stop for a scenario picked from the
 * library are the Overview's own (a run over something already playing asks first); Pause stops the devices and not the
 * scenario's clock, Step exists only on the simulated clock (absent, not disabled), Reset clears the faults. Under it
 * the elapsed time and how far along it is, and the links to the Lab's other pages.
 */
export function LabBar({
  controls,
  pick,
  onPick,
  progress,
  playing,
  status,
  intervalMs,
}: LabBarProps) {
  const { library, commands, devices, clock } = controls;
  const items = library.library?.scenarios ?? [];
  const item: ScenarioItem | undefined =
    pick === CUSTOM_PICK ? undefined : items.find((candidate) => candidate.name === pick);
  const running = item !== undefined && item.running;
  const options = [
    { value: CUSTOM_PICK, label: 'Custom fault' },
    ...items.map((scenario) => ({ value: scenario.name, label: scenario.name })),
  ];
  const refusal = item === undefined ? null : commands.errorOf(item.name);

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <h1 className={styles.title}>Simulation lab</h1>
        {status}
        <SelectField
          label="Scenario"
          value={item === undefined ? CUSTOM_PICK : item.name}
          options={options}
          onChange={onPick}
        />
        {playing ? (
          <Chip tone="warn" icon={uiIcons.play}>
            Running
          </Chip>
        ) : (
          <Chip>Idle</Chip>
        )}

        <div className={styles.buttons}>
          {item === undefined ? null : running ? (
            <Button
              size="sm"
              variant="danger"
              icon={uiIcons.stop}
              aria-label={`Stop ${item.name}`}
              disabled={commands.isBusy(item.name, 'stop')}
              onClick={() => void commands.stop(item.name)}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={uiIcons.play}
              aria-label={`Run ${item.name}`}
              disabled={commands.isBusy(item.name, 'run')}
              onClick={() => void commands.run(item.name)}
            >
              Run
            </Button>
          )}
          {devices.canPause ? (
            <>
              <Button
                size="sm"
                icon={uiIcons.pause}
                disabled={devices.pausable === 0 || devices.state.running}
                onClick={devices.pause}
              >
                Pause{devices.pausable > 0 ? ` ${devices.pausable}` : ''}
              </Button>
              {devices.resumable > 0 ? (
                <Button
                  size="sm"
                  icon={uiIcons.play}
                  disabled={devices.state.running}
                  onClick={devices.resume}
                >
                  Resume {devices.resumable} paused
                </Button>
              ) : null}
            </>
          ) : null}
          {clock.simulated ? (
            <Button
              size="sm"
              icon={uiIcons.step}
              disabled={clock.busy !== null}
              onClick={() => void clock.step()}
            >
              Step +{intervalMs / 1000} s
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon={uiIcons.reset}
            disabled={clock.busy !== null}
            onClick={() => void clock.reset()}
          >
            Reset
          </Button>
        </div>

        <span className={styles.spacer} />
        <div className={styles.progress}>
          <span className={styles.elapsed}>{elapsedText(progress)}</span>
          <div
            className={styles.track}
            role="progressbar"
            aria-label="Progress of what is playing"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.fraction * 100)}
          >
            <i style={{ width: percent(progress.fraction) }} />
          </div>
        </div>
        <Link className={styles.link} to="/lab/scenarios">
          Scenarios
        </Link>
        <Link className={styles.link} to="/lab/faults">
          Faults
        </Link>
      </div>

      {clock.simulated ? (
        <p className={styles.hint}>
          Simulated clock: nothing is published until you step it, and a fault starts from the next
          step.
        </p>
      ) : null}
      {refusal === null ? null : (
        <p className={styles.bad} role="alert">
          {refusal}
        </p>
      )}
      <BulkStatus
        pending={devices.pending}
        onConfirm={devices.confirm}
        onCancelConfirm={devices.cancelConfirm}
        state={devices.state}
        onCancelRun={devices.cancelRun}
        onDismiss={devices.dismiss}
      />
      {[commands.notice, clock.notice].map((notice, index) =>
        notice === null ? null : (
          <div
            key={index}
            className={styles.notice}
            data-tone={notice.tone}
            role={notice.tone === 'bad' ? 'alert' : 'status'}
          >
            <span className={styles.noticeText}>{notice.text}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={index === 0 ? commands.dismissNotice : clock.dismissNotice}
            >
              Dismiss
            </Button>
          </div>
        ),
      )}
      {commands.pending === null ? null : (
        <ReplaceDialog
          pending={commands.pending}
          busy={commands.isBusy(commands.pending.name, 'run')}
          onConfirm={() => void commands.confirmReplace()}
          onCancel={commands.cancelReplace}
        />
      )}
    </div>
  );
}
