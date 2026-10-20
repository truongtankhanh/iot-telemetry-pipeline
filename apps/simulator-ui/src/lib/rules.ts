import { METRICS, type MetricName } from '@itp/telemetry-contract';
import type { DeviceInfo, RuleInfo, RulesView } from '../api/types';
import { metricUnit } from './deviceIdentity';

/** The rules that apply to a metric of a device: those of its kind for that metric. Empty when rules are not available. */
export function rulesFor(rules: RulesView, device: DeviceInfo, metric: string): RuleInfo[] {
  if (!rules.available) return [];
  return rules.items.filter((rule) => rule.kind === device.kind && rule.metric === metric);
}

/** True when a value is strictly beyond the raise line (the side that opens an alert). */
export function isBeyond(rule: RuleInfo, value: number): boolean {
  return rule.direction === 'above' ? value > rule.raise : value < rule.raise;
}

/** The range the contract accepts for a metric; `null` for a metric the contract does not have. */
export function rangeOf(metric: string): { min: number; max: number; unit: string } | null {
  return Object.hasOwn(METRICS, metric) ? METRICS[metric as MetricName] : null;
}

/** An amount for a sentence: one decimal under 100, whole above, no trailing `.0`, never negative. */
export function formatAmount(amount: number): string {
  const x = Math.abs(amount);
  const rounded = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
  return String(rounded);
}

/** A reading for a card or a tag: ppm are whole, the rest have one decimal. */
export function formatValue(metric: string, value: number): string {
  return metric === 'co2_ppm' ? String(Math.round(value)) : value.toFixed(1);
}

const withUnit = (metric: string, text: string) => {
  const unit = metricUnit(metric);
  return unit === '' ? text : `${text} ${unit}`;
};

export interface Headroom {
  /** True when the value is beyond the raise line. */
  beyond: boolean;
  /** How far beyond, or how far short of it, in the metric's unit, as a non-negative number. */
  amount: number;
  /** "2.3 °C above raise" when beyond, "4.6 °C to raise" when not. */
  text: string;
}

/** How a value stands against a rule's raise line, in words. */
export function headroom(rule: RuleInfo, value: number): Headroom {
  const beyond = isBeyond(rule, value);
  const amount = Math.abs(value - rule.raise);
  const amountText = withUnit(rule.metric, formatAmount(amount));
  const side = rule.direction === 'above' ? 'above' : 'below';
  return {
    beyond,
    amount,
    text: beyond ? `${amountText} ${side} raise` : `${amountText} to raise`,
  };
}

/** "raise 27 · clear 25.5 · opens after 3 readings in a row" */
export function ruleSentence(rule: RuleInfo): string {
  const readings = rule.for === 1 ? '1 reading' : `${rule.for} readings in a row`;
  return `raise ${rule.raise} · clear ${rule.clear} · opens after ${readings}`;
}
