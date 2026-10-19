import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import type { Database } from '../database/database';
import { AlertsController, AlertsQueryDto } from './alerts.controller';
import { decodeCursor, encodeCursor } from './cursor';

const NEWEST = new Date('2026-10-17T10:00:00.000Z').getTime();

function setup(rows: unknown[] = []) {
  const query = jest.fn().mockResolvedValue({ rows });
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  const controller = new AlertsController({ query } as unknown as Database);
  const sent = () => {
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    return { sql, params };
  };
  return { controller, query, sent, res, setHeader };
}

const dto = (values: Partial<AlertsQueryDto> = {}) => Object.assign(new AlertsQueryDto(), values);

/** `count` alerts, newest first, one minute apart, with ids counting down: as the query returns them. */
const alertRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: String(count - i),
    deviceId: 'dc-env-01',
    openedAt: new Date(NEWEST - i * 60_000),
    status: 'open',
  }));

/** The `(openedAt, id)` the cursor in the `X-Next-Cursor` header carries. */
const headerCursor = (setHeader: jest.Mock) => {
  expect(setHeader).toHaveBeenCalledTimes(1);
  const [name, value] = setHeader.mock.calls[0] as [string, string];
  expect(name).toBe('X-Next-Cursor');
  return decodeCursor(value);
};

describe('AlertsController.list', () => {
  it.each([
    [undefined, null],
    ['open', 'open'],
    ['cleared', 'cleared'],
  ] as const)(
    'with status %s passes %s, no cursor and one row more than the default limit',
    async (status, expected) => {
      const { controller, sent, res } = setup();

      await controller.list(dto({ status }), res);

      expect(sent().params).toEqual([expected, null, null, 201]);
    },
  );

  it('asks for one row more than the limit, to know whether another page exists', async () => {
    const { controller, sent, res } = setup();

    await controller.list(dto({ limit: 50 }), res);

    expect(sent().params[3]).toBe(51);
  });

  it('returns the rows as the database gave them when they fit, without a cursor', async () => {
    const rows = alertRows(3);
    const { controller, res, setHeader } = setup(rows);

    await expect(controller.list(dto(), res)).resolves.toEqual(rows);

    expect(setHeader).not.toHaveBeenCalled();
  });

  it('returns 200 and points at the next page when the database had one more', async () => {
    const rows = alertRows(201);
    const { controller, res, setHeader } = setup(rows);

    const result = await controller.list(dto(), res);

    expect(result).toHaveLength(200);
    expect(result).not.toContainEqual(rows[200]);
    expect(headerCursor(setHeader)).toEqual({ openedAt: rows[199]!.openedAt, id: rows[199]!.id });
  });

  it('sets no cursor for exactly as many rows as the limit', async () => {
    const { controller, res, setHeader } = setup(alertRows(200));

    await expect(controller.list(dto(), res)).resolves.toHaveLength(200);

    expect(setHeader).not.toHaveBeenCalled();
  });

  it('points at the last row returned, not the one left out', async () => {
    const rows = alertRows(3);
    const { controller, res, setHeader } = setup(rows);

    const result = await controller.list(dto({ limit: 2 }), res);

    expect(result).toEqual(rows.slice(0, 2));
    expect(headerCursor(setHeader)).toEqual({ openedAt: rows[1]!.openedAt, id: rows[1]!.id });
  });

  it('carries the id in the cursor, so alerts opened at the same instant are not skipped', async () => {
    const openedAt = new Date('2026-10-17T10:00:03.000Z');
    const rows = [
      { id: '9', openedAt },
      { id: '8', openedAt },
    ];
    const { controller, res, setHeader } = setup(rows);

    await controller.list(dto({ limit: 1 }), res);

    expect(headerCursor(setHeader)).toEqual({ openedAt, id: '9' });
  });

  it('continues after the cursor it is given, with the status filter kept', async () => {
    const openedAt = new Date('2026-10-17T09:00:00.000Z');
    const before = encodeCursor({ openedAt, id: '42' });
    const { controller, sent, res } = setup();

    await controller.list(dto({ status: 'open', before }), res);

    expect(sent().params).toEqual(['open', openedAt, '42', 201]);
  });

  it('refuses a "before" that is not a cursor, without querying', async () => {
    const { controller, query, res } = setup();

    await expect(controller.list(dto({ before: 'not-a-cursor' }), res)).rejects.toThrow(
      BadRequestException,
    );

    expect(query).not.toHaveBeenCalled();
  });

  it('reads the latest outbox row of each alert, newest alert first, ties broken by id', async () => {
    const { controller, sent, res } = setup();

    await controller.list(dto(), res);

    const { sql } = sent();
    expect(sql).toContain('FROM alert a');
    expect(sql).toContain('FROM alert_delivery');
    expect(sql).toContain('ORDER BY a.opened_at DESC, a.id DESC');
    expect(sql).toContain('(a.opened_at, a.id) <');
    expect(sql).toContain('LIMIT $4');
    expect(sql).not.toContain('LIMIT 200');
  });
});
