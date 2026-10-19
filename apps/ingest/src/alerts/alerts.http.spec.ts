import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../configure-app';
import { Database } from '../database/database';
import { AlertsController } from './alerts.controller';
import { decodeCursor, encodeCursor } from './cursor';

/**
 * The alerts endpoint through the real global pipe (`configureApp`), which the controller spec
 * bypasses by building the query DTO by hand. The database is a stub: what matters is what the HTTP
 * layer answers, which header it sets, and whether it asks the database at all.
 */

const NEWEST = new Date('2026-10-17T10:00:00.000Z').getTime();

/** `count` alerts, newest first, one minute apart, with ids counting down. */
const alertRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: String(count - i),
    deviceId: 'dc-env-01',
    openedAt: new Date(NEWEST - i * 60_000),
    status: 'open',
  }));

describe('GET /api/alerts (HTTP)', () => {
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
      controllers: [AlertsController],
      providers: [{ provide: Database, useValue: { query } }],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(() => app?.close());

  const alerts = (qs = '') => request(app!.getHttpServer()).get(`/api/alerts?${qs}`);

  describe('the limit', () => {
    it.each(['0', '201', 'abc', '1.5', '', '-1'])(
      'refuses limit=%s from the pipe',
      async (limit) => {
        const res = await alerts(`limit=${limit}`).expect(400);

        expect(Array.isArray(res.body.message)).toBe(true);
        expect(query).not.toHaveBeenCalled();
      },
    );

    it('refuses a repeated limit', async () => {
      await alerts('limit=1&limit=2').expect(400);

      expect(query).not.toHaveBeenCalled();
    });

    it('accepts the largest limit', async () => {
      await alerts('limit=200').expect(200);

      expect(query.mock.calls[0]![1]).toEqual([null, null, null, 201]);
    });
  });

  describe('the status and the cursor', () => {
    it('refuses a status that is neither open nor cleared', async () => {
      await alerts('status=bogus').expect(400);

      expect(query).not.toHaveBeenCalled();
    });

    it('refuses a "before" that is not a cursor, with a message that is a string', async () => {
      const res = await alerts('before=not-a-cursor').expect(400);

      expect(res.body.message).toBe('"before" is not a cursor returned by this API');
      expect(query).not.toHaveBeenCalled();
    });

    it('refuses a "before" of more than 200 characters from the pipe', async () => {
      const res = await alerts(`before=${'a'.repeat(201)}`).expect(400);

      expect(Array.isArray(res.body.message)).toBe(true);
      expect(query).not.toHaveBeenCalled();
    });

    it('continues after a cursor it made', async () => {
      const before = encodeCursor({ openedAt: new Date(NEWEST), id: '7' });

      await alerts(`status=cleared&before=${before}`).expect(200);

      expect(query.mock.calls[0]![1]).toEqual(['cleared', new Date(NEWEST), '7', 201]);
    });
  });

  describe('the page', () => {
    it('answers an array and asks for one row more than the default limit', async () => {
      const rows = alertRows(3);
      query.mockResolvedValue({ rows });

      const res = await alerts().expect(200);

      expect(res.body.map((a: { id: string }) => a.id)).toEqual(['3', '2', '1']);
      expect(res.headers['x-next-cursor']).toBeUndefined();
      expect(query.mock.calls[0]![1]).toEqual([null, null, null, 201]);
    });

    it('returns 200 alerts and a header pointing at the last of them when there are more', async () => {
      const rows = alertRows(201);
      query.mockResolvedValue({ rows });

      const res = await alerts().expect(200);

      expect(res.body).toHaveLength(200);
      const cursor = decodeCursor(res.headers['x-next-cursor'] as string);
      expect(cursor.id).toBe(res.body[199].id);
      expect(cursor.openedAt.toISOString()).toBe(res.body[199].openedAt);
    });
  });
});
