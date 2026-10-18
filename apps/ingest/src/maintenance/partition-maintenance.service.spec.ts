import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import type { Env } from '../config/env.validation';
import type { Database } from '../database/database';
import { PartitionMaintenance } from './partition-maintenance.service';

const NOW = new Date('2026-10-17T10:00:00Z');
const HOUR = 3_600_000;

/** Just enough of PostgreSQL for the job: the partition listing, and the statements it records. */
class FakeDatabase {
  /** Child tables of `reading`, as `pg_inherits` would list them. */
  existing: string[] = [];
  /** While set, every transaction throws it. */
  failure?: Error;
  transactions = 0;
  readonly statements: { sql: string; params: unknown[] }[] = [];

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.transactions++;
    if (this.failure) throw this.failure;
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        this.statements.push({ sql, params });
        if (sql.includes('FROM pg_inherits'))
          return { rows: this.existing.map((name) => ({ name })) };
        return { rows: [] };
      },
    } as unknown as PoolClient;
    return work(client);
  }

  /** Statements that start with `prefix`, in the order they were sent. */
  sent(prefix: string) {
    return this.statements.filter((s) => s.sql.trimStart().startsWith(prefix));
  }
}

function setup(retentionDays = 30) {
  const db = new FakeDatabase();
  const config = {
    get: (key: keyof Env) => (key === 'RETENTION_DAYS' ? retentionDays : undefined),
  } as unknown as ConfigService<Env, true>;
  const service = new PartitionMaintenance(db as unknown as Database, config);
  return { db, service };
}

describe('PartitionMaintenance', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('run', () => {
    it('exempts itself from the statement timeout and takes the advisory lock before anything else', async () => {
      const { db, service } = setup();

      await service.run(NOW);

      // The lock can wait for another replica, and DROP TABLE for readers: neither may be cancelled.
      expect(db.statements[0]).toEqual({ sql: 'SET LOCAL statement_timeout = 0', params: [] });
      expect(db.statements[1]).toEqual({
        sql: 'SELECT pg_advisory_xact_lock($1)',
        params: [4_242_002],
      });
    });

    it('creates the partitions from two days back to two days ahead, with their bounds', async () => {
      const { db, service } = setup();

      const result = await service.run(NOW);

      expect(result.created).toEqual([
        'reading_20261015',
        'reading_20261016',
        'reading_20261017',
        'reading_20261018',
        'reading_20261019',
      ]);
      const creates = db.sent('CREATE TABLE');
      expect(creates).toHaveLength(5);
      expect(creates[0]!.sql).toContain('CREATE TABLE reading_20261015 PARTITION OF reading');
      expect(creates[0]!.sql).toContain(
        `FROM ('2026-10-15T00:00:00.000Z') TO ('2026-10-16T00:00:00.000Z')`,
      );
      expect(creates[4]!.sql).toContain(
        `FROM ('2026-10-19T00:00:00.000Z') TO ('2026-10-20T00:00:00.000Z')`,
      );
    });

    it('does not create a partition that already exists', async () => {
      const { db, service } = setup();
      db.existing = ['reading_20261015', 'reading_20261016', 'reading_20261017'];

      const result = await service.run(NOW);

      expect(result.created).toEqual(['reading_20261018', 'reading_20261019']);
      expect(db.sent('CREATE TABLE')).toHaveLength(2);
    });

    it('drops partitions past retention, and never a table whose name is not reading_YYYYMMDD', async () => {
      const { db, service } = setup(30);
      // Retention 30 days from 2026-10-17: 20260917 is the oldest day kept.
      db.existing = [
        'reading_20250101',
        'reading_20260916',
        'reading_20260917',
        'reading_default',
        'reading_2026091',
      ];

      const result = await service.run(NOW);

      expect(result.dropped).toEqual(['reading_20250101', 'reading_20260916']);
      expect(db.sent('DROP TABLE').map((s) => s.sql)).toEqual([
        'DROP TABLE reading_20250101',
        'DROP TABLE reading_20260916',
      ]);
    });

    it('deletes rollups older than the configured retention', async () => {
      const { db, service } = setup(7);

      await service.run(NOW);

      const deletes = db.sent('DELETE FROM rollup_1m');
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.params).toEqual([7]);
    });

    it('does its work in one transaction, and logs only when it changed something', async () => {
      const { db, service } = setup();
      db.existing = [
        'reading_20261015',
        'reading_20261016',
        'reading_20261017',
        'reading_20261018',
        'reading_20261019',
      ];

      await expect(service.run(NOW)).resolves.toEqual({ created: [], dropped: [] });
      expect(db.transactions).toBe(1);
      expect(log).not.toHaveBeenCalled();

      db.existing = ['reading_20260101'];
      await service.run(NOW);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Partitions created: \[reading_20261015.*\] dropped: \[reading_20260101\]$/,
        ),
      );
    });
  });

  describe('lifecycle', () => {
    it('refuses to start when the first run fails, so ingest never begins without partitions', async () => {
      jest.useFakeTimers();
      const { db, service } = setup();
      db.failure = new Error('connect ECONNREFUSED');

      await expect(service.onModuleInit()).rejects.toThrow('connect ECONNREFUSED');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('runs at start and then every hour, and logs a failed hourly run instead of throwing', async () => {
      jest.useFakeTimers();
      const { db, service } = setup();

      await service.onModuleInit();
      expect(db.transactions).toBe(1);

      await jest.advanceTimersByTimeAsync(HOUR - 1);
      expect(db.transactions).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(db.transactions).toBe(2);

      db.failure = new Error('connection terminated');
      await jest.advanceTimersByTimeAsync(HOUR);
      expect(db.transactions).toBe(3);
      expect(error).toHaveBeenCalledWith('connection terminated');

      service.beforeApplicationShutdown();
    });

    it('stops the hourly timer on shutdown', async () => {
      jest.useFakeTimers();
      const { db, service } = setup();
      await service.onModuleInit();
      expect(jest.getTimerCount()).toBe(1);

      service.beforeApplicationShutdown();

      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(2 * HOUR);
      expect(db.transactions).toBe(1);
    });
  });
});
