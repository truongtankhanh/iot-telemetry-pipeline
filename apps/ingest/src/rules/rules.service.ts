import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';
import { DevicesService } from '../devices/devices.service';
import { Metrics } from '../metrics/metrics';
import type { Reading } from '../telemetry/rollup';
import { evaluate, parseRules, type Rule, type RuleState } from './rules-engine';

const key = (deviceId: string, ruleId: string) => `${deviceId}\u0000${ruleId}`;

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

  async process(readings: Reading[]): Promise<void> {
    const rules = this.load();
    const work: { reading: Reading; rule: Rule }[] = [];
    for (const reading of readings) {
      const device = this.devices.get(reading.deviceId);
      if (!device) continue;
      for (const rule of rules.get(`${device.kind}\u0000${reading.metric}`) ?? []) {
        work.push({ reading, rule });
      }
    }
    if (work.length === 0) return;

    await this.loadMissingState(work.map((w) => [w.reading.deviceId, w.rule.id] as const));

    for (const { reading, rule } of work) {
      const k = key(reading.deviceId, rule.id);
      const { state, transition } = evaluate(rule, this.state.get(k)!, reading.value);
      this.state.set(k, state);
      if (transition === 'opened') await this.open(reading, rule);
      if (transition === 'cleared') await this.clear(reading, rule);
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
