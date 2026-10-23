import { useId, type ReactNode } from 'react';
import type { FaultKind, FaultsSnapshot, MalformedKind } from '../../api/types';
import {
  checkDraft,
  FAULT_LIMITS,
  FAULT_ROWS,
  type FaultDrafts,
  type FaultRowInfo,
  faultSentence,
  isFaultOn,
  MALFORMED_HINTS,
  MALFORMED_KINDS,
  PERCENT_TRACK_MAX,
} from '../../lib/faultSettings';
import { formatClockTime } from '../../lib/time';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { faultGlyphs } from '../../ui/icons';
import { NumberField } from '../../ui/NumberField';
import { PercentField } from '../../ui/PercentField';
import { Switch } from '../../ui/Switch';
import { ToggleChip } from '../../ui/ToggleChip';
import type { CommandKey } from './useFaultCommands';
import styles from './faults.module.css';

export interface FaultListProps {
  faults: FaultsSnapshot;
  drafts: FaultDrafts;
  busy: ReadonlySet<CommandKey>;
  /** What the simulator said when it refused a command, by fault. */
  errors: Readonly<Partial<Record<CommandKey, string>>>;
  /** The link to the simulator is lost: nothing can be sent. */
  disabled: boolean;
  onSwitch: (kind: FaultKind, on: boolean) => void;
  /** A value is being edited (a drag, a keystroke). */
  onDraft: <K extends FaultKind>(kind: K, draft: FaultDrafts[K]) => void;
  /** A value is done (released, blurred, Enter, a chip pressed): the draft is sent if the fault is on. */
  onCommit: <K extends FaultKind>(kind: K, draft: FaultDrafts[K]) => void;
  onBurst: () => void;
}

interface RowProps {
  info: FaultRowInfo;
  on: boolean;
  /** What the fault does now, from the engine's own settings. */
  state: string | null;
  error: string | undefined;
  /** The control at the end of the row's head: a switch, or a button. */
  action: ReactNode;
  children?: ReactNode;
}

/** One fault of the frame: a tile with its glyph, the title and the words, the switch, and the controls while it is on. */
function Row({ info, on, state, error, action, children }: RowProps) {
  const titleId = useId();
  return (
    <div
      className={styles.fault}
      data-on={on ? 'true' : undefined}
      role="group"
      aria-labelledby={titleId}
    >
      <span className={styles.tile} data-on={on ? 'true' : undefined}>
        <Icon glyph={faultGlyphs[info.kind]} />
      </span>
      <div className={styles.faultBody}>
        <div className={styles.faultHead}>
          <div className={styles.faultText}>
            <h3 id={titleId} className={styles.faultTitle}>
              {info.title}
            </h3>
            <p className={styles.faultDesc}>{info.description}</p>
            {on && state ? <p className={styles.faultState}>{state}</p> : null}
          </div>
          {action}
        </div>
        {children}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The seven faults of the page, in the frame's order with link loss last. A switch is on exactly when the engine says the
 * fault is on (the page reads `faults`, not its own idea of it); the controls of a fault show only while it is on, and a value
 * that is edited is a draft until it is released, blurred or confirmed. A burst is a button, not a switch: it is a one-shot.
 */
export function FaultList({
  faults,
  drafts,
  busy,
  errors,
  disabled,
  onSwitch,
  onDraft,
  onCommit,
  onBurst,
}: FaultListProps) {
  const headingId = useId();
  const rowFor = (info: FaultRowInfo) => {
    const kind = info.kind;
    if (kind === 'burst') {
      return (
        <Row
          key={kind}
          info={info}
          on={false}
          state={null}
          error={errors.burst}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={
                disabled || busy.has('burst') || faults.bursting || faults.linkLoss !== null
              }
              onClick={onBurst}
            >
              Send {FAULT_LIMITS.burst.toLocaleString('en-US')}
            </Button>
          }
        />
      );
    }

    const on = isFaultOn(kind, faults);
    const sw = (
      <Switch
        label={info.title}
        labelHidden
        checked={on}
        disabled={disabled || busy.has(kind)}
        onChange={(next) => onSwitch(kind, next)}
      />
    );
    const common = { info, on, state: faultSentence(kind, faults), error: errors[kind] };

    switch (kind) {
      case 'drop':
      case 'duplicate': {
        const draft = drafts[kind];
        return (
          <Row key={kind} {...common} action={sw}>
            {on ? (
              <PercentField
                label={info.title}
                value={draft.percent}
                trackMax={PERCENT_TRACK_MAX}
                disabled={disabled}
                error={checkDraft(kind, draft).percent}
                onChange={(percent) => onDraft(kind, { percent })}
                onCommit={(percent) => onCommit(kind, { percent })}
              />
            ) : null}
          </Row>
        );
      }
      case 'malformed': {
        const draft = drafts.malformed;
        const problems = checkDraft('malformed', draft);
        const toggle = (value: MalformedKind, pressed: boolean) => {
          const kinds = MALFORMED_KINDS.filter((k) =>
            k === value ? pressed : draft.kinds.includes(k),
          );
          // The last chip stays on: the simulator takes no empty set.
          if (kinds.length === 0) return;
          const next = { ...draft, kinds: [...kinds] };
          onDraft('malformed', next);
          onCommit('malformed', next);
        };
        return (
          <Row key={kind} {...common} action={sw}>
            {on ? (
              <>
                <div className={styles.chips} role="group" aria-label="Kinds of malformed payload">
                  {MALFORMED_KINDS.map((value) => (
                    <ToggleChip
                      key={value}
                      pressed={draft.kinds.includes(value)}
                      title={MALFORMED_HINTS[value]}
                      disabled={disabled}
                      onChange={(pressed) => toggle(value, pressed)}
                    >
                      {value}
                    </ToggleChip>
                  ))}
                </div>
                {problems.kinds ? (
                  <p className={styles.error} role="alert">
                    {problems.kinds}
                  </p>
                ) : null}
                <PercentField
                  label={`${info.title} share`}
                  value={draft.percent}
                  trackMax={PERCENT_TRACK_MAX}
                  disabled={disabled}
                  error={problems.percent}
                  onChange={(percent) => onDraft('malformed', { ...draft, percent })}
                  onCommit={(percent) => onCommit('malformed', { ...draft, percent })}
                />
              </>
            ) : null}
          </Row>
        );
      }
      case 'delay': {
        const draft = drafts.delay;
        const problems = checkDraft('delay', draft);
        return (
          <Row key={kind} {...common} action={sw}>
            {on ? (
              <div className={styles.pair}>
                <NumberField
                  label="Delay"
                  unit="ms"
                  value={draft.delayMs}
                  disabled={disabled}
                  error={problems.delayMs}
                  onChange={(delayMs) => onDraft('delay', { ...draft, delayMs })}
                  onCommit={(delayMs) => onCommit('delay', { ...draft, delayMs })}
                />
                <NumberField
                  label="Jitter"
                  unit="ms"
                  value={draft.jitterMs}
                  disabled={disabled}
                  error={problems.jitterMs}
                  onChange={(jitterMs) => onDraft('delay', { ...draft, jitterMs })}
                  onCommit={(jitterMs) => onCommit('delay', { ...draft, jitterMs })}
                />
              </div>
            ) : null}
          </Row>
        );
      }
      case 'reorder': {
        const draft = drafts.reorder;
        return (
          <Row key={kind} {...common} action={sw}>
            {on ? (
              <div className={styles.pair}>
                <NumberField
                  label="Window"
                  unit="messages"
                  value={draft.window}
                  disabled={disabled}
                  error={checkDraft('reorder', draft).window}
                  onChange={(window) => onDraft('reorder', { window })}
                  onCommit={(window) => onCommit('reorder', { window })}
                />
              </div>
            ) : null}
          </Row>
        );
      }
      default: {
        // Link loss. Its restore time is chosen before the link is cut; once it is down the state says the rest.
        const draft = drafts['link-loss'];
        const sentence = faultSentence('link-loss', faults);
        const since = faults.linkLoss === null ? null : Date.parse(faults.linkLoss.since);
        const state =
          sentence === null
            ? null
            : `${sentence} (down since ${since === null ? '' : formatClockTime(since)})`;
        return (
          <Row key={kind} {...common} state={state} action={sw}>
            {!on ? (
              <div className={styles.pair}>
                <NumberField
                  label="Restore after (empty: when I restore it)"
                  unit="s"
                  value={draft.forS}
                  disabled={disabled}
                  error={checkDraft('link-loss', draft).forS}
                  onChange={(forS) => onDraft('link-loss', { forS })}
                />
              </div>
            ) : null}
          </Row>
        );
      }
    }
  };

  return (
    <section className={styles.list} aria-labelledby={headingId}>
      {/* The rows are level 3 under the page's level 1: this keeps the order of the levels. */}
      <h2 id={headingId} className="visually-hidden">
        Faults
      </h2>
      {FAULT_ROWS.map(rowFor)}
    </section>
  );
}
