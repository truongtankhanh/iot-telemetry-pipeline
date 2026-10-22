import { useId, useState } from 'react';
import type { Anomaly, DeviceInfo, RulesView, StateView } from '../../api/types';
import { metricUnit } from '../../lib/deviceIdentity';
import { breachValue, MAX_DURATION_S } from '../../lib/labFault';
import { rangeOf, rulesFor } from '../../lib/rules';
import { type EntryPatch } from '../../lib/timelineEditor';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import type { ExpectedImpact } from '../lab/useExpectedImpact';
import { raisesFor } from '../../lib/thresholdPreview';
import styles from './inspector.module.css';
import { ThresholdPreview } from './ThresholdPreview';
import type { ScenarioEditor } from './useScenarioEditor';

type Shape = NonNullable<Anomaly['shape']>;

const SHAPES: readonly { value: Shape; label: string; path: string }[] = [
  { value: 'step', label: 'Step', path: 'M3 18h6V6h6M15 6h6' },
  { value: 'ramp', label: 'Ramp', path: 'M3 19 17 5h4' },
  { value: 'spike', label: 'Spike', path: 'M3 19h5l4-14 4 14h5' },
];

const parseNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

interface NumberFieldProps {
  label: string;
  value: number;
  unit?: string;
  hint?: string;
  /** What is wrong with the value in force (the validation's), shown whatever was typed. */
  error: string | undefined;
  /** Applies a number; answers the reason it was refused, or `null`. */
  onCommit: (value: number) => string | null;
}

/**
 * A number with its unit. While it has focus it shows what was typed (an empty field or "2." is not an error yet); at rest it
 * shows the value in force. A number the editor refuses (it would overlap another anomaly) is not applied and the reason is
 * told next to the field.
 */
function NumberField({ label, value, unit, hint, error, onCommit }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const shown = text ?? String(value);
  const problem = refusal ?? error;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.input} data-invalid={problem ? 'true' : undefined}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onFocus={() => setText(String(value))}
          onBlur={() => {
            setText(null);
            setRefusal(null);
          }}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = parseNumber(event.target.value);
            setRefusal(parsed === null ? null : onCommit(parsed));
          }}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      {problem ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {problem}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface AnomalyInspectorProps {
  editor: ScenarioEditor;
  impact: ExpectedImpact;
  rules: RulesView;
  profiles: StateView['profiles'];
  devices: readonly DeviceInfo[];
}

/**
 * The inspector of the selected anomaly (frame 05): its device and metric, its shape (step, ramp or spike), its value,
 * when it starts and how long it lasts, what the rules should do with it, and the preview against the rule's thresholds.
 * It reaches everything a pointer does on the canvas. A change that would make the anomaly play at once with another on
 * its device and metric is not applied and says so next to the field; a value outside the contract's range is kept and
 * marked, because the person may be half way through typing it, and the scenario cannot be saved until it is fixed.
 */
export function AnomalyInspector({
  editor,
  impact,
  rules,
  profiles,
  devices,
}: AnomalyInspectorProps) {
  const deviceId = useId();
  const metricId = useId();
  const { doc, selectedId } = editor;
  const index = doc.entries.findIndex((entry) => entry.id === selectedId);
  const entry = index < 0 ? undefined : doc.entries[index];

  if (entry === undefined) {
    return (
      <Card title="Inspector">
        <p className={styles.muted}>Select an anomaly on the timeline to edit it.</p>
      </Card>
    );
  }

  const { anomaly } = entry;
  const errors = editor.errors.entries[entry.id] ?? {};
  const device = devices.find((candidate) => candidate.id === anomaly.deviceId);
  const range = rangeOf(anomaly.metric);
  const unit = metricUnit(anomaly.metric);

  /** A value a little beyond the rule's raise line for a metric of a device: what a new metric starts at. */
  const startingValue = (target: DeviceInfo | undefined, metric: Anomaly['metric']): number => {
    const rule = target === undefined ? null : (rulesFor(rules, target, metric)[0] ?? null);
    const baseline =
      target === undefined ? null : (profiles[target.id]?.[metric]?.baseline ?? null);
    const span = rangeOf(metric);
    return breachValue(metric, rule, baseline) ?? (span === null ? 0 : (span.min + span.max) / 2);
  };

  const apply = (patch: EntryPatch): string | null => {
    const result = editor.edit(entry.id, patch);
    return result.ok ? null : result.reason;
  };

  const chooseDevice = (id: string) => {
    const next = devices.find((candidate) => candidate.id === id);
    if (next === undefined) return;
    // The metric stays if the new device reports it; else the first one it does, at a value that makes sense for it.
    if (next.metrics.includes(anomaly.metric)) apply({ deviceId: id });
    else {
      const metric = next.metrics[0];
      if (metric !== undefined) apply({ deviceId: id, metric, value: startingValue(next, metric) });
    }
  };

  const chooseMetric = (metric: Anomaly['metric']) => {
    apply({ metric, value: startingValue(device, metric) });
  };

  const shape = anomaly.shape ?? 'step';
  const raises = raisesFor(impact.preview?.expected ?? null, anomaly);
  const rangeHint =
    range === null
      ? undefined
      : `From ${range.min} to ${range.max}${unit === '' ? '' : ` ${unit}`}`;

  return (
    <Card
      title={`Anomaly ${index + 1}`}
      aside={
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove anomaly ${index + 1}`}
          onClick={() => editor.remove(entry.id)}
        >
          Remove
        </Button>
      }
    >
      <div className={styles.form}>
        <p className={styles.signal}>
          <span className={styles.mono}>{anomaly.deviceId}</span> · {anomaly.metric}
        </p>

        <div className={styles.pair}>
          <div className={styles.field}>
            <label htmlFor={deviceId}>Device</label>
            <select
              id={deviceId}
              className={styles.select}
              value={anomaly.deviceId}
              aria-invalid={errors.deviceId ? true : undefined}
              onChange={(event) => chooseDevice(event.target.value)}
            >
              {devices.some((candidate) => candidate.id === anomaly.deviceId) ? null : (
                <option value={anomaly.deviceId}>{anomaly.deviceId}</option>
              )}
              {devices.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id}
                </option>
              ))}
            </select>
            {errors.deviceId ? (
              <p className={styles.error} role="alert">
                {errors.deviceId}
              </p>
            ) : null}
          </div>
          <div className={styles.field}>
            <label htmlFor={metricId}>Metric</label>
            <select
              id={metricId}
              className={styles.select}
              value={anomaly.metric}
              aria-invalid={errors.metric ? true : undefined}
              onChange={(event) => chooseMetric(event.target.value as Anomaly['metric'])}
            >
              {(device?.metrics ?? [anomaly.metric]).map((metric) => (
                <option key={metric} value={metric}>
                  {metric}
                </option>
              ))}
            </select>
            {errors.metric ? (
              <p className={styles.error} role="alert">
                {errors.metric}
              </p>
            ) : null}
          </div>
        </div>

        <fieldset className={styles.shapes}>
          <legend>Shape</legend>
          <div className={styles.tiles}>
            {SHAPES.map((option) => (
              <label
                key={option.value}
                className={styles.tile}
                data-checked={shape === option.value || undefined}
              >
                <input
                  type="radio"
                  name={`${entry.id}-shape`}
                  value={option.value}
                  checked={shape === option.value}
                  onChange={() => apply({ shape: option.value })}
                />
                <svg
                  viewBox="0 0 24 24"
                  width={20}
                  height={20}
                  aria-hidden="true"
                  className={styles.glyph}
                >
                  <path d={option.path} />
                </svg>
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <NumberField
          label="Value"
          value={anomaly.value}
          unit={unit}
          {...(rangeHint === undefined ? {} : { hint: rangeHint })}
          error={errors.value}
          onCommit={(value) => apply({ value })}
        />
        <div className={styles.pair}>
          <NumberField
            label="Start"
            unit="s"
            value={anomaly.startAt}
            error={errors.startAt ?? errors.overlap}
            onCommit={(startAt) => apply({ startAt })}
          />
          <NumberField
            label="Duration"
            unit="s"
            value={anomaly.duration}
            hint={`Up to ${MAX_DURATION_S} s`}
            error={errors.duration}
            onCommit={(duration) => apply({ duration })}
          />
        </div>

        <p className={styles.raises}>{raises}</p>
        <ThresholdPreview
          doc={doc}
          selected={anomaly}
          impact={impact}
          rules={rules}
          devices={devices}
        />
      </div>
    </Card>
  );
}
