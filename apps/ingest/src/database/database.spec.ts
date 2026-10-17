import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { Database } from './database';

type Statement = 'BEGIN' | 'COMMIT' | 'ROLLBACK';

/**
 * A real `Database` over a fake connection. The `pg` Pool connects lazily, so building it with a
 * syntactically valid URL opens nothing; `connect` is replaced before `transaction` is called.
 */
function setup(failures: Partial<Record<Statement, Error>> = {}) {
  const settings: Partial<Record<keyof Env, unknown>> = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/telemetry_test',
    MIGRATE_ON_BOOT: false,
  };
  const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;
  const db = new Database(config);

  const statements: string[] = [];
  const client = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      statements.push(sql);
      const failure = failures[sql as Statement];
      if (failure) throw failure;
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  jest.spyOn(db.pool, 'connect').mockResolvedValue(client as unknown as never);
  return { db, client, statements };
}

describe('Database.transaction', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('commits and releases the client normally', async () => {
    const { db, client, statements } = setup();

    const result = await db.transaction(async (c) => {
      await c.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(statements).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows the error of a failing work', async () => {
    const { db, client, statements } = setup();
    const failure = new Error('work failed');

    await expect(
      db.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rethrows the original error, not the rollback error, and destroys the client', async () => {
    const rollbackFailure = new Error('connection terminated unexpectedly');
    const { db, client } = setup({ ROLLBACK: rollbackFailure });
    const failure = new Error('work failed');

    await expect(
      db.transaction(async (c) => {
        await c.query('INSERT INTO reading VALUES ($1)', ['secret-value']);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('ROLLBACK failed');
    expect(message).toContain(rollbackFailure.message);
    expect(message).not.toContain(failure.message);
    expect(message).not.toContain('secret-value');
    expect(message).not.toContain('INSERT');
  });

  it('destroys the client when BEGIN and the following ROLLBACK both fail', async () => {
    const beginFailure = new Error('connection refused');
    const { db, client, statements } = setup({
      BEGIN: beginFailure,
      ROLLBACK: new Error('connection terminated unexpectedly'),
    });
    const work = jest.fn();

    await expect(db.transaction(work)).rejects.toBe(beginFailure);

    expect(work).not.toHaveBeenCalled();
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('keeps the client when BEGIN fails but ROLLBACK works', async () => {
    const beginFailure = new Error('could not begin');
    const { db, client } = setup({ BEGIN: beginFailure });

    await expect(db.transaction(jest.fn())).rejects.toBe(beginFailure);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rethrows a failing COMMIT and destroys the client when ROLLBACK fails too', async () => {
    const commitFailure = new Error('commit failed');
    const { db, client } = setup({
      COMMIT: commitFailure,
      ROLLBACK: new Error('connection terminated unexpectedly'),
    });

    await expect(db.transaction(async () => 'unused')).rejects.toBe(commitFailure);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
