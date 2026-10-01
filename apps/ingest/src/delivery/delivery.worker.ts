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
 * Drains the `alert_delivery` outbox (ADR-0005). Rows are claimed with SKIP LOCKED, so any number
 * of replicas can run this worker without delivering the same row twice.
 */
@Injectable()
export class DeliveryWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(DeliveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<number> = Promise.resolve(0);

  constructor(
    private readonly db: Database,
    private readonly devices: DevicesService,
    private readonly rules: RulesService,
    private readonly metrics: Metrics,
    private readonly config: ConfigService<Env, true>,
    @Inject(ALERT_SINK) private readonly sink: AlertSink,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log(`Alert sink: ${this.sink.name}`);
    const interval = this.config.get('DELIVERY_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.tick(), interval);
  }

  async beforeApplicationShutdown(): Promise<void> {
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

  private deliverDue(): Promise<number> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<DueRow>(
        `SELECT d.id AS delivery_id, d.event, d.attempts, a.id AS alert_id, a.device_id, a.rule_id,
                a.metric, a.severity, a.title, a.opened_at, a.opened_value, a.cleared_at,
                a.cleared_value, a.external_ref
         FROM alert_delivery d JOIN alert a ON a.id = d.alert_id
         WHERE d.status = 'pending' AND d.next_attempt <= now()
         ORDER BY d.id
         LIMIT $1
         FOR UPDATE OF d SKIP LOCKED`,
        [BATCH],
      );

      for (const row of rows) {
        const alert = this.toAlert(row);
        try {
          if (row.event === 'opened') {
            const ref = await this.sink.opened(alert);
            if (ref)
              await client.query('UPDATE alert SET external_ref = $2 WHERE id = $1', [
                row.alert_id,
                ref,
              ]);
          } else {
            // The matching `opened` row may have been delivered earlier in this same pass.
            const ref = await client.query<{ external_ref: string | null }>(
              'SELECT external_ref FROM alert WHERE id = $1',
              [row.alert_id],
            );
            await this.sink.cleared({ ...alert, externalRef: ref.rows[0]?.external_ref ?? null });
          }
          const status = this.sink.name === 'none' ? 'skipped' : 'delivered';
          await client.query(
            `UPDATE alert_delivery SET status = $2, attempts = attempts + 1, delivered_at = now(),
               last_error = NULL WHERE id = $1`,
            [row.delivery_id, status],
          );
          this.metrics.deliveries.inc({ result: status });
        } catch (error) {
          const attempts = row.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          await client.query(
            `UPDATE alert_delivery SET attempts = $2, status = $3, last_error = $4,
               next_attempt = now() + make_interval(secs => $5) WHERE id = $1`,
            [
              row.delivery_id,
              attempts,
              failed ? 'failed' : 'pending',
              (error as Error).message,
              nextDelayMs(attempts) / 1000,
            ],
          );
          this.metrics.deliveries.inc({ result: failed ? 'failed' : 'retry' });
          if (!(error instanceof RetryLater)) {
            this.logger.warn(
              `Delivery ${row.delivery_id} (${row.event}) attempt ${attempts}: ${(error as Error).message}`,
            );
          }
        }
      }
      return rows.length;
    });
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
