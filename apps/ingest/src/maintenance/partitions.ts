const DAY = 86_400_000;

/** Days of partitions kept ready before and after today. Readings outside are rejected. */
export const PARTITION_DAYS_BACK = 2;
export const PARTITION_DAYS_AHEAD = 2;

export const startOfUtcDay = (date: Date) => new Date(Math.floor(date.getTime() / DAY) * DAY);

export const partitionName = (day: Date) =>
  `reading_${day.toISOString().slice(0, 10).replaceAll('-', '')}`;

/** Days (UTC midnights) that must have a partition right now. */
export function requiredDays(now: Date): Date[] {
  const today = startOfUtcDay(now).getTime();
  const days: Date[] = [];
  for (let d = -PARTITION_DAYS_BACK; d <= PARTITION_DAYS_AHEAD; d++)
    days.push(new Date(today + d * DAY));
  return days;
}

/**
 * Oldest reading accepted: never older than the partitions kept back, nor than retention —
 * so a write can never target a partition that does not exist (ADR-0003).
 */
export function acceptedWindow(now: Date, retentionDays: number): { from: Date } {
  const back = Math.min(PARTITION_DAYS_BACK, retentionDays - 1);
  return { from: new Date(startOfUtcDay(now).getTime() - Math.max(back, 0) * DAY) };
}

/** Partition names older than the retention window. */
export function expiredPartitions(existing: string[], now: Date, retentionDays: number): string[] {
  const cutoff = partitionName(new Date(startOfUtcDay(now).getTime() - retentionDays * DAY));
  return existing.filter((name) => /^reading_\d{8}$/.test(name) && name < cutoff);
}
