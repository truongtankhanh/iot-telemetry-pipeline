import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { configureApp } from '../configure-app';
import { Database } from '../database/database';
import { DevicesController } from './devices.controller';
import { DevicesService, parseDevices } from './devices.service';

/**
 * The readings endpoint through the real global pipe (`configureApp`), which the controller specs
 * bypass by building the query DTO by hand. The database is a stub: what matters here is what the
 * HTTP layer answers and whether it asks the database at all.
 */

const list = parseDevices(
  JSON.parse(readFileSync(join(__dirname, '../../config/devices.json'), 'utf8')),
);

describe('GET /api/devices/:id/readings (HTTP)', () => {
  let app: INestApplication | undefined;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ API_DOCS_ENABLED: false })],
        }),
      ],
      controllers: [DevicesController],
      providers: [
        {
          provide: DevicesService,
          useValue: { all: () => list, get: (id: string) => list.find((d) => d.id === id) },
        },
        { provide: Database, useValue: { query } },
      ],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(() => app?.close());

  const get = (path: string) => request(app!.getHttpServer()).get(path);
  const readings = (qs: string, device = 'dc-env-01') =>
    get(`/api/devices/${device}/readings?${qs}`);

  describe('the time range', () => {
    it('rejects a range that ends before it starts', async () => {
      const res = await readings(
        'metric=temperature_c&from=2026-10-17T10:00:00Z&to=2026-10-17T09:00:00Z',
      ).expect(400);

      expect(res.body.message).toBe('"from" must be earlier than "to"');
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects an empty range', async () => {
      const res = await readings(
        'metric=temperature_c&from=2026-10-17T10:00:00Z&to=2026-10-17T10:00:00Z',
      ).expect(400);

      expect(res.body.message).toBe('"from" must be earlier than "to"');
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects a "from" in the future when "to" defaults to now', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

      const res = await readings(`metric=temperature_c&from=${tomorrow}`).expect(400);

      expect(res.body.message).toBe('"from" must be earlier than "to"');
      expect(query).not.toHaveBeenCalled();
    });

    // Pinned as it is today. IMP-16.4 changes this: the pipe reads "from" with `new Date(value)`,
    // so a loose string is accepted (confirmed in the first run, before the fix: 200). It is a raw
    // request because `from=1` is the year 2001, a range the 1m resolution refuses.
    it('accepts a loose "from" such as 1', async () => {
      await readings('metric=temperature_c&resolution=raw&from=1&to=2026-10-17T10:00:00Z').expect(
        200,
      );

      expect(query).toHaveBeenCalledTimes(1);
    });

    it('refuses a 1m range of more than 7 days, naming the limit, without querying', async () => {
      const res = await readings('metric=temperature_c&from=2020-01-01T00:00:00Z').expect(400);

      expect(res.body.message).toContain('at most 10080 minutes');
      expect(query).not.toHaveBeenCalled();
    });

    it('accepts a 1m range of exactly 7 days', async () => {
      await readings(
        'metric=temperature_c&from=2026-10-10T00:00:00Z&to=2026-10-17T00:00:00Z',
      ).expect(200);

      expect(query).toHaveBeenCalledTimes(1);
    });

    it('does not limit the range of raw readings', async () => {
      await readings('metric=temperature_c&resolution=raw&from=2020-01-01T00:00:00Z').expect(200);

      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe('truncated raw readings', () => {
    const raw =
      'metric=temperature_c&resolution=raw&from=2026-10-17T00:00:00Z&to=2026-10-18T00:00:00Z';
    const rows = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ts: new Date(Date.UTC(2026, 9, 17) + i * 1000),
        value: i,
      }));

    it('says so, and where to continue, when more than 5 000 readings match', async () => {
      const all = rows(5001);
      query.mockResolvedValue({ rows: all });

      const res = await readings(raw).expect(200);

      expect(res.body.points).toHaveLength(5000);
      expect(res.body.truncated).toBe(true);
      expect(res.body.nextFrom).toBe(all[5000]!.ts.toISOString());
    });

    it('says it is complete when everything fit', async () => {
      query.mockResolvedValue({ rows: rows(3) });

      const res = await readings(raw).expect(200);

      expect(res.body.points).toHaveLength(3);
      expect(res.body.truncated).toBe(false);
      expect(res.body.nextFrom).toBeNull();
    });
  });

  describe('the metric', () => {
    // Before IMP-16.1 this was a 404 from the handler; the pipe now refuses it, and its message
    // is an array of strings (the range check and the 404s answer a string).
    it('answers 400 for a name that is no metric, listing the allowed ones', async () => {
      const res = await readings('metric=foo').expect(400);

      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.join(' ')).toContain('must be one of the following values');
      expect(res.body.message.join(' ')).toContain('temperature_c');
      expect(query).not.toHaveBeenCalled();
    });

    it('answers 400 for a repeated metric', async () => {
      const res = await readings('metric=temperature_c&metric=humidity_pct').expect(400);

      expect(Array.isArray(res.body.message)).toBe(true);
      expect(query).not.toHaveBeenCalled();
    });

    it('answers 404 for a metric the device does not report', async () => {
      const res = await readings('metric=co2_ppm').expect(404);

      expect(res.body.message).toBe('Device dc-env-01 does not report co2_ppm');
      expect(query).not.toHaveBeenCalled();
    });

    it('answers 400 when the metric is missing', async () => {
      const res = await readings('resolution=raw').expect(400);

      expect(Array.isArray(res.body.message)).toBe(true);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('the device', () => {
    it('answers 404 for a device that is not registered', async () => {
      await readings('metric=temperature_c', 'ghost-01').expect(404);

      expect(query).not.toHaveBeenCalled();
    });

    // The pipe runs before the handler, so a malformed query beats an unknown device.
    it('answers 400, not 404, for a malformed query on a device that is not registered', async () => {
      await readings('metric=foo', 'ghost-01').expect(400);

      expect(query).not.toHaveBeenCalled();
    });

    it('answers 404, not 400, for a reversed range on a device that is not registered', async () => {
      await readings(
        'metric=temperature_c&from=2026-10-17T10:00:00Z&to=2026-10-17T09:00:00Z',
        'ghost-01',
      ).expect(404);

      expect(query).not.toHaveBeenCalled();
    });

    it('answers a valid request from the database', async () => {
      const res = await readings(
        'metric=temperature_c&from=2026-10-17T09:00:00Z&to=2026-10-17T10:00:00Z',
      ).expect(200);

      expect(res.body).toMatchObject({ deviceId: 'dc-env-01', resolution: '1m', points: [] });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
