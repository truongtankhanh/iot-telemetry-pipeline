export interface Reading {
  deviceId: string;
  metric: string;
  ts: Date;
  value: number;
}

export interface RollupRow {
  deviceId: string;
  metric: string;
  bucket: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
}

const MINUTE = 60_000;

/**
 * Plain `<` comparison, so every replica sorts the same way (it need not match PostgreSQL's collation).
 */
const byKey = (x: RollupRow, y: RollupRow): number =>
  x.deviceId !== y.deviceId
    ? x.deviceId < y.deviceId
      ? -1
      : 1
    : x.metric !== y.metric
      ? x.metric < y.metric
        ? -1
        : 1
      : x.bucket.getTime() - y.bucket.getTime();

/**
 * Aggregates stored readings into per-minute rows, ready to upsert into `rollup_1m`. The rows come
 * back sorted by device, metric and bucket: the upsert locks the rows it touches in the order it is
 * given them, so two replicas that touch the same rows in different orders can each wait for the
 * other and PostgreSQL aborts one with a deadlock. One order for everyone rules that out.
 */
export function rollup(readings: Reading[]): RollupRow[] {
  const rows = new Map<string, RollupRow>();
  for (const r of readings) {
    const bucket = new Date(Math.floor(r.ts.getTime() / MINUTE) * MINUTE);
    const key = `${r.deviceId}\u0000${r.metric}\u0000${bucket.getTime()}`;
    const row = rows.get(key);
    if (row) {
      row.count++;
      row.sum += r.value;
      row.min = Math.min(row.min, r.value);
      row.max = Math.max(row.max, r.value);
    } else {
      rows.set(key, {
        deviceId: r.deviceId,
        metric: r.metric,
        bucket,
        count: 1,
        sum: r.value,
        min: r.value,
        max: r.value,
      });
    }
  }
  return [...rows.values()].sort(byKey);
}
