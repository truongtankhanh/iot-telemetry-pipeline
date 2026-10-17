import type { Metrics } from '../../src/metrics/metrics';

/** Sum of a metric's values whose labels contain all of `labels` (no labels: the sum of everything). */
export async function counterValue(
  metrics: Metrics,
  name: keyof Metrics,
  labels: Record<string, string> = {},
): Promise<number> {
  const metric = await (
    metrics[name] as { get(): Promise<{ values: { labels: object; value: number }[] }> }
  ).get();
  return metric.values
    .filter((v) =>
      Object.entries(labels).every(([k, l]) => (v.labels as Record<string, string>)[k] === l),
    )
    .reduce((sum, v) => sum + v.value, 0);
}
