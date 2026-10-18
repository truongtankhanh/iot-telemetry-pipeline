import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { MetricName } from '@itp/telemetry-contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '../database/database';
import { DevicesController, ReadingsQueryDto } from './devices.controller';
import { parseDevices, type DevicesService } from './devices.service';

const NOW = new Date('2026-10-17T10:00:00Z');
const HOUR = 3_600_000;

function setup(rows: unknown[] = []) {
  const list = parseDevices(
    JSON.parse(readFileSync(join(__dirname, '../../config/devices.json'), 'utf8')),
  );
  const devices = {
    all: () => list,
    get: (id: string) => list.find((d) => d.id === id),
  } as unknown as DevicesService;
  const query = jest.fn().mockResolvedValue({ rows });
  const controller = new DevicesController(devices, { query } as unknown as Database);
  /** The statement and parameters of the one query the controller sent. */
  const sent = () => {
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    return { sql, params };
  };
  return { controller, query, sent, count: list.length };
}

/** A query as the validation pipe leaves it: the class defaults are applied by constructing it. */
const dto = (values: Partial<ReadingsQueryDto> & { metric: MetricName }) =>
  Object.assign(new ReadingsQueryDto(), values);

describe('DevicesController.list', () => {
  it('adds when each device was last heard from, and null for a device with no row', async () => {
    const seen = new Date('2026-10-17T09:59:00Z');
    const { controller, count } = setup([{ id: 'dc-env-01', last_seen: seen }]);

    const result = await controller.list();

    expect(result).toHaveLength(count);
    expect(result.find((d) => d.id === 'dc-env-01')).toMatchObject({
      kind: 'server_room',
      zoneCode: 'BLD-DC',
      lastSeen: seen,
    });
    expect(result.filter((d) => d.lastSeen === null)).toHaveLength(count - 1);
  });
});

describe('DevicesController.readings', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('answers 404 for a device that is not registered, without querying', async () => {
    const { controller, query } = setup();

    await expect(controller.readings('ghost-01', dto({ metric: 'temperature_c' }))).rejects.toThrow(
      NotFoundException,
    );

    expect(query).not.toHaveBeenCalled();
  });

  it('answers 404 for a metric the device does not report, without querying', async () => {
    const { controller, query } = setup();

    await expect(controller.readings('dc-env-01', dto({ metric: 'co2_ppm' }))).rejects.toThrow(
      NotFoundException,
    );

    expect(query).not.toHaveBeenCalled();
  });

  it('defaults to the last hour ending now', async () => {
    const { controller, sent } = setup();

    const result = await controller.readings('dc-env-01', dto({ metric: 'temperature_c' }));

    const { params } = sent();
    expect(params.slice(2)).toEqual([new Date(NOW.getTime() - HOUR), NOW]);
    expect(result).toMatchObject({ from: new Date(NOW.getTime() - HOUR), to: NOW });
  });

  it('defaults to per-minute summaries from the rollup table', async () => {
    const points = [{ bucket: new Date(NOW), count: 3, avg: 28, min: 27, max: 29 }];
    const { controller, sent } = setup(points);

    const result = await controller.readings('dc-env-01', dto({ metric: 'temperature_c' }));

    const { sql, params } = sent();
    expect(sql).toContain('FROM rollup_1m');
    expect(params).toHaveLength(4); // [id, metric, from, to]
    expect(params.slice(0, 2)).toEqual(['dc-env-01', 'temperature_c']);
    expect(result).toMatchObject({
      deviceId: 'dc-env-01',
      metric: 'temperature_c',
      resolution: '1m',
      points,
    });
  });

  it('reads raw readings with a cap on the number of points', async () => {
    const points = [{ ts: new Date(NOW), value: 28.1 }];
    const { controller, sent } = setup(points);

    const result = await controller.readings(
      'dc-env-01',
      dto({ metric: 'temperature_c', resolution: 'raw' }),
    );

    const { sql, params } = sent();
    expect(sql).toContain('FROM reading');
    expect(sql).not.toContain('rollup_1m');
    // IMP-16 changes this: today the cap is 5 000 points and the response does not say it applied.
    expect(params).toHaveLength(5);
    expect(params[4]).toBe(5000);
    expect(result).toMatchObject({ resolution: 'raw', points });
  });

  it('uses the range it is given, in the order id, metric, from, to', async () => {
    const from = new Date('2026-10-17T08:00:00Z');
    const to = new Date('2026-10-17T09:00:00Z');
    const { controller, sent } = setup();

    const result = await controller.readings(
      'dc-env-01',
      dto({ metric: 'humidity_pct', from, to }),
    );

    expect(sent().params).toEqual(['dc-env-01', 'humidity_pct', from, to]);
    expect(result).toMatchObject({ from, to });
  });

  it.each([
    ['ends before it starts', '2026-10-17T09:00:00Z', '2026-10-17T08:00:00Z'],
    ['is empty', '2026-10-17T09:00:00Z', '2026-10-17T09:00:00Z'],
  ])('refuses a range that %s, without querying', async (_name, fromText, toText) => {
    const { controller, query } = setup();
    const range = { from: new Date(fromText), to: new Date(toText) };

    const rejection = controller.readings('dc-env-01', dto({ metric: 'temperature_c', ...range }));

    await expect(rejection).rejects.toThrow(BadRequestException);
    await expect(rejection).rejects.toThrow('"from" must be earlier than "to"');
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a "from" in the future when "to" defaults to now, without querying', async () => {
    const { controller, query } = setup();
    const from = new Date(NOW.getTime() + HOUR);

    await expect(
      controller.readings('dc-env-01', dto({ metric: 'temperature_c', from })),
    ).rejects.toThrow(BadRequestException);

    expect(query).not.toHaveBeenCalled();
  });
});
