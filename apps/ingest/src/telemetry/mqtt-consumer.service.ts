import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type MetricName,
  parsePayload,
  parseTopic,
  TELEMETRY_FILTER,
  withShareGroup,
} from '@itp/telemetry-contract';
import { connect, type MqttClient } from 'mqtt';
import { hostname } from 'node:os';
import type { Env } from '../config/env.validation';
import { DevicesService } from '../devices/devices.service';
import { Metrics } from '../metrics/metrics';
import { acceptedWindow } from '../maintenance/partitions';
import { BatchWriter } from './batch-writer.service';
import type { Reading } from './rollup';
import { SequenceTracker } from './sequence-tracker';

/** Readings may be at most this far in the future (device clock skew). */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Subscribes to device telemetry through an MQTT 5 shared subscription (ADR-0001), validates each
 * message, and hands accepted readings to the batch writer. Rejections are counted by reason.
 */
@Injectable()
export class MqttConsumer implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(MqttConsumer.name);
  private readonly sequences = new SequenceTracker();
  private client?: MqttClient;
  private connected = false;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly devices: DevicesService,
    private readonly writer: BatchWriter,
    private readonly metrics: Metrics,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  async onApplicationBootstrap(): Promise<void> {
    const group = this.config.get('MQTT_SHARE_GROUP', { infer: true }) || undefined;
    const filter = withShareGroup(TELEMETRY_FILTER, group);

    this.client = connect(this.config.get('MQTT_URL', { infer: true }), {
      protocolVersion: 5,
      clientId: `ingest-${hostname()}-${process.pid}`,
      clean: true,
      reconnectPeriod: 2000,
      username: this.config.get('MQTT_USERNAME', { infer: true }),
      password: this.config.get('MQTT_PASSWORD', { infer: true }),
    });

    this.client.on('connect', () => {
      this.connected = true;
      // Subscribing on every (re)connect: with a clean session the broker forgets subscriptions.
      this.client!.subscribe(filter, { qos: 1 }, (error) => {
        if (error) this.logger.error(`Subscribe to ${filter} failed: ${error.message}`);
        else this.logger.log(`Subscribed to ${filter}`);
      });
    });
    this.client.on('close', () => (this.connected = false));
    this.client.on('error', (error) => this.logger.warn(`MQTT: ${error.message}`));
    this.client.on('message', (topic, payload) => this.handle(topic, payload));
  }

  /** Stop consuming, then drain the buffer before the database pool closes (ADR-0002). */
  async beforeApplicationShutdown(): Promise<void> {
    await this.client?.endAsync();
    this.connected = false;
    await this.writer.flush();
  }

  /** Public for tests: the whole validation path without a broker. */
  handle(topic: string, payload: Uint8Array): void {
    const reject = (reason: string) => {
      this.metrics.messages.inc({ result: 'rejected' });
      this.metrics.rejections.inc({ reason });
    };

    const route = parseTopic(topic);
    if (!route.ok) return reject(route.reason);
    const device = this.devices.get(route.value.deviceId);
    if (!device) return reject('unknown_device');
    if (device.zoneCode !== route.value.zoneCode) return reject('zone_mismatch');

    const parsed = parsePayload(payload);
    if (!parsed.ok) return reject(parsed.reason);
    const { seq, ts, metrics } = parsed.value;

    // Counted as soon as the message is attributable to a device: a message rejected below was
    // received, not lost, so it must not show up as a gap.
    const gaps = this.sequences.observe(device.id, seq);
    if (gaps > 0) this.metrics.sequenceGaps.inc(gaps);

    const time = new Date(ts);
    const now = Date.now();
    if (time.getTime() > now + MAX_CLOCK_SKEW_MS) return reject('future');
    const retention = this.config.get('RETENTION_DAYS', { infer: true });
    if (time < acceptedWindow(new Date(now), retention).from) return reject('too_old');

    const readings: Reading[] = [];
    for (const [metric, value] of Object.entries(metrics)) {
      if (!device.metrics.includes(metric as MetricName)) return reject('metric_not_registered');
      readings.push({ deviceId: device.id, metric, ts: time, value: value! });
    }

    this.metrics.messages.inc({ result: 'accepted' });
    this.writer.add(readings);
  }
}
