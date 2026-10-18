import type { ConfigService } from '@nestjs/config';
import type { Counter } from 'prom-client';
import type { Env } from '../config/env.validation';
import type { Device, DevicesService } from '../devices/devices.service';
import { Metrics } from '../metrics/metrics';
import type { BatchWriter } from './batch-writer.service';
import { MqttConsumer } from './mqtt-consumer.service';

const NOW = new Date('2026-10-17T10:00:00.000Z');
const MINUTE = 60_000;

const DEVICE: Device = {
  id: 'lha-air-01',
  kind: 'indoor_air',
  zoneCode: 'BLD-LHA',
  name: 'Lecture Hall A',
  metrics: ['co2_ppm', 'temperature_c'],
};
const TOPIC = `campus/${DEVICE.zoneCode}/${DEVICE.id}/telemetry`;

/**
 * A real `MqttConsumer` over fakes of the registry and the writer: `handle` is the whole validation
 * path without a broker. The clock is faked, so the accepted window is a function of a date the test
 * chooses. The registry knows one device; the writer only records what it is given.
 */
function setup(retentionDays = 30) {
  const settings: Partial<Record<keyof Env, number>> = { RETENTION_DAYS: retentionDays };
  const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;
  const devices = {
    get: (id: string) => (id === DEVICE.id ? DEVICE : undefined),
  } as unknown as DevicesService;
  const writer = { observe: jest.fn(), add: jest.fn() };
  const metrics = new Metrics();
  const consumer = new MqttConsumer(config, devices, writer as unknown as BatchWriter, metrics);

  const count = async (counter: Counter, labels: Record<string, string>) => {
    const { values } = await counter.get();
    const match = values.find((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x));
    return match?.value ?? 0;
  };
  return {
    consumer,
    writer,
    accepted: () => count(metrics.messages, { result: 'accepted' }),
    rejected: () => count(metrics.messages, { result: 'rejected' }),
    rejectedFor: (reason: string) => count(metrics.rejections, { reason }),
  };
}

const payload = (
  ts: string | Date,
  metrics: Record<string, number> = { co2_ppm: 800, temperature_c: 22.5 },
  seq = 7,
) =>
  Buffer.from(
    JSON.stringify({ seq, ts: ts instanceof Date ? ts.toISOString() : ts, metrics }),
  ) as Uint8Array;

const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('MqttConsumer.handle', () => {
  it('buffers one reading per metric and records the sequence number', async () => {
    const { consumer, writer, accepted, rejected } = setup();
    const ts = at(-1000);

    consumer.handle(TOPIC, payload(ts, { co2_ppm: 800, temperature_c: 22.5 }, 41));

    expect(writer.add).toHaveBeenCalledTimes(1);
    expect(writer.add).toHaveBeenCalledWith([
      { deviceId: DEVICE.id, metric: 'co2_ppm', ts, value: 800 },
      { deviceId: DEVICE.id, metric: 'temperature_c', ts, value: 22.5 },
    ]);
    expect(writer.observe).toHaveBeenCalledTimes(1);
    expect(writer.observe).toHaveBeenCalledWith(DEVICE.id, 41, ts.getTime());
    expect(await accepted()).toBe(1);
    expect(await rejected()).toBe(0);
  });

  describe('before the payload is read', () => {
    // The payload is garbage in every case: the verdict must come from the topic and the registry.
    const garbage = Buffer.from('not json') as Uint8Array;

    it.each([
      ['bad topic', 'campus/telemetry', 'topic'],
      ['unknown device', 'campus/BLD-LHA/ghost-01/telemetry', 'unknown_device'],
      ['zone mismatch', `campus/BLD-DC/${DEVICE.id}/telemetry`, 'zone_mismatch'],
    ])('rejects a %s and does not record a sequence number', async (_name, topic, reason) => {
      const { consumer, writer, accepted, rejected, rejectedFor } = setup();

      consumer.handle(topic, garbage);

      expect(await rejected()).toBe(1);
      expect(await rejectedFor(reason)).toBe(1);
      expect(await accepted()).toBe(0);
      expect(writer.observe).not.toHaveBeenCalled();
      expect(writer.add).not.toHaveBeenCalled();
    });
  });

  describe('a payload the contract refuses', () => {
    it.each([
      ['is not JSON', Buffer.from('not json') as Uint8Array, 'json'],
      ['has a ts without a zone', payload('2026-10-17T10:00:00'), 'ts'],
      ['has a value out of range', payload(at(0), { co2_ppm: 99_999 }), 'range'],
      ['names a metric the contract does not have', payload(at(0), { constructor: 1 }), 'metric'],
    ])('rejects a message that %s, with the contract reason', async (_name, body, reason) => {
      const { consumer, writer, rejected, rejectedFor } = setup();

      consumer.handle(TOPIC, body);

      expect(await rejected()).toBe(1);
      expect(await rejectedFor(reason)).toBe(1);
      expect(writer.observe).not.toHaveBeenCalled();
      expect(writer.add).not.toHaveBeenCalled();
    });
  });

  describe('a message that was received but is not stored', () => {
    // Received, not lost: its sequence number is recorded, or the ledger would count a gap (V1-T01).
    it('rejects a reading more than five minutes ahead, and records its sequence number', async () => {
      const { consumer, writer, rejectedFor } = setup();
      const ts = at(5 * MINUTE + 1);

      consumer.handle(TOPIC, payload(ts, undefined, 12));

      expect(await rejectedFor('future')).toBe(1);
      expect(writer.observe).toHaveBeenCalledTimes(1);
      expect(writer.observe).toHaveBeenCalledWith(DEVICE.id, 12, ts.getTime());
      expect(writer.add).not.toHaveBeenCalled();
    });

    it('accepts a reading exactly five minutes ahead', async () => {
      const { consumer, writer, accepted } = setup();

      consumer.handle(TOPIC, payload(at(5 * MINUTE)));

      expect(await accepted()).toBe(1);
      expect(writer.add).toHaveBeenCalledTimes(1);
    });

    it('rejects a reading older than the accepted window, and records its sequence number', async () => {
      const { consumer, writer, rejectedFor } = setup(30);
      const ts = new Date('2026-10-14T23:59:59.999Z'); // 1 ms before the window opens

      consumer.handle(TOPIC, payload(ts, undefined, 13));

      expect(await rejectedFor('too_old')).toBe(1);
      expect(writer.observe).toHaveBeenCalledTimes(1);
      expect(writer.observe).toHaveBeenCalledWith(DEVICE.id, 13, ts.getTime());
      expect(writer.add).not.toHaveBeenCalled();
    });

    it('rejects a metric the device does not report, whatever came before it in the message', async () => {
      const { consumer, writer, rejectedFor, accepted } = setup();

      // `co2_ppm` is fine; `humidity_pct` is a contract metric but not one of this device's.
      consumer.handle(TOPIC, payload(at(0), { co2_ppm: 800, humidity_pct: 40 }, 14));

      expect(await rejectedFor('metric_not_registered')).toBe(1);
      expect(await accepted()).toBe(0);
      expect(writer.observe).toHaveBeenCalledTimes(1);
      expect(writer.observe).toHaveBeenCalledWith(DEVICE.id, 14, at(0).getTime());
      expect(writer.add).not.toHaveBeenCalled();
    });
  });

  describe('the accepted window (ADR-0003)', () => {
    // At 2026-10-17T10:00Z the window opens at the start of a UTC day: two days back, or fewer when
    // retention is shorter, so a write never targets a partition that does not exist.
    it.each([
      [30, '2026-10-15T00:00:00.000Z', '2026-10-14T23:59:59.999Z'],
      [2, '2026-10-16T00:00:00.000Z', '2026-10-15T23:59:59.999Z'],
      [1, '2026-10-17T00:00:00.000Z', '2026-10-16T23:59:59.999Z'],
    ])(
      'with %i days of retention accepts %s and rejects %s',
      async (retention, firstAccepted, lastRejected) => {
        const { consumer, writer, accepted, rejectedFor } = setup(retention);

        consumer.handle(TOPIC, payload(firstAccepted));
        expect(await accepted()).toBe(1);
        expect(writer.add).toHaveBeenCalledTimes(1);

        consumer.handle(TOPIC, payload(lastRejected));
        expect(await rejectedFor('too_old')).toBe(1);
        expect(await accepted()).toBe(1);
        expect(writer.add).toHaveBeenCalledTimes(1);
      },
    );

    it('moves with the clock: a timestamp accepted before UTC midnight is too old after it', async () => {
      const { consumer, writer, accepted, rejectedFor } = setup(30);
      const ts = '2026-10-15T12:00:00.000Z';

      jest.setSystemTime(new Date('2026-10-17T23:59:59.000Z'));
      consumer.handle(TOPIC, payload(ts));
      expect(await accepted()).toBe(1);
      expect(await rejectedFor('too_old')).toBe(0);

      jest.setSystemTime(new Date('2026-10-18T00:00:01.000Z'));
      consumer.handle(TOPIC, payload(ts));
      expect(await rejectedFor('too_old')).toBe(1);
      expect(await accepted()).toBe(1);
      expect(writer.add).toHaveBeenCalledTimes(1);
    });
  });
});
