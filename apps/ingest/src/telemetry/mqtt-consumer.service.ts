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
import { mqttConnectOptions } from './mqtt-options';
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
  private clients: MqttClient[] = [];

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly devices: DevicesService,
    private readonly writer: BatchWriter,
    private readonly metrics: Metrics,
  ) {}

  /** Ready while at least one connection is up: the group keeps delivering to the others. */
  get isConnected(): boolean {
    return this.clients.some((client) => client.connected);
  }

  async onApplicationBootstrap(): Promise<void> {
    const group = this.config.get('MQTT_SHARE_GROUP', { infer: true }) || undefined;
    const filter = withShareGroup(TELEMETRY_FILTER, group);
    const url = this.config.get('MQTT_URL', { infer: true });
    const count = this.config.get('MQTT_CONNECTIONS', { infer: true });
    const settings = {
      MQTT_CLIENT_ID_PREFIX: this.config.get('MQTT_CLIENT_ID_PREFIX', { infer: true }),
      MQTT_USERNAME: this.config.get('MQTT_USERNAME', { infer: true }),
      MQTT_PASSWORD: this.config.get('MQTT_PASSWORD', { infer: true }),
      MQTT_CA_PEM: this.config.get('MQTT_CA_PEM', { infer: true }),
      MQTT_CERT_PEM: this.config.get('MQTT_CERT_PEM', { infer: true }),
      MQTT_KEY_PEM: this.config.get('MQTT_KEY_PEM', { infer: true }),
    };
    const instance = `${hostname()}-${process.pid}`;

    for (let index = 0; index < count; index++) {
      const client = connect(url, mqttConnectOptions(settings, index, instance));
      client.on('connect', () => {
        // Subscribing on every (re)connect: with a clean session the broker forgets subscriptions.
        client.subscribe(filter, { qos: 1 }, (error) => {
          if (error) this.logger.error(`Subscribe to ${filter} failed: ${error.message}`);
          else this.logger.log(`Connection ${index} subscribed to ${filter}`);
        });
      });
      client.on('error', (error) => this.logger.warn(`MQTT[${index}]: ${error.message}`));
      client.on('message', (topic, payload) => this.handle(topic, payload));
      this.clients.push(client);
    }
  }

  /** Stop consuming on every connection, then drain the buffer (ADR-0002). */
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.endAsync()));
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
