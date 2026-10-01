import { Injectable } from '@nestjs/common';
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics. Label values are small fixed sets (results, reasons, transitions) — never
 * device ids — so cardinality stays bounded as the fleet grows.
 */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly messages = new Counter({
    name: 'telemetry_messages_total',
    help: 'MQTT messages received, by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly rejections = new Counter({
    name: 'telemetry_rejections_total',
    help: 'Messages rejected before storage, by reason',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  readonly readings = new Counter({
    name: 'telemetry_readings_total',
    help: 'Readings written, by result (stored or duplicate)',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly sequenceGaps = new Counter({
    name: 'telemetry_sequence_gaps_total',
    help: 'Messages missing according to per-device sequence numbers (approximate across replicas)',
    registers: [this.registry],
  });

  readonly batchSize = new Histogram({
    name: 'telemetry_batch_size',
    help: 'Readings per database flush',
    buckets: [1, 10, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [this.registry],
  });

  readonly flushSeconds = new Histogram({
    name: 'telemetry_flush_duration_seconds',
    help: 'Time to write one batch, including rollups',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  readonly lagSeconds = new Histogram({
    name: 'telemetry_ingest_lag_seconds',
    help: 'Time from measurement to storage',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60],
    registers: [this.registry],
  });

  readonly buffered = new Gauge({
    name: 'telemetry_buffered_readings',
    help: 'Readings waiting for the next flush',
    registers: [this.registry],
  });

  readonly alertTransitions = new Counter({
    name: 'alerts_transitions_total',
    help: 'Alerts opened or cleared',
    labelNames: ['transition'] as const,
    registers: [this.registry],
  });

  readonly deliveries = new Counter({
    name: 'alert_deliveries_total',
    help: 'Outbox delivery attempts, by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
