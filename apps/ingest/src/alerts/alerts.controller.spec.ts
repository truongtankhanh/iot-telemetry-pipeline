import type { Database } from '../database/database';
import { AlertsController, AlertsQueryDto } from './alerts.controller';

function setup(rows: unknown[] = []) {
  const query = jest.fn().mockResolvedValue({ rows });
  const controller = new AlertsController({ query } as unknown as Database);
  const sent = () => {
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    return { sql, params };
  };
  return { controller, sent };
}

const dto = (values: Partial<AlertsQueryDto> = {}) => Object.assign(new AlertsQueryDto(), values);

describe('AlertsController.list', () => {
  it.each([
    [undefined, null],
    ['open', 'open'],
    ['cleared', 'cleared'],
  ] as const)('with status %s passes %s as the only parameter', async (status, expected) => {
    const { controller, sent } = setup();

    await controller.list(dto({ status }));

    expect(sent().params).toEqual([expected]);
  });

  it('returns the rows as the database gave them', async () => {
    const rows = [
      { id: '2', deviceId: 'dc-env-01', status: 'open', deliveryStatus: 'pending' },
      { id: '1', deviceId: 'dc-env-01', status: 'cleared', deliveryStatus: 'delivered' },
    ];
    const { controller } = setup(rows);

    await expect(controller.list(dto())).resolves.toBe(rows);
  });

  it('reads the latest outbox row of each alert, newest alert first, capped at 200', async () => {
    const { controller, sent } = setup();

    await controller.list(dto());

    const { sql } = sent();
    expect(sql).toContain('FROM alert a');
    expect(sql).toContain('FROM alert_delivery');
    expect(sql).toContain('ORDER BY a.opened_at DESC');
    // IMP-16 changes this: today the list is a fixed 200 rows with no way to page.
    expect(sql).toContain('LIMIT 200');
  });
});
