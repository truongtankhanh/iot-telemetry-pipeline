import { rangeOf } from './rules';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** `−40 to 85 °C`: the range the contract accepts for a metric, for a hint; empty for a metric it lacks. */
export function holdRangeHint(metric: string): string {
  const range = rangeOf(metric);
  if (!range) return '';
  return `${range.min} to ${range.max}${range.unit ? ` ${range.unit}` : ''}`;
}

/**
 * Reads the text of a value to hold. A value outside the contract's range is refused here, and says what the range is:
 * sending one on purpose is what the Faults page is for, not a hold. A comma is read as a decimal point.
 */
export function parseHoldValue(text: string, metric: string): ParseResult<number> {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return { ok: false, message: 'Enter a value' };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: `“${text.trim()}” is not a number` };
  const range = rangeOf(metric);
  if (range && (value < range.min || value > range.max)) {
    return { ok: false, message: `${metric} accepts ${holdRangeHint(metric)}` };
  }
  return { ok: true, value };
}

export const MAX_INTERVAL_MS = 3_600_000;

/** Reads the text of a publish interval in whole milliseconds, from 1 to an hour. */
export function parseIntervalMs(text: string): ParseResult<number> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: 'Enter milliseconds' };
  const value = Number(trimmed);
  if (!Number.isInteger(value)) return { ok: false, message: 'Use a whole number of milliseconds' };
  if (value < 1 || value > MAX_INTERVAL_MS) {
    return { ok: false, message: `Use 1 to ${MAX_INTERVAL_MS.toLocaleString('en-US')} ms` };
  }
  return { ok: true, value };
}
