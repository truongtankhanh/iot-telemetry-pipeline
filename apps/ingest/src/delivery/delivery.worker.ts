import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';
import { DevicesService } from '../devices/devices.service';
import { Metrics } from '../metrics/metrics';
import { RulesService } from '../rules/rules.service';
import { ALERT_SINK, type AlertForDelivery, type AlertSink, RetryLater } from './alert-sink';
import { MAX_ATTEMPTS, nextDelayMs } from './backoff';

const BATCH = 20;

/**
 * How long a worker keeps the row it took. It takes one row at a time, so this only has to outlast
 * one delivery (a few requests of 5 s each); a lease taken for a whole batch would run out under a
 * command center that times out every call. After a crash the row waits this long, at most. A
 * constant, not a setting.
 */
export const LEASE_MS = 60_000;

/** How long a `cleared` event waits before it looks again for the incident of its `opened` event. */
export const WAITING_RETRY_MS = 5_000;

interface DueRow {
  delivery_id: string;
  event: 'opened' | 'cleared';
  attempts: number;
  alert_id: string;
  device_id: string;
  rule_id: string;
  metric: string;
  severity: string;
  title: string;
  opened_at: Date;
  opened_value: number;
  cleared_at: Date | null;
  cleared_value: number | null;
  external_ref: string | null;
}

/**
 * Drains the `alert_delivery` outbox (ADR-0005). A row is taken with a lease (`locked_until`) in a
 * single statement, so any number of replicas can run this worker without delivering the same row
 * twice, and no transaction, row lock or pool connection is held while the command center is called.
 */
@Injectable()
export class DeliveryWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(DeliveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<number> = Promise.resolve(0);
  /** Set at shutdown: the pass in flight finishes its row and takes no other. */
  private stopping = false;

  constructor(
    private readonly db: Database,
    private readonly devices: DevicesService,
    private readonly rules: RulesService,
    private readonly metrics: Metrics,
    private readonly config: ConfigService<Env, true>,
    @Inject(ALERT_SINK) private readonly sink: AlertSink,
  ) {}

  onApplicationBootstrap(): void {
    if (this.sink.name === 'none') {
      // A warning, not a boot line: a deployment that lost OCC_API_URL otherwise looks like a demo,
      // and its alerts are final (a skipped row is never retried).
      this.logger.warn(
        'Alert sink: none — alerts are recorded and marked skipped, never delivered. Set OCC_API_URL to deliver them.',
      );
    } else {
      this.logger.log(`Alert sink: ${this.sink.name}`);
    }
    const interval = this.config.get('DELIVERY_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.tick(), interval);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass over due rows. Returns how many rows were handled. Public for tests. */
  tick(): Promise<number> {
    this.running = this.running.then(() =>
      this.deliverDue().catch((error: Error) => {
        this.logger.error(`Delivery pass failed: ${error.message}`);
        return 0;
      }),
    );
    return this.running;
  }

  /** Takes, delivers and records one row at a time, up to `BATCH`. Returns how many it handled. */
  private async deliverDue(): Promise<number> {
    let handled = 0;
    while (handled < BATCH && !this.stopping) {
      const row = await this.claimNext();
      if (!row) break;
      await this.deliver(row);
      handled++;
    }
    return handled;
  }

  /**
   * The oldest due row nobody holds, leased to this worker. `SKIP LOCKED` inside the statement keeps
   * it safe next to a replica that still locks rows in a long transaction (a rolling deploy).
   */
  private async claimNext(): Promise<DueRow | undefined> {
    const { rows } = await this.db.query<DueRow>(
      `WITH next AS (
         SELECT id FROM alert_delivery
         WHERE status = 'pending' AND next_attempt <= now()
           AND (locked_until IS NULL OR locked_until <= now())
         ORDER BY id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       ), claimed AS (
         UPDATE alert_delivery d SET locked_until = now() + make_interval(secs => $1)
         FROM next WHERE d.id = next.id
         RETURNING d.id, d.alert_id, d.event, d.attempts
       )
       SELECT c.id AS delivery_id, c.event, c.attempts, a.id AS alert_id, a.device_id, a.rule_id,
              a.metric, a.severity, a.title, a.opened_at, a.opened_value, a.cleared_at,
              a.cleared_value, a.external_ref
       FROM claimed c JOIN alert a ON a.id = c.alert_id`,
      [LEASE_MS / 1000],
    );
    return rows[0];
  }

  private async deliver(row: DueRow): Promise<void> {
    const alert = this.toAlert(row);
    let reference: string | null = null;
    try {
      if (row.event === 'opened') {
        reference = await this.sink.opened(alert);
      } else {
        // The matching `opened` row may have been delivered a moment ago, here or on another replica.
        const stored = await this.db.query<{ external_ref: string | null }>(
          'SELECT external_ref FROM alert WHERE id = $1',
          [row.alert_id],
        );
        await this.sink.cleared({ ...alert, externalRef: stored.rows[0]?.external_ref ?? null });
      }
    } catch (error) {
      if (error instanceof RetryLater) await this.waitForOpened(row, error);
      else await this.recordFailure(row, error);
      return;
    }
    await this.recordSuccess(row, reference);
  }

  /**
   * One short transaction with no network call in it. Every update checks `status = 'pending'`: if
   * the lease ran out and another worker finished the row meanwhile, this late result changes
   * nothing. If recording fails the row stays leased and is delivered again when the lease ends,
   * which is safe: `opened` carries an `Idempotency-Key` and a repeated `cleared` is a 409.
   */
  private async recordSuccess(row: DueRow, reference: string | null): Promise<void> {
    const status = this.sink.name === 'none' ? 'skipped' : 'delivered';
    try {
      const recorded = await this.db.transaction(async (client) => {
        if (reference) {
          await client.query('UPDATE alert SET external_ref = $2 WHERE id = $1', [
            row.alert_id,
            reference,
          ]);
        }
        const result = await client.query(
          `UPDATE alert_delivery SET status = $2, attempts = attempts + 1, delivered_at = now(),
             last_error = NULL, locked_until = NULL WHERE id = $1 AND status = 'pending'`,
          [row.delivery_id, status],
        );
        return (result.rowCount ?? 0) > 0;
      });
      if (recorded) this.metrics.deliveries.inc({ result: status });
    } catch (error) {
      this.logger.error(
        `Delivery ${row.delivery_id} (${row.event}) succeeded but could not be recorded, it is tried again when its lease ends: ${(error as Error).message}`,
      );
    }
  }

  /**
   * A `cleared` event has no incident to resolve yet. That is not the command center's fault, so it
   * costs no attempt: the row looks again soon. It only waits while the `opened` event of the same
   * alert is still pending; once that has been settled without an incident (failed, skipped) there
   * will never be one, and the `cleared` event is settled the same way instead of waiting for ever.
   */
  private async waitForOpened(row: DueRow, reason: RetryLater): Promise<void> {
    try {
      const { rows } = await this.db.query<{ status: string }>(
        `SELECT status FROM alert_delivery WHERE alert_id = $1 AND event = 'opened'`,
        [row.alert_id],
      );
      const opened = rows[0]?.status;
      if (opened === 'pending') {
        const result = await this.db.query(
          `UPDATE alert_delivery SET last_error = $2, next_attempt = now() + make_interval(secs => $3),
             locked_until = NULL WHERE id = $1 AND status = 'pending'`,
          [row.delivery_id, reason.message, WAITING_RETRY_MS / 1000],
        );
        if ((result.rowCount ?? 0) > 0) this.metrics.deliveries.inc({ result: 'waiting' });
        return;
      }
      const status = opened === 'skipped' ? 'skipped' : 'failed';
      const why =
        opened === 'skipped' || opened === 'failed'
          ? `opened event ${opened}: no incident to resolve`
          : `opened event is ${opened ?? 'missing'} but the alert has no incident reference`;
      const result = await this.db.query(
        `UPDATE alert_delivery SET status = $2, last_error = $3, locked_until = NULL
         WHERE id = $1 AND status = 'pending'`,
        [row.delivery_id, status, why],
      );
      if ((result.rowCount ?? 0) > 0) this.metrics.deliveries.inc({ result: status });
      this.logger.warn(`Delivery ${row.delivery_id} (cleared) settled as ${status}: ${why}`);
    } catch (error) {
      this.logger.error(
        `Delivery ${row.delivery_id} (cleared) is waiting for its opened event and could not be updated, it is tried again when its lease ends: ${(error as Error).message}`,
      );
    }
  }

  private async recordFailure(row: DueRow, error: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    try {
      const result = await this.db.query(
        `UPDATE alert_delivery SET attempts = $2, status = $3, last_error = $4,
           next_attempt = now() + make_interval(secs => $5), locked_until = NULL
         WHERE id = $1 AND status = 'pending'`,
        [
          row.delivery_id,
          attempts,
          failed ? 'failed' : 'pending',
          (error as Error).message,
          nextDelayMs(attempts) / 1000,
        ],
      );
      if ((result.rowCount ?? 0) > 0) {
        this.metrics.deliveries.inc({ result: failed ? 'failed' : 'retry' });
      }
    } catch (recordError) {
      this.logger.error(
        `Delivery ${row.delivery_id} (${row.event}) failed and the failure could not be recorded, it is tried again when its lease ends: ${(recordError as Error).message}`,
      );
    }
    this.logger.warn(
      `Delivery ${row.delivery_id} (${row.event}) attempt ${attempts}: ${(error as Error).message}`,
    );
  }

  private toAlert(row: DueRow): AlertForDelivery {
    const device = this.devices.get(row.device_id);
    return {
      id: row.alert_id,
      deviceId: row.device_id,
      deviceName: device?.name ?? row.device_id,
      zoneCode: device?.zoneCode ?? '',
      ruleId: row.rule_id,
      metric: row.metric,
      severity: row.severity,
      title: row.title,
      incidentType: this.rules.incidentType(row.rule_id) ?? 'equipment_fault',
      openedAt: row.opened_at,
      openedValue: row.opened_value,
      clearedAt: row.cleared_at,
      clearedValue: row.cleared_value,
      externalRef: row.external_ref,
    };
  }
}
