import { useId } from 'react';
import type { Cause } from '../../lib/demoWaiting';
import type { DemoAwaitType } from '../../lib/demoScript';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { toneIcons, uiIcons } from '../../ui/icons';
import { Kbd } from '../../ui/Kbd';
import type { CommandNotice } from '../scenarios/useScenarioCommands';
import styles from './demo.module.css';
import type { StepPhase } from './useDemoDriver';

/** One of the three small facts under the waiting block ("Scenario started"). */
export interface HotFact {
  done: boolean;
  text: string;
}

export interface StepCardProps {
  /** The position, from 0. */
  index: number;
  count: number;
  title: string;
  /** The narration, with its `{tokens}` filled. */
  say: string;
  phase: StepPhase;
  /** What the step waits for, as the end of "Waiting for …"; `null` for a step that waits for nothing. */
  waitingFor: string | null;
  /** The kind of event the step waits for; the footer says it moves on by itself when it happens. */
  awaitType: DemoAwaitType | null;
  /** The rule's count ("server-room-hot has 2 of 3 readings above 27 °C") while it is counting. */
  detail: string | null;
  /** The newest reading of the metric under watch, big, on the right of the waiting block. */
  reading: { value: string; unit: string; breach: boolean } | null;
  /** What explains a wait that is not ending, when Studio can see it. */
  cause: Cause | null;
  /** The step cannot finish by itself, or is past its time limit: the way on is offered by name. */
  late: boolean;
  /** The label of the way on once the step is late ("Move on without the alert"). */
  moveOnLabel: string | null;
  /** What the step says happened, once its event did ("the alert opened"). */
  happened: string | null;
  /** The simulator's reason when the step's action was refused. */
  failure: string | null;
  /** "Moved on: the alert opened", for a few seconds after the step moved on by itself. */
  movedOn: string | null;
  scenarioRunning: boolean;
  /** Seconds the step has been on screen. */
  sinceStartS: number;
  facts: readonly HotFact[];
  /** The title of the step after this one, `null` on the last. */
  nextTitle: string | null;
  canBack: boolean;
  notes: string | null;
  notesOpen: boolean;
  notice: CommandNotice | null;
  /**
   * The card at the size that fits beside the twin's scene (SIM-21): smaller headings and padding, the same content and the same
   * keys. Without it the card is the frame's, for a projector.
   */
  compact?: boolean | undefined;
  onNext: () => void;
  onBack: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onToggleNotes: () => void;
}

const WHEN: Record<DemoAwaitType, string> = {
  'rule-raised': 'the rule raises',
  'alert-opened': 'the alert opens',
  'incident-delivered': 'the incident appears',
  'alert-cleared': 'the alert clears',
};

/** The keys are shown on the buttons and said by `aria-keyshortcuts`, so they stay out of the buttons' names. */
const key = (label: string) => (
  <span aria-hidden="true">
    <Kbd>{label}</Kbd>
  </span>
);

/**
 * The current step (frame 08), large enough for a projector: what to say, what the step waits for and how it is going, three small
 * facts, and the way on. The waiting block is a status, so a screen reader hears it change; a step that was refused is an alert
 * with a Retry. A step that is late (past its time limit, or one that cannot finish) says so in words, names what is wrong when
 * Studio can see it, and puts the way on in the button: "Move on without the alert". Nothing here moves the step; the page does.
 */
export function StepCard(props: StepCardProps) {
  const {
    index,
    count,
    title,
    say,
    phase,
    waitingFor,
    awaitType,
    detail,
    reading,
    cause,
    late,
    moveOnLabel,
    happened,
    failure,
    movedOn,
    scenarioRunning,
    sinceStartS,
    facts,
    nextTitle,
    canBack,
    notes,
    notesOpen,
    notice,
    compact,
  } = props;
  const notesId = useId();
  const isLast = index >= count - 1;

  const nextLabel =
    late && moveOnLabel !== null
      ? moveOnLabel
      : isLast
        ? 'Finish'
        : `Next: ${nextTitle ?? 'the next step'}`;

  const block = (() => {
    switch (phase) {
      case 'none':
        return null;
      case 'starting':
        return {
          tone: 'neutral',
          role: 'status',
          spinner: true,
          glyph: null,
          title: 'Starting this step',
          lines: ['Waiting for the simulator to confirm.'],
        } as const;
      case 'failed':
        return {
          tone: 'bad',
          role: 'alert',
          spinner: false,
          glyph: toneIcons.bad,
          title: 'This step could not start',
          lines: [failure ?? 'Something is in the way: answer the question to go on.'],
        } as const;
      case 'waiting':
      case 'slow': {
        const slow = phase === 'slow';
        const warn = slow || cause !== null;
        const lines = [
          ...(detail === null ? [] : [detail]),
          ...(slow ? [`Still not here after ${Math.floor(sinceStartS)} s.`] : []),
          ...(cause === null
            ? slow
              ? ['Nothing Studio can see explains it. Move on when you are ready.']
              : []
            : [cause.text]),
        ];
        return {
          tone: warn ? 'warn' : 'neutral',
          role: 'status',
          spinner: !warn,
          glyph: warn ? toneIcons.warn : null,
          title: `${slow ? 'Late: still waiting' : 'Waiting'} for ${waitingFor ?? 'the next event'}`,
          lines,
        } as const;
      }
      case 'done':
        return {
          tone: 'ok',
          role: 'status',
          spinner: false,
          glyph: toneIcons.ok,
          title: happened === null ? 'Done' : `Done: ${happened}`,
          lines: ['It has already happened.'],
        } as const;
    }
  })();

  return (
    <section
      className={styles.card}
      aria-label="Current step"
      data-compact={compact === true ? 'true' : undefined}
    >
      <div className={styles.cardBody}>
        <div className={styles.row}>
          <Chip tone="accent">Step {index + 1}</Chip>
          {scenarioRunning ? (
            <Chip tone="warn" icon={uiIcons.play}>
              Scenario running · {Math.floor(sinceStartS)} s in
            </Chip>
          ) : null}
        </div>
        <h2 className={styles.big}>{title}</h2>
        <p className={styles.say}>{say}</p>

        {block === null ? null : (
          <div className={styles.wait} data-tone={block.tone} role={block.role}>
            {block.spinner ? <span className={styles.spin} aria-hidden="true" /> : null}
            {block.glyph === null ? null : <Icon glyph={block.glyph} size="lg" />}
            <div className={styles.waitText}>
              <span className={styles.waitTitle}>{block.title}</span>
              {block.lines.map((line) => (
                <span key={line} className={styles.waitDetail}>
                  {line}
                </span>
              ))}
            </div>
            <span className={styles.spacer} />
            {phase === 'failed' && failure !== null ? (
              <Button variant="outline" size="sm" onClick={props.onRetry}>
                Retry
              </Button>
            ) : null}
            {reading === null || phase === 'failed' || phase === 'starting' ? null : (
              <span className={styles.value} data-breach={reading.breach}>
                {reading.value}
                {reading.unit === '' ? null : <small>{reading.unit}</small>}
              </span>
            )}
          </div>
        )}

        <p className="visually-hidden" role="status">
          {movedOn === null ? '' : `Moved on: ${movedOn}`}
        </p>

        {facts.length === 0 && notes === null ? null : (
          <div className={styles.row}>
            {facts.length === 0 ? null : (
              <ul className={styles.hot} role="list">
                {facts.map((fact) => (
                  <li key={fact.text} className={styles.hotItem} data-done={fact.done}>
                    <Icon glyph={fact.done ? uiIcons.check : uiIcons.clock} size="sm" />
                    {fact.text}
                  </li>
                ))}
              </ul>
            )}
            <span className={styles.spacer} />
            {notes === null ? null : (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={notesOpen}
                aria-controls={notesId}
                aria-keyshortcuts="N"
                onClick={props.onToggleNotes}
              >
                Notes {key('N')}
              </Button>
            )}
          </div>
        )}
        {notes !== null && notesOpen ? (
          <p id={notesId} className={styles.notes}>
            {notes}
          </p>
        ) : null}
      </div>

      <div className={styles.footer}>
        <Button
          variant="ghost"
          disabled={!canBack}
          aria-keyshortcuts="ArrowLeft"
          onClick={props.onBack}
        >
          Back {key('←')}
        </Button>
        <Button variant="ghost" aria-keyshortcuts="R" onClick={props.onRestart}>
          Restart step {key('R')}
        </Button>
        <span className={styles.spacer} />
        {awaitType === null ? null : (
          <span className={styles.hint}>Moves on by itself when {WHEN[awaitType]}</span>
        )}
        <Button variant="primary" size="lg" aria-keyshortcuts="Space" onClick={props.onNext}>
          {nextLabel} {key('Space')}
        </Button>
      </div>

      {notice === null ? null : (
        <p
          className={styles.notice}
          data-tone={notice.tone}
          role={notice.tone === 'bad' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
