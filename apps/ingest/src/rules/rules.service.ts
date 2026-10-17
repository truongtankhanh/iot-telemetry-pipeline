import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';
import { isDataError } from '../database/errors';
import { DevicesService } from '../devices/devices.service';
import { Metrics } from '../metrics/metrics';
import type { Reading } from '../telemetry/rollup';
import { evaluate, parseRules, type Rule, type RuleState } from './rules-engine';

const key = (deviceId: string, ruleId: string) => `${deviceId}\u0000${ruleId}`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Safety valve for deferred evaluations, a count and not a setting. The queue only grows when
 * readings commit but the alert transaction fails (a plain outage fails the flush first), and then
 * by about one batch per flush. Like the write buffer, it is memory: a killed process loses it
 * (ADR-0002).
 */
export const MAX_PENDING = 10_000;

/**
 * How long a replica trusts its cached open/closed state before it compares it with the `alert`
 * table again. Replicas come and go and each one changes alerts the others have cached (ADR-0004),
 * so without this a cached state can stay wrong until the process restarts. A count, not a setting.
 */
export const RECONCILE_INTERVAL_MS = 30_000;

/** One reading against one rule: a reading that matches several rules is several items. */
interface WorkItem {
  reading: Reading;
  rule: Rule;
}

/**
 * Applies threshold rules to stored readings and persists alert transitions with their outbox rows
 * (ADR-0004, ADR-0005). Per-device state lives in memory; a cache miss is filled from the `alert`
 * table so a device that moved to this replica keeps its open alerts.
 */
@Injectable()
export class RulesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RulesService.name);
  private rulesByKindMetric?: Map<string, Rule[]>;
  private readonly state = new Map<string, RuleState>();
  /** Evaluations the database could not take yet, oldest first; retried before anything newer. */
  private pending: WorkItem[] = [];
  /** When the cached state was last compared with the table; 0 until the first evaluation. */
  private lastReconcile = 0;
  /** Tail of the call chain: `process` runs one call at a time. */
  private running: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly devices: DevicesService,
    private readonly metrics: Metrics,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Runs after every module has initialised, so the device registry is loaded. */
  onApplicationBootstrap(): void {
    this.load();
  }

  private load(): Map<string, Rule[]> {
    if (this.rulesByKindMetric) return this.rulesByKindMetric;
    const path = join(this.config.get('CONFIG_DIR', { infer: true }), 'rules.json');
    const kinds = new Map<string, Set<string>>();
    for (const d of this.devices.all()) {
      const metrics = kinds.get(d.kind) ?? new Set<string>();
      d.metrics.forEach((m) => metrics.add(m));
      kinds.set(d.kind, metrics);
    }
    const rules = parseRules(JSON.parse(readFileSync(path, 'utf8')), kinds);
    const byKindMetric = new Map<string, Rule[]>();
    for (const rule of rules) {
      const k = `${rule.kind}\u0000${rule.metric}`;
      byKindMetric.set(k, [...(byKindMetric.get(k) ?? []), rule]);
    }
    this.logger.log(`Loaded ${rules.length} rules from ${path}`);
    this.rulesByKindMetric = byKindMetric;
    return byKindMetric;
  }

  /**
   * Applies the rules to readings that are already stored, after whatever is still pending. A
   * transient database failure does not throw: the failing evaluation and everything after it are
   * queued for the next call, because the readings have committed and the batch must not be redone.
   * Calls are serialised so a retry cannot interleave with a flush over `pending` and `state`.
   */
  process(readings: Reading[]): Promise<void> {
    const result = this.running.then(() => this.evaluateAll(readings));
    this.running = result.catch(() => undefined);
    return result;
  }

  /** Retries what is pending without new readings; returns how many items are still pending. */
  async retryPending(): Promise<number> {
    await this.process([]);
    return this.pending.length;
  }

  private async evaluateAll(readings: Reading[]): Promise<void> {
    const fresh = this.toWorkItems(readings);
    const work = this.pending.length > 0 ? [...this.pending, ...fresh] : fresh;
    if (work.length === 0) return;

    if (Date.now() - this.lastReconcile >= RECONCILE_INTERVAL_MS) await this.reconcile();

    try {
      await this.loadMissingState(work.map((w) => [w.reading.deviceId, w.rule.id] as const));
    } catch (error) {
      this.defer(work, error);
      return;
    }

    for (let i = 0; i < work.length; i++) {
      const { reading, rule } = work[i]!;
      const k = key(reading.deviceId, rule.id);
      const { state, transition } = evaluate(rule, this.state.get(k)!, reading.value);
      try {
        if (transition === 'opened') await this.open(reading, rule);
        if (transition === 'cleared') await this.clear(reading, rule);
      } catch (error) {
        if (!isDataError(error)) {
          // Not the data's fault, so this item and every later one wait: applying a later reading
          // of the same device first would count its breach twice once this one is retried.
          this.defer(work.slice(i), error);
          return;
        }
        this.drop(reading, rule, error);
        continue;
      }
      // Only now, so the state never gets ahead of the `alert` table.
      this.state.set(k, state);
    }
    this.setPending([]);
  }

  private toWorkItems(readings: Reading[]): WorkItem[] {
    const rules = this.load();
    const items: WorkItem[] = [];
    for (const reading of readings) {
      const device = this.devices.get(reading.deviceId);
      if (!device) continue;
      for (const rule of rules.get(`${device.kind}\u0000${reading.metric}`) ?? []) {
        items.push({ reading, rule });
      }
    }
    return items;
  }

  /** Queues `items` (oldest first), dropping the oldest ones past `MAX_PENDING`. */
  private defer(items: WorkItem[], error: unknown): void {
    const wasEmpty = this.pending.length === 0;
    const excess = Math.max(0, items.length - MAX_PENDING);
    if (excess > 0) {
      this.metrics.evaluationDropped.inc(excess);
      this.logger.error(`Pending rule evaluations are full, dropped the oldest ${excess}`);
    }
    this.setPending(excess > 0 ? items.slice(excess) : items);
    if (wasEmpty) {
      this.logger.warn(
        `Rule evaluation deferred, ${this.pending.length} pending: ${messageOf(error)}`,
      );
    }
  }

  /** The database rejected this item's data, so a retry would fail the same way: give it up. */
  private drop(reading: Reading, rule: Rule, error: unknown): void {
    this.metrics.evaluationDropped.inc();
    this.logger.error(
      `Rule evaluation dropped, the database rejected it: rule ${rule.id}, device ${reading.deviceId}: ${messageOf(error)}`,
    );
  }

  private setPending(items: WorkItem[]): void {
    const wasPending = this.pending.length > 0;
    this.pending = items;
    this.metrics.evaluationPending.set(items.length);
    if (wasPending && items.length === 0) {
      this.logger.log('Rule evaluation caught up, nothing is pending');
    }
  }

  /**
   * Brings every cached (device, rule) state in line with the open alerts in the table: another
   * replica may have opened or cleared an alert since this one cached it, and may be gone now.
   * Pairs not cached are left to `loadMissingState`. Runs inside the serialised `process` chain, so
   * it never interleaves with a transition. A failure is logged and skipped: the evaluation goes on
   * with the state it has, and the next interval tries again.
   */
  private async reconcile(): Promise<void> {
    this.lastReconcile = Date.now();
    if (this.state.size === 0) return;
    try {
      const { rows } = await this.db.query<{ device_id: string; rule_id: string }>(
        `SELECT device_id, rule_id FROM alert WHERE status = 'open'`,
      );
      const open = new Set(rows.map((r) => key(r.device_id, r.rule_id)));
      let toOpen = 0;
      let toClosed = 0;
      for (const [k, state] of this.state) {
        if (state.open === open.has(k)) continue;
        this.state.set(k, { open: !state.open, streak: 0 });
        if (state.open) toClosed++;
        else toOpen++;
      }
      if (toOpen > 0) this.metrics.stateCorrections.inc({ direction: 'to_open' }, toOpen);
      if (toClosed > 0) this.metrics.stateCorrections.inc({ direction: 'to_closed' }, toClosed);
      if (toOpen + toClosed > 0) {
        this.logger.warn(
          `Alert state corrected from the table: ${toOpen} now open, ${toClosed} now closed`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Alert state reconcile failed, keeping the cached state: ${messageOf(error)}`,
      );
    }
  }

  /** One query for every (device, rule) pair this replica has not seen yet. */
  private async loadMissingState(pairs: (readonly [string, string])[]): Promise<void> {
    const missing = [...new Map(pairs.map((p) => [key(...p), p])).values()].filter(
      (p) => !this.state.has(key(...p)),
    );
    if (missing.length === 0) return;
    const { rows } = await this.db.query<{ device_id: string; rule_id: string }>(
      `SELECT device_id, rule_id FROM alert
       WHERE status = 'open' AND (device_id, rule_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [missing.map((p) => p[0]), missing.map((p) => p[1])],
    );
    const open = new Set(rows.map((r) => key(r.device_id, r.rule_id)));
    for (const p of missing) this.state.set(key(...p), { open: open.has(key(...p)), streak: 0 });
  }

  private async open(reading: Reading, rule: Rule): Promise<void> {
    const opened = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO alert (device_id, rule_id, metric, severity, title, status, opened_at, opened_value)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)
         ON CONFLICT (device_id, rule_id) WHERE status = 'open' DO NOTHING
         RETURNING id`,
        [
          reading.deviceId,
          rule.id,
          rule.metric,
          rule.severity,
          rule.title,
          reading.ts,
          reading.value,
        ],
      );
      if (rows.length === 0) return false; // another replica opened it first
      await client.query(`INSERT INTO alert_delivery (alert_id, event) VALUES ($1, 'opened')`, [
        rows[0]!.id,
      ]);
      return true;
    });
    if (opened) {
      this.metrics.alertTransitions.inc({ transition: 'opened' });
      this.logger.warn(`${rule.title} — ${reading.deviceId} ${rule.metric}=${reading.value}`);
    }
  }

  private async clear(reading: Reading, rule: Rule): Promise<void> {
    const cleared = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `UPDATE alert SET status = 'cleared', cleared_at = $3, cleared_value = $4
         WHERE device_id = $1 AND rule_id = $2 AND status = 'open'
         RETURNING id`,
        [reading.deviceId, rule.id, reading.ts, reading.value],
      );
      if (rows.length === 0) return false;
      await client.query(`INSERT INTO alert_delivery (alert_id, event) VALUES ($1, 'cleared')`, [
        rows[0]!.id,
      ]);
      return true;
    });
    if (cleared) {
      this.metrics.alertTransitions.inc({ transition: 'cleared' });
      this.logger.log(
        `Cleared: ${rule.title} — ${reading.deviceId} ${rule.metric}=${reading.value}`,
      );
    }
  }

  /** Incident type configured for a rule — used when delivering its alerts. */
  incidentType(ruleId: string): string | undefined {
    for (const rules of this.load().values()) {
      const rule = rules.find((r) => r.id === ruleId);
      if (rule) return rule.incidentType;
    }
    return undefined;
  }
}
