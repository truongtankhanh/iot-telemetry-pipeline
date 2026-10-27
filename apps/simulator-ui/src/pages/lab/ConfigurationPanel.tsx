import { useId, useState } from 'react';
import type { DeviceInfo, ExpectedAlert } from '../../api/types';
import { metricUnit } from '../../lib/deviceIdentity';
import type { FleetRow } from '../../lib/fleetQuery';
import { holdMetrics, nameList } from '../../lib/holdTargets';
import {
  FAULT_SHAPES,
  type FaultDraft,
  type FaultErrors,
  type FaultPlan,
  type FaultShape,
  type StopCondition,
  sliderModel,
  staggerSentence,
  STOP_OPTIONS,
} from '../../lib/labFault';
import type { TargetScope } from '../../lib/labTargets';
import { formatValue } from '../../lib/rules';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Segmented } from '../../ui/Segmented';
import { SelectField } from '../../ui/SelectField';
import { FaultTiles } from './FaultTiles';
import { TargetPicker } from './TargetPicker';
import styles from './configuration.module.css';

export interface ConfigurationPanelProps {
  rows: readonly FleetRow[];
  scope: TargetScope;
  targets: readonly string[];
  /** The devices the choice reaches. */
  reached: readonly DeviceInfo[];
  onScope: (scope: TargetScope) => void;
  onTargets: (targets: string[]) => void;
  draft: FaultDraft;
  plan: FaultPlan;
  onDraft: (change: Partial<FaultDraft>) => void;
  /** What the simulator expects of this fault, for the line under the stagger; `null` while it is being worked out. */
  expectedAlerts: readonly ExpectedAlert[] | null;
  /** A fault is being sent. */
  busy: boolean;
  /**
   * A benchmark is running: an injection may start devices, which the simulator refuses, so Inject now is off (Add to timeline is a
   * draft and stays on); the banner says why.
   */
  locked?: boolean;
  onAdd: () => void;
  onInject: () => void;
}

const SHAPE_LABELS: Record<FaultShape, string> = { step: 'Step', ramp: 'Ramp', spike: 'Spike' };

const parseNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
  error?: string | undefined;
  disabled?: boolean;
}

/**
 * A number with its unit. While it has focus it shows what was typed (an empty field or "2." is not an error yet); at
 * rest it shows the value in force, so a default or a change made elsewhere is what is on screen.
 */
function NumberField({ label, value, onChange, unit, error, disabled }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? '' : String(value));
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.input} data-invalid={error ? 'true' : undefined}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => setText(value === null ? '' : String(value))}
          onBlur={() => setText(null)}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parseNumber(event.target.value));
          }}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const errorOf = (errors: FaultErrors, key: keyof FaultErrors) => errors[key];

/**
 * _Configure a fault_ (frames 12 and 19): the target, the metric, the kind of fault, its value and shape, when it
 * starts and how long it lasts (with a stagger when more than one device is aimed at), when it stops, and the two ways to
 * send it: _Inject now_ (this fault, at once) and _Add to timeline_ (to the draft the dock draws). A button that cannot act is
 * disabled and the line beside it says why, in words; the same reason is the plan's `blocker`.
 */
export function ConfigurationPanel({
  rows,
  scope,
  targets,
  reached,
  onScope,
  onTargets,
  draft,
  plan,
  onDraft,
  expectedAlerts,
  busy,
  locked = false,
  onAdd,
  onInject,
}: ConfigurationPanelProps) {
  const metrics = holdMetrics(reached);
  const metric = plan.metric;
  const unit = metric === null ? '' : metricUnit(metric);
  const slider = metric === null ? null : sliderModel(metric, plan.value, plan.rule);
  const stagger = staggerSentence(plan.anomalies, expectedAlerts);
  const stopReason = STOP_OPTIONS.find((option) => option.id === 'alert-clears')?.reason;
  const disabled = plan.blocker !== null || busy;

  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.title}>Configure a fault</h2>
        <Chip tone="accent">New</Chip>
      </div>

      <section className={styles.section} aria-label="Target">
        <h3 className={styles.sec}>Target</h3>
        <TargetPicker
          rows={rows}
          scope={scope}
          targets={targets}
          onScope={onScope}
          onChange={onTargets}
        />
        {reached.length > 0 && metric !== null ? (
          <SelectField
            label="Metric"
            value={metric}
            options={metrics.map((value) => ({ value, label: value }))}
            onChange={(value) => onDraft({ metric: value })}
          />
        ) : null}
        {plan.skipped.length > 0 ? (
          <p className={styles.note}>
            {nameList(plan.skipped, 3)} {plan.skipped.length === 1 ? 'does' : 'do'} not report{' '}
            {metric ?? 'it'} and {plan.skipped.length === 1 ? 'is' : 'are'} left out.
          </p>
        ) : null}
      </section>

      <section className={styles.section} aria-label="Fault type">
        <h3 className={styles.sec}>Fault type</h3>
        <FaultTiles value={draft.tile} onChange={(tile) => onDraft({ tile })} />
      </section>

      <section className={styles.section} aria-label="Parameters">
        <h3 className={styles.sec}>Parameters</h3>
        {metric === null ? (
          <p className={styles.note}>Choose a target to set the value.</p>
        ) : (
          <>
            <div className={styles.valueRow}>
              <span
                className={styles.bigValue}
                role="img"
                aria-label={`Value in force: ${plan.value === null ? 'none' : formatValue(metric, plan.value)}${unit ? ` ${unit}` : ''}`}
              >
                {plan.value === null ? '—' : formatValue(metric, plan.value)}
                {unit ? <small>{unit}</small> : null}
              </span>
              <span className={styles.lines}>
                {plan.rule === null
                  ? 'no rule watches this'
                  : `raise ${plan.rule.raise} · clear ${plan.rule.clear}`}
              </span>
            </div>
            {slider === null ? null : (
              <div className={styles.slider}>
                <input
                  type="range"
                  aria-label="Value slider"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={plan.value ?? slider.min}
                  onChange={(event) => onDraft({ value: Number(event.target.value) })}
                />
                {slider.raisePct === null ? null : (
                  <span
                    className={styles.mark}
                    data-kind="raise"
                    style={{ left: `${slider.raisePct}%` }}
                    aria-hidden="true"
                  />
                )}
                {slider.clearPct === null ? null : (
                  <span
                    className={styles.mark}
                    data-kind="clear"
                    style={{ left: `${slider.clearPct}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
            )}
            <NumberField
              label="Value"
              value={plan.value}
              unit={unit}
              error={errorOf(plan.errors, 'value')}
              onChange={(value) => onDraft({ value })}
            />
          </>
        )}
        <Segmented
          label="Shape"
          value={draft.shape}
          onChange={(value) => onDraft({ shape: value as FaultShape })}
          options={FAULT_SHAPES.map((value) => ({ value, label: SHAPE_LABELS[value] }))}
        />
      </section>

      <section className={styles.section} aria-label="Trigger and stop">
        <h3 className={styles.sec}>Trigger and stop</h3>
        <div className={styles.pair}>
          <NumberField
            label="Start at"
            unit="s"
            value={draft.startAt}
            error={errorOf(plan.errors, 'startAt')}
            onChange={(startAt) => onDraft({ startAt })}
          />
          {draft.stop === 'manual' ? (
            <p className={styles.note}>Lasts until you remove it.</p>
          ) : (
            <NumberField
              label="Duration"
              unit="s"
              value={draft.duration}
              error={errorOf(plan.errors, 'duration')}
              onChange={(duration) => onDraft({ duration })}
            />
          )}
        </div>
        {plan.deviceIds.length > 1 ? (
          <>
            <NumberField
              label="Stagger starts"
              unit="s apart"
              value={draft.stagger}
              error={errorOf(plan.errors, 'stagger')}
              onChange={(value) => onDraft({ stagger: value })}
            />
            {stagger === null ? null : <p className={styles.note}>{stagger}</p>}
          </>
        ) : null}
        <Segmented
          label="Stop condition"
          value={draft.stop}
          onChange={(value) => onDraft({ stop: value as StopCondition })}
          options={STOP_OPTIONS.map((option) => ({
            value: option.id,
            label: option.label,
            disabled: !option.available,
          }))}
        />
        {stopReason ? <p className={styles.note}>Alert clears: {stopReason}</p> : null}
      </section>

      <div className={styles.footer}>
        <p className={styles.blocker} role="status">
          {busy ? 'Sending…' : (plan.blocker ?? '')}
        </p>
        <div className={styles.buttons}>
          <Button variant="outline" size="sm" disabled={disabled} onClick={onAdd}>
            Add to timeline
          </Button>
          <Button variant="primary" size="sm" disabled={disabled || locked} onClick={onInject}>
            Inject now
          </Button>
        </div>
      </div>
    </>
  );
}
